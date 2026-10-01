'use strict';
// 日本の祝日（表示用。法令の判定には使わない）。期待値は内閣府の「国民の祝日」一覧から手で写した値。
// https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');

const holidays = (y) => load().call('util_jpHolidays_', y);

test('2026年の祝日（振替休日・国民の休日を含む）', () => {
  assert.deepEqual(holidays(2026), {
    '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日', '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日', '2026-04-29': '昭和の日', '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日', '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
    '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日', '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
  });
});

test('2027年: 春分の日が日曜なので翌日が振替休日', () => {
  const h = holidays(2027);
  assert.equal(h['2027-03-21'], '春分の日');
  assert.equal(h['2027-03-22'], '振替休日');
  assert.equal(h['2027-09-23'], '秋分の日');
  assert.equal(Object.keys(h).length, 17);
});

test('生徒の月データに、その月の祝日が入る', () => {
  const { world, ok } = require('../helpers/api');
  const w = world();
  const m = ok(w.api('api_getMonth', w.st.token, '2026-09'));
  assert.deepEqual(m.publicHolidays, { '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日' });
});

test('印刷と学生詳細にも祝日が出る', () => {
  const { world, ok, sh } = require('../helpers/api');
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '12': [sh('09:00', '13:00')] }, 0));
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: ['2026-10'] }));
  assert.ok(r.html.includes('スポーツの日'));
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  assert.deepEqual(d.months.find((m) => m.yearMonth === '2026-10').publicHolidays, { '2026-10-12': 'スポーツの日' });
});
