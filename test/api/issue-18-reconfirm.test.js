'use strict';
// #18 確定ボタンのみ: 締切までは何度でも直して再確定でき、再確定のたびに最新の内容で確定済になる。
// 違反のある内容は確定済にならず（保存もされず）、締切後は直せない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, sh, everyDay } = require('../helpers/api');

const YM = '2026-10';

test('締切までは何度でも再確定でき、そのたびに最新の内容で確定済になる', () => {
  const w = world();
  const a = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  const b = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '13:00')], '4': [sh('10:00', '12:00')] }, a.version));
  assert.equal(b.status, '確定済');
  assert.equal(b.version, a.version + 1);
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '確定済');
  assert.deepEqual(m.shifts['3'], [sh('09:00', '13:00')]);
  assert.deepEqual(m.shifts['4'], [sh('10:00', '12:00')]);
});

test('違反のある内容では再確定できず、保存済みの確定内容は変わらない', () => {
  const w = world();
  const a = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  const r = w.api('api_confirm', w.st.token, YM, everyDay(9, 13, sh('09:00', '18:00')), a.version);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.deepEqual(ok(w.api('api_getMonth', w.st.token, YM)).shifts, { '3': [sh('09:00', '12:00')] });
});

test('締切後は再確定できない（最終確定）', () => {
  const w = world();
  const a = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  w.at('2026-10-01 00:05');
  const r = w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '13:00')] }, a.version);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'DEADLINE_PASSED');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '確定済');
});

test('印刷に「下書き」は出ない。既存の下書きは確定済として印刷される', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: [YM] }));
  assert.equal(r.html.includes('下書き'), false);
  assert.equal(r.html.includes('確定済'), true);
});
