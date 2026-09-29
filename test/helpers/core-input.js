'use strict';
// 計算の心臓部 evaluateMonth のテスト用の入力を組み立てる。テスト専用。
// 実装役はこのファイルを変更してはならない。
// 注意: 最低賃金の金額はテスト用の架空の値であり、実際の金額ではない。

const { load } = require('./load');

let app;
function evaluateMonth(input) {
  if (!app) app = load();
  return app.call('evaluateMonth', input);
}

function baseInput() {
  return {
    yearMonth: '2026-10',
    mode: 'plan',
    student: {
      birthDate: '2000-04-01',
      enrollmentDate: '2025-04-01',
      withdrawalDate: null,
      graduationDate: null,
      status: '在籍',
      workPermission: true,
      permissionExpires: '2027-12-31',
    },
    workplaces: [
      { id: 'W01', prefecture: '愛知県', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null, verificationStatus: 'OK' },
      { id: 'W02', prefecture: '愛知県', baseHourlyWage: 1150, earlyStart: null, earlyEnd: null, earlyPremium: null, verificationStatus: 'OK' },
    ],
    shifts: {},
    prevMonthDaily: {},
    prevMonthSource: 'confirmed',
    nextMonthDaily: {},
    holidays: [],
    minimumWages: [
      { prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null },
    ],
    settings: { allowLeaveOfAbsence: false },
  };
}

// overrides は浅く上書きする。student / settings だけは項目ごとに上書きする。
function input(overrides) {
  const base = baseInput();
  const o = overrides || {};
  const out = { ...base, ...o };
  if (o.student) out.student = { ...base.student, ...o.student };
  if (o.settings) out.settings = { ...base.settings, ...o.settings };
  return out;
}

// 1シフトの略記: s('W01', '09:00', '18:00')
function s(workplace, start, end) { return { workplace, start, end }; }

// 連続する日に同じシフトを入れる: everyDay(5, 11, s(...)) → { '5': [..], ..., '11': [..] }
function everyDay(from, to, shift) {
  const out = {};
  for (let d = from; d <= to; d++) out[String(d)] = [{ ...shift }];
  return out;
}

const codes = (r) => r.codes.map((c) => c.code);
const has = (r, code, date) => r.codes.some((c) => c.code === code && (date === undefined || c.date === date));
const inputErrorCodes = (r) => r.inputErrors.map((e) => e.code);
const blocking = (r) => r.codes.filter((c) => c.severity === 'block');

module.exports = { evaluateMonth, input, s, everyDay, codes, has, inputErrorCodes, blocking };
