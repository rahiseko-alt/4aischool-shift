'use strict';
// 実績確認。10月分の実績確認期間は 2026-11-01 00:00 〜 2026-11-10 23:59（既定の10日）。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, sh, everyDay, auditRows } = require('../helpers/api');

const YM = '2026-10';

function planConfirmed(w, shifts) {
  ok(w.api('api_confirm', w.st.token, YM, shifts, 0));
}

test('対象月が終わる前（10/31 23:59）は実績を保存できない（NOT_OPEN）', () => {
  const w = world();
  planConfirmed(w, { '1': [sh('09:00', '12:00')] });
  w.at('2026-10-31 23:59');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.actual.open, false);
  assert.equal(w.api('api_saveActual', w.st.token, YM, {}, m.version).error, 'NOT_OPEN');
});

test('11/1 00:00 から実績を保存でき、状態は未確認のまま。実績確認期限は 2026-11-10 23:59', () => {
  const w = world();
  planConfirmed(w, { '1': [sh('09:00', '12:00')] });
  w.at('2026-11-01 00:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.actual.open, true);
  assert.equal(m.actual.deadlineAt, '2026-11-10 23:59');
  assert.equal(m.actual.status, '未確認');
  const r = ok(w.api('api_saveActual', w.st.token, YM, { '1': [sh('09:00', '12:00')] }, m.version));
  assert.equal(r.actualStatus, '未確認');
  assert.equal(r.version, m.version + 1);
});

test('予定と同じ内容で実績を確認すると「予定どおり」', () => {
  const w = world();
  const plan = { '1': [sh('09:00', '12:00')], '2': [sh('18:00', '22:00')] };
  planConfirmed(w, plan);
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, plan, m.version));
  const c = ok(w.api('api_confirmActual', w.st.token, YM, saved.version));
  assert.equal(c.actualStatus, '予定どおり');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).actual.status, '予定どおり');
});

test('予定と違う内容なら「修正あり」', () => {
  const w = world();
  planConfirmed(w, { '1': [sh('09:00', '12:00')] });
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, { '1': [sh('09:00', '13:00')] }, m.version));
  assert.equal(ok(w.api('api_confirmActual', w.st.token, YM, saved.version)).actualStatus, '修正あり');
});

test('実績を一度も保存していなければ確認できない（BAD_REQUEST）', () => {
  const w = world();
  planConfirmed(w, {});
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(w.api('api_confirmActual', w.st.token, YM, m.version).error, 'BAD_REQUEST');
});

test('予定を出していなかった月でも実績は入力・確認できる（修正あり）', () => {
  const w = world();
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, m.version));
  assert.equal(ok(w.api('api_confirmActual', w.st.token, YM, saved.version)).actualStatus, '修正あり');
});

test('実績は28時間を超えていても保存・確認でき、評価に ACTUAL_OVER が付く', () => {
  const w = world();
  planConfirmed(w, {});
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, everyDay(9, 13, sh('09:00', '18:00')), m.version));
  assert.ok(saved.evaluation.codes.some((c) => c.code === 'ACTUAL_OVER'));
  assert.equal(saved.evaluation.codes.some((c) => c.severity === 'block'), false);
  ok(w.api('api_confirmActual', w.st.token, YM, saved.version));
});

test('実績でも入力エラー（16時間超）は保存しない（VALIDATION_FAILED）', () => {
  const w = world();
  planConfirmed(w, {});
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const r = w.api('api_saveActual', w.st.token, YM, { '1': [sh('06:00', '22:15')] }, m.version);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.inputErrors.some((e) => e.code === 'SHIFT_TOO_LONG'));
});

test('実績確認期限（11/10 23:59）を過ぎると DEADLINE_PASSED', () => {
  const w = world();
  planConfirmed(w, {});
  w.at('2026-11-11 00:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.actual.open, false);
  assert.equal(w.api('api_saveActual', w.st.token, YM, {}, m.version).error, 'DEADLINE_PASSED');
});

test('実績確認期限は締切の表で変えられる（actualDeadlineAt）', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30 23:59', actualDeadlineAt: '2026-11-15 23:59' }));
  planConfirmed(w, {});
  w.at('2026-11-14 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.actual.deadlineAt, '2026-11-15 23:59');
  ok(w.api('api_saveActual', w.st.token, YM, {}, m.version));
});

test('実績確認の既定日は学校設定（actualConfirmDefaultDay）で変えられる', () => {
  const w = world();
  ok(w.api('api_adminSetSettings', w.admin, { actualConfirmDefaultDay: 5 }));
  planConfirmed(w, {});
  w.at('2026-11-06 00:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.actual.deadlineAt, '2026-11-05 23:59');
  assert.equal(w.api('api_saveActual', w.st.token, YM, {}, m.version).error, 'DEADLINE_PASSED');
});

test('実績の保存・確認は監査ログに ACTUAL_SAVE・ACTUAL_CONFIRM として残る', () => {
  const w = world();
  planConfirmed(w, {});
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, {}, m.version));
  ok(w.api('api_confirmActual', w.st.token, YM, saved.version));
  const actions = auditRows(w).map((r) => r.action);
  assert.ok(actions.includes('ACTUAL_SAVE'));
  assert.ok(actions.includes('ACTUAL_CONFIRM'));
});

test('実績を保存しても、予定の状態（確定済）とシフトは変わらない', () => {
  const w = world();
  const plan = { '1': [sh('09:00', '12:00')] };
  planConfirmed(w, plan);
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  ok(w.api('api_saveActual', w.st.token, YM, { '1': [sh('10:00', '12:00')] }, m.version));
  const after = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(after.status, '確定済');
  assert.deepEqual(after.shifts, plan);
  assert.deepEqual(after.actual.shifts, { '1': [sh('10:00', '12:00')] });
});
