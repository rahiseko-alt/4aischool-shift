'use strict';
// 管理者がまとめて締める・再開する、一覧の先月との差（2026-11-04）。
// 時計: world() は 2026-09-01 10:00。10月分の締切は 2026-09-30 23:59。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, addStudent, sh, everyDay } = require('../helpers/api');

const YM = '2026-10';
const row = (w, id, ym) => ok(w.api('api_adminBoard', w.admin, ym || YM, {})).rows.find((r) => r.studentId === id);

test('締める: 下書きの月は今の内容のまま確定済に、行の無い学生は空のまま確定済（本人未入力）になる', () => {
  const w = world();
  const b = addStudent(w, { studentId: '251002' });
  ok(w.api('api_saveDraft', w.st.token, YM, { '5': [sh('09:00', '13:00')] }, 0));
  const r = ok(w.api('api_adminCloseMonths', w.admin, YM, [w.st.studentId, b.studentId]));
  assert.deepEqual(r.done.sort(), [w.st.studentId, b.studentId].sort());
  assert.equal(row(w, w.st.studentId).displayStatus, '確定済');
  assert.equal(row(w, b.studentId).displayStatus, '確定済（本人未入力）');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '確定済');
});

test('締める: すでに確定済・学校確定の月は飛ばし、理由を返す', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, { '5': [sh('09:00', '13:00')] }, 0));
  const r = ok(w.api('api_adminCloseMonths', w.admin, YM, [w.st.studentId, 'NOPE']));
  assert.deepEqual(r.done, []);
  assert.deepEqual(r.skipped.map((x) => x.studentId).sort(), ['NOPE', w.st.studentId].sort());
});

test('再開: 確定済の月が下書きに戻り、締切を過ぎても3日後の 23:59 まで直せる。一覧に再開の期限が出る', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, { '5': [sh('09:00', '13:00')] }, 0));
  w.at('2026-10-05 10:00'); // 締切後
  assert.equal(w.api('api_saveDraft', w.st.token, YM, {}, 1).error, 'DEADLINE_PASSED');
  const r = ok(w.api('api_adminReopenMonths', w.admin, YM, [w.st.studentId]));
  assert.equal(r.until, '2026-10-08 23:59');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '下書き');
  assert.equal(m.closed, false);
  assert.equal(row(w, w.st.studentId).reopenUntil, '2026-10-08 23:59');
  ok(w.api('api_confirm', w.st.token, YM, { '5': [sh('09:00', '14:00')] }, m.version));
  w.at('2026-10-09 00:00');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, {}, m.version + 1).error, 'DEADLINE_PASSED');
});

test('締めると再開の許可も消える', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, { '5': [sh('09:00', '13:00')] }, 0));
  w.at('2026-10-05 10:00');
  ok(w.api('api_adminReopenMonths', w.admin, YM, [w.st.studentId]));
  ok(w.api('api_adminCloseMonths', w.admin, YM, [w.st.studentId]));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '確定済');
  assert.equal(m.closed, true);
  assert.equal(row(w, w.st.studentId).reopenUntil, null);
});

test('一覧に今月と先月の予定の合計が出る（入力途中で確定していないかの目安）', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: '2026-11', className: 'A', deadlineAt: '2026-10-31 23:59', actualDeadlineAt: null }));
  ok(w.api('api_confirm', w.st.token, YM, everyDay(1, 10, sh('09:00', '12:00')), 0)); // 30時間
  ok(w.api('api_confirm', w.st.token, '2026-11', { '2': [sh('09:00', '12:00')] }, 0)); // 3時間
  const r = row(w, w.st.studentId, '2026-11');
  assert.equal(r.totalMinutes, 180);
  assert.equal(r.prevTotalMinutes, 1800);
  assert.equal(row(w, w.st.studentId, YM).prevTotalMinutes, null); // 9月の行は無い
});

test('形の違う頼みは BAD_REQUEST', () => {
  const w = world();
  assert.equal(w.api('api_adminCloseMonths', w.admin, '2026-13', [w.st.studentId]).error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminReopenMonths', w.admin, YM, []).error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminReopenMonths', w.admin, YM, 'x').error, 'BAD_REQUEST');
});
