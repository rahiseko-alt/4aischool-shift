'use strict';
// 7日間のコード（OVER_28H など）は、date に7日間の初日、windowEnd に最終日を持つ（2026-10-07）。
// 画面は windowEnd を使って、その月の中の日として出す（前の月の日付が出て、違う日の行が赤くなるのを防ぐ）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, everyDay } = require('../helpers/core-input');

test('7日間のコードには、初日から6日後の windowEnd が付く', () => {
  const r = evaluateMonth(input({ shifts: everyDay(9, 13, s('09:00', '18:00')) }));
  const c = r.codes.filter((x) => x.code === 'OVER_28H');
  assert.ok(c.length);
  for (const x of c) {
    const d = new Date(x.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    assert.equal(x.windowEnd, d.toISOString().slice(0, 10));
  }
});

test('前の月の日から始まる7日間でも、windowEnd はその月の中に入る', () => {
  const prev = { '2026-09-28': 300, '2026-09-29': 300, '2026-09-30': 300 };
  const r = evaluateMonth(input({ shifts: everyDay(1, 3, s('09:00', '14:00')), prevMonthDaily: prev, prevMonthSource: 'confirmed' }));
  const c = r.codes.filter((x) => x.code === 'OVER_28H');
  assert.ok(c.length);
  assert.ok(c.some((x) => x.date < '2026-10-01'));
  for (const x of c) assert.ok(x.windowEnd >= '2026-10-01', x.windowEnd);
});
