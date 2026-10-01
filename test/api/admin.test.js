'use strict';
// 管理ボード・マスタ・印刷・保存期限。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, addStudent, standardMasters, sh, everyDay, auditRows } = require('../helpers/api');

const YM = '2026-10';

// 5人の学生: 確定済・下書き（28時間超）・未提出・学校確定（退学）・クラスBの未提出
function classroom() {
  const w = world();
  const s2 = addStudent(w, { studentId: '251002', name: 'スズキ タロウ' });
  const s3 = addStudent(w, { studentId: '251003', name: 'タン グエン' });
  const s4 = addStudent(w, { studentId: '251004', name: 'ラマ ビケシュ', status: '退学', withdrawalDate: '2026-10-15' });
  const s5 = addStudent(w, { studentId: '251005', name: 'グルン サン', className: 'B' });
  ok(w.api('api_confirm', w.st.token, YM, { '1': [sh('09:00', '12:00')] }, 0));
  ok(w.api('api_saveDraft', s2.token, YM, everyDay(9, 13, sh('09:00', '18:00')), 0));
  ok(w.api('api_adminSchoolConfirm', w.admin, s4.studentId, YM));
  return Object.assign(w, { s2, s3, s4, s5 });
}

test('管理ボード: 件数（学生数・確定済・下書き・未提出・エラー・対象外）', () => {
  const w = classroom();
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.deepEqual(b.counts, { students: 5, confirmed: 1, draft: 1, notSubmitted: 2, error: 1, outOfScope: 1 });
});

test('管理ボード: 一覧の表示状態とエラーコード', () => {
  const w = classroom();
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  const row = (id) => b.rows.find((r) => r.studentId === id);
  assert.equal(row('251001').displayStatus, '確定済');
  assert.equal(row('251002').displayStatus, '下書き');
  assert.ok(row('251002').errorCodes.includes('OVER_28H'));
  assert.deepEqual(row('251001').errorCodes, []);
  assert.equal(row('251003').displayStatus, '未提出');
  assert.equal(row('251003').updatedAt, null);
  assert.equal(row('251004').displayStatus, '対象外');
  assert.equal(row('251002').name, 'スズキ タロウ');
  assert.equal(row('251002').className, 'A');
  assert.match(row('251001').updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('管理ボード: クラスで絞ると件数も一覧も変わる', () => {
  const w = classroom();
  const b = ok(w.api('api_adminBoard', w.admin, YM, { className: 'B' }));
  assert.deepEqual(b.counts, { students: 1, confirmed: 0, draft: 0, notSubmitted: 1, error: 0, outOfScope: 0 });
  assert.deepEqual(b.rows.map((r) => r.studentId), ['251005']);
});

test('管理ボード: 状態・検索（学籍番号の前方一致、氏名の部分一致）で一覧を絞る。件数はクラスの絞り込みだけに従う', () => {
  const w = classroom();
  const byStatus = ok(w.api('api_adminBoard', w.admin, YM, { status: '未提出' }));
  assert.deepEqual(byStatus.rows.map((r) => r.studentId).sort(), ['251003', '251005']);
  assert.equal(byStatus.counts.students, 5);
  const byId = ok(w.api('api_adminBoard', w.admin, YM, { query: '25100' }));
  assert.equal(byId.rows.length, 5);
  const byName = ok(w.api('api_adminBoard', w.admin, YM, { query: 'タロウ' }));
  assert.deepEqual(byName.rows.map((r) => r.studentId), ['251002']);
});

test('管理ボード: その月に在籍していない学生（9月に退学・11月入学）は数えない', () => {
  const w = world();
  addStudent(w, { studentId: '251090', status: '退学', withdrawalDate: '2026-09-15' });
  addStudent(w, { studentId: '261001', enrollmentDate: '2026-11-01' });
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.deepEqual(b.rows.map((r) => r.studentId), ['251001']);
});

test('管理ボード: 実績未確認は、実績確認期間が始まってから数える', () => {
  const w = classroom();
  assert.equal(ok(w.api('api_adminBoard', w.admin, YM, {})).actualUnconfirmed, 0);
  w.at('2026-11-02 10:00');
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.equal(b.actualUnconfirmed, 4);
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  const saved = ok(w.api('api_saveActual', w.st.token, YM, m.shifts, m.version));
  ok(w.api('api_confirmActual', w.st.token, YM, saved.version));
  const b2 = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.equal(b2.actualUnconfirmed, 3);
  assert.equal(b2.rows.find((r) => r.studentId === '251001').actualStatus, '予定どおり');
});

test('管理ボード: 実績が法令の上限を超えた学生は actualOver が true', () => {
  const w = classroom();
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.s2.token, YM));
  ok(w.api('api_saveActual', w.s2.token, YM, everyDay(9, 13, sh('09:00', '18:00')), m.version));
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.equal(b.rows.find((r) => r.studentId === '251002').actualOver, true);
  assert.equal(b.rows.find((r) => r.studentId === '251001').actualOver, false);
});

test('管理ボード・学生詳細に勤務先の項目は無い（2026-10-01 勤務先の廃止）', () => {
  const w = classroom();
  const b = ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.equal('workplacesPending' in b, false);
  assert.equal('workplacesOverdue' in b, false);
  for (const r of b.rows) assert.equal('pendingWorkplaces' in r, false);
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  assert.equal('workplaces' in d, false);
  assert.equal(d.student.studentId, '251001');
});

test('学生詳細: 月ごとに、学生が入れた予定と実績の時間・合計・注意をそのまま見られる（2026-10-01 追加）', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '3': [sh('21:00', '06:00')], '4': [sh('09:00', '13:00')] }, 0));
  const d = ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId));
  const m = d.months.find((x) => x.yearMonth === YM);
  assert.deepEqual(m.shifts, { '3': [{ start: '21:00', end: '06:00' }], '4': [{ start: '09:00', end: '13:00' }] });
  assert.equal(m.totalMinutes, 480 + 240);
  assert.equal(m.actual, null);
  assert.equal(m.actualTotalMinutes, null);
  assert.ok(Array.isArray(m.codes));
  assert.equal(d.student.loginId, w.st.loginId);
});

// ---- マスタが評価に反映される ----

test('長期休業を登録すると、学生の評価に反映される（8時間15分で OVER_8H_HOLIDAY）', () => {
  const w = world();
  ok(w.api('api_adminSetHoliday', w.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 }));
  const r = w.api('api_confirm', w.st.token, '2026-12', { '25': [sh('09:00', '18:15')] }, 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'OVER_8H_HOLIDAY'));
  const list = ok(w.api('api_adminListHolidays', w.admin));
  assert.equal(list.length, 1);
  ok(w.api('api_adminDeleteHoliday', w.admin, list[0].holidayId));
  // 長期休業を消すと、その日は普通の日の1日8時間超（OVER_8H）になる（2026-10-01 成人も確定を止める）
  const r2 = w.api('api_confirm', w.st.token, '2026-12', { '25': [sh('09:00', '18:15')] }, 0);
  assert.ok(r2.details.codes.some((c) => c.code === 'OVER_8H'));
  assert.equal(r2.details.codes.some((c) => c.code === 'OVER_8H_HOLIDAY'), false);
});

test('長期休業の開始日が終了日より後なら BAD_REQUEST', () => {
  const w = world();
  assert.equal(w.api('api_adminSetHoliday', w.admin, { name: 'x', startDate: '2027-01-07', endDate: '2026-12-24', schoolYear: 2026 }).error, 'BAD_REQUEST');
});

test('学校設定: 休学の確定可否を切り替えると評価に反映される', () => {
  const w = world();
  const leave = addStudent(w, { studentId: '251080', status: '休学' });
  const r = w.api('api_confirm', leave.token, YM, { '1': [sh('09:00', '12:00')] }, 0);
  assert.ok(r.details.codes.some((c) => c.code === 'NOT_ENROLLED'));
  ok(w.api('api_adminSetSettings', w.admin, { allowLeaveOfAbsence: true }));
  ok(w.api('api_confirm', leave.token, YM, { '1': [sh('09:00', '12:00')] }, 0));
});

test('学校設定の既定値', () => {
  const w = boot();
  const s = ok(w.api('api_adminGetSettings', w.admin));
  assert.equal(s.retentionMonths, 24);
  assert.equal(s.sessionTtlMinutes, 120);
  assert.equal('workplaceSlaDays' in s, false);
  assert.equal(w.api('api_adminSetSettings', w.admin, { workplaceSlaDays: 3 }).error, 'BAD_REQUEST');
  assert.equal(s.allowLeaveOfAbsence, false);
  assert.equal(s.actualConfirmDefaultDay, 10);
  assert.equal(s.timezone, 'Asia/Tokyo');
});

test('学生情報の入力検証: 日付の形式・在籍状態・言語', () => {
  const w = boot();
  const { studentRecord } = require('../helpers/api');
  for (const bad of [
    studentRecord({ birthDate: '2000/04/01' }),
    studentRecord({ status: '在学' }),
    studentRecord({ language: 'zh' }), // 2026-10-01 英語は対応言語になった
    studentRecord({ studentId: '' }),
    studentRecord({ className: '' }),
  ]) {
    assert.equal(w.api('api_adminUpsertStudent', w.admin, bad).error, 'BAD_REQUEST', JSON.stringify(bad));
  }
});

test('管理者の追加: 新しい管理者は初回にパスワード変更を求められる', () => {
  const w = boot();
  const a = ok(w.api('api_adminCreateAdmin', w.admin));
  const login = ok(w.api('api_login', a.loginId, a.initialPassword));
  assert.equal(login.role, 'admin');
  assert.equal(login.mustChangePassword, true);
});

// ---- 印刷 ----

test('印刷: 学生×月の数だけ student-page があり、A4横の指定がある', () => {
  const w = classroom();
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: ['251001', '251002'], yearMonths: ['2026-09', '2026-10'] }));
  assert.equal((r.html.match(/class="student-page"/g) || []).length, 4);
  assert.match(r.html, /@page\s*\{\s*size:\s*A4 landscape;?\s*\}/);
});

test('印刷: 学校確定の月は「対象外」と表示される', () => {
  const w = classroom();
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: ['251004'], yearMonths: ['2026-10'] }));
  assert.ok(r.html.includes('対象外'));
});

test('印刷: 1回は50名まで、24か月まで。超えると BAD_REQUEST', () => {
  const w = world();
  const ids = Array.from({ length: 51 }, (_, i) => String(260000 + i));
  assert.equal(w.api('api_adminPrintHtml', w.admin, { studentIds: ids, yearMonths: ['2026-10'] }).error, 'BAD_REQUEST');
  const months = Array.from({ length: 25 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  assert.equal(w.api('api_adminPrintHtml', w.admin, { studentIds: ['251001'], yearMonths: months }).error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminPrintHtml', w.admin, { studentIds: [], yearMonths: ['2026-10'] }).error, 'BAD_REQUEST');
});

test('印刷: 学生の名前などに含まれる < > & はエスケープされる', () => {
  const w = world();
  ok(w.api('api_adminUpsertStudent', w.admin, { ...require('../helpers/api').studentRecord(), name: '<script>alert(1)</script>' }));
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: ['251001'], yearMonths: ['2026-10'] }));
  assert.equal(r.html.includes('<script>alert(1)</script>'), false);
  assert.ok(r.html.includes('&lt;script&gt;'));
});

test('印刷: & と " もエスケープされる', () => {
  const w = world();
  ok(w.api('api_adminUpsertStudent', w.admin, { ...require('../helpers/api').studentRecord(), name: 'A&B "Q"' }));
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: ['251001'], yearMonths: ['2026-10'] }));
  assert.equal(r.html.includes('A&B'), false);
  assert.equal(r.html.includes('"Q"'), false);
  assert.ok(r.html.includes('A&amp;B'));
});

// ---- 保存期限 ----

test('保存期限超過データの削除: 24か月より前の月だけを消し、件数を返して監査ログに残す', () => {
  const w = boot({ now: '2024-08-01 10:00' });
  standardMasters(w);
  for (const [ym, at] of [['2024-09', '2024-08-31 23:59'], ['2024-10', '2024-09-30 23:59']]) {
    ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: ym, className: 'A', deadlineAt: at, actualDeadlineAt: null }));
  }
  const st = addStudent(w);
  ok(w.api('api_saveDraft', st.token, '2024-09', {}, 0));
  ok(w.api('api_saveDraft', st.token, '2024-10', {}, 0));
  w.at('2026-10-05 10:00');
  const r = ok(w.api('api_adminPurgeExpired', w.admin));
  assert.equal(r.deletedRows, 1);
  const h = ok(w.api('api_getHistory', st.token));
  assert.deepEqual(h.map((x) => x.yearMonth), ['2024-10']);
  assert.ok(auditRows(w).some((x) => x.action === 'PURGE'));
});
