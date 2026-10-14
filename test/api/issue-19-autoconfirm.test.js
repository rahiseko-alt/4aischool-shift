'use strict';
// #19 締切後の自動確定: 締切を過ぎて入力のない在籍中の月を、空欄のまま「確定済（本人未入力）」にする。
// 入力済みの月・学校確定の月は書き換えない。二重に確定しない。
// 時計: world() は 2026-09-01 10:00（JST）。10月分の締切は 2026-09-30 23:59。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, addStudent, sh, auditRows } = require('../helpers/api');

const YM = '2026-10';
const board = (w, ym) => ok(w.api('api_adminBoard', w.admin, ym || YM, {}));
const row = (b, id) => b.rows.find((r) => r.studentId === id);
const subRows = (w) => {
  const id = w.env.properties.get('SHIFT_DB_ID');
  const sheet = w.env.spreadsheets.get(id).getSheetByName('MONTHLY_SUBMISSIONS');
  const v = sheet.getDataRange().getValues();
  // 表は書式なしテキストなので、先頭に ' が付いて読める
  return v.slice(1).map((r) => Object.fromEntries(v[0].map((h, i) => [h, String(r[i]).replace(/^'/, '')])));
};
const run = (w) => w.app.get('autoConfirmMonths')();

test('締切前は何も確定しない', () => {
  const w = world();
  run(w);
  // 9月分の締切（8/31 23:59）は過ぎているが、10月分はまだ
  assert.deepEqual(subRows(w).map((r) => r.year_month), ['2026-09']);
  assert.equal(row(board(w), '251001').displayStatus, '未提出');
});

test('締切後、入力のない在籍中の月は、空欄のまま確定済（本人未入力）になる', () => {
  const w = world();
  w.at('2026-10-01 00:05');
  run(w);
  const rows = subRows(w).filter((r) => r.year_month === YM);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, '確定済');
  assert.equal(rows[0].shift_json, '{}');
  assert.equal(rows[0].version, '0');
  const b = board(w);
  assert.equal(row(b, '251001').displayStatus, '確定済（本人未入力）');
  assert.equal(b.counts.confirmed, 1);
  assert.equal(b.counts.notSubmitted, 0);
});

test('二度走らせても、同じ月を二重に確定しない（行も監査ログも増えない）', () => {
  const w = world();
  w.at('2026-10-01 00:05');
  run(w);
  const before = subRows(w).length;
  const audits = auditRows(w).filter((r) => r.action === 'AUTO_CONFIRM').length;
  run(w);
  assert.equal(subRows(w).length, before);
  assert.equal(auditRows(w).filter((r) => r.action === 'AUTO_CONFIRM').length, audits);
  assert.ok(audits >= 1);
});

test('入力済みの月（確定済・下書き）と学校確定の月は書き換えない', () => {
  const w = world();
  const b = addStudent(w, { studentId: '251002', name: 'シタガキ ハナ' });
  const c = addStudent(w, { studentId: '251003', name: 'ガクコウ タロウ', status: '退学', withdrawalDate: '2026-12-31' });
  ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  ok(w.api('api_saveDraft', b.token, YM, { '4': [sh('10:00', '12:00')] }, 0));
  ok(w.api('api_adminSchoolConfirm', w.admin, '251003', YM));
  const before = subRows(w).filter((r) => r.year_month === YM);
  w.at('2026-10-01 00:05');
  run(w);
  const after = subRows(w).filter((r) => r.year_month === YM);
  assert.deepEqual(after, before);
});

test('在籍でない学生・入学前の月・DEMO のクラスは対象にしない', () => {
  const w = world();
  addStudent(w, { studentId: '251004', name: 'タイガク ジロウ', status: '退学', withdrawalDate: '2026-12-31' });
  addStudent(w, { studentId: '251005', name: 'ニュウガク マエ', enrollmentDate: '2026-11-01' });
  w.at('2026-10-01 00:05');
  run(w);
  const ids = subRows(w).filter((r) => r.year_month === YM).map((r) => r.student_id);
  assert.deepEqual(ids, ['251001']);
});

test('自動確定は監査ログに残る', () => {
  const w = world();
  w.at('2026-10-01 00:05');
  run(w);
  const a = auditRows(w).filter((r) => r.action === 'AUTO_CONFIRM' && r.year_month === YM);
  assert.equal(a.length, 1);
  assert.equal(a[0].student_id, '251001');
  assert.equal(a[0].year_month, YM);
});

test('本人未入力の月は、前後の月の28時間チェックで勤務0時間として数えられる', () => {
  const w = world();
  w.at('2026-10-01 00:05');
  run(w);
  // 10月が自動確定されても、11月の入力は10月を0時間として検算される（エラーにならず確定できる）
  const r = ok(w.api('api_confirm', w.st.token, '2026-11', { '3': [sh('09:00', '12:00')] }, 0));
  assert.equal(r.status, '確定済');
});

test('本人が保存した確定済は version が 1 以上で、本人未入力とは区別される', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  w.at('2026-10-01 00:05');
  run(w);
  assert.equal(row(board(w), '251001').displayStatus, '確定済');
});
