'use strict';
// ログインの短い番号（2026-10-06）: 国際ビジネス科は K＋学籍番号の下2桁、総合ビジネス科は S＋下2桁（例 K01・S21）。
// 学籍番号そのものは変えない。学籍番号でもこれまでどおり入れる。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok } = require('../helpers/api');

function setup() {
  const ctx = boot({ now: '2026-10-06 10:00' });
  const reg = (className, rows) => ok(ctx.api('api_adminImportRoster', ctx.admin, { className, enrollmentDate: '2026-04-01', rows }));
  reg('国際ビジネス科', [{ studentId: 'AIBC26001', name: 'A ONE', nameKana: '' }, { studentId: 'AIBC26002', name: 'A TWO', nameKana: '' }]);
  reg('総合ビジネス科', [{ studentId: 'AIGB26021', name: 'S ONE', nameKana: '' }, { studentId: 'AIGB26001', name: 'S TWO', nameKana: '' }]);
  return ctx;
}

test('K＋下2桁で国際ビジネス科、S＋下2桁で総合ビジネス科の学生として入れる（大文字小文字・前後の空白は問わない）', () => {
  const ctx = setup();
  assert.equal(ok(ctx.api('api_login', 'K01', '')).studentId, 'AIBC26001');
  assert.equal(ok(ctx.api('api_login', 'k02', '')).studentId, 'AIBC26002');
  assert.equal(ok(ctx.api('api_login', ' S21 ', '')).studentId, 'AIGB26021');
  assert.equal(ok(ctx.api('api_login', 'S01', '')).studentId, 'AIGB26001');
});

test('学籍番号でもこれまでどおり入れる。該当者がいない短い番号では入れない', () => {
  const ctx = setup();
  assert.equal(ok(ctx.api('api_login', 'AIBC26001', '')).studentId, 'AIBC26001');
  assert.equal(ctx.api('api_login', 'K21', '').ok, false);
  assert.equal(ctx.api('api_login', 'X01', '').ok, false);
});

test('学生詳細に、その学生のログイン番号が出る', () => {
  const ctx = setup();
  assert.equal(ok(ctx.api('api_adminStudentDetail', ctx.admin, 'AIBC26002')).student.loginCode, 'K02');
  assert.equal(ok(ctx.api('api_adminStudentDetail', ctx.admin, 'AIGB26021')).student.loginCode, 'S21');
});

test('同じクラスに下2桁が同じ学生が2人いたら、短い番号では入れない（取り違えを防ぐ）', () => {
  const ctx = setup();
  ok(ctx.api('api_adminImportRoster', ctx.admin, { className: '国際ビジネス科', enrollmentDate: '2026-04-01', rows: [{ studentId: 'AIBC25001', name: 'OLD ONE', nameKana: '' }] }));
  assert.equal(ctx.api('api_login', 'K01', '').ok, false);
  ok(ctx.api('api_login', 'AIBC26001', ''));
});

test('管理者のIDに K01 のような短い番号の形は使えない', () => {
  const ctx = setup();
  const r = ctx.api('api_adminChangeCredentials', ctx.admin, { currentPassword: ctx.adminPassword, newLoginId: 'k05x', newPassword: null });
  ok(r);
  const r2 = ctx.api('api_adminChangeCredentials', ctx.admin, { currentPassword: ctx.adminPassword, newLoginId: 'S99', newPassword: null });
  assert.equal(r2.error, 'BAD_REQUEST');
});
