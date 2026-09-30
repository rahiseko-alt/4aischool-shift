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
const PREFS = app.plain(app.get('PREFECTURES_'));
const read = (f) => fs.readFileSync(path.join(REPO, 'src', f), 'utf8');
let html = read('index.html')
  .replace("<?!= include_('client_css') ?>", read('client_css.html'))
  .replace("<?!= include_('client_js') ?>", read('client_js.html'));
html = html.replace('<?!= JSON.stringify(I18N) ?>', JSON.stringify(I18N)).replace('<?!= JSON.stringify(PREFECTURES_) ?>', JSON.stringify(PREFS));
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
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(promptAnswer.shift() || undefined); });
  const dialogs = [];
  const promptAnswer = [];
  await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z'));
  await page.exposeFunction('__api', async (name, args) => JSON.stringify(api(name, ...JSON.parse(args))));
  await page.setContent(html);
  const step = (s) => console.log('▶ ' + s);
  const wait = () => page.waitForFunction(() => document.getElementById('global-spinner').hidden, null, { timeout: 5000 });

  // --- 管理者: 初回ログイン → パスワード変更 ---
  step('管理者ログイン');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', ADMIN.pw); await page.click('#btn-login'); await wait();
  await page.waitForSelector('#change-password-screen:not([hidden])');
  await page.fill('#inp-cur-password', ADMIN.pw); await page.fill('#inp-new-password', 'admin-pass-0001'); await page.click('#btn-change-password'); await wait();
  await page.waitForSelector('#admin-screen:not([hidden])');

  step('最低賃金を登録');
  await page.click('#btn-open-wage'); await wait();
  await page.selectOption('[data-key="prefecture"]', '愛知県');
  await page.fill('[data-key="amount"]', '1100'); await page.fill('[data-key="effectiveFrom"]', '2025-10-18');
  await page.click('[data-act="add"]'); await wait();
  if (!(await page.textContent('#admin-dialog-body')).includes('愛知県 ¥1,100')) throw new Error('最低賃金が一覧に出ない');
  await page.click('#btn-dialog-close');

  step('締切を登録');
  await page.click('#btn-open-deadline');
  await page.fill('[data-key="yearMonth"]', '2026-10'); await page.fill('[data-key="className"]', 'A'); await page.fill('[data-key="deadlineAt"]', '2026-09-30 23:59');
  await page.click('[data-act="submit"]'); await wait();

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
  await page.fill('[data-key="className"]', 'A'); await page.fill('[data-key="birthDate"]', '2000-04-01'); await page.fill('[data-key="enrollmentDate"]', '2025-04-01');
  await page.check('[data-key="workPermission"]'); await page.fill('[data-key="permissionExpires"]', '2027-12-31');
  await page.click('[data-act="submit"]'); await wait();
  const cred = await page.textContent('#admin-dialog-body');
  const stId = /ログインID: ([A-Za-z0-9]+)/.exec(cred)[1];
  const stPw = /初期パスワード: ([A-Za-z0-9]+)/.exec(cred)[1];
  await page.click('#btn-dialog-close');
  await page.click('#btn-admin-search'); await wait();
  if (!(await page.innerHTML('#admin-board')).includes('&lt;b&gt;テスト&lt;/b&gt;')) throw new Error('氏名がエスケープされていない');

  step('ログアウト → 学生ログイン');
  await page.click('#btn-logout-admin');
  await page.fill('#inp-loginId', stId); await page.fill('#inp-password', stPw); await page.click('#btn-login'); await wait();
  await page.fill('#inp-cur-password', stPw); await page.fill('#inp-new-password', 'student-pass-1'); await page.click('#btn-change-password'); await wait();
  await page.waitForSelector('#student-screen:not([hidden])');
  await page.click('#btn-next-month'); await wait(); // 9月 → 10月
  if ((await page.textContent('#st-year-month')) !== '2026-10') throw new Error('月の切替');
  if (!(await page.textContent('#st-name')).includes('251001')) throw new Error('学生名が出ない');
  const day1 = await page.textContent('#shifts-table .day-card[data-day="1"] .day-dow');
  if (!day1.includes('木')) throw new Error('10/1 の曜日が木曜でない: ' + day1);
  const hol = await page.$$eval('#shifts-table .holiday-day', (xs) => xs.map((x) => x.getAttribute('data-day')));
  if (hol.join(',') !== '20,21') throw new Error('長期休業の赤枠: ' + hol);
  if (await page.$('.day-card[data-day="5"].holiday-day')) throw new Error('10/5 が赤枠');

  step('勤務先を追加');
  await page.click('#btn-add-workplace');
  await page.fill('#wp-name', 'コンビニA'); await page.selectOption('#wp-pref', '愛知県'); await page.fill('#wp-job', 'レジ'); await page.fill('#wp-wage', '1200');
  await page.click('#btn-save-workplace'); await wait(); await wait();
  const wpBadge = await page.textContent('.wp-item-card .badge');
  if (wpBadge !== '勤務先要確認') throw new Error('確認中の表示: ' + wpBadge);

  step('シフト入力 → 途中保存（深夜またぎ・同日2行）');
  const wpId = await page.$eval('#shifts-table .day-card[data-day="1"] .wp-select option:nth-child(2)', (o) => o.value);
  const row = (day, i) => page.locator('#shifts-table .day-card[data-day="' + day + '"] .shift-row').nth(i);
  const setRow = async (r, s, e) => { await r.locator('.wp-select').selectOption(wpId); await r.locator('.sh-start').fill(s); await r.locator('.sh-end').fill(e); };
  await setRow(row(1, 0), '22:00', '02:00');
  await page.click('.day-card[data-day="2"] .btn-add-row');
  await setRow(row(2, 0), '09:00', '12:00');
  await setRow(row(2, 1), '18:00', '23:00');
  await page.click('#btn-save-draft'); await wait(); await wait();
  const msg = await page.textContent('#shift-error');
  if (msg !== '保存しました') throw new Error('途中保存の知らせ: ' + msg);
  const calc = await row(2, 1).locator('.shift-row-calc').textContent();
  if (!calc.includes('深夜 1:00') || !calc.includes('¥6,300')) throw new Error('計算欄: ' + calc);

  step('確定 → 勤務先が確認中なので止まる');
  await page.click('#btn-confirm-shift'); await wait();
  const cmsg = await page.textContent('#shift-error');
  if (!cmsg.includes('勤務先要確認')) throw new Error('確定の拒否理由: ' + cmsg);

  step('入力途中の行は入力不足で止まる（黙って消さない）');
  await row(3, 0).locator('.sh-start').fill('10:00');
  await page.click('#btn-save-draft'); await wait();
  if (!(await page.textContent('#shift-error')).includes('入力不足')) throw new Error('入力不足の案内');
  await row(3, 0).locator('.sh-start').fill('');

  step('言語切替（ネパール語・ベトナム語）');
  await page.click('#student-screen .lang-switch button[data-lang="ne"]');
  if (!(await page.textContent('#btn-save-draft')).match(/[ऀ-ॿ]/)) throw new Error('ネパール語に変わらない');
  await page.click('#student-screen .lang-switch button[data-lang="vi"]');
  if ((await page.textContent('#shifts-table .day-card[data-day="1"] .day-dow')).indexOf('T5') < 0) throw new Error('ベトナム語の曜日');
  await page.click('#student-screen .lang-switch button[data-lang="ja"]');

  step('ページを読み込み直すとシフトが残っている（保存済みの内容）');
  await page.click('#btn-prev-month'); await wait(); await page.click('#btn-next-month'); await wait();
  const v = await row(2, 1).locator('.sh-end').inputValue();
  if (v !== '23:00') throw new Error('保存したシフトが表示されない: ' + v);

  step('管理者で勤務先を OK にする');
  await page.click('#btn-logout-st');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', 'admin-pass-0001'); await page.click('#btn-login'); await wait();
  await page.click('#btn-admin-next-month'); await wait();
  if (!(await page.textContent('#admin-board')).includes('勤務先確認待ち 1')) throw new Error('確認待ちの印');
  await page.click('.btn-admin-detail'); await wait();
  await page.click('[data-act="wpok"]'); await wait(); await wait();
  if (!(await page.textContent('#admin-dialog-body')).includes('OK')) throw new Error('OK にならない');
  await page.click('#btn-dialog-close');

  step('学生で確定');
  await page.click('#btn-logout-admin');
  await page.fill('#inp-loginId', stId); await page.fill('#inp-password', 'student-pass-1'); await page.click('#btn-login'); await wait();
  await page.click('#btn-next-month'); await wait();
  if ((await page.textContent('.wp-item-card .badge')) !== '確認済') throw new Error('確認済の表示');
  await page.click('#btn-confirm-shift'); await wait(); await wait();
  if ((await page.textContent('#shift-error')) !== '確定済み') throw new Error('確定の知らせ: ' + (await page.textContent('#shift-error')));

  // 時計を進めるとセッション（120分）が切れる。画面がログインに戻ることも確かめ、入り直す。
  const relogin = async () => {
    await page.click('#btn-prev-month'); await wait();
    await page.waitForSelector('#login-screen:not([hidden])');
    if (!(await page.textContent('#login-error')).includes('ログイン')) throw new Error('期限切れの案内が出ない');
    await page.fill('#inp-loginId', stId); await page.fill('#inp-password', 'student-pass-1'); await page.click('#btn-login'); await wait();
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
  await page.click('#actual-table .day-card[data-day="2"] .btn-as-planned');
  const n = await page.$$eval('#actual-table .day-card[data-day="2"] .actual-shift-row', (x) => x.length);
  if (n !== 2) throw new Error('予定どおりで2行写らない: ' + n);
  await page.click('#btn-save-actual'); await wait(); await wait();
  await page.click('#btn-confirm-actual'); await wait(); await wait();
  if (!(await page.textContent('#actual-codes')).includes('予定どおり')) throw new Error('実績の状態: ' + (await page.textContent('#actual-codes')));

  step('管理者: 四半期確認・学校設定・印刷（ポップアップ）');
  await page.click('#btn-logout-st');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', 'admin-pass-0001'); await page.click('#btn-login'); await wait();
  await page.click('#btn-open-quarter');
  await page.fill('[data-key="endYearMonth"]', '2026-10');
  await page.click('[data-act="submit"]'); await wait();
  if (!(await page.textContent('#admin-dialog-body')).includes('予定どおり')) throw new Error('四半期確認の表');
  await page.click('#btn-dialog-close');
  await page.click('#btn-open-settings'); await wait();
  await page.fill('[data-key="retentionMonths"]', '1');
  await page.click('[data-act="submit"]'); await wait();
  if (!(await page.textContent('#admin-form-error')).includes('リクエスト')) throw new Error('範囲外の設定を止めない');
  await page.click('#btn-dialog-close');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.btn-admin-print')]);
  await popup.waitForFunction(() => document.querySelectorAll('.student-page').length === 1, null, { timeout: 5000 });
  await popup.close();

  await browser.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('✅ 画面の通し確認: すべて成功（ブラウザのエラー 0件）');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
