// 画面の点検（2026-10-07、手動で実行）: node scripts/qa-robust-browser.js
// 管理画面の一覧・通信のやり直し・キーボードでの二重送信・版の食い違い・生徒モード・応答の無い通信を確かめる。
// google.script.run の代わり（shim）で、呼び出しを遅らせる・返事を落とす・返事を返さないことができる。
// Playwright（グローバル導入）と Chromium が必要。自動チェックでは実行しない。
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const REPO = path.resolve(__dirname, '..');
const { load } = require(REPO + '/test/helpers/load.js');

const app = load({ now: '2026-09-10 10:00' });
const api = (n, ...a) => app.call(n, ...a);
const must = (res, label) => { if (!res || !res.ok) throw new Error(label + ': ' + JSON.stringify(res)); return res.data; };
app.get('setupInitial')();
const m = /loginId=(\S+) password=(\S+)/.exec(app.env.logs.find((l) => l.startsWith('INITIAL_ADMIN')));
const ADMIN = { id: m[1], pw: 'admin-pass-0001' };
{
  const first = must(api('api_login', m[1], m[2]), '管理者ログイン');
  must(api('api_changePassword', first.token, m[2], ADMIN.pw), 'パスワード変更');
  const t = must(api('api_login', ADMIN.id, ADMIN.pw), '管理者ログイン2').token;
  must(api('api_adminAddClass', t, 'A'), 'クラス');
  for (const ym of ['2026-09', '2026-10']) must(api('api_adminSetDeadline', t, { yearMonth: ym, className: 'A', deadlineAt: ym + '-28 23:59', actualDeadlineAt: null }), '締切');
  must(api('api_adminImportRoster', t, { className: 'A', enrollmentDate: '2026-04-01', rows: [
    { studentId: 'QA26001', name: 'TARO YAMADA', nameKana: 'ヤマダ タロウ' },
    { studentId: 'QA26002', name: 'HANAKO SATO', nameKana: 'サトウ ハナコ' },
    { studentId: 'QA26003', name: 'JIRO SUZUKI', nameKana: 'スズキ ジロウ' },
  ] }), '名簿');
  // 10月: QA26001 だけ確定済（ほかは未提出）
  const st = must(api('api_login', 'QA26001', ''), '学生ログイン').token;
  must(api('api_confirm', st, '2026-10', { '2': [{ start: '09:00', end: '13:00' }] }, 0), '確定');
}

const I18N = app.plain(app.get('I18N'));
const read = (f) => fs.readFileSync(path.join(REPO, 'src', f), 'utf8');
let html = read('index.html')
  .replace("<?!= include_('client_css') ?>", read('client_css.html'))
  .replace("<?!= include_('client_js') ?>", read('client_js.html'));
html = html.replace('<?!= JSON.stringify(I18N) ?>', JSON.stringify(I18N));
if (/<\?/.test(html)) throw new Error('未展開のテンプレートが残っている');

// 成功の返事は ok、失敗は ng に1度だけ渡す（本物の google.script.run と同じ）
const shim = `
window.google = { script: { get run() {
  let ok = () => {}, ng = () => {};
  const r = new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (f) => { ok = f; return r; };
    if (name === 'withFailureHandler') return (f) => { ng = f; return r; };
    return (...args) => { window.__api(name, JSON.stringify(args)).then((x) => ok(JSON.parse(x)), (e) => ng(e)); };
  }});
  return r;
}}};`;
html = html.replace('<head>', '<head><script>' + shim + '</script>');

// 呼び出しごとの振る舞い。plan[名前] に順に積む: { delay } 遅らせる / { lost: true } サーバでは済ませて返事を落とす /
// { fail: true } サーバに届かない / { hang: true } サーバでは済ませるが返事を返さない
const plan = {};
const ran = {}; // サーバで実際に動いた回数
const sent = []; // [名前, 引数]
const once = (name, b) => { (plan[name] = plan[name] || []).push(b); };
const runs = (name) => ran[name] || 0;

async function openPage(browser, opts) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'ja-JP' });
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
  page.on('popup', (p) => popups.push(p));
  if (opts && opts.fakeTimers) await page.clock.install({ time: new Date('2026-09-10T01:00:00Z') });
  else await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z'));
  await page.exposeFunction('__api', async (name, args) => {
    const xs = JSON.parse(args);
    sent.push([name, xs]);
    const b = (plan[name] || []).shift() || {};
    if (b.delay) await new Promise((r) => setTimeout(r, b.delay));
    if (b.fail) throw new Error('network');
    ran[name] = runs(name) + 1;
    const res = JSON.stringify(api(name, ...xs));
    if (b.lost) throw new Error('network');
    if (b.hang) return new Promise(() => {});
    return res;
  });
  await page.setContent(html);
  return { page, errors, dialogs };
}

const popups = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ページの中の時計に頼らず、node 側から状態を見に行く（偽の時計のページでも使える）
async function until(page, fn, arg, label, ms) {
  const end = Date.now() + (ms || 5000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() > end) throw new Error('待ちきれない: ' + label);
    await sleep(50);
  }
}
const idle = (page) => until(page, () => document.getElementById('global-spinner').hidden, null, '通信の終わり');
const step = (s) => console.log('▶ ' + s);

async function loginAdmin(page) {
  await page.click('#btn-show-password');
  await page.fill('#inp-loginId', ADMIN.id); await page.fill('#inp-password', ADMIN.pw); await page.click('#btn-login');
  await page.waitForSelector('#admin-screen:not([hidden])'); await idle(page);
}
async function loginStudent(page, sid) {
  await page.fill('#inp-loginId', sid); await page.click('#btn-login');
  await page.waitForSelector('#student-screen:not([hidden])'); await idle(page);
}
const boardIds = (page) => page.$$eval('#admin-board tr.board-row', (xs) => xs.map((x) => x.getAttribute('data-sid')));
const boardStatuses = (page) => page.$$eval('#admin-board tr.board-row td:nth-child(4)', (xs) => xs.map((x) => x.textContent));

(async () => {
  const browser = await chromium.launch({ args: ['--lang=ja-JP'], env: { ...process.env, LANG: 'ja_JP.UTF-8', LANGUAGE: 'ja' } });
  const { page, errors, dialogs } = await openPage(browser);
  await loginAdmin(page);

  step('1. 一覧: 遅れて届いた前の返事で、見出しの月と違う中身にならない（最後に頼んだ返事だけを使う）');
  await page.selectOption('#admin-class-filter', 'A'); await idle(page);
  once('api_adminBoard', { delay: 1200 }); // 10月（絞り込みなし）は遅く届く
  await page.click('#btn-admin-next-month');
  // 読み込み中に、状態の絞り込みを変える（こちらは速く届く）
  await page.evaluate(() => { const s = document.getElementById('admin-status-filter'); s.value = '確定済'; s.dispatchEvent(new Event('change')); });
  await sleep(1500); await idle(page);
  if ((await page.textContent('#admin-year-month')) !== '2026-10') throw new Error('見出しの月: ' + (await page.textContent('#admin-year-month')));
  const st1 = await boardStatuses(page);
  if (st1.join(',') !== '確定済') throw new Error('遅れた返事で一覧が上書きされた: ' + st1);
  if (!(await page.$('#admin-counts .adm-stat.is-active[data-status="確定済"]'))) throw new Error('札の「選択中」が絞り込みとそろわない');
  const before = sent.length;
  await page.click('#btn-print-board'); await idle(page);
  const pr = sent.slice(before).find((x) => x[0] === 'api_adminPrintHtml');
  if (!pr || pr[1][1].yearMonths.join() !== '2026-10' || pr[1][1].studentIds.join() !== 'QA26001') throw new Error('表示中を印刷が一覧と違う: ' + JSON.stringify(pr && pr[1][1]));

  step('2. 状態の選択を変えると読み直し、札の「選択中」もそろう');
  const nBoard = () => sent.filter((x) => x[0] === 'api_adminBoard').length;
  let n0 = nBoard();
  await page.selectOption('#admin-status-filter', '未提出'); await idle(page);
  if (nBoard() !== n0 + 1) throw new Error('状態を変えても読み直さない');
  const st2 = await boardStatuses(page);
  if (!st2.length || st2.some((s) => s !== '未提出')) throw new Error('未提出で絞れない: ' + st2);
  if (!(await page.$('#admin-counts .adm-stat.is-active[data-status="未提出"]'))) throw new Error('札が選択とそろわない');
  await page.click('#admin-counts [data-status="未提出"]'); await idle(page);
  if ((await page.inputValue('#admin-status-filter')) !== '') throw new Error('札をもう一度押しても解除されない');

  step('3・4. 検索欄で Enter を押すと検索する（全角・小文字・カナでも当たる）');
  n0 = nBoard();
  await page.fill('#admin-query', 'ｑａ２６００２');
  await page.press('#admin-query', 'Enter'); await idle(page);
  if (nBoard() !== n0 + 1) throw new Error('Enter で検索しない');
  if ((await boardIds(page)).join() !== 'QA26002') throw new Error('全角・小文字の学籍番号: ' + (await boardIds(page)));
  await page.fill('#admin-query', 'すずき'); await page.press('#admin-query', 'Enter'); await idle(page);
  if ((await boardIds(page)).join() !== 'QA26003') throw new Error('ひらがなでカナを探せない: ' + (await boardIds(page)));
  await page.fill('#admin-query', ''); await page.press('#admin-query', 'Enter'); await idle(page);

  step('5. 通信中は、フォーカスのあるボタンを Enter・スペースで押しても動かない（覆いでマウスが止まるのと同じ）');
  once('api_adminBoard', { delay: 800 });
  await page.focus('#btn-admin-next-month');
  await page.keyboard.press('Enter'); // 11月へ（遅い）
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await page.evaluate(() => document.getElementById('btn-admin-next-month').click());
  await sleep(1000); await idle(page);
  if ((await page.textContent('#admin-year-month')) !== '2026-11') throw new Error('通信中の Enter で月がさらに進んだ: ' + (await page.textContent('#admin-year-month')));
  const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (active === 'btn-admin-next-month') throw new Error('覆いを出してもボタンにフォーカスが残る');
  await page.click('#btn-admin-prev-month'); await page.click('#btn-admin-prev-month'); await idle(page);

  step('8. 生徒モードを Enter で2回押しても、管理者のトークンが学生のもので上書きされない');
  once('api_adminActAsDemoStudent', { delay: 800 });
  await page.focus('#btn-student-mode');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#student-screen:not([hidden])', { timeout: 15000 }); await idle(page);
  if (runs('api_adminActAsDemoStudent') !== 1) throw new Error('生徒モードが2回送られた: ' + runs('api_adminActAsDemoStudent'));
  await page.click('#btn-back-admin'); await page.waitForSelector('#admin-screen:not([hidden])'); await idle(page);
  if (!(await page.isVisible('#admin-screen')) || !(await page.isHidden('#login-screen'))) throw new Error('管理者に戻れない（トークンが上書きされた）');
  await page.click('#btn-open-settings'); await idle(page);
  if (await page.isHidden('#admin-dialog-overlay')) throw new Error('戻ったあと管理者の操作ができない');
  await page.click('#btn-dialog-close');

  step('6. 書き込みは通信失敗のあと送り直さず、保存されたか分からないことを知らせる（管理画面）');
  await page.click('#btn-open-classes'); await idle(page);
  once('api_adminAddClass', { lost: true });
  await page.fill('[data-key="name"]', 'B'); await page.click('[data-act="addClass"]'); await idle(page);
  await sleep(2500); await idle(page);
  if (runs('api_adminAddClass') !== 1) throw new Error('書き込みを送り直した: ' + runs('api_adminAddClass'));
  if (!(await page.textContent('#admin-form-error')).includes('保存されたか分かりません')) throw new Error('通信切れの知らせ: ' + (await page.textContent('#admin-form-error')));
  await page.click('#btn-dialog-close');

  step('6. 読むだけの呼び出しは、通信失敗のあと自動でやり直す');
  once('api_adminGetSettings', { fail: true });
  const r0 = runs('api_adminGetSettings');
  await page.click('#btn-open-settings');
  await until(page, () => !document.getElementById('admin-dialog-overlay').hidden, null, '設定が開く', 8000);
  if (runs('api_adminGetSettings') !== r0 + 1) throw new Error('読むだけの呼び出しをやり直していない');
  await page.click('#btn-dialog-close');

  step('6・7. 学生: 確定の返事が落ちても送り直さない。もう一度押すと版の食い違い → その場で読み直して「確定済」を出す');
  await page.click('#btn-logout-admin');
  await loginStudent(page, 'QA26003');
  if ((await page.textContent('#st-year-month')) !== '2026-09') throw new Error('学生の月: ' + (await page.textContent('#st-year-month')));
  await page.locator('#shifts-table tr.plan-row[data-day="3"] .sh-start').fill('10:00');
  await page.locator('#shifts-table tr.plan-row[data-day="3"] .sh-end').fill('14:00');
  once('api_confirm', { lost: true });
  await page.click('#btn-confirm-shift'); await idle(page);
  await sleep(2500); await idle(page);
  if (runs('api_confirm') !== 1) throw new Error('確定を送り直した: ' + runs('api_confirm'));
  const lostMsg = await page.textContent('#shift-error');
  if (lostMsg !== I18N.ja['error.CONN_LOST']) throw new Error('返事が落ちたときの知らせ: ' + lostMsg);
  await page.click('#btn-confirm-shift'); await idle(page); await idle(page);
  await until(page, () => document.getElementById('st-confirm-state').textContent === '確定済', null, '確定済の表示');
  const cmsg = await page.textContent('#shift-error');
  if (cmsg !== I18N.ja['label.conflictReloaded'] || /再読み込み/.test(cmsg)) throw new Error('版の食い違いの知らせ: ' + cmsg);
  for (const lang of Object.keys(I18N)) {
    if (/reload|再読み込み/i.test(I18N[lang]['label.conflictReloaded'])) throw new Error(lang + ': 再読み込みを求めている');
  }
  if ((await page.locator('#shifts-table tr.plan-row[data-day="3"] .sh-end').inputValue()) !== '14:00') throw new Error('読み直した表が違う');

  step('5. 学生: 確定ボタンにフォーカスして Enter を続けて押しても、確定は1回だけ送る');
  await page.click('#btn-next-month'); await idle(page);
  await page.locator('#shifts-table tr.plan-row[data-day="5"] .sh-start').fill('10:00');
  await page.locator('#shifts-table tr.plan-row[data-day="5"] .sh-end').fill('12:00');
  const c0 = runs('api_confirm');
  once('api_confirm', { delay: 800 });
  await page.focus('#btn-confirm-shift');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press(' ');
  await sleep(1200); await idle(page); await idle(page);
  if (runs('api_confirm') !== c0 + 1) throw new Error('Enter の連打で確定が2回送られた: ' + (runs('api_confirm') - c0));
  if ((await page.textContent('#shift-error')) !== '確定済み') throw new Error('確定の知らせ: ' + (await page.textContent('#shift-error')));

  step('7. 7言語すべてに新しい言葉がある');
  for (const lang of Object.keys(I18N)) for (const k of ['error.CONN_LOST', 'error.TIMEOUT', 'label.conflictReloaded']) {
    if (!I18N[lang][k]) throw new Error(lang + ' に ' + k + ' が無い');
  }

  step('10. 返事が来ない通信は 90秒で覆いを外して知らせる。書き込みは送り直さない');
  const p2 = await openPage(browser, { fakeTimers: true });
  await loginStudent(p2.page, 'QA26002');
  await p2.page.locator('#shifts-table tr.plan-row[data-day="4"] .sh-start').fill('10:00');
  await p2.page.locator('#shifts-table tr.plan-row[data-day="4"] .sh-end').fill('12:00');
  const s0 = runs('api_saveDraft');
  once('api_saveDraft', { hang: true });
  await p2.page.click('#btn-save-draft');
  await until(p2.page, () => !document.getElementById('global-spinner').hidden, null, '覆いが出る');
  await p2.page.clock.fastForward(60000);
  if (await p2.page.isHidden('#global-spinner')) throw new Error('60秒で覆いが消えた');
  await p2.page.clock.fastForward(31000);
  await until(p2.page, () => document.getElementById('global-spinner').hidden, null, '90秒で覆いが消える');
  const tmsg = await p2.page.textContent('#shift-error');
  if (tmsg !== I18N.ja['error.TIMEOUT']) throw new Error('応答が無いときの知らせ: ' + tmsg);
  await p2.page.clock.fastForward(20000);
  if (runs('api_saveDraft') !== s0 + 1) throw new Error('応答の無い書き込みを送り直した');
  // ボタンはまた押せる（画面が固まらない）。さっきの保存はサーバで済んでいたので、版の食い違い → 最新を読み直して出す
  await p2.page.click('#btn-save-draft');
  await until(p2.page, (t) => document.getElementById('shift-error').textContent === t, I18N.ja['label.conflictReloaded'], '押し直すと最新が出る');
  await until(p2.page, () => document.querySelector('#shifts-table tr.plan-row[data-day="4"] .sh-end') && document.querySelector('#shifts-table tr.plan-row[data-day="4"] .sh-end').value === '12:00', null, '済んでいた保存の中身');
  await p2.page.close();

  for (const p of popups) await p.close().catch(() => {});
  await browser.close();
  const all = errors.concat(p2.errors);
  if (all.length) { console.log(all.join('\n')); process.exit(1); }
  console.log('✅ 画面の点検（2026-10-07）: すべて成功（ブラウザのエラー 0件）');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
