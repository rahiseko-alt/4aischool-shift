'use strict';
// 計算の心臓部 evaluateMonth のテスト用の入力を組み立てる。テスト専用。
// 実装役はこのファイルを変更してはならない。

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
    shifts: {},
    prevMonthDaily: {},
    prevMonthSource: 'confirmed',
    nextMonthDaily: {},
    holidays: [],
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

// 1シフトの略記: s('09:00', '18:00')
function s(start, end) { return { start, end }; }

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
