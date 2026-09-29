'use strict';
// 予定シフトの保存・確定・締切・修正許可・上書き防止・学校確定。
// 実装役はこのファイルを変更してはならない。
// 時計: world() は 2026-09-01 10:00（JST）で始まる。10月分の締切は 2026-09-30 23:59。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, addStudent, addWorkplace, standardMasters, sh, everyDay, auditRows } = require('../helpers/api');

const YM = '2026-10';

test('一度も保存していない月は 未入力・version 0・シフト空', () => {
  const w = world();
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.yearMonth, YM);
  assert.equal(m.status, '未入力');
  assert.equal(m.version, 0);
  assert.deepEqual(m.shifts, {});
  assert.equal(m.closed, false);
  assert.equal(m.deadlineAt, '2026-09-30 23:59');
});

test('下書き保存: 28時間を超えていても保存でき、状態は下書き、version が1増える', () => {
  const w = world();
  const shifts = everyDay(9, 13, sh(w.wp, '09:00', '18:00'));
  const r = ok(w.api('api_saveDraft', w.st.token, YM, shifts, 0));
  assert.equal(r.status, '下書き');
  assert.equal(r.version, 1);
  assert.ok(r.evaluation.codes.some((c) => c.code === 'OVER_28H'));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '下書き');
  assert.equal(m.version, 1);
  assert.deepEqual(m.shifts['9'], [sh(w.wp, '09:00', '18:00')]);
});

test('保存するのは勤務先・開始・終了だけ。休憩・実働などは読み出し時に計算して evaluation に入る', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '24': [sh(w.wp, '09:00', '18:00')] }, 0));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.deepEqual(Object.keys(m.shifts['24'][0]).sort(), ['end', 'start', 'workplace']);
  const x = m.evaluation.shifts['24'][0];
  assert.equal(x.breakMinutes, 60);
  assert.equal(x.workMinutes, 480);
  assert.equal(x.salaryYen, 9600);
});

test('入力エラー（重なり）があれば下書きでも保存しない: VALIDATION_FAILED、details.inputErrors', () => {
  const w = world();
  const r = w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00'), sh(w.wp, '11:00', '13:00')] }, 0);
  assert.deepEqual([r.ok, r.error], [false, 'VALIDATION_FAILED']);
  assert.ok(r.details.inputErrors.some((e) => e.code === 'SHIFT_OVERLAP'));
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '未入力');
});

test('シフトの形が壊れている（月に無い日・配列でない）と BAD_REQUEST', () => {
  const w = world();
  assert.equal(w.api('api_saveDraft', w.st.token, YM, { '32': [sh(w.wp, '09:00', '12:00')] }, 0).error, 'BAD_REQUEST');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, { '0': [sh(w.wp, '09:00', '12:00')] }, 0).error, 'BAD_REQUEST');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, { '1': sh(w.wp, '09:00', '12:00') }, 0).error, 'BAD_REQUEST');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, 'x', 0).error, 'BAD_REQUEST');
});

test('確定: 違反が無ければ 確定済 になる', () => {
  const w = world();
  const r = ok(w.api('api_confirm', w.st.token, YM, everyDay(5, 11, sh(w.wp, '09:00', '13:00')), 0));
  assert.equal(r.status, '確定済');
  assert.equal(r.version, 1);
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '確定済');
});

test('確定: 28時間を超えていれば VALIDATION_FAILED（details.codes に OVER_28H）で、何も保存しない', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  const r = w.api('api_confirm', w.st.token, YM, everyDay(9, 13, sh(w.wp, '09:00', '18:00')), 1);
  assert.deepEqual([r.ok, r.error], [false, 'VALIDATION_FAILED']);
  assert.ok(r.details.codes.some((c) => c.code === 'OVER_28H'));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.status, '下書き');
  assert.equal(m.version, 1);
  assert.deepEqual(Object.keys(m.shifts), ['1']);
});

test('確定: 注意（warn）だけなら確定できる（成人の8時間超 LABOR_HOURS）', () => {
  const w = world();
  const r = ok(w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '18:15')] }, 0));
  assert.equal(r.status, '確定済');
  assert.ok(r.evaluation.codes.some((c) => c.code === 'LABOR_HOURS'));
});

test('確定: 確認中の勤務先を使うと WORKPLACE_PENDING で確定できない。OK になれば確定できる', () => {
  const w = world();
  const pending = addWorkplace(w, w.st, { name: 'レストランB' }, false);
  const r = w.api('api_confirm', w.st.token, YM, { '1': [sh(pending, '09:00', '12:00')] }, 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'WORKPLACE_PENDING'));
  ok(w.api('api_adminVerifyWorkplace', w.admin, pending, 'OK'));
  ok(w.api('api_confirm', w.st.token, YM, { '1': [sh(pending, '09:00', '12:00')] }, 0));
});

test('勤務なし: シフト0件のまま確定できる（確定済・合計0分）', () => {
  const w = world();
  const r = ok(w.api('api_confirm', w.st.token, YM, {}, 0));
  assert.equal(r.status, '確定済');
  assert.equal(r.evaluation.totalMinutes, 0);
});

test('確定済みの月を締切前に下書き保存すると、下書きに戻る', () => {
  const w = world();
  ok(w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  const r = ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:00')] }, 1));
  assert.equal(r.status, '下書き');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '下書き');
});

test('上書き防止: 古い version で保存すると VERSION_CONFLICT で、データは変わらない', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:00')] }, 1));
  const stale = w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '10:00', '11:00')] }, 1);
  assert.deepEqual([stale.ok, stale.error], [false, 'VERSION_CONFLICT']);
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.version, 2);
  assert.deepEqual(m.shifts['1'], [sh(w.wp, '09:00', '13:00')]);
  assert.equal(w.api('api_confirm', w.st.token, YM, {}, 0).error, 'VERSION_CONFLICT');
});

test('ロックが取れないときは BUSY を返し、何も書き込まない', () => {
  const w = world();
  w.env.setLockBusy(true);
  const r = w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0);
  assert.deepEqual([r.ok, r.error], [false, 'BUSY']);
  w.env.setLockBusy(false);
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).status, '未入力');
});

test('保存が終わったらロックを解放している', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  assert.equal(w.env.lockHeld, false);
  w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00'), sh(w.wp, '10:00', '11:00')] }, 1);
  assert.equal(w.env.lockHeld, false);
});

// ---- 締切 ----

test('締切の分（9/30 23:59）までは保存でき、10/1 00:00 からは DEADLINE_PASSED', () => {
  const w = world();
  w.at('2026-09-30 23:59');
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0));
  w.at('2026-10-01 00:00');
  const r = w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:00')] }, 1);
  assert.deepEqual([r.ok, r.error], [false, 'DEADLINE_PASSED']);
  assert.equal(w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 1).error, 'DEADLINE_PASSED');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.closed, true);
  assert.deepEqual(m.shifts['1'], [sh(w.wp, '09:00', '12:00')]);
});

test('締切はクラスごと: クラスBに締切が無い月は NOT_OPEN', () => {
  const w = world();
  const b = addStudent(w, { studentId: '251050', className: 'B' });
  const wpB = addWorkplace(w, b);
  const r = w.api('api_saveDraft', b.token, YM, { '1': [sh(wpB, '09:00', '12:00')] }, 0);
  assert.deepEqual([r.ok, r.error], [false, 'NOT_OPEN']);
  ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: YM, className: 'B', deadlineAt: '2026-09-30 23:30', actualDeadlineAt: null }));
  ok(w.api('api_saveDraft', b.token, YM, { '1': [sh(wpB, '09:00', '12:00')] }, 0));
});

test('修正許可: 締切後でも期限内は保存・確定でき、期限を過ぎると再び DEADLINE_PASSED', () => {
  const w = world();
  w.at('2026-10-01 09:00');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, 0).error, 'DEADLINE_PASSED');
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02 18:00'));
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.closed, false);
  assert.equal(m.unlockUntil, '2026-10-02 18:00');
  ok(w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '12:00')] }, m.version));
  w.at('2026-10-02 18:01');
  assert.equal(w.api('api_saveDraft', w.st.token, YM, {}, m.version + 1).error, 'DEADLINE_PASSED');
  assert.equal(ok(w.api('api_getMonth', w.st.token, YM)).closed, true);
});

test('修正許可は管理者だけが出せる（学生のトークンでは FORBIDDEN）', () => {
  const w = world();
  assert.equal(w.api('api_adminGrantUnlock', w.st.token, w.st.studentId, YM, '2026-10-02 18:00').error, 'FORBIDDEN');
});

// ---- 月またぎ（前月データの取得元） ----

function septConfirmed(w, days) {
  w.at('2026-08-20 10:00');
  ok(w.api('api_confirm', w.st.token, '2026-09', days, 0));
  w.at('2026-09-10 10:00');
}

test('前月（9月）が未入力なら、10月の評価に PREV_MONTH_DRAFT（注意）が付く', () => {
  const w = world();
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.ok(m.evaluation.codes.some((c) => c.code === 'PREV_MONTH_DRAFT'));
});

test('前月が確定済みなら、前月の最終6日分を合わせて28時間を検算する', () => {
  const w = world();
  septConfirmed(w, { '26': [sh(w.wp, '09:00', '18:00')], '27': [sh(w.wp, '09:00', '18:00')], '28': [sh(w.wp, '09:00', '18:00')] });
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  assert.equal(m.evaluation.codes.some((c) => c.code === 'PREV_MONTH_DRAFT'), false);
  const r = w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:15')] }, 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'OVER_28H'));
  ok(w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:00')] }, 0));
});

test('前月の実績が確認済みなら、前月は予定ではなく実績を使う', () => {
  const w = world();
  // 9月の予定は 9/28 に 480分だけ。実績では 9/26〜9/28 に各480分働いていた。
  septConfirmed(w, { '28': [sh(w.wp, '09:00', '18:00')] });
  w.at('2026-10-03 10:00');
  const sept = ok(w.api('api_getMonth', w.st.token, '2026-09'));
  const actual = { '26': [sh(w.wp, '09:00', '18:00')], '27': [sh(w.wp, '09:00', '18:00')], '28': [sh(w.wp, '09:00', '18:00')] };
  const saved = ok(w.api('api_saveActual', w.st.token, '2026-09', actual, sept.version));
  ok(w.api('api_confirmActual', w.st.token, '2026-09', saved.version));
  // 10月分は締切後なので、修正許可を出して検算させる
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-05 18:00'));
  const r = w.api('api_confirm', w.st.token, YM, { '1': [sh(w.wp, '09:00', '13:15')] }, 0);
  assert.equal(r.error, 'VALIDATION_FAILED');
  assert.ok(r.details.codes.some((c) => c.code === 'OVER_28H'));
});

test('前月が入学前なら PREV_MONTH_DRAFT は付かない', () => {
  const w = world();
  const fresh = addStudent(w, { studentId: '261001', enrollmentDate: '2026-10-01' });
  const m = ok(w.api('api_getMonth', fresh.token, YM));
  assert.equal(m.evaluation.codes.some((c) => c.code === 'PREV_MONTH_DRAFT'), false);
});

// ---- 学校確定 ----

test('学校確定: 退学した学生の未入力の月を「学校確定」にでき、学生の側からは変更できない', () => {
  const w = world();
  const gone = addStudent(w, { studentId: '251099', status: '退学', withdrawalDate: '2026-09-15' });
  ok(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, YM));
  const m = ok(w.api('api_getMonth', gone.token, YM));
  assert.equal(m.status, '学校確定');
  assert.equal(w.api('api_saveDraft', gone.token, YM, {}, m.version).error, 'FORBIDDEN');
});

test('学校確定: 在籍中の学生には使えない（FORBIDDEN）', () => {
  const w = world();
  assert.equal(w.api('api_adminSchoolConfirm', w.admin, w.st.studentId, YM).error, 'FORBIDDEN');
});

test('学校確定: 学生がすでに入力している月には使えない（FORBIDDEN）', () => {
  const w = world();
  const leave = addStudent(w, { studentId: '251098', status: '休学' });
  const wpL = addWorkplace(w, leave);
  ok(w.api('api_saveDraft', leave.token, YM, { '1': [sh(wpL, '09:00', '10:00')] }, 0));
  assert.equal(w.api('api_adminSchoolConfirm', w.admin, leave.studentId, YM).error, 'FORBIDDEN');
});

// ---- 監査ログ ----

test('下書き保存・確定・修正許可・学校確定は監査ログに1行ずつ残る（学籍番号・対象月・version 付き）', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, {}, 0));
  ok(w.api('api_confirm', w.st.token, YM, {}, 1));
  ok(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, YM, '2026-10-02 18:00'));
  const gone = addStudent(w, { studentId: '251097', status: '卒業', graduationDate: '2026-09-15' });
  ok(w.api('api_adminSchoolConfirm', w.admin, gone.studentId, YM));
  const rows = auditRows(w);
  const find = (a) => rows.filter((r) => r.action === a);
  assert.equal(find('SAVE_DRAFT').length, 1);
  assert.equal(find('CONFIRM').length, 1);
  assert.equal(find('ADMIN_UNLOCK').length, 1);
  assert.equal(find('SCHOOL_CONFIRM').length, 1);
  const c = find('CONFIRM')[0];
  assert.equal(c.student_id, w.st.studentId);
  assert.equal(c.year_month, YM);
  assert.equal(String(c.version), '2');
  assert.equal(c.role, 'student');
  assert.match(c.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('失敗した保存（締切後・上書き衝突）は監査ログに SAVE_DRAFT を残さない', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, {}, 0));
  w.api('api_saveDraft', w.st.token, YM, {}, 0);
  w.at('2026-10-01 00:00');
  w.api('api_saveDraft', w.st.token, YM, {}, 1);
  assert.equal(auditRows(w).filter((r) => r.action === 'SAVE_DRAFT').length, 1);
});
