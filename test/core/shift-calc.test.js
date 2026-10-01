'use strict';
// 1シフトごとの計算: 休憩・実働・深夜、入力エラー。
// 期待値はすべて仕様から手計算した値。実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMonth, input, s, inputErrorCodes } = require('../helpers/core-input');

function one(shift, extra) {
  const r = evaluateMonth(input({ shifts: { '1': [shift] }, ...(extra || {}) }));
  assert.deepEqual(r.inputErrors, [], '入力エラーが出てはいけない');
  return r.shifts['1'][0];
}

test('17:00〜22:00: 休憩0・実働300・深夜0', () => {
  const x = one(s('17:00', '22:00'));
  assert.equal(x.boundMinutes, 300);
  assert.equal(x.breakMinutes, 0);
  assert.equal(x.breakStart, null);
  assert.equal(x.breakEnd, null);
  assert.equal(x.workMinutes, 300);
  assert.equal(x.nightMinutes, 0);
});

test('18:00〜23:00: 深夜60分（仕様書の例）', () => {
  const x = one(s('18:00', '23:00'));
  assert.equal(x.workMinutes, 300);
  assert.equal(x.nightMinutes, 60);
});

test('09:00〜18:00: 休憩60分は13:00〜14:00、実働480（仕様書の例）', () => {
  const x = one(s('09:00', '18:00'));
  assert.equal(x.boundMinutes, 540);
  assert.equal(x.breakMinutes, 60);
  assert.equal(x.breakStart, '13:00');
  assert.equal(x.breakEnd, '14:00');
  assert.equal(x.workMinutes, 480);
});

test('22:00〜02:00: 翌日終了。拘束240・深夜240・開始日に帰属', () => {
  const r = evaluateMonth(input({ shifts: { '1': [s('22:00', '02:00')] } }));
  const x = r.shifts['1'][0];
  assert.equal(x.boundMinutes, 240);
  assert.equal(x.workMinutes, 240);
  assert.equal(x.nightMinutes, 240);
  assert.equal(r.daily['2026-10-01'], 240);
  assert.equal(r.daily['2026-10-02'], 0);
});

test('22:00〜06:15: 休憩は01:30〜02:30、深夜は休憩を除いて360分', () => {
  const x = one(s('22:00', '06:15'));
  assert.equal(x.boundMinutes, 495);
  assert.equal(x.breakMinutes, 60);
  assert.equal(x.breakStart, '01:30');
  assert.equal(x.breakEnd, '02:30');
  assert.equal(x.workMinutes, 435);
  assert.equal(x.nightMinutes, 360);
});

test('20:00〜04:00: 休憩45分は23:30〜00:15、深夜315分', () => {
  const x = one(s('20:00', '04:00'));
  assert.equal(x.boundMinutes, 480);
  assert.equal(x.breakMinutes, 45);
  assert.equal(x.breakStart, '23:30');
  assert.equal(x.breakEnd, '00:15');
  assert.equal(x.workMinutes, 435);
  assert.equal(x.nightMinutes, 315);
});

test('休憩の境目: 拘束6時間ちょうど＝0分', () => {
  const x = one(s('09:00', '15:00'));
  assert.equal(x.breakMinutes, 0);
  assert.equal(x.workMinutes, 360);
});

test('休憩の境目: 拘束6時間15分＝45分（11:45〜12:30）', () => {
  const x = one(s('09:00', '15:15'));
  assert.equal(x.breakMinutes, 45);
  assert.equal(x.breakStart, '11:45');
  assert.equal(x.breakEnd, '12:30');
  assert.equal(x.workMinutes, 330);
});

test('休憩の境目: 拘束8時間ちょうど＝45分', () => {
  const x = one(s('09:00', '17:00'));
  assert.equal(x.breakMinutes, 45);
  assert.equal(x.workMinutes, 435);
});

test('休憩の境目: 拘束8時間15分＝60分（実働7時間15分）', () => {
  const x = one(s('09:00', '17:15'));
  assert.equal(x.breakMinutes, 60);
  assert.equal(x.workMinutes, 435);
});

test('拘束16時間ちょうどは入力できる（休憩60・実働900）', () => {
  const x = one(s('06:00', '22:00'));
  assert.equal(x.boundMinutes, 960);
  assert.equal(x.workMinutes, 900);
});

test('00:00〜05:00 は開始日の深夜300分', () => {
  const x = one(s('00:00', '05:00'));
  assert.equal(x.nightMinutes, 300);
});

test('03:00〜08:00 は深夜120分', () => {
  const x = one(s('03:00', '08:00'));
  assert.equal(x.nightMinutes, 120);
});

test('05:00開始・22:00終了は深夜0分', () => {
  assert.equal(one(s('05:00', '10:00')).nightMinutes, 0);
  assert.equal(one(s('17:00', '22:00')).nightMinutes, 0);
});

test('21:45〜22:30 は深夜30分（22:00からが深夜）', () => {
  const x = one(s('21:45', '22:30'));
  assert.equal(x.nightMinutes, 30);
  assert.equal(x.workMinutes, 45);
});

test('同じ日に2件: 日の実働は合算する', () => {
  const r = evaluateMonth(input({ shifts: { '2': [s('09:00', '12:00'), s('18:00', '23:00')] } }));
  assert.deepEqual(r.inputErrors, []);
  assert.equal(r.daily['2026-10-02'], 480);
  assert.equal(r.totalMinutes, 480);
});

test('daily は対象月の全日を持つ（10月は31日、働かない日は0）', () => {
  const r = evaluateMonth(input({ shifts: {} }));
  assert.equal(Object.keys(r.daily).length, 31);
  assert.equal(r.daily['2026-10-31'], 0);
  assert.equal(r.totalMinutes, 0);
  assert.equal(r.maxRolling7Minutes, 0);
});

test('daily の日数: 2027年2月は28日、2028年2月は29日、2026年11月は30日', () => {
  assert.equal(Object.keys(evaluateMonth(input({ yearMonth: '2027-02' })).daily).length, 28);
  assert.equal(Object.keys(evaluateMonth(input({ yearMonth: '2028-02' })).daily).length, 29);
  assert.equal(Object.keys(evaluateMonth(input({ yearMonth: '2026-11' })).daily).length, 30);
});

test('月末日の深夜またぎ: 10/31 22:00〜02:00 は10月31日に帰属し、11月の日は持たない', () => {
  const r = evaluateMonth(input({ shifts: { '31': [s('22:00', '02:00')] } }));
  assert.equal(r.daily['2026-10-31'], 240);
  assert.equal(r.daily['2026-11-01'], undefined);
  assert.equal(r.totalMinutes, 240);
});

// ---- 入力エラー ----

function errs(shifts) { return inputErrorCodes(evaluateMonth(input({ shifts }))); }

test('入力エラー: 15分単位でない時刻は INVALID_TIME', () => {
  assert.ok(errs({ '1': [s('09:10', '12:00')] }).includes('INVALID_TIME'));
  assert.ok(errs({ '1': [s('09:00', '12:05')] }).includes('INVALID_TIME'));
});

test('入力エラー: HH:MM 形式でない時刻は INVALID_TIME（9:00・24:00）', () => {
  assert.ok(errs({ '1': [s('9:00', '12:00')] }).includes('INVALID_TIME'));
  assert.ok(errs({ '1': [s('20:00', '24:00')] }).includes('INVALID_TIME'));
});

test('入力エラー: 開始・終了の欠落は MISSING', () => {
  assert.ok(errs({ '1': [{ start: '09:00', end: '' }] }).includes('MISSING'));
  assert.ok(errs({ '1': [{ end: '12:00' }] }).includes('MISSING'));
  assert.ok(errs({ '1': [{ start: '09:00' }] }).includes('MISSING'));
  assert.ok(errs({ '1': [{}] }).includes('MISSING'));
});

test('勤務先の項目が無いシフトをそのまま受け付け、休憩・実働を計算する（2026-10-01 勤務先の廃止）', () => {
  const r = evaluateMonth(input({ shifts: { '1': [{ start: '21:00', end: '06:00' }] } }));
  assert.deepEqual(r.inputErrors, []);
  const x = r.shifts['1'][0];
  assert.equal(x.boundMinutes, 540);
  assert.equal(x.breakMinutes, 60);
  assert.equal(x.workMinutes, 480);
  assert.equal(x.nightMinutes, 360);
  assert.equal(r.daily['2026-10-01'], 480);
  assert.equal(r.totalMinutes, 480);
  assert.equal('workplace' in x, false);
  assert.equal('salaryYen' in x, false);
  assert.equal('earlyMinutes' in x, false);
  assert.equal('estimatedSalaryYen' in r, false);
});

test('シフトに余計な項目（workplace）があっても無視して計算し、勤務先の確認や最低賃金のコードは出ない', () => {
  const r = evaluateMonth(input({ shifts: { '1': [{ workplace: 'W99', start: '09:00', end: '18:00' }] } }));
  assert.deepEqual(r.inputErrors, []);
  assert.equal(r.shifts['1'][0].workMinutes, 480);
  assert.equal('workplace' in r.shifts['1'][0], false);
  assert.deepEqual(r.codes, []);
});

test('入力エラー: 拘束16時間15分は SHIFT_TOO_LONG', () => {
  assert.ok(errs({ '1': [s('06:00', '22:15')] }).includes('SHIFT_TOO_LONG'));
});

test('入力エラー: 開始と終了が同じ（24時間）は SHIFT_TOO_LONG', () => {
  assert.ok(errs({ '1': [s('09:00', '09:00')] }).includes('SHIFT_TOO_LONG'));
});

test('入力エラー: 同じ日の重なりは SHIFT_OVERLAP', () => {
  assert.ok(errs({ '1': [s('09:00', '12:00'), s('11:00', '14:00')] }).includes('SHIFT_OVERLAP'));
});

test('重なり: 終了と開始がちょうど接するだけなら重なりではない', () => {
  assert.deepEqual(errs({ '1': [s('09:00', '12:00'), s('12:00', '14:00')] }), []);
});

test('入力エラー: 日付をまたいで翌日のシフトと重なるのも SHIFT_OVERLAP', () => {
  assert.ok(errs({ '1': [s('22:00', '02:00')], '2': [s('01:00', '03:00')] }).includes('SHIFT_OVERLAP'));
});

test('重なり: 日付をまたぐシフトの終了と翌日の開始が接するだけなら可', () => {
  assert.deepEqual(errs({ '1': [s('22:00', '02:00')], '2': [s('02:00', '04:00')] }), []);
});

test('入力エラーの項目は date（YYYY-MM-DD）と shiftIndex（その日の何番目か、0始まり）を持つ', () => {
  const r = evaluateMonth(input({ shifts: { '3': [s('09:00', '12:00'), s('09:10', '12:00')] } }));
  const e = r.inputErrors.find((x) => x.code === 'INVALID_TIME');
  assert.ok(e);
  assert.equal(e.date, '2026-10-03');
  assert.equal(e.shiftIndex, 1);
});
