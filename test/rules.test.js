'use strict';
// 暴走止め: 公開してよい関数・使ってはいけない機能・ファイル構成。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, SRC_DIR } = require('./helpers/load');

// ブラウザ（google.script.run）から呼べてしまう関数は、この一覧だけ。
const REQUIRED_API = [
  'api_login', 'api_logout', 'api_changePassword',
  'api_getMonth', 'api_saveDraft', 'api_confirm', 'api_saveActual', 'api_confirmActual', 'api_getHistory',
  'api_saveWorkplace', 'api_listWorkplaces',
  'api_adminBoard', 'api_adminStudentDetail', 'api_adminUpsertStudent', 'api_adminResetPassword', 'api_adminUnlockLogin',
  'api_adminCreateAdmin', 'api_adminVerifyWorkplace', 'api_adminGrantUnlock', 'api_adminSchoolConfirm', 'api_adminQuarterCheck',
  'api_adminSetDeadline', 'api_adminSetHoliday', 'api_adminDeleteHoliday', 'api_adminListHolidays',
  'api_adminSetMinimumWage', 'api_adminListMinimumWages', 'api_adminGetSettings', 'api_adminSetSettings',
  'api_adminPrintHtml', 'api_adminPurgeExpired', 'api_adminSeedDemo', 'api_adminActAsDemoStudent',
];
const OTHER_PUBLIC = ['doGet', 'setupInitial', 'backupMonthly', 'installTriggers', 'evaluateMonth'];

test('公開関数（名前が _ で終わらないトップレベル関数）は決められた一覧だけ', () => {
  const app = load();
  const allowed = new Set([...REQUIRED_API, ...OTHER_PUBLIC]);
  const publicFns = Object.keys(app.context).filter((k) => typeof app.context[k] === 'function' && !k.endsWith('_'));
  const builtins = new Set(['Date']);
  const extra = publicFns.filter((k) => !allowed.has(k) && !builtins.has(k));
  assert.deepEqual(extra, [], '一覧に無い公開関数がある。内部の関数は名前の末尾に _ を付けること');
});

test('必要な窓口の関数がすべてある', () => {
  const app = load();
  for (const name of [...REQUIRED_API, ...OTHER_PUBLIC]) {
    assert.equal(typeof app.context[name], 'function', name + ' が無い');
  }
});

function srcFiles() {
  return fs.readdirSync(SRC_DIR).map((f) => ({ name: f, full: path.join(SRC_DIR, f) }));
}

test('src/ には .js・.html・appsscript.json だけを置き、サブフォルダを作らない', () => {
  for (const f of srcFiles()) {
    assert.ok(fs.statSync(f.full).isFile(), f.name + ' はフォルダ');
    assert.ok(/\.(js|html)$/.test(f.name) || f.name === 'appsscript.json', f.name);
  }
  assert.ok(fs.existsSync(path.join(SRC_DIR, 'appsscript.json')), 'appsscript.json が無い');
});

test('appsscript.json: タイムゾーン Asia/Tokyo・V8・デプロイ者として実行・全員アクセス', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));
  assert.equal(m.timeZone, 'Asia/Tokyo');
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.webapp && m.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(m.webapp && m.webapp.access, 'ANYONE_ANONYMOUS');
});

// 使ってはいけない機能。見つかったら不合格。
const FORBIDDEN = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/document\.cookie/, 'document.cookie'],
  [/Utilities\.formatDate/, 'Utilities.formatDate（+9時間の固定計算を使う）'],
  [/\bSession\.get/, 'Session（利用者の識別には使わない）'],
  [/\bUrlFetchApp\b/, 'UrlFetchApp（外部通信は禁止）'],
  [/\b(MailApp|GmailApp)\b/, 'メール送信'],
  [/\bCacheService\b/, 'CacheService'],
  [/\beval\s*\(/, 'eval'],
  [/new\s+Function\s*\(/, 'new Function'],
  [/^\s*(import|export)\s/m, 'import/export 構文'],
  [/\brequire\s*\(/, 'require'],
  [/<script[^>]+src\s*=/i, '外部スクリプトの読み込み'],
  [/<link[^>]+href\s*=\s*["']https?:/i, '外部CSS・Webフォントの読み込み'],
  [/fonts\.googleapis/, 'Webフォント'],
  [/\.getPdf|getAs\(\s*['"]application\/pdf/, 'PDF生成'],
];

test('使ってはいけない機能を使っていない', () => {
  for (const f of srcFiles()) {
    if (!/\.(js|html)$/.test(f.name)) continue;
    const code = fs.readFileSync(f.full, 'utf8');
    for (const [re, label] of FORBIDDEN) assert.doesNotMatch(code, re, `${f.name}: ${label}`);
  }
});

test('DriveApp・ScriptApp は Backup.js の中でだけ使う', () => {
  for (const f of srcFiles()) {
    if (!/\.(js|html)$/.test(f.name) || f.name === 'Backup.js') continue;
    const code = fs.readFileSync(f.full, 'utf8');
    assert.doesNotMatch(code, /\b(DriveApp|ScriptApp)\b/, f.name);
  }
});

test('evaluateMonth の中では現在時刻・乱数・スプレッドシートに触れない（Core.js）', () => {
  const core = fs.readFileSync(path.join(SRC_DIR, 'Core.js'), 'utf8');
  for (const re of [/new Date\(\s*\)/, /Date\.now/, /Math\.random/, /SpreadsheetApp/, /PropertiesService/, /LockService/, /Utilities/]) {
    assert.doesNotMatch(core, re, 'Core.js: ' + re);
  }
});

test('乱数に Math.random を使わない（Utilities.getUuid を使う）', () => {
  for (const f of srcFiles()) {
    if (!/\.js$/.test(f.name)) continue;
    assert.doesNotMatch(fs.readFileSync(f.full, 'utf8'), /Math\.random/, f.name);
  }
});

test('画面の部品ファイルに埋め込み記号（<?!= ?>）があるなら、テンプレートとして評価して読み込む（2026-09-30 追加）', () => {
  // createHtmlOutputFromFile で読み込むと記号がそのまま残り、本物の GAS で画面の JavaScript が動かなくなる。
  const parts = srcFiles().filter((f) => /\.html$/.test(f.name) && f.name !== 'index.html')
    .filter((f) => fs.readFileSync(f.full, 'utf8').includes('<?'));
  if (!parts.length) return;
  const code = srcFiles().filter((f) => /\.js$/.test(f.name)).map((f) => fs.readFileSync(f.full, 'utf8')).join('\n');
  const include = /function include_\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(code);
  assert.ok(include, 'include_ が無い');
  assert.match(include[0], /createTemplateFromFile\([^)]*\)\s*\.evaluate\(\)/, parts.map((f) => f.name).join(', '));
});
