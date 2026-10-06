'use strict';
// 管理者が自分のログインIDとパスワードを変える（2026-10-06）

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world } = require('../helpers/api');

const change = (w, p) => w.api('api_adminChangeCredentials', w.admin, p);

test('管理者のIDとパスワードを変えると、新しいIDとパスワードで入れ、古いものでは入れない。今のログインは続く', () => {
  const w = world();
  ok(change(w, { currentPassword: w.adminPassword, newLoginId: 'sensei01', newPassword: 'new-admin-pass-01' }));
  assert.equal(w.api('api_login', w.adminLoginId, w.adminPassword).ok, false);
  assert.equal(w.api('api_login', 'sensei01', w.adminPassword).ok, false);
  const r = ok(w.api('api_login', 'sensei01', 'new-admin-pass-01'));
  assert.equal(r.role, 'admin');
  ok(w.api('api_adminBoard', w.admin, '2026-10', {})); // 変更した画面のログインは切れない
});

test('IDだけ・パスワードだけでも変えられる（空欄はそのまま）', () => {
  const w = world();
  ok(change(w, { currentPassword: w.adminPassword, newLoginId: 'sensei02', newPassword: null }));
  ok(w.api('api_login', 'sensei02', w.adminPassword));
  ok(change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: 'new-admin-pass-02' }));
  ok(w.api('api_login', 'sensei02', 'new-admin-pass-02'));
});

test('今のパスワードが違う・新しいパスワードが短い・IDの形が違うときは変えない', () => {
  const w = world();
  assert.equal(change(w, { currentPassword: 'wrong-password', newLoginId: 'sensei03', newPassword: null }).error, 'LOGIN_FAILED');
  assert.equal(change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: 'short' }).error, 'BAD_REQUEST');
  assert.equal(change(w, { currentPassword: w.adminPassword, newLoginId: 'ab', newPassword: null }).error, 'BAD_REQUEST');
  assert.equal(change(w, { currentPassword: w.adminPassword, newLoginId: 'あいうえお', newPassword: null }).error, 'BAD_REQUEST');
  assert.equal(change(w, { currentPassword: w.adminPassword, newLoginId: null, newPassword: null }).error, 'BAD_REQUEST');
  ok(w.api('api_login', w.adminLoginId, w.adminPassword));
});

test('学籍番号と同じID（大文字小文字は問わない）は使えない（学籍番号のログインが先に効くため）', () => {
  const w = world();
  const r = change(w, { currentPassword: w.adminPassword, newLoginId: String(w.st.studentId).toLowerCase(), newPassword: null });
  assert.equal(r.error, 'BAD_REQUEST');
  assert.equal(r.details.reason, 'ID_TAKEN');
});

test('学生は使えない', () => {
  const w = world();
  assert.equal(w.api('api_adminChangeCredentials', w.st.token, { currentPassword: 'x', newLoginId: 'sensei04', newPassword: null }).error, 'FORBIDDEN');
});
