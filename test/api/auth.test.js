'use strict';
// ログイン・パスワード・セッション・初期設定。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, addStudent, studentRecord, allCells } = require('../helpers/api');

test('setupInitial は2回目を実行しても管理者を増やさない', () => {
  const ctx = boot();
  ctx.app.get('setupInitial')();
  assert.equal(ctx.env.logs.filter((l) => /^INITIAL_ADMIN /.test(l)).length, 1);
});

test('setupInitial は SHIFT_DB_ID・AUDIT_LOG_ID・PASSWORD_PEPPER を Script Properties に置き、2つのスプレッドシートを作る', () => {
  const ctx = boot();
  for (const k of ['SHIFT_DB_ID', 'AUDIT_LOG_ID', 'PASSWORD_PEPPER']) assert.ok(ctx.env.properties.get(k), k);
  assert.notEqual(ctx.env.properties.get('SHIFT_DB_ID'), ctx.env.properties.get('AUDIT_LOG_ID'));
  assert.ok(ctx.env.properties.get('PASSWORD_PEPPER').length >= 32, '秘密鍵が短すぎる');
});

test('新しい学生には、学籍番号と別の非連番ログインID（紛らわしい文字なし8文字）と12文字以上の初期パスワードが発行される', () => {
  const ctx = boot();
  const a = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: '251001' })));
  const b = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: '251002' })));
  for (const x of [a, b]) {
    assert.match(x.loginId, /^[A-HJ-NP-Za-km-z2-9]{8}$/);
    assert.notEqual(x.loginId, x.studentId);
    assert.ok(x.initialPassword.length >= 12);
    assert.equal(x.created, true);
  }
  assert.notEqual(a.loginId, b.loginId);
  assert.notEqual(a.initialPassword, b.initialPassword);
});

test('既存の学生を更新しても、ログインIDは変わらず、新しいパスワードも出ない', () => {
  const ctx = boot();
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord()));
  const again = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ name: '別名' })));
  assert.equal(again.created, false);
  assert.equal(again.initialPassword, undefined);
});

test('学籍番号ではログインできない', () => {
  const ctx = boot();
  const x = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord()));
  const r = ctx.api('api_login', '251001', x.initialPassword);
  assert.deepEqual([r.ok, r.error], [false, 'LOGIN_FAILED']);
});

test('初回ログインでは mustChangePassword が true で、パスワード変更以外は PASSWORD_CHANGE_REQUIRED', () => {
  const ctx = boot();
  const x = ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord()));
  const login = ok(ctx.api('api_login', x.loginId, x.initialPassword));
  assert.equal(login.mustChangePassword, true);
  assert.equal(login.role, 'student');
  assert.equal(login.studentId, '251001');
  const r = ctx.api('api_getMonth', login.token, '2026-10');
  assert.deepEqual([r.ok, r.error], [false, 'PASSWORD_CHANGE_REQUIRED']);
  ok(ctx.api('api_changePassword', login.token, x.initialPassword, 'my-new-password'));
  ok(ctx.api('api_getMonth', login.token, '2026-10'));
});

test('パスワード変更: 現在のパスワードが違えば LOGIN_FAILED、新しいパスワードが10文字未満なら BAD_REQUEST', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  assert.equal(ctx.api('api_changePassword', st.token, 'wrong-password', 'another-password').error, 'LOGIN_FAILED');
  assert.equal(ctx.api('api_changePassword', st.token, st.password, 'short').error, 'BAD_REQUEST');
  ok(ctx.api('api_changePassword', st.token, st.password, 'long-enough-1'));
  ok(ctx.api('api_login', st.loginId, 'long-enough-1'));
});

test('間違ったパスワード・存在しないIDは、どちらも LOGIN_FAILED（区別できない）', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  assert.equal(ctx.api('api_login', st.loginId, 'wrong-password').error, 'LOGIN_FAILED');
  assert.equal(ctx.api('api_login', 'ZZZZZZZZ', 'wrong-password').error, 'LOGIN_FAILED');
});

test('5回続けて間違えると15分ロック: 正しいパスワードでも LOGIN_LOCKED。16分後には入れる', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  for (let i = 0; i < 5; i++) ctx.api('api_login', st.loginId, 'wrong-password');
  const locked = ctx.api('api_login', st.loginId, st.password);
  assert.deepEqual([locked.ok, locked.error], [false, 'LOGIN_LOCKED']);
  ctx.env.clock.advanceMinutes(14);
  assert.equal(ctx.api('api_login', st.loginId, st.password).error, 'LOGIN_LOCKED');
  ctx.env.clock.advanceMinutes(2);
  ok(ctx.api('api_login', st.loginId, st.password));
});

test('4回間違えてから正しく入れば失敗回数は0に戻り、その後4回間違えてもロックされない', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  for (let i = 0; i < 4; i++) ctx.api('api_login', st.loginId, 'wrong-password');
  ok(ctx.api('api_login', st.loginId, st.password));
  for (let i = 0; i < 4; i++) ctx.api('api_login', st.loginId, 'wrong-password');
  ok(ctx.api('api_login', st.loginId, st.password));
});

test('管理者はロックを即時に解除できる', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  for (let i = 0; i < 5; i++) ctx.api('api_login', st.loginId, 'wrong-password');
  assert.equal(ctx.api('api_login', st.loginId, st.password).error, 'LOGIN_LOCKED');
  ok(ctx.api('api_adminUnlockLogin', ctx.admin, st.studentId));
  ok(ctx.api('api_login', st.loginId, st.password));
});

test('管理者のパスワード再発行: 古いパスワードは使えず、新しい初期パスワードでは変更を求められる', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  const re = ok(ctx.api('api_adminResetPassword', ctx.admin, st.studentId));
  assert.ok(re.initialPassword.length >= 12);
  assert.equal(ctx.api('api_login', st.loginId, st.password).error, 'LOGIN_FAILED');
  const login = ok(ctx.api('api_login', st.loginId, re.initialPassword));
  assert.equal(login.mustChangePassword, true);
});

test('トークンが無い・でたらめ・1文字書き換えたものは AUTH_REQUIRED', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  assert.equal(ctx.api('api_getMonth', '', '2026-10').error, 'AUTH_REQUIRED');
  assert.equal(ctx.api('api_getMonth', null, '2026-10').error, 'AUTH_REQUIRED');
  assert.equal(ctx.api('api_getMonth', 'not-a-token', '2026-10').error, 'AUTH_REQUIRED');
  const last = st.token.slice(-1);
  const tampered = st.token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
  assert.equal(ctx.api('api_getMonth', tampered, '2026-10').error, 'AUTH_REQUIRED');
});

test('セッションはログインから120分で切れる（119分後は有効、121分後は AUTH_REQUIRED）', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  const token = ok(ctx.api('api_login', st.loginId, st.password)).token;
  ctx.env.clock.advanceMinutes(119);
  ok(ctx.api('api_getMonth', token, '2026-10'));
  ctx.env.clock.advanceMinutes(2);
  assert.equal(ctx.api('api_getMonth', token, '2026-10').error, 'AUTH_REQUIRED');
});

test('ログアウトしたトークンは AUTH_REQUIRED', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  ok(ctx.api('api_logout', st.token));
  assert.equal(ctx.api('api_getMonth', st.token, '2026-10').error, 'AUTH_REQUIRED');
});

test('トークンは128ビット以上のランダム値（22文字以上）で、ログインのたびに変わる', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  const t1 = ok(ctx.api('api_login', st.loginId, st.password)).token;
  const t2 = ok(ctx.api('api_login', st.loginId, st.password)).token;
  assert.ok(t1.length >= 22);
  assert.notEqual(t1, t2);
});

test('パスワード・トークン・秘密鍵は、どのスプレッドシートにも平文で残らない', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  const cells = allCells(ctx).join('\n');
  for (const secret of [st.password, st.initialPassword, st.token, ctx.adminPassword, ctx.admin, ctx.env.properties.get('PASSWORD_PEPPER')]) {
    assert.equal(cells.includes(secret), false, '平文が見つかった: ' + secret.slice(0, 4) + '…');
  }
});

test('ログインの成功・失敗は監査ログに残る', () => {
  const { auditRows } = require('../helpers/api');
  const ctx = boot();
  const st = addStudent(ctx);
  ctx.api('api_login', st.loginId, 'wrong-password');
  const actions = auditRows(ctx).map((r) => r.action);
  assert.ok(actions.includes('LOGIN_OK'));
  assert.ok(actions.includes('LOGIN_FAIL'));
  assert.ok(actions.includes('PASSWORD_CHANGE'));
});

test('窓口は例外を投げず、想定外の引数には BAD_REQUEST を返す', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  assert.equal(ctx.api('api_getMonth', st.token, null).error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_getMonth', st.token, '2026-13').error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_login', undefined, undefined).ok, false);
});
