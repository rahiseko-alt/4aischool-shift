'use strict';
// 在籍・資格外活動許可。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, has, codes, blocking } = require('../helpers/core-input');

const SHIFT = s('09:00', '12:00');
const on = (...days) => Object.fromEntries(days.map((d) => [String(d), [SHIFT]]));

// ---- 在籍 ----

test('退学日（10/15）当日は在籍、翌日（10/16）のシフトは NOT_ENROLLED', () => {
  const r = evaluateMonth(input({ student: { status: '退学', withdrawalDate: '2026-10-15' }, shifts: on(15, 16) }));
  assert.equal(has(r, 'NOT_ENROLLED', '2026-10-15'), false);
  assert.ok(has(r, 'NOT_ENROLLED', '2026-10-16'));
});

test('入学日（10/10）より前のシフトは NOT_ENROLLED、当日からは可', () => {
  const r = evaluateMonth(input({ student: { enrollmentDate: '2026-10-10' }, shifts: on(9, 10) }));
  assert.ok(has(r, 'NOT_ENROLLED', '2026-10-09'));
  assert.equal(has(r, 'NOT_ENROLLED', '2026-10-10'), false);
});

test('卒業日（10/20）より後のシフトは NOT_ENROLLED（在籍状態が在籍のままでも日付で判定）', () => {
  const r = evaluateMonth(input({ student: { graduationDate: '2026-10-20' }, shifts: on(20, 21) }));
  assert.equal(has(r, 'NOT_ENROLLED', '2026-10-20'), false);
  assert.ok(has(r, 'NOT_ENROLLED', '2026-10-21'));
});

test('在籍状態が退学で退学日が空なら、すべてのシフトが NOT_ENROLLED', () => {
  const r = evaluateMonth(input({ student: { status: '退学', withdrawalDate: null }, shifts: on(1) }));
  assert.ok(has(r, 'NOT_ENROLLED', '2026-10-01'));
});

test('休学中: 設定が「休学は確定不可」（既定）なら NOT_ENROLLED', () => {
  const r = evaluateMonth(input({ student: { status: '休学' }, shifts: on(1) }));
  assert.ok(has(r, 'NOT_ENROLLED', '2026-10-01'));
});

test('休学中: 設定で休学を許可していれば NOT_ENROLLED にしない', () => {
  const r = evaluateMonth(input({ student: { status: '休学' }, settings: { allowLeaveOfAbsence: true }, shifts: on(1) }));
  assert.equal(has(r, 'NOT_ENROLLED'), false);
});

test('休学中でもシフト0件（勤務なし）ならコードは付かない', () => {
  const r = evaluateMonth(input({ student: { status: '休学', workPermission: false }, shifts: {} }));
  assert.deepEqual(codes(r), []);
});

// ---- 資格外活動許可 ----

test('許可なしでシフトがあれば NO_PERMIT（block）', () => {
  const r = evaluateMonth(input({ student: { workPermission: false }, shifts: on(1) }));
  assert.ok(has(r, 'NO_PERMIT'));
  assert.ok(blocking(r).some((c) => c.code === 'NO_PERMIT'));
});

test('許可ありでも期限が空なら NO_PERMIT', () => {
  const r = evaluateMonth(input({ student: { permissionExpires: null }, shifts: on(1) }));
  assert.ok(has(r, 'NO_PERMIT'));
});

test('許可なしでもシフト0件なら NO_PERMIT は付かない', () => {
  const r = evaluateMonth(input({ student: { workPermission: false }, shifts: {} }));
  assert.equal(has(r, 'NO_PERMIT'), false);
});

test('許可期限（10/15）当日は可、翌日のシフトは PERMIT_EXPIRED', () => {
  const r = evaluateMonth(input({ student: { permissionExpires: '2026-10-15' }, shifts: on(15, 16) }));
  assert.equal(has(r, 'PERMIT_EXPIRED', '2026-10-15'), false);
  assert.ok(has(r, 'PERMIT_EXPIRED', '2026-10-16'));
});
