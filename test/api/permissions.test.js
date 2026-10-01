'use strict';
// 役割と他人のデータ。画面を隠すだけでなく、サーバ側で拒否すること。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, addStudent, addWorkplace, sh } = require('../helpers/api');

const ADMIN_APIS = [
  ['api_adminBoard', '2026-10', {}],
  ['api_adminStudentDetail', '251001'],
  ['api_adminUpsertStudent', { studentId: '259999' }],
  ['api_adminResetPassword', '251001'],
  ['api_adminUnlockLogin', '251001'],
  ['api_adminVerifyWorkplace', 'x', 'OK'],
  ['api_adminGrantUnlock', '251001', '2026-10', '2026-10-02 18:00'],
  ['api_adminSchoolConfirm', '251001', '2026-10'],
  ['api_adminQuarterCheck', { className: null, endYearMonth: '2026-10' }],
  ['api_adminSetDeadline', { yearMonth: '2026-10', className: 'A', deadlineAt: '2026-09-30 23:59', actualDeadlineAt: null }],
  ['api_adminSetHoliday', { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 }],
  ['api_adminDeleteHoliday', 'x'],
  ['api_adminListHolidays'],
  ['api_adminSetMinimumWage', { prefecture: '愛知県', amount: 1, effectiveFrom: '2020-01-01', effectiveTo: null }],
  ['api_adminListMinimumWages'],
  ['api_adminGetSettings'],
  ['api_adminSetSettings', { allowLeaveOfAbsence: true }],
  ['api_adminPrintHtml', { studentIds: ['251001'], yearMonths: ['2026-10'] }],
  ['api_adminPurgeExpired'],
  ['api_adminCreateAdmin'],
  ['api_adminSeedDemo'],
];

test('学生のトークンで管理者の窓口を呼ぶと、すべて FORBIDDEN', () => {
  const w = world();
  for (const [name, ...args] of ADMIN_APIS) {
    const r = w.api(name, w.st.token, ...args);
    assert.deepEqual([r.ok, r.error], [false, 'FORBIDDEN'], name);
  }
});

test('学生のトークンで管理者の窓口を呼んでも、データは何も変わらない', () => {
  const w = world();
  w.api('api_adminSetSettings', w.st.token, { allowLeaveOfAbsence: true });
  w.api('api_adminSetMinimumWage', w.st.token, { prefecture: '愛知県', amount: 1, effectiveFrom: '2020-01-01', effectiveTo: null });
  const s = ok(w.api('api_adminGetSettings', w.admin));
  assert.equal(s.allowLeaveOfAbsence, false);
  const wages = ok(w.api('api_adminListMinimumWages', w.admin));
  assert.equal(wages.some((x) => x.amount === 1), false);
});

test('トークン無しで管理者の窓口を呼ぶと、すべて AUTH_REQUIRED', () => {
  const w = world();
  for (const [name, ...args] of ADMIN_APIS) {
    assert.equal(w.api(name, '', ...args).error, 'AUTH_REQUIRED', name);
  }
});

const STUDENT_APIS = [
  ['api_getMonth', '2026-10'],
  ['api_saveDraft', '2026-10', {}, 0],
  ['api_confirm', '2026-10', {}, 0],
  ['api_saveActual', '2026-10', {}, 0],
  ['api_confirmActual', '2026-10', 0],
  ['api_saveWorkplace', { name: 'x', prefecture: '愛知県', jobDescription: 'x', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null }],
  ['api_listWorkplaces'],
  ['api_getHistory'],
];

test('管理者のトークンで学生の窓口を呼ぶと FORBIDDEN（管理者は学生として保存できない）', () => {
  const w = world();
  for (const [name, ...args] of STUDENT_APIS) {
    assert.equal(w.api(name, w.admin, ...args).error, 'FORBIDDEN', name);
  }
});

test('学生は自分のデータだけを見る: 別の学生の保存内容は見えない', () => {
  const w = world();
  const other = addStudent(w, { studentId: '251002' });
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  const m = ok(w.api('api_getMonth', other.token, '2026-10'));
  assert.equal(m.status, '未入力');
  assert.deepEqual(m.shifts, {});
});

test('学生は他の学生の勤務先を見られず、変更もできない（NOT_FOUND）', () => {
  const w = world();
  const other = addStudent(w, { studentId: '251002' });
  assert.deepEqual(ok(w.api('api_listWorkplaces', other.token)), []);
  const r = w.api('api_saveWorkplace', other.token, {
    workplaceId: w.wp, name: '乗っ取り', prefecture: '愛知県', jobDescription: 'x', baseHourlyWage: 1200,
    earlyStart: null, earlyEnd: null, earlyPremium: null,
  });
  assert.equal(r.error, 'NOT_FOUND');
  assert.equal(ok(w.api('api_listWorkplaces', w.st.token))[0].name, 'コンビニA');
});

test('他の学生の勤務先IDをシフトに使うと入力エラー（MISSING）で保存できない', () => {
  const w = world();
  const other = addStudent(w, { studentId: '251002' });
  const r = w.api('api_saveDraft', other.token, '2026-10', { '1': [sh(w.wp, '09:00', '12:00')] }, 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.inputErrors.some((e) => e.code === 'MISSING'));
});

test('勤務先: 新規登録は必ず確認中。学生がOKの勤務先を編集すると確認中に戻る', () => {
  const w = world();
  const list1 = ok(w.api('api_listWorkplaces', w.st.token));
  assert.equal(list1[0].verificationStatus, 'OK');
  ok(w.api('api_saveWorkplace', w.st.token, { ...list1[0], workplaceId: w.wp, baseHourlyWage: 1250 }));
  assert.equal(ok(w.api('api_listWorkplaces', w.st.token))[0].verificationStatus, '確認中');
  const id2 = ok(w.api('api_saveWorkplace', w.st.token, { name: 'B', prefecture: '愛知県', jobDescription: '接客', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null, verificationStatus: 'OK' })).workplaceId;
  assert.equal(ok(w.api('api_listWorkplaces', w.st.token)).find((x) => x.workplaceId === id2).verificationStatus, '確認中');
});

test('勤務先: 禁止にされた勤務先は学生が編集できない（FORBIDDEN）', () => {
  const w = world();
  ok(w.api('api_adminVerifyWorkplace', w.admin, w.wp, '禁止'));
  const list = ok(w.api('api_listWorkplaces', w.st.token));
  const r = w.api('api_saveWorkplace', w.st.token, { ...list[0], workplaceId: w.wp, name: '名前を変えて逃れる' });
  assert.equal(r.error, 'FORBIDDEN');
});

test('勤務先の入力検証: 都道府県名・時給・早朝手当の組み合わせ', () => {
  const w = world();
  const base = { name: 'C', prefecture: '愛知県', jobDescription: '調理', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null };
  const bad = [
    { ...base, prefecture: '愛知' },
    { ...base, name: '' },
    { ...base, jobDescription: '' },
    { ...base, baseHourlyWage: 0 },
    { ...base, baseHourlyWage: 1200.5 },
    { ...base, earlyStart: '05:00', earlyEnd: null, earlyPremium: 100 },
    { ...base, earlyStart: '08:00', earlyEnd: '05:00', earlyPremium: 100 },
    { ...base, earlyStart: '05:10', earlyEnd: '08:00', earlyPremium: 100 },
    { ...base, earlyStart: '05:00', earlyEnd: '08:00', earlyPremium: -1 },
  ];
  for (const b of bad) assert.equal(w.api('api_saveWorkplace', w.st.token, b).error, 'BAD_REQUEST', JSON.stringify(b));
  ok(w.api('api_saveWorkplace', w.st.token, { ...base, earlyStart: '05:00', earlyEnd: '08:00', earlyPremium: 100 }));
});

test('提出履歴は自分の月だけを新しい順に返す', () => {
  const w = world();
  const other = addStudent(w, { studentId: '251002' });
  addWorkplace(w, other);
  ok(w.api('api_saveDraft', w.st.token, '2026-10', {}, 0));
  ok(w.api('api_confirm', w.st.token, '2026-11', {}, 0));
  ok(w.api('api_saveDraft', other.token, '2026-12', {}, 0));
  const h = ok(w.api('api_getHistory', w.st.token));
  assert.deepEqual(h.map((x) => [x.yearMonth, x.status]), [['2026-11', '確定済'], ['2026-10', '下書き']]);
});
