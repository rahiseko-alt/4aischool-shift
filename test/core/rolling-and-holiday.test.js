'use strict';
// 28時間（ローリング7日）と、長期休業の1日8時間。
// 期待値はすべて仕様から手計算した値。実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, everyDay, has, codes } = require('../helpers/core-input');

const FOUR_H = s('09:00', '13:00'); // 実働240
const FOUR_H15 = s('09:00', '13:15'); // 実働255
const EIGHT_H = s('09:00', '18:00'); // 実働480
const EIGHT_H15 = s('09:00', '18:15'); // 実働495

test('7日で28時間ちょうど（240分×7）は可。7日最大は1,680分', () => {
  const r = evaluateMonth(input({ shifts: everyDay(5, 11, FOUR_H) }));
  assert.equal(has(r, 'OVER_28H'), false);
  assert.equal(r.maxRolling7Minutes, 1680);
});

test('7日で28時間15分は OVER_28H（block）', () => {
  const shifts = everyDay(5, 11, FOUR_H);
  shifts['11'] = [FOUR_H15];
  const r = evaluateMonth(input({ shifts }));
  assert.ok(has(r, 'OVER_28H'));
  assert.equal(r.codes.find((c) => c.code === 'OVER_28H').severity, 'block');
  assert.equal(r.maxRolling7Minutes, 1695);
});

test('月〜日の固定週では収まっても、どの曜日から数えても28時間を超えれば OVER_28H', () => {
  // 10/5(月)〜10/11(日): 10/9・10/10・10/11 に各480分＝1,440分
  // 10/12(月)〜10/18(日): 10/12・10/13 に各480分＝960分
  // 10/9〜10/15 の7日間では 2,400分
  const r = evaluateMonth(input({ shifts: { ...everyDay(9, 13, EIGHT_H) } }));
  assert.ok(has(r, 'OVER_28H'));
  assert.ok(has(r, 'OVER_28H', '2026-10-09'));
  assert.equal(r.maxRolling7Minutes, 2400);
});

test('同じ日の複数のシフトを合算して28時間を超えれば OVER_28H（1件ずつなら超えない）', () => {
  const shifts = {};
  for (let d = 5; d <= 11; d++) shifts[String(d)] = [s('09:00', '12:00'), s('18:00', '19:00')];
  assert.equal(has(evaluateMonth(input({ shifts })), 'OVER_28H'), false);
  shifts['11'] = [s('09:00', '12:00'), s('18:00', '19:15')];
  assert.ok(has(evaluateMonth(input({ shifts })), 'OVER_28H'));
});

test('月初: 前月の最終6日分（前月の確定データ）と合わせて28時間を超えれば OVER_28H', () => {
  const prev = { '2026-09-26': 480, '2026-09-27': 480, '2026-09-28': 480 };
  const ok = evaluateMonth(input({ prevMonthDaily: prev, shifts: {} }));
  assert.equal(has(ok, 'OVER_28H'), false);
  const ng = evaluateMonth(input({ prevMonthDaily: prev, shifts: { '1': [FOUR_H15] } }));
  assert.ok(has(ng, 'OVER_28H', '2026-09-26'));
  assert.equal(ng.maxRolling7Minutes, 1695);
});

test('月またぎ: 10/31 22:00〜02:00 の240分は、11月の検算で前月分として数える', () => {
  const nov = { yearMonth: '2026-11', prevMonthDaily: { '2026-10-31': 240 } };
  const ok = evaluateMonth(input({ ...nov, shifts: everyDay(1, 6, FOUR_H) }));
  assert.equal(has(ok, 'OVER_28H'), false);
  assert.equal(ok.maxRolling7Minutes, 1680);
  const shifts = everyDay(1, 6, FOUR_H);
  shifts['6'] = [FOUR_H15];
  const ng = evaluateMonth(input({ ...nov, shifts }));
  assert.ok(has(ng, 'OVER_28H', '2026-10-31'));
});

test('月末: 翌月の最初6日分が渡されれば、それも合わせて検算する', () => {
  const next = { '2026-11-01': 480, '2026-11-02': 480, '2026-11-03': 480 };
  const r = evaluateMonth(input({ nextMonthDaily: next, shifts: { '30': [FOUR_H15] } }));
  assert.ok(has(r, 'OVER_28H'));
  const r2 = evaluateMonth(input({ nextMonthDaily: next, shifts: { '30': [FOUR_H] } }));
  assert.equal(has(r2, 'OVER_28H'), false);
});

test('前月の日だけで28時間を超えていても、前月の日しか含まない7日間は検算しない', () => {
  // 9/20〜9/26 に 2,400分。対象月の日を含む最初の7日間は 9/25〜10/1（9/25・9/26 の 960分）
  const prev = { '2026-09-20': 480, '2026-09-21': 480, '2026-09-22': 480, '2026-09-25': 480, '2026-09-26': 480 };
  const r = evaluateMonth(input({ prevMonthDaily: prev, shifts: {} }));
  assert.equal(has(r, 'OVER_28H'), false);
});

// ---- 長期休業 ----

const WINTER = { holidays: [{ startDate: '2026-12-24', endDate: '2027-01-07' }] };

test('長期休業日: 8時間ちょうど（480分）は可', () => {
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: { '25': [EIGHT_H] } }));
  assert.equal(has(r, 'OVER_8H_HOLIDAY'), false);
});

test('長期休業日: 8時間15分（495分）は OVER_8H_HOLIDAY（block）', () => {
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: { '25': [EIGHT_H15] } }));
  assert.ok(has(r, 'OVER_8H_HOLIDAY', '2026-12-25'));
  assert.equal(r.codes.find((c) => c.code === 'OVER_8H_HOLIDAY').severity, 'block');
});

test('長期休業日: 同じ日の2シフトの合計で8時間を超えても OVER_8H_HOLIDAY', () => {
  const r = evaluateMonth(input({
    yearMonth: '2026-12', ...WINTER,
    shifts: { '25': [s('09:00', '13:00'), s('14:00', '18:15')] },
  }));
  assert.ok(has(r, 'OVER_8H_HOLIDAY', '2026-12-25'));
});

test('長期休業期間の中の土曜日（12/26）も長期休業日として扱う', () => {
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: { '26': [EIGHT_H15] } }));
  assert.ok(has(r, 'OVER_8H_HOLIDAY', '2026-12-26'));
});

test('長期休業期間の外の土曜日（12/19）は通常期間（OVER_8H_HOLIDAY にならない）', () => {
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: { '19': [EIGHT_H15] } }));
  assert.equal(has(r, 'OVER_8H_HOLIDAY'), false);
});

test('長期休業期間の開始日・終了日も長期休業日に含む', () => {
  const dec = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: { '24': [EIGHT_H15] } }));
  assert.ok(has(dec, 'OVER_8H_HOLIDAY', '2026-12-24'));
  const jan = evaluateMonth(input({ yearMonth: '2027-01', ...WINTER, shifts: { '7': [EIGHT_H15], '8': [EIGHT_H15] } }));
  assert.ok(has(jan, 'OVER_8H_HOLIDAY', '2027-01-07'));
  assert.equal(has(jan, 'OVER_8H_HOLIDAY', '2027-01-08'), false);
});

test('通常期間と長期休業が混ざった7日間は、28時間の検算を続ける', () => {
  // 12/22・12/23（通常）と 12/24・12/25（休業）に各480分 → 12/19〜12/25 で 1,920分
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: everyDay(22, 25, EIGHT_H) }));
  assert.ok(has(r, 'OVER_28H'));
});

test('7日すべてが長期休業日になった7日間は、28時間の検算をしない', () => {
  // 12/28〜12/31 に各480分（1,920分）。通常の日を含む7日間（〜12/23開始）は最大960分
  const r = evaluateMonth(input({ yearMonth: '2026-12', ...WINTER, shifts: everyDay(28, 31, EIGHT_H) }));
  assert.equal(has(r, 'OVER_28H'), false);
  assert.equal(has(r, 'OVER_8H_HOLIDAY'), false);
  assert.equal(r.maxRolling7Minutes, 1920);
});

test('長期休業が登録されていなければ、12月末も通常期間', () => {
  const r = evaluateMonth(input({ yearMonth: '2026-12', shifts: everyDay(28, 31, EIGHT_H) }));
  assert.ok(has(r, 'OVER_28H'));
});

test('違反が無い月は block のコードを1つも持たない', () => {
  const r = evaluateMonth(input({ shifts: everyDay(5, 11, FOUR_H) }));
  assert.deepEqual(codes(r), []);
});
