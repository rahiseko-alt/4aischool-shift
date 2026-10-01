'use strict';
// 18歳未満・成人の注意・前月未確定・実績モード・重さ（severity）。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, everyDay, has, codes, blocking, inputErrorCodes } = require('../helpers/core-input');

const EIGHT_H = s('09:00', '18:00'); // 実働480
const EIGHT_H15 = s('09:00', '18:15'); // 実働495
const WINTER = { holidays: [{ startDate: '2026-12-24', endDate: '2027-01-07' }] };
// 12/24〜12/29 を含む7日間がすべて長期休業日になるよう、長めの休業期間を使う
const LONG_WINTER = { holidays: [{ startDate: '2026-12-15', endDate: '2027-01-07' }] };

// ---- 18歳未満 ----

const TURNS_18_ON_OCT15 = { student: { birthDate: '2008-10-15' } };

test('18歳の誕生日の前日（10/14）の深夜勤務は MINOR_NIGHT（block）', () => {
  const r = evaluateMonth(input({ ...TURNS_18_ON_OCT15, shifts: { '14': [s('22:00', '23:00')] } }));
  assert.ok(has(r, 'MINOR_NIGHT', '2026-10-14'));
  assert.ok(blocking(r).some((c) => c.code === 'MINOR_NIGHT'));
});

test('18歳の誕生日当日（10/15）からは深夜勤務も可', () => {
  const r = evaluateMonth(input({ ...TURNS_18_ON_OCT15, shifts: { '15': [s('22:00', '23:00')] } }));
  assert.equal(has(r, 'MINOR_NIGHT'), false);
});

test('誕生日の前日に始まり当日にまたぐ深夜勤務は、開始日で判定して MINOR_NIGHT', () => {
  const r = evaluateMonth(input({ ...TURNS_18_ON_OCT15, shifts: { '14': [s('22:00', '02:00')] } }));
  assert.ok(has(r, 'MINOR_NIGHT', '2026-10-14'));
});

const MINOR = { student: { birthDate: '2010-01-01' } };

test('18歳未満: 17:00〜22:00 と 05:00〜09:00 は深夜にかからない（可）', () => {
  const r = evaluateMonth(input({ ...MINOR, shifts: { '1': [s('17:00', '22:00')], '2': [s('05:00', '09:00')] } }));
  assert.equal(has(r, 'MINOR_NIGHT'), false);
});

test('18歳未満: 21:45〜22:15 と 04:45〜06:00 は深夜に15分かかる（MINOR_NIGHT）', () => {
  const r = evaluateMonth(input({ ...MINOR, shifts: { '1': [s('21:45', '22:15')], '2': [s('04:45', '06:00')] } }));
  assert.ok(has(r, 'MINOR_NIGHT', '2026-10-01'));
  assert.ok(has(r, 'MINOR_NIGHT', '2026-10-02'));
});

test('2月29日生まれは、平年は2月28日まで17歳、3月1日から18歳', () => {
  const st = { student: { birthDate: '2008-02-29' } };
  const feb = evaluateMonth(input({ ...st, yearMonth: '2026-02', shifts: { '28': [s('22:00', '23:00')] } }));
  assert.ok(has(feb, 'MINOR_NIGHT', '2026-02-28'));
  const mar = evaluateMonth(input({ ...st, yearMonth: '2026-03', shifts: { '1': [s('22:00', '23:00')] } }));
  assert.equal(has(mar, 'MINOR_NIGHT'), false);
});

test('18歳未満: 1日の実働8時間ちょうどは可、8時間15分は MINOR_OVER（LABOR_HOURS ではない）', () => {
  const ok = evaluateMonth(input({ ...MINOR, shifts: { '1': [EIGHT_H] } }));
  assert.equal(has(ok, 'MINOR_OVER'), false);
  const ng = evaluateMonth(input({ ...MINOR, shifts: { '1': [EIGHT_H15] } }));
  assert.ok(has(ng, 'MINOR_OVER', '2026-10-01'));
  assert.equal(has(ng, 'LABOR_HOURS'), false);
});

test('18歳未満: 長期休業中（28時間の検算が止まる7日間）でも、7日40時間を超えれば MINOR_OVER', () => {
  const ok = evaluateMonth(input({ ...MINOR, yearMonth: '2026-12', ...LONG_WINTER, shifts: everyDay(24, 28, EIGHT_H) }));
  assert.equal(has(ok, 'MINOR_OVER'), false);
  const ng = evaluateMonth(input({ ...MINOR, yearMonth: '2026-12', ...LONG_WINTER, shifts: everyDay(24, 29, EIGHT_H) }));
  assert.ok(has(ng, 'MINOR_OVER'));
  assert.equal(has(ng, 'OVER_28H'), false);
});

// ---- 成人の注意（確定は止めない） ----

test('成人: 1日の実働8時間15分は LABOR_HOURS（warn）で、block ではない', () => {
  const r = evaluateMonth(input({ shifts: { '1': [EIGHT_H15] } }));
  assert.ok(has(r, 'LABOR_HOURS', '2026-10-01'));
  assert.equal(r.codes.find((c) => c.code === 'LABOR_HOURS').severity, 'warn');
  assert.deepEqual(blocking(r), []);
});

test('成人: 1日の実働8時間ちょうどは LABOR_HOURS にならない', () => {
  assert.deepEqual(codes(evaluateMonth(input({ shifts: { '1': [EIGHT_H] } }))), []);
});

test('成人: 7日で40時間ちょうどは注意なし、40時間を超えれば LABOR_HOURS（長期休業中）', () => {
  const ok = evaluateMonth(input({ yearMonth: '2026-12', ...LONG_WINTER, shifts: everyDay(24, 28, EIGHT_H) }));
  assert.equal(has(ok, 'LABOR_HOURS'), false);
  const ng = evaluateMonth(input({ yearMonth: '2026-12', ...LONG_WINTER, shifts: everyDay(24, 29, EIGHT_H) }));
  assert.ok(has(ng, 'LABOR_HOURS'));
  assert.deepEqual(blocking(ng), []);
});

// ---- 前月未確定 ----

test('前月の取得元が none なら PREV_MONTH_DRAFT（warn）', () => {
  const r = evaluateMonth(input({ prevMonthSource: 'none', prevMonthDaily: {} }));
  assert.ok(has(r, 'PREV_MONTH_DRAFT'));
  assert.equal(r.codes.find((c) => c.code === 'PREV_MONTH_DRAFT').severity, 'warn');
  assert.deepEqual(blocking(r), []);
});

test('前月の取得元が actual・confirmed・not_applicable なら PREV_MONTH_DRAFT は付かない', () => {
  for (const src of ['actual', 'confirmed', 'not_applicable']) {
    assert.equal(has(evaluateMonth(input({ prevMonthSource: src })), 'PREV_MONTH_DRAFT'), false, src);
  }
});

// ---- 実績モード ----

test('実績モード: 28時間超過は保存を止めない。OVER_28H は admin になり、ACTUAL_OVER が付く', () => {
  const r = evaluateMonth(input({ mode: 'actual', shifts: everyDay(9, 13, EIGHT_H) }));
  assert.ok(has(r, 'OVER_28H'));
  assert.equal(r.codes.find((c) => c.code === 'OVER_28H').severity, 'admin');
  assert.ok(has(r, 'ACTUAL_OVER'));
  assert.equal(r.codes.find((c) => c.code === 'ACTUAL_OVER').severity, 'admin');
  assert.deepEqual(blocking(r), []);
});

test('実績モード: 長期休業8時間超過・18歳未満の超過でも ACTUAL_OVER が付く', () => {
  const hol = evaluateMonth(input({ mode: 'actual', yearMonth: '2026-12', ...WINTER, shifts: { '25': [EIGHT_H15] } }));
  assert.ok(has(hol, 'ACTUAL_OVER'));
  const minor = evaluateMonth(input({ mode: 'actual', ...MINOR, shifts: { '1': [s('22:00', '23:00')] } }));
  assert.ok(has(minor, 'ACTUAL_OVER'));
});

test('実績モード: 許可期限切れなど時間超過でない違反は admin になるが、ACTUAL_OVER は付かない', () => {
  const r = evaluateMonth(input({
    mode: 'actual',
    student: { permissionExpires: '2026-09-30' },
    shifts: { '1': [s('09:00', '12:00')] },
  }));
  assert.equal(r.codes.find((c) => c.code === 'PERMIT_EXPIRED').severity, 'admin');
  assert.equal(has(r, 'ACTUAL_OVER'), false);
});

test('実績モードでも入力エラーは inputErrors に出る（保存を止める）', () => {
  const r = evaluateMonth(input({ mode: 'actual', shifts: { '1': [s('09:00', '12:00'), s('11:00', '13:00')] } }));
  assert.ok(inputErrorCodes(r).includes('SHIFT_OVERLAP'));
});

test('予定モードでは ACTUAL_OVER は付かない', () => {
  const r = evaluateMonth(input({ shifts: everyDay(9, 13, EIGHT_H) }));
  assert.equal(has(r, 'ACTUAL_OVER'), false);
});

// ---- 重さの一覧 ----

test('各コードの重さ（severity）は仕様どおり', () => {
  const expected = {
    OVER_28H: 'block', OVER_8H_HOLIDAY: 'block', NO_PERMIT: 'block', PERMIT_EXPIRED: 'block',
    NOT_ENROLLED: 'block', MINOR_NIGHT: 'block', MINOR_OVER: 'block',
    PREV_MONTH_DRAFT: 'warn', LABOR_HOURS: 'warn',
  };
  const r = evaluateMonth(input({
    student: { birthDate: '2010-01-01', workPermission: false, status: '休学', permissionExpires: '2026-09-30' },
    prevMonthSource: 'none',
    shifts: { ...everyDay(5, 9, s('09:00', '18:15')), '10': [s('21:00', '23:00')] },
  }));
  for (const c of r.codes) {
    if (expected[c.code]) assert.equal(c.severity, expected[c.code], c.code);
  }
  for (const code of ['OVER_28H', 'NO_PERMIT', 'NOT_ENROLLED', 'MINOR_NIGHT', 'MINOR_OVER', 'PREV_MONTH_DRAFT']) {
    assert.ok(has(r, code), code + ' が出ていない');
  }
});
