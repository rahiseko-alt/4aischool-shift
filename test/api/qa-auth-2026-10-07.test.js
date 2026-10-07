'use strict';
// QA 指摘（2026-10-07）: ログイン・認証・管理者のID/パスワードまわり

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, studentRecord, addStudent } = require('../helpers/api');

const change = (w, p) => w.api('api_adminChangeCredentials', w.admin, p);

// 修正前のデータで、管理者のIDと同じ学籍番号の学生がすでにいる状態を直接つくる
function insertCollidingStudent(ctx, studentId) {
  ctx.app.call('db_insertRow_', 'STUDENTS', {
    student_id: studentId, login_id: 'zzLegacy1', name: '重なる学生', class: 'A', birth_date: '2000-04-01', language: 'ja',
    enrollment_date: '2025-04-01', graduation_date: '', withdrawal_date: '', status: '在籍', work_permission: 'true',
    permission_expires: '2027-12-31', permission_checked_at: '', created_at: '2026-09-01 10:00', updated_at: '2026-09-01 10:00'
  });
  ctx.app.call('db_insertRow_', 'USERS', {
    login_id: 'zzLegacy1', role: 'student', student_id: studentId, password_salt: 's', password_hash: 'h', hash_iterations: '1',
    force_password_change: 'false', failed_login_count: '0', locked_until: '', created_at: '2026-09-01 10:00'
  });
}

test('1a 管理者のIDと同じ学籍番号の学生がいても、パスワードを入れた管理者は管理者として入れる', () => {
  const ctx = boot();
  insertCollidingStudent(ctx, ctx.adminLoginId.toUpperCase());
  const r = ok(ctx.api('api_login', ctx.adminLoginId, ctx.adminPassword));
  assert.equal(r.role, 'admin');
  // パスワード違いは学生として入れず LOGIN_FAILED
  assert.equal(ctx.api('api_login', ctx.adminLoginId, 'wrong-password').error, 'LOGIN_FAILED');
  // パスワード欄が空なら、これまでどおり学籍番号で学生が入れる
  assert.equal(ok(ctx.api('api_login', ctx.adminLoginId, '')).role, 'student');
});

test('1a パスワードを入れても、管理者のIDでない学籍番号ならこれまでどおり学生として入れる', () => {
  const w = world();
  assert.equal(ok(w.api('api_login', w.st.studentId, 'なにか')).role, 'student');
});

test('1b 管理者のログインIDと同じ学籍番号（大文字小文字を問わない）の学生は追加できない', () => {
  const ctx = boot();
  for (const id of [ctx.adminLoginId, ctx.adminLoginId.toLowerCase(), ctx.adminLoginId.toUpperCase()]) {
    const r = ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: id }));
    assert.equal(r.error, 'BAD_REQUEST', id);
    assert.equal(r.details.reason, 'ID_TAKEN');
  }
  // 普通の学籍番号は追加できる。既存の学生の更新は止めない
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: '251001' })));
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: '251001', name: '別名' })));
});

test('1b 名簿の一括登録でも、管理者のログインIDと同じ学籍番号があれば登録しない', () => {
  const ctx = boot();
  const r = ctx.api('api_adminImportRoster', ctx.admin, {
    className: 'A', enrollmentDate: '2026-04-01',
    rows: [{ studentId: 'AIBC26001', name: 'A' }, { studentId: ctx.adminLoginId.toLowerCase(), name: 'B' }]
  });
  assert.equal(r.error, 'BAD_REQUEST');
  assert.equal(r.details.reason, 'ID_TAKEN');
  assert.equal(r.details.studentId, ctx.adminLoginId.toLowerCase());
  assert.equal(ctx.api('api_login', 'AIBC26001', '').error, 'LOGIN_FAILED'); // 1人も登録されない
});

test('2 空白だけのパスワードは使えない', () => {
  const w = world();
  const r = change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: '            ' });
  assert.equal(r.error, 'BAD_REQUEST');
  assert.equal(r.details.reason, 'PASSWORD_BLANK');
  const st = w.api('api_changePassword', w.admin, w.adminPassword, '            ');
  assert.equal(st.details.reason, 'PASSWORD_BLANK');
  // 前後に空白のあるパスワードはそのまま使える（削らない）
  ok(change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: '  spaced-pass  ' }));
  ok(w.api('api_login', w.adminLoginId, '  spaced-pass  '));
  assert.equal(w.api('api_login', w.adminLoginId, 'spaced-pass').error, 'LOGIN_FAILED');
});

test('4 パスワード変更の失敗には理由が付く（短い・今と同じ）', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  const short = ctx.api('api_changePassword', st.token, st.password, 'short');
  assert.deepEqual([short.error, short.details.reason], ['BAD_REQUEST', 'PASSWORD_SHORT']);
  const same = ctx.api('api_changePassword', st.token, st.password, st.password);
  assert.deepEqual([same.error, same.details.reason], ['BAD_REQUEST', 'SAME_PASSWORD']);
});

test('4 理由の言葉は7言語すべてにある', () => {
  const ctx = boot();
  const I18N = ctx.app.plain(ctx.app.get('I18N'));
  for (const lang of Object.keys(I18N)) {
    for (const k of ['error.reason.PASSWORD_SHORT', 'error.reason.SAME_PASSWORD', 'error.reason.PASSWORD_MISMATCH',
      'error.reason.PASSWORD_BLANK', 'error.LOGIN_LOCKED_UNTIL', 'label.adminLoginHint', 'label.newPasswordConfirm']) {
      assert.ok(I18N[lang][k], lang + ' ' + k);
    }
    assert.ok(I18N[lang]['error.LOGIN_LOCKED_UNTIL'].includes('{time}'), lang);
  }
});

test('5 管理者のパスワード変更で、新しいパスワードが今と同じなら変えない', () => {
  const w = world();
  const r = change(w, { currentPassword: w.adminPassword, newLoginId: 'sensei05', newPassword: w.adminPassword });
  assert.deepEqual([r.error, r.details.reason], ['BAD_REQUEST', 'SAME_PASSWORD']);
  assert.equal(w.api('api_login', 'sensei05', w.adminPassword).ok, false); // IDも変わらない
});

test('9 管理者のID・パスワード変更で今のパスワードを5回まちがえるとロックされ、ログインもできない', () => {
  const w = world();
  for (let i = 0; i < 4; i++) assert.equal(change(w, { currentPassword: 'wrong-' + i, newLoginId: 'sensei09', newPassword: null }).error, 'LOGIN_FAILED');
  const r = change(w, { currentPassword: 'wrong-5', newLoginId: 'sensei09', newPassword: null });
  assert.equal(r.error, 'LOGIN_LOCKED');
  assert.ok(r.details.lockedUntil);
  // ロック中は正しいパスワードでも変えられず、ログインもできない
  assert.equal(change(w, { currentPassword: w.adminPassword, newLoginId: 'sensei09', newPassword: null }).error, 'LOGIN_LOCKED');
  assert.equal(w.api('api_login', w.adminLoginId, w.adminPassword).error, 'LOGIN_LOCKED');
});

test('9 成功すれば失敗の回数は0に戻る', () => {
  const w = world();
  for (let i = 0; i < 4; i++) change(w, { currentPassword: 'wrong-' + i, newLoginId: null, newPassword: 'x-new-pass-01' });
  ok(change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: 'x-new-pass-01' }));
  for (let i = 0; i < 4; i++) assert.equal(w.api('api_login', w.adminLoginId, 'wrong-' + i).error, 'LOGIN_FAILED');
});

test('9 初回のパスワード変更でも、今のパスワードを5回まちがえるとロックされる', () => {
  const ctx = boot();
  const x = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord()));
  const login = ok(ctx.api('api_login', x.loginId, x.initialPassword));
  for (let i = 0; i < 4; i++) assert.equal(ctx.api('api_changePassword', login.token, 'wrong-' + i, 'my-new-password').error, 'LOGIN_FAILED');
  const r = ctx.api('api_changePassword', login.token, 'wrong-5', 'my-new-password');
  assert.equal(r.error, 'LOGIN_LOCKED');
  assert.ok(r.details.lockedUntil);
  assert.equal(ctx.api('api_changePassword', login.token, x.initialPassword, 'my-new-password').error, 'LOGIN_LOCKED');
  assert.equal(ctx.api('api_login', x.loginId, x.initialPassword).error, 'LOGIN_LOCKED');
});
