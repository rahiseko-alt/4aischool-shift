'use strict';
// 名簿の一括登録（2026-10-02 追加）: 管理画面に名簿（学籍番号・ローマ字氏名・カナ）を貼り付けて、学生をまとめて登録する。
// 生年月日・資格外活動許可は空のまま登録し、あとで学生詳細から入れる（許可が未登録の間は確定できない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok } = require('../helpers/api');

const ROWS = [
  { studentId: 'TEST26001', name: 'TARO YAMADA', nameKana: 'タロウ　ヤマダ' },
  { studentId: 'TEST26002', name: 'HANAKO SATO', nameKana: 'ハナコ　サトウ' },
];
const req = (rows) => ({ className: 'テスト科', enrollmentDate: '2026-04-01', rows });

test('名簿の一括登録: 学生が入り、学籍番号だけでログインできる。生年月日・許可は空', () => {
  const ctx = boot({ now: '2026-10-02 10:00' });
  const r = ok(ctx.api('api_adminImportRoster', ctx.admin, req(ROWS)));
  assert.deepEqual(r.created, ['TEST26001', 'TEST26002']);
  assert.deepEqual(r.skipped, []);
  const d = ok(ctx.api('api_adminStudentDetail', ctx.admin, 'TEST26001'));
  assert.equal(d.student.name, 'TARO YAMADA');
  assert.equal(d.student.nameKana, 'タロウ　ヤマダ');
  assert.equal(d.student.className, 'テスト科');
  assert.equal(d.student.enrollmentDate, '2026-04-01');
  assert.equal(d.student.birthDate, '');
  assert.equal(d.student.workPermission, false);
  const login = ok(ctx.api('api_login', 'TEST26002', ''));
  assert.equal(login.studentId, 'TEST26002');
});

test('名簿の一括登録: 許可が未登録の学生は、入力・途中保存はできるが確定は NO_PERMIT で止まる', () => {
  const ctx = boot({ now: '2026-10-02 10:00' });
  ok(ctx.api('api_adminImportRoster', ctx.admin, req(ROWS)));
  ok(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: '2026-11', className: 'テスト科', deadlineAt: '2026-10-31 23:59', actualDeadlineAt: null }));
  const t = ok(ctx.api('api_login', 'TEST26001', '')).token;
  ok(ctx.api('api_saveDraft', t, '2026-11', { '2': [{ start: '09:00', end: '13:00' }] }, 0));
  const r = ctx.api('api_confirm', t, '2026-11', { '2': [{ start: '09:00', end: '13:00' }] }, 1);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'NO_PERMIT'));
});

test('名簿の一括登録: 既にいる学籍番号と、名簿の中の重複は飛ばす（上書きしない）', () => {
  const ctx = boot({ now: '2026-10-02 10:00' });
  ok(ctx.api('api_adminImportRoster', ctx.admin, req(ROWS)));
  const r = ok(ctx.api('api_adminImportRoster', ctx.admin, req([
    { studentId: 'TEST26001', name: 'CHANGED', nameKana: '' },
    { studentId: 'TEST26003', name: 'JIRO', nameKana: 'ジロウ' },
    { studentId: 'TEST26003', name: 'JIRO2', nameKana: '' },
  ])));
  assert.deepEqual(r.created, ['TEST26003']);
  assert.deepEqual(r.skipped.sort(), ['TEST26001', 'TEST26003']);
  assert.equal(ok(ctx.api('api_adminStudentDetail', ctx.admin, 'TEST26001')).student.name, 'TARO YAMADA');
});

test('名簿の一括登録: 形が違えば BAD_REQUEST で1人も登録しない。管理者だけが使える', () => {
  const ctx = boot({ now: '2026-10-02 10:00' });
  for (const bad of [
    req([{ studentId: 'A B', name: 'X', nameKana: '' }]),
    req([{ studentId: 'OK1', name: '', nameKana: '' }]),
    { className: '', enrollmentDate: '2026-04-01', rows: ROWS },
    { className: 'テスト科', enrollmentDate: '2026/04/01', rows: ROWS },
    req([]),
    req(Array.from({ length: 301 }, (_, i) => ({ studentId: 'X' + i, name: 'N', nameKana: '' }))),
  ]) {
    assert.equal(ctx.api('api_adminImportRoster', ctx.admin, bad).error, 'BAD_REQUEST', JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', {})).rows.length, 0);
  ok(ctx.api('api_adminImportRoster', ctx.admin, req(ROWS)));
  const st = ok(ctx.api('api_login', 'TEST26001', '')).token;
  assert.equal(ctx.api('api_adminImportRoster', st, req(ROWS)).error, 'FORBIDDEN');
});
