// 画面の通し確認（手動で実行）: node scripts/e2e-browser.js
// 本物のサーバコード（偽のスプレッドシート上）とブラウザの画面をつないで、管理者と学生の一連の操作を行う。
// Playwright（グローバル導入）と Chromium が必要。自動チェックでは実行しない。
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const REPO = path.resolve(__dirname, '..');
const { load } = require(REPO + '/test/helpers/load.js');

const app = load({ now: '2026-09-10 10:00' });
const api = (n, ...a) => app.call(n, ...a);
app.get('setupInitial')();
const m = /loginId=(\S+) password=(\S+)/.exec(app.env.logs.find((l) => l.startsWith('INITIAL_ADMIN')));
const ADMIN = { id: m[1], pw: m[2] };

// 画面の組み立て（GAS のテンプレートを手で展開）
const I18N = app.plain(app.get('I18N'));
const read = (f) => fs.readFileSync(path.join(REPO, 'src', f), 'utf8');
let html = read('index.html')
  .replace("<?!= include_('client_css') ?>", read('client_css.html'))
  .replace("<?!= include_('client_js') ?>", read('client_js.html'));
html = html.replace('<?!= JSON.stringify(I18N) ?>', JSON.stringify(I18N));
if (/<\?/.test(html)) throw new Error('未展開のテンプレートが残っている');

const shim = `
window.__calls = [];
window.google = { script: { get run() {
  let ok = () => {}, ng = () => {};
  const r = new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (f) => { ok = f; return r; };
    if (name === 'withFailureHandler') return (f) => { ng = f; return r; };
    return (...args) => { window.__calls.push(name); window.__api(name, JSON.stringify(args)).then((x) => ok(JSON.parse(x))).catch(ng); };
  }});
  return r;
}}};`;
html = html.replace('<head>', '<head><script>' + shim + '</script>');

(async () => {
  const browser = await chromium.launch({ args: ['--lang=ja-JP'], env: { ...process.env, LANG: 'ja_JP.UTF-8', LANGUAGE: 'ja' } });
  // スマホの幅（390×844）・日本語の端末として開く（時刻欄が 24時間表示になる）
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(promptAnswer.shift() || undefined); });
  const dialogs = [];
  const promptAnswer = [];
  await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z'));
  // slowGetMonth: 月の読み込みを遅らせて、読み込み中の画面を確かめる。savedYm: 最後に保存した月
  let slowGetMonth = 0; let savedYm = null;
  await page.exposeFunction('__api', async (name, args) => {
    const xs = JSON.parse(args);
    if (name === 'api_getMonth' && slowGetMonth) await new Promise((r) => setTimeout(r, slowGetMonth));
    if (name === 'api_saveDraft' || name === 'api_confirm') savedYm = xs[1];
    return JSON.stringify(api(name, ...xs));
  });
  await page.setContent(html);
  const step = (s) => console.log('▶ ' + s);
  const wait = () => page.waitForFunction(() => document.getElementById('global-spinner').hidden, null, { timeout: 5000 });

  // --- 管理者: 初回ログイン → パスワード変更 ---
  step('管理者ログイン');
  if (!(await page.isHidden('#inp-password'))) throw new Error('ログイン画面にパスワード欄が最初から出ている');
  await page.click('#btn-show-password');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', ADMIN.pw); await page.click('#btn-login'); await wait();
  await page.waitForSelector('#change-password-screen:not([hidden])');
  await page.fill('#inp-cur-password', ADMIN.pw); await page.fill('#inp-new-password', 'admin-pass-0001'); await page.click('#btn-change-password'); await wait();
  await page.waitForSelector('#admin-screen:not([hidden])');

  step('最低賃金・勤務先の画面が無い');
  if (await page.$('#btn-open-wage')) throw new Error('最低賃金設定のボタンが残っている');
  if ((await page.textContent('#admin-screen')).includes('最低賃金')) throw new Error('管理画面に最低賃金の文字が残っている');

  step('クラスを登録（A と 名簿テスト科）。クラスが無いと学生の追加はできない');
  await page.click('#btn-open-classes'); await wait();
  for (const name of ['A', '名簿テスト科']) {
    await page.fill('[data-key="name"]', name); await page.click('[data-act="addClass"]'); await wait();
  }
  if (!(await page.textContent('#admin-dialog-body')).includes('名簿テスト科')) throw new Error('クラスが一覧に出ない');
  await page.click('#btn-dialog-close');

  step('入力期限を登録（クラスは選ぶ。日付だけ入れれば 23:59）');
  await page.click('#btn-open-deadline'); await wait();
  await page.fill('[data-key="yearMonth"]', '2026-10'); await page.selectOption('[data-key="className"]', 'A'); await page.fill('[data-key="deadlineAt"]', '2026-09-30');
  await page.click('[data-act="submit"]'); await wait();
  if (!dialogs.some((m) => m.includes('入力期限を保存しました（A）'))) throw new Error('入力期限が保存されない: ' + dialogs.slice(-1));

  step('長期休業を登録');
  await page.click('#btn-open-holiday'); await wait();
  await page.fill('[data-key="name"]', '秋休み'); await page.fill('[data-key="startDate"]', '2026-10-20'); await page.fill('[data-key="endDate"]', '2026-10-21');
  await page.click('[data-act="add"]'); await wait();
  await page.click('#btn-dialog-close');

  step('学生を追加（フォーム）');
  await page.click('#btn-open-student-form');
  await page.click('[data-act="submit"]');
  if (!(await page.textContent('#admin-form-error')).includes('学籍番号')) throw new Error('必須項目の案内が出ない');
  await page.fill('[data-key="studentId"]', '251001'); await page.fill('[data-key="name"]', '<b>テスト</b> 学生');
  await page.selectOption('[data-key="className"]', 'A'); await page.fill('[data-key="birthDate"]', '2000-04-01'); await page.fill('[data-key="enrollmentDate"]', '2025-04-01');
  await page.check('[data-key="workPermission"]'); await page.fill('[data-key="permissionExpires"]', '2027-12-31');
  await page.click('[data-act="submit"]'); await wait();
  const cred = await page.textContent('#admin-dialog-body');
  if (!cred.includes('学籍番号だけ')) throw new Error('追加後の案内: ' + cred);
  const stId = '251001';
  await page.click('#btn-dialog-close');
  await page.click('#btn-admin-search'); await wait();
  if (!(await page.innerHTML('#admin-board')).includes('&lt;b&gt;テスト&lt;/b&gt;')) throw new Error('氏名がエスケープされていない');

  step('ログアウト → 学生ログイン（学籍番号だけ・パスワード無し）');
  await page.click('#btn-logout-admin');
  await page.fill('#inp-loginId', stId); await page.click('#btn-login'); await wait();
  await page.waitForSelector('#student-screen:not([hidden])');
  await page.click('#btn-next-month'); await wait(); // 9月 → 10月
  if ((await page.textContent('#st-year-month')) !== '2026-10') throw new Error('月の切替');
  if (!(await page.textContent('#st-name')).includes('251001')) throw new Error('学生名が出ない');
  if (await page.$('#workplaces-section')) throw new Error('勤務先の欄が残っている');
  const day1 = await page.textContent('#shifts-table tr.day-row[data-day="1"] .day-dow');
  if (!day1.includes('木')) throw new Error('10/1 の曜日が木曜でない: ' + day1);
  const rows31 = await page.$$eval('#shifts-table tr.plan-row', (xs) => xs.length);
  if (rows31 !== 31) throw new Error('1日1行の表になっていない: ' + rows31);
  const hol = await page.$$eval('#shifts-table tr.holiday-day', (xs) => xs.map((x) => x.getAttribute('data-day')));
  if (hol.join(',') !== '20,21') throw new Error('長期休業の印: ' + hol);
  if (!(await page.textContent('#shifts-table tr.day-row[data-day="20"] .col-date')).includes('長期休暇')) throw new Error('長期休暇の印が出ない');
  if (await page.$('tr.day-row[data-day="5"].holiday-day')) throw new Error('10/5 が長期休業の色');
  if (!(await page.textContent('#shifts-table thead')).includes('勤務予定時間')) throw new Error('見出しに勤務予定時間が無い');
  const totalText = () => page.textContent('#shifts-table .month-total');
  if ((await totalText()) !== '勤務予定時間合計: 0時間') throw new Error('空の月の合計: ' + (await totalText()));

  step('シフト入力: 休憩・実働・月の合計が、保存前にその場で計算される');
  const row = (day) => page.locator('#shifts-table tr.plan-row[data-day="' + day + '"]');
  const setRow = async (r, s, e) => { await r.locator('.sh-start').fill(s); await r.locator('.sh-end').fill(e); };
  const cells = async (r) => [await r.locator('.cell-break').textContent(), await r.locator('.cell-work').textContent()].join(' / ');
  await setRow(row(3), '21:00', '06:00');
  if ((await cells(row(3))) !== '1時間 / 8時間') throw new Error('21:00〜06:00 の休憩・実働: ' + (await cells(row(3))));
  if ((await totalText()) !== '勤務予定時間合計: 8時間') throw new Error('合計が更新されない: ' + (await totalText()));
  await setRow(row(1), '22:00', '02:00');
  if ((await cells(row(1))) !== '0分 / 4時間') throw new Error('22:00〜02:00: ' + (await cells(row(1))));
  await setRow(row(2), '09:00', '18:15');
  if ((await cells(row(2))) !== '1時間 / 8時間15分') throw new Error('09:00〜18:15: ' + (await cells(row(2))));
  if ((await totalText()) !== '勤務予定時間合計: 20時間15分') throw new Error('合計: ' + (await totalText()));
  // 両方を消せばその日は勤務なし（合計から外れる）
  await setRow(row(4), '10:00', '11:00');
  await setRow(row(4), '', '');
  if ((await cells(row(4))) !== ' / ') throw new Error('消した日の表示: ' + (await cells(row(4))));
  if ((await totalText()) !== '勤務予定時間合計: 20時間15分') throw new Error('消した後の合計: ' + (await totalText()));

  step('スマホ幅（360px）でも横にはみ出さない');
  await page.setViewportSize({ width: 360, height: 740 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) {
    const wide = await page.evaluate(() => Array.from(document.querySelectorAll('#student-screen *'))
      .filter((x) => x.getBoundingClientRect().right > window.innerWidth + 0.5).slice(0, 5)
      .map((x) => x.tagName + '.' + x.className + ' ' + Math.round(x.getBoundingClientRect().right)).join(', '));
    throw new Error('360px で横スクロールが出る: ' + over + 'px（' + wide + '）');
  }
  const inputW = await page.$eval('#shifts-table tr.plan-row[data-day="1"] .sh-start', (x) => x.getBoundingClientRect().width);
  if (inputW < 60) throw new Error('時刻の入力欄が狭すぎる: ' + inputW);
  await page.setViewportSize({ width: 390, height: 844 });

  step('途中保存 → その日の行の下に注意（8時間超）が出る');
  await page.click('#btn-save-draft'); await wait(); await wait();
  const msg = await page.textContent('#shift-error');
  if (msg !== '保存しました') throw new Error('途中保存の知らせ: ' + msg);
  const day2codes = await page.textContent('#shifts-table tr.day-codes-row[data-day="2"]');
  if (!day2codes.includes('1日8時間超過')) throw new Error('2日の注意が出ない: ' + day2codes);
  if ((await cells(row(3))) !== '1時間 / 8時間') throw new Error('保存後の表示: ' + (await cells(row(3))));
  if (process.env.E2E_SCREENSHOT) {
    await page.evaluate(() => window.scrollTo(0, document.getElementById('shifts-section').getBoundingClientRect().top + window.scrollY - document.querySelector('#student-screen .top-bar').offsetHeight - 8));
    await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  }

  step('数字の打ち込み: 2100〜600 は 21:00〜06:00 にそろい、休憩・実働も出る。15分刻みでない時刻は赤枠');
  await row(7).locator('.sh-start').fill('2100');
  await row(7).locator('.sh-end').fill('600');
  if ((await cells(row(7))) !== '1時間 / 8時間') throw new Error('打ち込み中の計算: ' + (await cells(row(7))));
  await row(7).locator('.sh-end').blur();
  await row(7).locator('.sh-start').focus(); await row(7).locator('.sh-start').blur();
  const typed = [await row(7).locator('.sh-start').inputValue(), await row(7).locator('.sh-end').inputValue()].join('〜');
  if (typed !== '21:00〜06:00') throw new Error('打ち込みのそろえ方: ' + typed);
  if (await row(7).locator('.sh-start').getAttribute('type') !== 'text') throw new Error('時刻欄がダイヤルのまま');
  await row(7).locator('.sh-end').fill('610'); await row(7).locator('.sh-end').blur();
  if (!(await row(7).locator('.sh-end').getAttribute('class')).includes('time-invalid')) throw new Error('15分刻みでない時刻に赤枠が出ない');
  await row(7).locator('.sh-start').fill(''); await row(7).locator('.sh-end').fill(''); await row(7).locator('.sh-end').blur();

  step('入力途中の行は入力不足で止まる（黙って消さない）');
  await row(5).locator('.sh-start').fill('10:00');
  await page.click('#btn-save-draft'); await wait();
  if (!(await page.textContent('#shift-error')).includes('入力不足')) throw new Error('入力不足の案内');
  await row(5).locator('.sh-start').fill('');

  step('言語切替（ネパール語・ベトナム語・ベンガル語・ミャンマー語）');
  await page.selectOption('#student-screen .lang-select', 'ne');
  if (!(await page.textContent('#btn-save-draft')).match(/[ऀ-ॿ]/)) throw new Error('ネパール語に変わらない');
  await page.selectOption('#student-screen .lang-select', 'vi');
  if ((await page.textContent('#shifts-table tr.day-row[data-day="1"] .day-dow')).indexOf('T5') < 0) throw new Error('ベトナム語の曜日');
  if (!(await totalText()).includes('Tổng giờ làm dự kiến')) throw new Error('ベトナム語の合計: ' + (await totalText()));
  await page.selectOption('#student-screen .lang-select', 'bn');
  if (!(await page.textContent('#btn-save-draft')).match(/[\u0980-\u09FF]/)) throw new Error('ベンガル語に変わらない');
  await page.selectOption('#student-screen .lang-select', 'my');
  if (!(await page.textContent('#btn-save-draft')).match(/[\u1000-\u109F]/)) throw new Error('ミャンマー語に変わらない');
  await page.selectOption('#student-screen .lang-select', 'ja');

  step('ページを読み込み直すとシフトが残っている（保存済みの内容）');
  await page.click('#btn-prev-month'); await wait(); await page.click('#btn-next-month'); await wait();
  const v = await row(2).locator('.sh-end').inputValue();
  if (v !== '18:15') throw new Error('保存したシフトが表示されない: ' + v);
  if ((await totalText()) !== '勤務予定時間合計: 20時間15分') throw new Error('読み込み直した合計: ' + (await totalText()));

  step('月を切り替えた直後は、読み込み終わるまで表が空で保存できない。保存は表に出ている月で送る');
  slowGetMonth = 800;
  await page.click('#btn-next-month');
  if (!(await page.isDisabled('#btn-save-draft'))) throw new Error('読み込み中に保存ボタンが押せる');
  if ((await page.$$eval('#shifts-table tr.plan-row', (xs) => xs.length)) !== 0) throw new Error('読み込み中に前の月の表が残っている');
  await page.click('#btn-prev-month');
  await page.waitForTimeout(1000); await wait();
  slowGetMonth = 0;
  if ((await page.textContent('#st-year-month')) !== '2026-10') throw new Error('月が戻らない');
  if ((await row(2).locator('.sh-end').inputValue()) !== '18:15') throw new Error('遅れて届いた11月の表で上書きされた');
  await page.click('#btn-save-draft'); await wait();
  if (savedYm !== '2026-10') throw new Error('保存した月がずれた: ' + savedYm);

  step('学生で確定: 1日8時間超の日があると止まり、その日が赤くなる。直せば確定できる');
  if ((await page.textContent('#st-confirm-state')) !== '未確定') throw new Error('確定前に「未確定」が出ない: ' + (await page.textContent('#st-confirm-state')));
  await page.click('#btn-confirm-shift'); await wait(); await wait();
  if (!(await page.textContent('#shift-error')).startsWith('確定できません。')) throw new Error('「確定できません。」で始まらない: ' + (await page.textContent('#shift-error')));
  if (!(await page.textContent('#shift-error')).includes('2日: 1日8時間超過')) throw new Error('8時間超で止まらない: ' + (await page.textContent('#shift-error')));
  if (!(await row(2).getAttribute('class')).includes('row-error')) throw new Error('8時間超の日が赤くならない');
  await row(2).locator('.sh-end').fill('18:00');
  await page.click('#btn-confirm-shift'); await wait(); await wait();
  if ((await page.textContent('#shift-error')) !== '確定済み') throw new Error('確定の知らせ: ' + (await page.textContent('#shift-error')));
  if ((await page.textContent('#st-confirm-state')) !== '確定済') throw new Error('確定後に「確定済」が出ない: ' + (await page.textContent('#st-confirm-state')));

  // 時計を進めるとセッション（120分）が切れる。画面がログインに戻ることも確かめ、入り直す。
  const relogin = async () => {
    await page.click('#btn-prev-month'); await wait();
    await page.waitForSelector('#login-screen:not([hidden])');
    if (!(await page.textContent('#login-error')).includes('ログイン')) throw new Error('期限切れの案内が出ない');
    await page.fill('#inp-loginId', stId); await page.click('#btn-login'); await wait();
    await page.click('#btn-next-month'); await wait();
  };
  step('締切後は入力できない（セッション切れ → 入り直し）');
  app.env.clock.set('2026-10-01 00:05');
  await relogin();
  if (!(await page.isDisabled('#btn-save-draft'))) throw new Error('締切後に保存ボタンが押せる');
  if ((await page.textContent('#st-closed-notice')) !== '締切済み') throw new Error('締切済みの表示');

  step('実績確認（11/2）: 予定どおり → 保存 → 確認');
  app.env.clock.set('2026-11-02 10:00');
  await relogin();
  await page.waitForSelector('#actual-section:not([hidden])');
  const arow = (day) => page.locator('#actual-table tr.actual-shift-row[data-day="' + day + '"]');
  if (!(await page.textContent('#actual-table thead')).includes('勤務時間')) throw new Error('実績の見出し');
  // 実績を変えてから「予定どおり」で予定に戻す
  await arow(2).locator('.sh-end').fill('13:00');
  if ((await arow(2).locator('.cell-work').textContent()) !== '4時間') throw new Error('実績の実働がその場で変わらない');
  await page.click('#actual-table tr.actual-shift-row[data-day="2"] .btn-as-planned');
  const a2 = [await arow(2).locator('.sh-start').inputValue(), await arow(2).locator('.sh-end').inputValue()].join('〜');
  if (a2 !== '09:00〜18:00') throw new Error('予定どおりで写らない: ' + a2);
  if ((await arow(2).locator('.cell-work').textContent()) !== '8時間') throw new Error('予定どおり後の実働');
  if (!(await page.textContent('#actual-table .month-total')).includes('20時間')) throw new Error('実績の合計: ' + (await page.textContent('#actual-table .month-total')));
  await page.click('#btn-save-actual'); await wait(); await wait();
  await page.click('#btn-confirm-actual'); await wait(); await wait();
  if (!(await page.textContent('#actual-error')).includes('確定済み')) throw new Error('実績の確認: ' + (await page.textContent('#actual-error')));
  if ((await page.textContent('#actual-codes')).includes('予定どおり') || (await page.textContent('#history-list')).includes('未確認')) throw new Error('生徒に実績確認の進み具合が出ている');

  step('管理者: 学校設定・印刷（ポップアップ）');
  await page.click('#btn-logout-st');
  if (!(await page.isHidden('#inp-password'))) throw new Error('ログアウト後にパスワード欄が出たまま');
  await page.click('#btn-show-password');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', 'admin-pass-0001'); await page.click('#btn-login'); await wait();
  await page.click('#btn-open-settings'); await wait();
  await page.fill('[data-key="retentionMonths"]', '1');
  await page.click('[data-act="submit"]'); await wait();
  if (!(await page.textContent('#admin-form-error')).includes('リクエスト')) throw new Error('範囲外の設定を止めない');
  await page.click('#btn-dialog-close');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#btn-print-board')]);
  await popup.waitForFunction(() => document.querySelectorAll('.student-page').length === 1, null, { timeout: 5000 });
  const printed = await popup.textContent('body');
  if (!printed.includes('勤務予定時間合計') || !printed.includes('実働(合計)時間')) throw new Error('印刷に紙の予定表の欄が無い');
  if (printed.includes('実績')) throw new Error('印刷に実績が残っている');
  if (/勤務先|時給|給与|¥/.test(printed)) throw new Error('印刷に勤務先・お金の欄が残っている');
  await popup.close();

  step('管理画面: 行を押すと詳細が開く・四半期確認と試用データのボタンは無い');
  for (const id of ['#btn-open-quarter', '#btn-seed-demo', '#btn-print-all-class']) {
    if (await page.$(id)) throw new Error('消したはずのボタンが残っている: ' + id);
  }
  await page.click('#admin-board tr.board-row td:nth-child(2)'); await wait();
  if (await page.isHidden('#admin-dialog-overlay')) throw new Error('行を押しても詳細が開かない');
  await page.selectOption('#detail-ym', '2026-10');
  if (!(await page.textContent('#detail-month')).includes('〜')) throw new Error('詳細に学生の入力した時間が出ない: ' + (await page.textContent('#detail-month')));
  await page.click('#btn-dialog-close');

  step('名簿から一括登録: Excel から貼った表（番号・学籍番号・ローマ字・セル内改行のあるカナ）を読み取って登録し、学籍番号だけで入れる');
  await page.click('#btn-open-roster');
  await page.selectOption('[data-key="className"]', '名簿テスト科');
  await page.fill('#roster-text', '1\tTEST26001\tTARO  YAMADA\t"タロウ　\nヤマダ"\n2\tTEST26002\tHANAKO SATO\tハナコ　サトウ\n\n');
  await page.click('[data-act="rosterCheck"]');
  const prev = await page.textContent('#roster-preview');
  if (!prev.includes('2人') || !prev.includes('TARO YAMADA') || !prev.includes('タロウ　ヤマダ')) throw new Error('名簿の読み取り: ' + prev);
  await page.click('[data-act="rosterSave"]'); await wait();
  if (!(await page.textContent('#admin-dialog-body')).includes('2人を登録しました')) throw new Error('名簿の登録: ' + (await page.textContent('#admin-dialog-body')));
  await page.click('#btn-dialog-close');

  step('生徒モード: ボタン1つで生徒Aの画面に入り、管理者に戻る');
  await page.click('#btn-student-mode'); await wait(); await wait();
  if (!dialogs.some((m) => m.includes('DEMO-A') && m.includes('学籍番号'))) throw new Error('試用の生徒のログイン案内が出ない');
  await page.waitForSelector('#student-screen:not([hidden])');
  await page.waitForFunction(() => document.getElementById('st-name').textContent.includes('DEMO-A'));
  if (await page.isHidden('#btn-back-admin')) throw new Error('管理者に戻るボタンが無い');
  await page.click('#btn-back-admin'); await wait();
  await page.waitForSelector('#admin-screen:not([hidden])');
  if (!(await page.isHidden('#btn-back-admin'))) throw new Error('管理者に戻った後もボタンが残る');

  step('管理者のID・パスワード変更: 変えたあと、新しいIDとパスワードで入れる');
  await page.click('#btn-open-credentials');
  await page.fill('[data-key="currentPassword"]', 'admin-pass-0001');
  await page.fill('[data-key="newLoginId"]', 'sensei01');
  await page.fill('[data-key="newPassword"]', 'new-admin-pass-01');
  await page.fill('[data-key="newPassword2"]', 'new-admin-pass-01');
  await page.click('[data-act="submit"]'); await wait();
  if (!dialogs.some((m) => m.includes('sensei01'))) throw new Error('IDの変更が知らされない');
  await page.click('#btn-logout-admin');
  await page.click('#btn-show-password');
  await page.fill('#inp-loginId', 'sensei01'); await page.fill('#inp-password', 'new-admin-pass-01'); await page.click('#btn-login'); await wait();
  await page.waitForSelector('#admin-screen:not([hidden])');

  await browser.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('✅ 画面の通し確認: すべて成功（ブラウザのエラー 0件）');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
