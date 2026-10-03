'use strict';
// クラスの登録（2026-10-03 追加）: クラスは「クラス設定」で登録し、学生・名簿・入力期限ではその中から選ぶ。
// 入力期限は空欄なら対象月の末日 23:59。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, studentRecord } = require('../helpers/api');

test('クラス: 登録して一覧に出る。同じ名前は増えない。学生がいるクラスは自動で一覧に入る', () => {
  const ctx = boot();
  ok(ctx.api('api_adminAddClass', ctx.admin, '国際ビジネス科'));
  ok(ctx.api('api_adminAddClass', ctx.admin, ' 国際ビジネス科 '));
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'S1', className: '総合ビジネス科' })));
  const list = ok(ctx.api('api_adminListClasses', ctx.admin));
  assert.deepEqual(list.map((c) => [c.name, c.students]), [['国際ビジネス科', 0], ['総合ビジネス科', 1]]);
});

test('クラス: 学生がいないクラスだけ消せる。名前が空・長すぎは BAD_REQUEST。学生は使えない', () => {
  const ctx = boot();
  ok(ctx.api('api_adminAddClass', ctx.admin, '消すクラス'));
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'S1', className: '残るクラス' })));
  ok(ctx.api('api_adminDeleteClass', ctx.admin, '消すクラス'));
  assert.equal(ctx.api('api_adminDeleteClass', ctx.admin, '残るクラス').error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_adminAddClass', ctx.admin, '').error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_adminAddClass', ctx.admin, 'x'.repeat(31)).error, 'BAD_REQUEST');
  assert.deepEqual(ok(ctx.api('api_adminListClasses', ctx.admin)).map((c) => c.name), ['残るクラス']);
  const st = ok(ctx.api('api_login', 'S1', '')).token;
  assert.equal(ctx.api('api_adminAddClass', st, 'x').error, 'FORBIDDEN');
});

test('クラス: クラスの表が無い古いデータの表でも動く（自動で作る）', () => {
  const ctx = boot();
  const ss = ctx.env.spreadsheets.get(ctx.env.properties.get('SHIFT_DB_ID'));
  const sh = ss.getSheetByName('CLASSES');
  if (sh) ss.deleteSheet(sh);
  ok(ctx.api('api_adminAddClass', ctx.admin, 'A科'));
  assert.deepEqual(ok(ctx.api('api_adminListClasses', ctx.admin)).map((c) => c.name), ['A科']);
});

test('入力期限: 予定の期限を空にすると、対象月の末日 23:59 になる', () => {
  const ctx = boot({ now: '2026-10-03 10:00' });
  ok(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: '2026-11', className: 'A', deadlineAt: '', actualDeadlineAt: null }));
  ok(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: '2027-02', className: 'A', deadlineAt: null, actualDeadlineAt: null }));
  ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'S1', className: 'A' })));
  const t = ok(ctx.api('api_login', 'S1', '')).token;
  assert.equal(ok(ctx.api('api_getMonth', t, '2026-11')).deadlineAt, '2026-11-30 23:59');
  assert.equal(ok(ctx.api('api_getMonth', t, '2027-02')).deadlineAt, '2027-02-28 23:59');
});
