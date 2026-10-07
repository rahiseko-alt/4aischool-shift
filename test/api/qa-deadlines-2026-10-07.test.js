'use strict';
// 点検（2026-10-07）: 入力期限・締切後の修正許可・学生詳細の操作・印刷。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, addStudent, sh, everyDay } = require('../helpers/api');

const YM = '2026-10';

// ---- 1. 締切の行が無い月は「受付していない」と返す ----

test('1: 締切の行が無い月は notOpen・closed で返り、実績も開かない（保存は NOT_OPEN と一致）', () => {
  const w = world();
  const m = ok(w.api('api_getMonth', w.st.token, '2027-01'));
  assert.equal(m.notOpen, true);
  assert.equal(m.closed, true);
  assert.equal(m.deadlineAt, null);
  assert.equal(w.api('api_saveDraft', w.st.token, '2027-01', {}, 0).error, 'NOT_OPEN');
  // 翌月になっても、締切の行が無ければ実績も開かない（api_saveActual も NOT_OPEN）
  w.at('2027-02-02 10:00');
  const m2 = ok(w.api('api_getMonth', w.st.token, '2027-01'));
  assert.equal(m2.actual.open, false);
  assert.equal(w.api('api_saveActual', w.st.token, '2027-01', {}, 0).error, 'NOT_OPEN');
});

test('1: 締切の行がある月は notOpen が false', () => {
  const w = world();
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.notOpen, false);
  assert.equal(m.closed, false);
});

test('1: 学校確定の月は実績も開かない（api_saveActual の FORBIDDEN と一致）', () => {
  const w = world();
  const gone = addStudent(w, { studentId: '251099', status: '退学', withdrawalDate: '2026-09-15' });
  ok(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, YM));
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', gone.token, YM));
  assert.equal(m.actual.open, false);
  assert.equal(w.api('api_saveActual', gone.token, YM, {}, m.version).error, 'FORBIDDEN');
});

// ---- 2. 修正許可の期限 ----

test('2: 修正許可の期限が今以前なら BAD_REQUEST（reason: UNTIL_NOT_FUTURE）', () => {
  const w = world(); // 2026-09-01 10:00
  const past = w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-09-01 09:59');
  assert.deepEqual([past.error, past.details && past.details.reason], ['BAD_REQUEST', 'UNTIL_NOT_FUTURE']);
  const same = w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-09-01 10:00');
  assert.deepEqual([same.error, same.details && same.details.reason], ['BAD_REQUEST', 'UNTIL_NOT_FUTURE']);
  const bad = w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '10/2');
  assert.deepEqual([bad.error, bad.details && bad.details.reason], ['BAD_REQUEST', 'UNTIL_FORMAT']);
});

test('2: 修正許可の期限は日付だけでもよい（その日の 23:59 まで）', () => {
  const w = world();
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02'));
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).unlockUntil, '2026-10-02 23:59');
});

test('2: 学生詳細は、期限の過ぎた修正許可に unlockExpired: true を付ける', () => {
  const w = world();
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02 18:00'));
  const month = () => ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId)).months.find((m) => m.yearMonth === YM);
  assert.equal(month().unlockExpired, false);
  w.at('2026-10-02 18:01');
  assert.equal(month().unlockExpired, true);
  assert.equal(month().unlockUntil, '2026-10-02 18:00');
});

// ---- 3. 学生の画面に、いま有効な修正許可を出す ----

test('3: 締切後に有効な修正許可があれば unlockActive: true、期限を過ぎれば false', () => {
  const w = world();
  w.at('2026-10-01 09:00');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).unlockActive, false);
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02 18:00'));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.deepEqual([m.unlockActive, m.closed], [true, false]);
  w.at('2026-10-02 18:01');
  const m2 = ok(w.api('api_getMonth', w.st.token, YM));
  assert.deepEqual([m2.unlockActive, m2.closed], [false, true]);
});

test('3: 締切前の修正許可は unlockActive にしない（締切の表示のまま）', () => {
  const w = world();
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02 18:00'));
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).unlockActive, false);
});

// ---- 4. 予定の期限を保存し直しても、実績確認の期限を消さない ----

test('4: 予定の期限だけを保存し直しても、登録済みの実績確認の期限は残る。空文字を送れば既定に戻る', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30 23:59', actualDeadlineAt: '2026-11-15 23:59' }));
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-29', actualDeadlineAt: null }));
  let m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.deadlineAt, '2026-09-29 23:59');
  assert.equal(m.actual.deadlineAt, '2026-11-15 23:59');
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-29' }));
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).actual.deadlineAt, '2026-11-15 23:59');
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-29', actualDeadlineAt: '' }));
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).actual.deadlineAt, '2026-11-10 23:59');
});

test('4: 実績確認の期限は対象月の末日より後、かつ予定の期限より後でなければ BAD_REQUEST（理由つき）', () => {
  const w = world();
  const r1 = w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30', actualDeadlineAt: '2026-10-31' });
  assert.deepEqual([r1.error, r1.details && r1.details.reason], ['BAD_REQUEST', 'ACTUAL_BEFORE_MONTH_END']);
  const r2 = w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-11-05', actualDeadlineAt: '2026-11-03' });
  assert.deepEqual([r2.error, r2.details && r2.details.reason], ['BAD_REQUEST', 'ACTUAL_BEFORE_PLAN']);
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30', actualDeadlineAt: '2026-11-01' }));
});

// ---- 5. 登録の無いクラスの締切 ----

test('5: クラスが登録されている学校では、登録の無いクラス名の締切は BAD_REQUEST（reason: UNKNOWN_CLASS）', () => {
  const w = world(); // 学生のクラス A がある
  const r = w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'Aa', deadlineAt: '2026-09-30', actualDeadlineAt: null });
  assert.deepEqual([r.error, r.details && r.details.reason], ['BAD_REQUEST', 'UNKNOWN_CLASS']);
  ok(w.api('api_adminAddClass', w.admin, '国際ビジネス科'));
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: '国際ビジネス科', deadlineAt: '2026-09-30', actualDeadlineAt: null }));
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30', actualDeadlineAt: null }));
});

// ---- 6. 登録済みの締切の一覧 ----

test('6: api_adminListDeadlines は登録済みの締切を新しい月から返す', () => {
  const w = world();
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30', actualDeadlineAt: '2026-11-15' }));
  const list = ok(w.api('api_adminListDeadlines', w.admin));
  assert.deepEqual(list.map((d) => d.yearMonth), ['2026-12', '2026-11', '2026-10', '2026-09']);
  assert.deepEqual(list[2], { yearMonth: YM, className: 'A', deadlineAt: '2026-09-30 23:59', actualDeadlineAt: '2026-11-15 23:59' });
  assert.equal(list[0].actualDeadlineAt, null);
});

test('6: api_adminListDeadlines は管理者だけ（学生は FORBIDDEN、トークン無しは AUTH_REQUIRED）', () => {
  const w = world();
  assert.equal(w.api('api_adminListDeadlines', w.st.token).error, 'FORBIDDEN');
  assert.equal(w.api('api_adminListDeadlines', '').error, 'AUTH_REQUIRED');
});

// ---- 7・8. 学校確定の確かめと理由 ----

test('7: 学校確定は年月の形を確かめ、入学より前の月には使えない', () => {
  const w = world();
  const gone = addStudent(w, { studentId: '251099', status: '退学', enrollmentDate: '2026-04-01', withdrawalDate: '2026-09-15' });
  assert.equal(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, '2026-13').error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, 'x').error, 'BAD_REQUEST');
  const r = w.api('api_adminSchoolConfirm', w.admin, gone.studentId, '2026-03');
  assert.deepEqual([r.error, r.details && r.details.reason], ['FORBIDDEN', 'BEFORE_ENROLLMENT']);
  ok(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, '2026-04'));
});

test('8: 学校確定を断るときは理由（在籍中・入力済み）を details.reason で返す', () => {
  const w = world();
  const r1 = w.api('api_adminSchoolConfirm', w.admin, w.st.studentId, YM);
  assert.deepEqual([r1.error, r1.details && r1.details.reason], ['FORBIDDEN', 'STUDENT_ENROLLED']);
  const leave = addStudent(w, { studentId: '251098', status: '休学' });
  ok(w.api('api_saveDraft', leave.token, YM, { '1': [sh('09:00', '10:00')] }, 0));
  const r2 = w.api('api_adminSchoolConfirm', w.admin, leave.studentId, YM);
  assert.deepEqual([r2.error, r2.details && r2.details.reason], ['FORBIDDEN', 'ALREADY_ENTERED']);
  const r3 = w.api('api_adminSchoolConfirm', w.admin, leave.studentId, '2026-11');
  ok(r3);
  const r4 = w.api('api_adminSchoolConfirm', w.admin, leave.studentId, '2026-11');
  assert.deepEqual([r4.error, r4.details && r4.details.reason], ['FORBIDDEN', 'ALREADY_SCHOOL_CONFIRMED']);
  const r5 = w.api('api_adminUndoSchoolConfirm', w.admin, leave.studentId, YM);
  assert.deepEqual([r5.error, r5.details && r5.details.reason], ['FORBIDDEN', 'NOT_SCHOOL_CONFIRMED']);
  assert.equal(w.api('api_adminUndoSchoolConfirm', w.admin, leave.studentId, '2026-13').error, 'BAD_REQUEST');
});

// ---- 10. 印刷: 予定の多い月でも、すべての日・合計・署名が1枚に収まる ----

test('10: 印刷のページは高さを固定して切り捨てない（overflow: hidden を使わない）', () => {
  const w = world();
  const r = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: [YM] }));
  assert.doesNotMatch(r.html, /overflow:\s*hidden/);
  assert.doesNotMatch(r.html, /\.student-page\s*\{[^}]*\bheight:\s*275mm/);
});

test('10: 1日に何件もある月は、文字と行の高さを小さくして1枚に収める', () => {
  const w = world();
  const many = {};
  for (let d = 1; d <= 16; d++) many[String(d)] = [sh('06:00', '08:00'), sh('12:00', '13:00'), sh('18:00', '19:00')];
  // 1日3件（各1〜2時間）でも、7日間の合計は28時間以内
  ok(w.api('api_saveDraft', w.st.token, YM, many, 0));
  const dense = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: [YM] })).html;
  const light = ok(w.api('api_adminPrintHtml', w.admin, { studentIds: [w.st.studentId], yearMonths: ['2026-11'] })).html;
  const fs = (html) => Number(/class="student-page" style="--fs:\s*([\d.]+)px/.exec(html)[1]);
  assert.ok(fs(dense) < fs(light), fs(dense) + ' < ' + fs(light));
  // すべての日・合計・署名が出ている
  for (const d of ['16(金)', '31(土)']) assert.ok(dense.includes(d), d);
  assert.ok(dense.includes('勤務予定時間合計') && dense.includes('署名'));
});
