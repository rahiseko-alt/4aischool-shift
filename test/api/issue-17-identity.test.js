'use strict';
// #17 本人確認: ログイン直後に氏名とクラスを出し、YES で先へ、NO でログインを取り消す。
// 画面は identityCheck=true でログインする。確認が済むまで申告の読み書きは断られる。
// identityCheck を付けない呼び出しは今までどおり（既存の固定テストが前提にしている）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, sh, auditRows } = require('../helpers/api');

const YM = '2026-10';
const login = (w) => ok(w.api('api_login', w.st.record.studentId, '', true));

test('本人確認つきのログインは、氏名とクラスを返し、確認待ちになる', () => {
  const w = world();
  const r = login(w);
  assert.equal(r.identityPending, true);
  assert.deepEqual(r.identity, { name: w.st.record.name, className: 'A' });
  assert.equal(r.role, 'student');
});

test('確認が済むまで、申告の読み書き・履歴は断られる', () => {
  const w = world();
  const t = login(w).token;
  assert.equal(w.api('api_getMonth', t, YM).error, 'IDENTITY_REQUIRED');
  assert.equal(w.api('api_getHistory', t).error, 'IDENTITY_REQUIRED');
  assert.equal(w.api('api_saveDraft', t, YM, { '3': [sh('09:00', '12:00')] }, 0).error, 'IDENTITY_REQUIRED');
  assert.equal(w.api('api_confirm', t, YM, { '3': [sh('09:00', '12:00')] }, 0).error, 'IDENTITY_REQUIRED');
  assert.equal(w.api('api_changePassword', t, 'x', 'yyyyyyyyyyyy').error, 'IDENTITY_REQUIRED');
});

test('YES で先に進める。もう一度 YES を送っても壊れない', () => {
  const w = world();
  const t = login(w).token;
  assert.deepEqual(ok(w.api('api_confirmIdentity', t, true)), { confirmed: true });
  assert.equal(ok(w.api('api_getMonth', t, YM)).status, '未入力');
  assert.deepEqual(ok(w.api('api_confirmIdentity', t, true)), { confirmed: true });
});

test('NO でログインが取り消され、そのトークンはもう使えない', () => {
  const w = world();
  const t = login(w).token;
  assert.deepEqual(ok(w.api('api_confirmIdentity', t, false)), { confirmed: false });
  assert.equal(w.api('api_getMonth', t, YM).error, 'AUTH_REQUIRED');
  assert.equal(w.api('api_confirmIdentity', t, true).error, 'AUTH_REQUIRED');
});

test('確認待ちでも、ログアウトはできる', () => {
  const w = world();
  const t = login(w).token;
  ok(w.api('api_logout', t));
  assert.equal(w.api('api_getMonth', t, YM).error, 'AUTH_REQUIRED');
});

test('答えが true か false でなければ BAD_REQUEST。確認待ちのままになる', () => {
  const w = world();
  const t = login(w).token;
  assert.equal(w.api('api_confirmIdentity', t, 'yes').error, 'BAD_REQUEST');
  assert.equal(w.api('api_confirmIdentity', t, undefined).error, 'BAD_REQUEST');
  assert.equal(w.api('api_getMonth', t, YM).error, 'IDENTITY_REQUIRED');
});

test('管理者のログインには本人確認を挟まない', () => {
  const w = world();
  const r = ok(w.api('api_login', w.adminLoginId, w.adminPassword, true));
  assert.equal(r.role, 'admin');
  assert.equal(r.identityPending, undefined);
});

test('本人確認の付かないログインは、今までどおりそのまま使える', () => {
  const w = world();
  const r = ok(w.api('api_login', w.st.record.studentId, ''));
  assert.equal(r.identityPending, undefined);
  assert.equal(ok(w.api('api_getMonth', r.token, YM)).status, '未入力');
});

test('YES と NO は監査ログに残る', () => {
  const w = world();
  ok(w.api('api_confirmIdentity', login(w).token, true));
  ok(w.api('api_confirmIdentity', login(w).token, false));
  const actions = auditRows(w).map((r) => r.action);
  assert.ok(actions.includes('IDENTITY_OK'));
  assert.ok(actions.includes('IDENTITY_REJECTED'));
});
