'use strict';
// 点検10件の修正（2026-10-03）。番号は docs/agents/fix-plan-2026-10-03.md の表と同じ。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, sh, everyDay } = require('../helpers/api');

function sheetOf(ctx, name) { return ctx.env.spreadsheets.get(ctx.env.properties.get('SHIFT_DB_ID')).getSheetByName(name); }
function header(sheet) { return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((v) => String(v).replace(/^'/, '')); }

// ---- 5. エラーの記録・壊れた JSON ----

test('5: 前の月の予定（shift_json）が壊れていても、今の月は開ける', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '1': [sh('09:00', '12:00')] }, 0));
  const sheet = sheetOf(w, 'MONTHLY_SUBMISSIONS');
  const col = header(sheet).indexOf('shift_json') + 1;
  sheet.getRange(2, col).setValue('{こわれた');
  ok(w.api('api_getMonth', w.st.token, '2026-11')); // 前の月（10月）が壊れていても開ける
  ok(w.api('api_getMonth', w.st.token, '2026-10')); // 壊れた月そのものも、空として開ける
});

test('5: 窓口で想定外のエラーが起きたら、記録（console.error）に残してから INTERNAL を返す', () => {
  const w = world();
  const errs = [];
  const orig = w.app.context.console;
  w.app.context.console = { ...console, error: (...a) => errs.push(a.join(' ')) };
  const ss = w.env.spreadsheets.get(w.env.properties.get('SHIFT_DB_ID'));
  ss.deleteSheet(ss.getSheetByName('DEADLINES'));
  const r = w.api('api_getMonth', w.st.token, '2026-10');
  w.app.context.console = orig;
  assert.equal(r.error, 'INTERNAL');
  assert.ok(errs.some((e) => /api_getMonth|DEADLINES|Sheet not found/.test(e)), errs.join('\n'));
});

// ---- 1. 見本の休業が全学生に効く ----

test('1: 生徒モードを押しても、本物の長期休業の表に休業は入らない', () => {
  const w = world();
  ok(w.api('api_adminActAsDemoStudent', w.admin, 'DEMO-A'));
  assert.deepEqual(ok(w.api('api_adminListHolidays', w.admin)), []);
});

test('1: 以前の版が入れた見本の休業（名前と期間が完全一致）は、管理画面を開くと1回だけ取り除かれる。学校が入れた休業は残る', () => {
  const w = world();
  ok(w.api('api_adminSetHoliday', w.admin, { name: '冬季休業', startDate: '2026-12-21', endDate: '2027-01-07', schoolYear: 2026 }));
  ok(w.api('api_adminSetHoliday', w.admin, { name: '秋季休業', startDate: '2026-09-21', endDate: '2026-09-30', schoolYear: 2026 }));
  ok(w.api('api_adminSetHoliday', w.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 }));
  ok(w.api('api_adminBoard', w.admin, '2026-10', {}));
  assert.deepEqual(ok(w.api('api_adminListHolidays', w.admin)).map((h) => h.startDate), ['2026-12-24']);
  // 2回目以降は何もしない（学校が同じ期間を入れ直しても消さない）
  ok(w.api('api_adminSetHoliday', w.admin, { name: '秋季休業', startDate: '2026-09-21', endDate: '2026-09-30', schoolYear: 2026 }));
  ok(w.api('api_adminBoard', w.admin, '2026-10', {}));
  assert.equal(ok(w.api('api_adminListHolidays', w.admin)).length, 2);
});

// ---- 2. 前月が下書きだと0と数える ----

test('2: 前月が下書きでも、その時間を数える（月をまたいで28時間を超えたら確定できない）', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: '2026-11', className: w.st.className || 'A', deadlineAt: '2026-10-31 23:59', actualDeadlineAt: null }));
  // 10/26〜31 は毎日4時間（下書きのまま）、11/1〜4 は毎日5時間 → 10/29〜11/4 の7日で32時間
  ok(w.api('api_saveDraft', w.st.token, '2026-10', everyDay(26, 31, sh('09:00', '13:00')), 0));
  const r = w.api('api_confirm', w.st.token, '2026-11', everyDay(1, 4, sh('09:00', '14:00')), 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'OVER_28H'));
});

// ---- 3. 確定後に条件が変わっても計算し直さない ----

test('3: 確定した後に許可の期限を短くすると、管理一覧と学生詳細にエラーが出る', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, '2026-10', { '20': [sh('09:00', '12:00')] }, 0));
  const row = () => ok(w.api('api_adminBoard', w.admin, '2026-10', {})).rows.find((r) => r.studentId === w.st.studentId);
  assert.deepEqual(row().errorCodes, []);
  const { studentRecord } = require('../helpers/api');
  ok(w.api('api_adminUpsertStudent', w.admin, studentRecord({ studentId: w.st.studentId, permissionExpires: '2026-10-15' })));
  assert.deepEqual(row().errorCodes, ['PERMIT_EXPIRED']);
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  assert.deepEqual(d.months.find((m) => m.yearMonth === '2026-10').codes, ['PERMIT_EXPIRED']);
});

// ---- 6. 1行ずつ消す処理 ----

test('6: ログイン時の片付けは期限切れのセッションだけをまとめて消し、有効なセッションは使えるまま残る', () => {
  const w = world();
  const b = ok(w.api('api_login', w.st.loginId, w.st.password)).token;
  const sheet = sheetOf(w, 'SESSIONS');
  const col = header(sheet).indexOf('expires_at') + 1;
  sheet.getRange(2, col).setValue("'2000-01-01 00:00"); // 先頭のセッション（管理者）を期限切れにする
  let single = 0;
  const orig = sheet.deleteRow.bind(sheet);
  sheet.deleteRow = (r) => { single++; return orig(r); };
  ok(w.api('api_login', w.st.loginId, w.st.password));
  sheet.deleteRow = orig;
  assert.equal(single, 0, '1行ずつ消していない');
  assert.equal(w.api('api_adminBoard', w.admin, '2026-10', {}).error, 'AUTH_REQUIRED');
  ok(w.api('api_getMonth', w.st.token, '2026-10'));
  ok(w.api('api_getMonth', b, '2026-10'));
});

// ---- 8. バックアップが無くても気付けない ----

test('8: 管理一覧の応答にバックアップの状態が入り、未設定・40日以上前なら警告になる', () => {
  const w = world();
  w.env.drive.driveFail = true; // ドライブが使えず、自動で用意できない場合
  const backup = () => ok(w.api('api_adminBoard', w.admin, '2026-10', {})).backup;
  assert.deepEqual(backup(), { configured: false, lastAt: null, warn: true });
  w.env.properties.set('BACKUP_FOLDER_ID', 'folder-1');
  w.env.properties.set('BACKUP_TRIGGER_OK', 'true');
  assert.equal(backup().warn, true); // 一度も取っていない
  w.env.properties.set('LAST_BACKUP_AT', '2026-09-01 03:00');
  assert.deepEqual(backup(), { configured: true, lastAt: '2026-09-01 03:00', warn: false });
  w.env.properties.set('LAST_BACKUP_AT', '2026-07-01 03:00');
  assert.equal(backup().warn, true);
});

// ---- 9. 管理者のパスワードを忘れると戻せない・初期設定のやり直しで空になる ----

test('9: パスワードの再発行は、許可（ADMIN_RESET_LOGIN_ID）が無ければ何もしない', () => {
  const w = world();
  w.app.get('resetAdminPassword')();
  assert.ok(w.env.logs.some((l) => l.startsWith('NOT_ALLOWED')));
  ok(w.api('api_login', w.adminLoginId, w.adminPassword)); // 今のパスワードのまま
});

test('9: 許可を入れて実行すると新しいパスワードで入れ、許可は1回で消える', () => {
  const w = world();
  w.env.properties.set('ADMIN_RESET_LOGIN_ID', w.adminLoginId);
  w.app.get('resetAdminPassword')();
  assert.equal(w.env.properties.get('ADMIN_RESET_LOGIN_ID'), undefined);
  const m = /ADMIN_PASSWORD_RESET loginId=(\S+) password=(\S+)/.exec(w.env.logs.find((l) => l.startsWith('ADMIN_PASSWORD_RESET')));
  assert.equal(m[1], w.adminLoginId);
  assert.equal(w.api('api_login', w.adminLoginId, w.adminPassword).ok, false);
  const r = ok(w.api('api_login', w.adminLoginId, m[2]));
  assert.equal(r.mustChangePassword, true);
  w.app.get('resetAdminPassword')(); // 2回目は許可が無いので何もしない
  ok(w.api('api_login', w.adminLoginId, m[2]));
});

test('9: 初期設定は ShiftDB があれば止まり、データの表を作り直さない', () => {
  const w = world();
  const id = w.env.properties.get('SHIFT_DB_ID');
  w.env.properties.delete('SETUP_DONE'); // 途中で止まった扱いでも
  w.app.get('setupInitial')();
  assert.equal(w.env.properties.get('SHIFT_DB_ID'), id);
  assert.ok(w.env.logs.some((l) => l.startsWith('SHIFT_DB_EXISTS')));
  ok(w.api('api_getMonth', w.st.token, '2026-10'));
});

// ---- 10. 学校確定を取り消せない ----

test('10: 学校確定を取り消すと未入力に戻り、学生がまた入力できる', () => {
  const w = world();
  const { studentRecord } = require('../helpers/api');
  ok(w.api('api_adminUpsertStudent', w.admin, studentRecord({ studentId: w.st.studentId, status: '休学' })));
  ok(w.api('api_adminSchoolConfirm', w.admin, w.st.studentId, '2026-10'));
  ok(w.api('api_adminUpsertStudent', w.admin, studentRecord({ studentId: w.st.studentId, status: '在籍' })));
  const before = ok(w.api('api_getMonth', w.st.token, '2026-10'));
  assert.equal(w.api('api_saveDraft', w.st.token, '2026-10', { '20': [sh('09:00', '12:00')] }, before.version).ok, false);
  ok(w.api('api_adminUndoSchoolConfirm', w.admin, w.st.studentId, '2026-10'));
  const m = ok(w.api('api_getMonth', w.st.token, '2026-10'));
  assert.equal(m.status, '未入力');
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '20': [sh('09:00', '12:00')] }, m.version));
  assert.equal(w.api('api_adminUndoSchoolConfirm', w.admin, w.st.studentId, '2026-10').error, 'FORBIDDEN'); // 学校確定でない月は取り消せない
});

// ---- 後でやるリスト 1. 確定済みの月に、翌月の下書きで28時間超が出る ----

test('後1: 確定済みの月には、翌月の下書きによる28時間超を出さない（翌月の側にだけ出る）', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: '2026-11', className: w.st.className || 'A', deadlineAt: '2026-10-31 23:59', actualDeadlineAt: null }));
  ok(w.api('api_confirm', w.st.token, '2026-10', everyDay(26, 31, sh('09:00', '13:00')), 0));
  ok(w.api('api_saveDraft', w.st.token, '2026-11', everyDay(1, 4, sh('09:00', '14:00')), 0));
  const codes = (ym) => ok(w.api('api_adminBoard', w.admin, ym, {})).rows.find((r) => r.studentId === w.st.studentId).errorCodes;
  assert.deepEqual(codes('2026-10'), []);
  assert.deepEqual(codes('2026-11'), ['OVER_28H']);
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  assert.deepEqual(d.months.find((m) => m.yearMonth === '2026-10').codes, []);
  const m = ok(w.api('api_getMonth', w.st.token, '2026-10'));
  assert.ok(!m.evaluation.codes.some((c) => c.code === 'OVER_28H'));
});

// ---- 後でやるリスト 2. 初期設定が途中で失敗すると、やり直しが止まる ----

test('後2: 初期設定が管理者を作る前に失敗していたら、やり直せる（管理者がいるデータの表は作り直さない）', () => {
  const { load } = require('../helpers/load.js');
  const app = load({ now: '2026-09-01 10:00' });
  app.env.properties.set('SHIFT_DB_ID', 'half-made'); // 表の番号だけ残って止まった状態（表は開けない）
  app.get('setupInitial')();
  assert.ok(app.env.logs.some((l) => l.startsWith('INITIAL_ADMIN')), app.env.logs.join('\n'));
  assert.notEqual(app.env.properties.get('SHIFT_DB_ID'), 'half-made');
  assert.equal(app.env.properties.get('SETUP_DONE'), 'true');
});

// ---- 後でやるリスト 3. バックアップが本番で設定されていない ----

test('後3: 管理画面を開くと、保存先のフォルダ・毎月の自動実行・最初のバックアップが自動で用意され、2回目以降は何もしない', () => {
  const w = world();
  w.env.properties.set('LAST_BACKUP_YM', '2026-09'); // 古い版で月だけ記録されていた場合でも取り直す
  const b = ok(w.api('api_adminBoard', w.admin, '2026-10', {})).backup;
  assert.equal(b.configured, true);
  assert.equal(b.warn, false);
  assert.equal(w.env.drive.folders.length, 1);
  assert.deepEqual(w.env.drive.triggers, ['backupMonthly']);
  assert.deepEqual(w.env.drive.copies.map((c) => c.name).sort(), ['AuditLog_2026-09', 'ShiftDB_2026-09']);
  ok(w.api('api_adminBoard', w.admin, '2026-10', {}));
  assert.equal(w.env.drive.folders.length, 1);
  assert.equal(w.env.drive.triggers.length, 1);
  assert.equal(w.env.drive.copies.length, 2);
});
