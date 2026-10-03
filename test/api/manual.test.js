'use strict';
// マニュアルのシート（2026-10-02 追加）: 管理画面を開くと、データの表（ShiftDB）に「マニュアル」と
// 「困ったとき（ChatGPT用）」のシートができる。2回目以降は書き直さない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok } = require('../helpers/api');

function shiftDb(ctx) { return ctx.env.spreadsheets.get(ctx.env.properties.get('SHIFT_DB_ID')); }
function text(sheet) { return sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map((r) => r[0]).join('\n'); }

test('管理画面を開くと、マニュアルと ChatGPT 用の文章のシートができる', () => {
  const ctx = boot();
  ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', {}));
  const ss = shiftDb(ctx);
  const manual = ss.getSheetByName('マニュアル');
  const prompt = ss.getSheetByName('困ったとき（ChatGPT用）');
  assert.ok(manual && prompt);
  assert.match(text(manual), /学籍番号/);
  assert.match(text(manual), /script\.google\.com\/macros/);
  assert.match(text(prompt), /ChatGPT/);
  assert.match(text(prompt), /何に困っていますか/);
});

test('2回目は書き直さない（版が同じなら触らない）', () => {
  const ctx = boot();
  ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', {}));
  const ss = shiftDb(ctx);
  const before = ss._writes;
  ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', {}));
  assert.equal(ss._writes, before);
});
