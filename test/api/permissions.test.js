'use strict';
// 役割と他人のデータ。画面を隠すだけでなく、サーバ側で拒否すること。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, addStudent, sh } = require('../helpers/api');

const ADMIN_APIS = [
  ['api_adminBoard', '2026-10', {}],
  ['api_adminStudentDetail', '251001'],
  ['api_adminUpsertStudent', { studentId: '259999' }],
  ['api_adminResetPassword', '251001'],
  ['api_adminUnlockLogin', '251001'],
  ['api_adminGrantUnlock', '251001', '2026-10', '2026-10-02 18:00'],
  ['api_adminSchoolConfirm', '251001', '2026-10'],
  ['api_adminSetDeadline', { yearMonth: '2026-10', className: 'A', deadlineAt: '2026-09-30 23:59', actualDeadlineAt: null }],
  ['api_adminSetHoliday', { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 }],
  ['api_adminDeleteHoliday', 'x'],
  ['api_adminListHolidays'],
  ['api_adminGetSettings'],
  ['api_adminSetSettings', { allowLeaveOfAbsence: true }],
  ['api_adminPrintHtml', { studentIds: ['251001'], yearMonths: ['2026-10'] }],
  ['api_adminPurgeExpired'],
  ['api_adminCreateAdmin'],
  ['api_adminSeedDemo'],
  ['api_adminActAsDemoStudent', 'DEMO-A'],
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
  const s = ok(w.api('api_adminGetSettings', w.admin));
  assert.equal(s.allowLeaveOfAbsence, false);
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
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '1': [sh('09:00', '12:00')] }, 0));
  const m = ok(w.api('api_getMonth', other.token, '2026-10'));
  assert.equal(m.status, '未入力');
  assert.deepEqual(m.shifts, {});
});

test('提出履歴は自分の月だけを新しい順に返す', () => {
  const w = world();
  const other = addStudent(w, { studentId: '251002' });
  ok(w.api('api_saveDraft', w.st.token, '2026-10', {}, 0));
  ok(w.api('api_confirm', w.st.token, '2026-11', {}, 0));
  ok(w.api('api_saveDraft', other.token, '2026-12', {}, 0));
  const h = ok(w.api('api_getHistory', w.st.token));
  assert.deepEqual(h.map((x) => [x.yearMonth, x.status]), [['2026-11', '確定済'], ['2026-10', '下書き']]);
});

test('勤務先・最低賃金の窓口はもう無い（2026-10-01 勤務先の廃止）', () => {
  const w = world();
  for (const name of ['api_saveWorkplace', 'api_listWorkplaces', 'api_adminVerifyWorkplace', 'api_adminSetMinimumWage', 'api_adminListMinimumWages']) {
    assert.notEqual(typeof w.app.context[name], 'function', name);
  }
});
