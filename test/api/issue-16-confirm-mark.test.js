'use strict';
// #16 確定マーク: サーバが返す状態は保存された内容を表す。確定後に途中保存すれば下書きに戻り、
// 違反の内容で再確定して断られても、保存済みの確定内容と状態は変わらない（画面の札は、表を直し始めたら未確定にする）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, sh, everyDay } = require('../helpers/api');

const YM = '2026-10';

test('確定後に途中保存すると、状態は下書きに戻る', () => {
  const w = world();
  const c = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  assert.equal(c.status, '確定済');
  const d = ok(w.api('api_saveDraft', w.st.token, YM, { '3': [sh('09:00', '13:00')] }, c.version));
  assert.equal(d.status, '下書き');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '下書き');
});

test('確定後に違反の内容で再確定して断られても、保存済みの確定内容は変わらない', () => {
  const w = world();
  const c = ok(w.api('api_confirm', w.st.token, YM, { '3': [sh('09:00', '12:00')] }, 0));
  const r = w.api('api_confirm', w.st.token, YM, everyDay(9, 13, sh('09:00', '18:00')), c.version);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'VALIDATION_FAILED');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '確定済');
  assert.equal(m.version, c.version);
  assert.deepEqual(Object.keys(m.shifts), ['3']);
});
