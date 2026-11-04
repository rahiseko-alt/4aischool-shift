'use strict';
// 勤務先（月に1つ）と手書き署名（2026-11-04）: 確定には勤務先と署名が要る（設定 requireSignature、既定 true）。
// 署名は PNG の data URL で、確定のときに保存し、下書きに戻すと消す。印刷と学生詳細に出る。

const test = require('node:test');
const assert = require('node:assert/strict');
const { ok, world, sh } = require('../helpers/api');

const YM = '2026-10';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SHIFTS = { '5': [sh('09:00', '13:00')] };

function signed() {
  const w = world();
  ok(w.api('api_adminSetSettings', w.admin, { requireSignature: true }));
  return w;
}
const subRow = (w) => {
  const ss = w.env.spreadsheets.get(w.env.properties.get('SHIFT_DB_ID'));
  const sheet = ss.getSheetByName('MONTHLY_SUBMISSIONS');
  const v = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues().map((r) => r.map((c) => String(c).replace(/^'/, '')));
  const h = v[0];
  const row = v.slice(1).find((r) => r[h.indexOf('student_id')] === w.st.studentId && r[h.indexOf('year_month')] === YM);
  return row ? Object.fromEntries(h.map((k, i) => [k, row[i]])) : null;
};

test('既定では確定に勤務先と署名が要る（設定の既定値 true）', () => {
  const w = world();
  assert.equal(ok(w.api('api_adminGetSettings', w.admin)).requireSignature, false); // 下準備で切っている
  const { load } = require('../helpers/load.js');
  assert.equal(load().get('SETTINGS_DEFAULTS_').requireSignature, true);
});

test('勤務先が空なら NO_WORKPLACE、署名が無い・形が違う・大きすぎるなら NO_SIGNATURE', () => {
  const w = signed();
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0).error, 'NO_WORKPLACE');
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: '   ', signature: SIG }).error, 'NO_WORKPLACE');
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA' }).error, 'NO_SIGNATURE');
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA', signature: 'data:image/jpeg;base64,AAAA' }).error, 'NO_SIGNATURE');
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA', signature: 'data:image/png;base64,' + 'A'.repeat(46000) }).error, 'NO_SIGNATURE');
  assert.equal(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'x'.repeat(201), signature: SIG }).error, 'BAD_REQUEST');
  assert.equal(subRow(w), null); // 何も保存されない
});

test('勤務先と署名があれば確定済になり、勤務先・署名・署名の時刻が保存される。getMonth は署名ありと勤務先を返す', () => {
  const w = signed();
  const r = ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: ' コンビニA\r\n居酒屋B ', signature: SIG }));
  assert.equal(r.status, '確定済');
  const row = subRow(w);
  assert.equal(row.workplace, 'コンビニA\n居酒屋B');
  assert.equal(row.signature_png, SIG);
  assert.ok(row.signed_at);
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.workplace, 'コンビニA\n居酒屋B');
  assert.equal(m.hasSignature, true);
  assert.equal(m.requireSignature, true);
  assert.equal(m.signature, undefined); // 画像は学生画面に返さない
});

test('確定後に途中保存すると、署名が消えて下書きになる（勤務先は送れば書き換わる）', () => {
  const w = signed();
  ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA', signature: SIG }));
  ok(w.api('api_saveDraft', w.st.token, YM, SHIFTS, 1, { workplace: 'コンビニC' }));
  const row = subRow(w);
  assert.equal(row.status, '下書き');
  assert.equal(row.signature_png, '');
  assert.equal(row.workplace, 'コンビニC');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).hasSignature, false);
});

test('次の月を開くと、前の月の勤務先が下書きとして返る', () => {
  const w = signed();
  ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA', signature: SIG }));
  const m = ok(w.api('api_getMonth', w.st.token, '2026-11'));
  assert.equal(m.workplace, '');
  assert.equal(m.workplaceSuggest, 'コンビニA');
});

test('印刷に勤務先と署名の画像が出る。署名が無ければ線だけ', () => {
  const w = signed();
  ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA\n居酒屋B', signature: SIG }));
  const html = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: [YM, '2026-11'] }));
  const text = typeof html === 'string' ? html : html.html;
  assert.ok(text.includes('コンビニA ／ 居酒屋B'));
  assert.ok(text.includes('<img class="sign-img" alt="署名" src="' + SIG + '">'));
  assert.equal(text.split('class="sign-img"').length - 1, 1); // 11月は署名なし
});

test('学生詳細に勤務先と署名が出る', () => {
  const w = signed();
  ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0, { workplace: 'コンビニA', signature: SIG }));
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  const m = d.months.find((x) => x.yearMonth === YM);
  assert.equal(m.workplace, 'コンビニA');
  assert.equal(m.signature, SIG);
  assert.ok(m.signedAt);
});

test('requireSignature を切った学校では、勤務先・署名なしでも確定できる', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, SHIFTS, 0));
});
