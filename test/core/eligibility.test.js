'use strict';
// 在籍・資格外活動許可・勤務先の確認状態・最低賃金。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, has, codes, blocking } = require('../helpers/core-input');

const SHIFT = s('W01', '09:00', '12:00');
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

// ---- 勤務先 ----

function withStatus(status) {
  const base = input();
  return base.workplaces.map((w) => (w.id === 'W02' ? { ...w, verificationStatus: status } : w));
}

test('確認中の勤務先を使ったシフトは WORKPLACE_PENDING（block）', () => {
  const r = evaluateMonth(input({ workplaces: withStatus('確認中'), shifts: { '1': [s('W02', '09:00', '12:00')] } }));
  assert.ok(has(r, 'WORKPLACE_PENDING', '2026-10-01'));
  assert.ok(blocking(r).some((c) => c.code === 'WORKPLACE_PENDING'));
});

test('禁止の勤務先を使ったシフトは WORKPLACE_BANNED（block）', () => {
  const r = evaluateMonth(input({ workplaces: withStatus('禁止'), shifts: { '1': [s('W02', '09:00', '12:00')] } }));
  assert.ok(has(r, 'WORKPLACE_BANNED', '2026-10-01'));
});

test('シフトで使っていない勤務先が確認中・禁止でも、コードは付かない', () => {
  assert.deepEqual(codes(evaluateMonth(input({ workplaces: withStatus('確認中'), shifts: on(1) }))), []);
  assert.deepEqual(codes(evaluateMonth(input({ workplaces: withStatus('禁止'), shifts: on(1) }))), []);
});

// ---- 最低賃金 ----

function wage(w, minimumWages, days) {
  const base = input();
  return evaluateMonth(input({
    workplaces: base.workplaces.map((x) => (x.id === 'W01' ? { ...x, baseHourlyWage: w } : x)),
    minimumWages,
    shifts: on(...days),
  }));
}

test('時給が最低賃金と同額なら可', () => {
  const r = wage(1100, [{ prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null }], [1]);
  assert.equal(has(r, 'WAGE_LOW'), false);
});

test('時給が最低賃金を1円でも下回れば WAGE_LOW（block）', () => {
  const r = wage(1099, [{ prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null }], [1]);
  assert.ok(has(r, 'WAGE_LOW', '2026-10-01'));
});

test('発効日をまたぐ月は日ごとに判定する（10/17まで1,100円、10/18から1,140円、時給1,120円）', () => {
  const r = wage(1120, [
    { prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: '2026-10-17' },
    { prefecture: '愛知県', amount: 1140, effectiveFrom: '2026-10-18', effectiveTo: null },
  ], [17, 18]);
  assert.equal(has(r, 'WAGE_LOW', '2026-10-17'), false);
  assert.ok(has(r, 'WAGE_LOW', '2026-10-18'));
});

test('終了日が空の古い行と新しい行が両方当てはまるときは、発効日が新しい行を使う', () => {
  const r = wage(1120, [
    { prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null },
    { prefecture: '愛知県', amount: 1140, effectiveFrom: '2026-10-18', effectiveTo: null },
  ], [17, 18]);
  assert.equal(has(r, 'WAGE_LOW', '2026-10-17'), false);
  assert.ok(has(r, 'WAGE_LOW', '2026-10-18'));
});

test('その都道府県の最低賃金が登録されていなければ MINWAGE_MISSING（block）', () => {
  const r = wage(1200, [{ prefecture: '東京都', amount: 1163, effectiveFrom: '2025-10-03', effectiveTo: null }], [1]);
  assert.ok(has(r, 'MINWAGE_MISSING', '2026-10-01'));
  assert.equal(r.codes.find((c) => c.code === 'MINWAGE_MISSING').severity, 'block');
});

test('発効日より前の日には、その行を使わない（MINWAGE_MISSING）', () => {
  const r = wage(1200, [{ prefecture: '愛知県', amount: 1100, effectiveFrom: '2026-10-18', effectiveTo: null }], [17]);
  assert.ok(has(r, 'MINWAGE_MISSING', '2026-10-17'));
});
