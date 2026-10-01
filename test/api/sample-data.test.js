'use strict';
// 試用の見本データ（2026-10-01 追加）: 生徒モードを押すと、DEMO クラスに架空の学生10人と3か月分（前月・今月・翌月）の
// 予定・実績、長期休業が入る。管理画面の見た目を試すためのもの。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok } = require('../helpers/api');

const SAMPLE = ['DEMO-01', 'DEMO-02', 'DEMO-03', 'DEMO-04', 'DEMO-05', 'DEMO-06', 'DEMO-07', 'DEMO-08', 'DEMO-09', 'DEMO-10'];

function seeded() {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const r = ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  return { ctx, r };
}

test('見本データ: 生徒モードを押すと10人が DEMO クラスに入る。ログイン情報の表示は生徒Aだけ', () => {
  const { ctx, r } = seeded();
  assert.deepEqual(r.newStudents.map((s) => s.studentId), ['DEMO-A']);
  const board = ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { className: 'DEMO' }));
  for (const id of SAMPLE) assert.ok(board.rows.some((x) => x.studentId === id), id);
});

test('見本データ: 3か月分の状態が混ざっている（前月は実績まで、今月は確定・下書き・未提出、翌月はエラーあり）', () => {
  const { ctx } = seeded();
  const rows = (ym) => ok(ctx.api('api_adminBoard', ctx.admin, ym, { className: 'DEMO' })).rows.filter((x) => SAMPLE.includes(x.studentId));
  const prev = rows('2026-09');
  assert.ok(prev.filter((x) => x.displayStatus === '確定済').length >= 8);
  assert.ok(prev.some((x) => x.actualStatus === '予定どおり'));
  assert.ok(prev.some((x) => x.actualStatus === '修正あり'));
  const cur = rows('2026-10').map((x) => x.displayStatus);
  for (const s of ['確定済', '下書き', '未提出']) assert.ok(cur.includes(s), '今月に ' + s + ' が無い');
  const next = rows('2026-11');
  assert.ok(next.some((x) => x.displayStatus === '未提出'));
  assert.ok(next.some((x) => (x.errorCodes || []).includes('OVER_28H')), '翌月に28時間超の下書きが無い');
});

test('見本データ: 確定済の月には確定を止める注意が無い（本物の確定と同じ検算を通している）', () => {
  const { ctx } = seeded();
  for (const ym of ['2026-09', '2026-10', '2026-11']) {
    for (const row of ok(ctx.api('api_adminBoard', ctx.admin, ym, { className: 'DEMO' })).rows) {
      if (row.displayStatus === '確定済') assert.deepEqual(row.errorCodes || [], [], ym + ' ' + row.studentId);
    }
  }
});

test('見本データ: 長期休業（秋季・冬季）が入り、生徒の入力内容を学生詳細で見られる', () => {
  const { ctx } = seeded();
  const names = ok(ctx.api('api_adminListHolidays', ctx.admin)).map((h) => h.name);
  assert.ok(names.includes('秋季休業'));
  assert.ok(names.includes('冬季休業'));
  const d = ok(ctx.api('api_adminStudentDetail', ctx.admin, 'DEMO-01'));
  const sep = d.months.find((m) => m.yearMonth === '2026-09');
  assert.ok(Object.keys(sep.shifts).length > 0);
  assert.ok(sep.actual);
});

test('見本データ: 2回押しても増えない', () => {
  const { ctx } = seeded();
  const count = () => ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { className: 'DEMO' })).rows.length;
  const n = count();
  ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  assert.equal(count(), n);
  assert.equal(ok(ctx.api('api_adminListHolidays', ctx.admin)).length, 2);
});
