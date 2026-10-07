'use strict';
// 実装後の点検で見つかった穴を塞いだことを確かめるテスト（2026-09-30 追加）。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, addStudent, studentRecord, auditRows, sh } = require('../helpers/api');

// 本物のスプレッドシートは = + - @ で始まる文字を数式として実行する。どのシートにもそのまま残してはならない。
function formulaLikeCells(ctx) {
  const out = [];
  for (const ss of ctx.env.spreadsheets.values()) {
    for (const sheet of ss.getSheets()) {
      for (const row of sheet.getDataRange().getValues()) {
        for (const v of row) if (/^[=+\-@]/.test(String(v))) out.push(sheet.getName() + ': ' + v);
      }
    }
  }
  return out;
}

test('数式のような氏名・クラス名は、そのままの文字で保存・表示され、シートには数式として残らない', () => {
  const w = world();
  const name = '=IMPORTRANGE("x","USERS!A1")';
  ok(w.api('api_adminUpsertStudent', w.admin, studentRecord({ studentId: '251077', name, className: '+SUM(1)' })));
  const d = ok(w.api('api_adminStudentDetail', w.admin, '251077'));
  assert.equal(d.student.name, name);
  assert.equal(d.student.className, '+SUM(1)');
  assert.deepEqual(formulaLikeCells(w), []);
});

test('ログインIDに数式を入れても、監査ログに数式として残らない', () => {
  const ctx = boot();
  ctx.api('api_login', '=HYPERLINK("http://example.invalid")', 'x');
  assert.deepEqual(formulaLikeCells(ctx), []);
});

test('学校設定: 範囲外・型違い・知らない項目は BAD_REQUEST で、何も変わらない', () => {
  const ctx = boot();
  for (const bad of [{ retentionMonths: 1 }, { retentionMonths: -5 }, { retentionMonths: '24' }, { sessionTtlMinutes: 0 },
    { actualConfirmDefaultDay: 31 }, { allowLeaveOfAbsence: 'true' }, { unknownKey: 1 }]) {
    assert.equal(ctx.api('api_adminSetSettings', ctx.admin, bad).error, 'BAD_REQUEST', JSON.stringify(bad));
  }
  const s = ok(ctx.api('api_adminGetSettings', ctx.admin));
  assert.equal(s.retentionMonths, 24);
  assert.equal(s.unknownKey, undefined);
});

test('セッションの有効期限は学校設定（sessionTtlMinutes）に従う', () => {
  const ctx = boot();
  ok(ctx.api('api_adminSetSettings', ctx.admin, { sessionTtlMinutes: 30 }));
  const st = addStudent(ctx);
  const token = ok(ctx.api('api_login', st.loginId, st.password)).token;
  ctx.env.clock.advanceMinutes(29);
  ok(ctx.api('api_getMonth', token, '2026-10'));
  ctx.env.clock.advanceMinutes(2);
  assert.equal(ctx.api('api_getMonth', token, '2026-10').error, 'AUTH_REQUIRED');
});

test('ロックが切れた後の1回の失敗では、すぐに再ロックされない', () => {
  const ctx = boot();
  const st = addStudent(ctx);
  for (let i = 0; i < 5; i++) ctx.api('api_login', st.loginId, 'wrong-password');
  ctx.env.clock.advanceMinutes(16);
  assert.equal(ctx.api('api_login', st.loginId, 'wrong-password').error, 'LOGIN_FAILED');
  ok(ctx.api('api_login', st.loginId, st.password));
});

test('学籍番号が空のパスワード再発行・ロック解除は、管理者のアカウントに触れない', () => {
  const ctx = boot();
  assert.notEqual(ctx.api('api_adminResetPassword', ctx.admin, '').ok, true);
  assert.notEqual(ctx.api('api_adminUnlockLogin', ctx.admin, '').ok, true);
  ok(ctx.api('api_login', ctx.adminLoginId, ctx.adminPassword));
});

// 2026-10-07: 生年月日は任意になった（名簿で入れた学生には無い）。生年月日は形だけを確かめる
test('学生情報: 入学日・許可の有無は必須、日付は実在する日だけ', () => {
  const ctx = boot();
  for (const bad of [
    studentRecord({ birthDate: 20000401 }),
    studentRecord({ enrollmentDate: '' }),
    studentRecord({ workPermission: undefined }),
    studentRecord({ birthDate: '2000-02-30' }),
    studentRecord({ studentId: 25 }),
  ]) {
    assert.equal(ctx.api('api_adminUpsertStudent', ctx.admin, bad).error, 'BAD_REQUEST', JSON.stringify(bad));
  }
});

test('修正許可: 期限の形が違えば BAD_REQUEST、存在しない学生なら NOT_FOUND', () => {
  const w = world();
  assert.equal(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, '2026-10', '2026/10/02').error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminGrantUnlock', w.admin, w.st.studentId, '2026-13', '2026-10-02 18:00').error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminGrantUnlock', w.admin, 'no-such', '2026-10', '2026-10-02 18:00').error, 'NOT_FOUND');
});

test('締切・長期休業: 日付や数の形が違えば BAD_REQUEST', () => {
  const ctx = boot();
  assert.equal(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: '2026-10', className: 'A', deadlineAt: '2026/09/30', actualDeadlineAt: null }).error, 'BAD_REQUEST'); // 2026-10-03: 日付だけ（2026-09-30）は 23:59 として受け付ける
  assert.equal(ctx.api('api_adminSetHoliday', ctx.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 'abc' }).error, 'BAD_REQUEST');
});

test('発行するログインIDは重複しない（30人）', () => {
  const ctx = boot();
  const ids = new Set();
  for (let i = 0; i < 30; i++) {
    ids.add(ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'S' + i }))).loginId);
  }
  assert.equal(ids.size, 30);
});

test('試用データ: 押すと DEMO クラスの学生1人（生徒A）が入り、そのまま入力・確定まで試せる。2回押しても重複しない', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const first = ok(ctx.api('api_adminSeedDemo', ctx.admin));
  assert.equal(first.className, 'DEMO');
  assert.deepEqual(first.students.map((s) => [s.studentId, s.name]), [['DEMO-A', '生徒A']]);
  const again = ok(ctx.api('api_adminSeedDemo', ctx.admin));
  assert.equal(again.students.length, 0);
  const shiftDb = ctx.env.spreadsheets.get(ctx.env.properties.get('SHIFT_DB_ID'));
  assert.equal(shiftDb.getSheetByName('WORKPLACES'), null, '勤務先の表は作らない');
  assert.equal(shiftDb.getSheetByName('MINIMUM_WAGES'), null, '最低賃金の表は作らない');
  const s = first.students[0];
  const login = ok(ctx.api('api_login', s.loginId, s.initialPassword));
  ok(ctx.api('api_changePassword', login.token, s.initialPassword, 'demo-password-1'));
  const r = ok(ctx.api('api_confirm', login.token, '2026-11', { '2': [{ start: '09:00', end: '13:00' }] }, 0));
  assert.equal(r.status, '確定済');
});

test('生徒モード: 管理者は試用の学生（DEMO）の画面にパスワード無しで入れる。試用データが無ければ自動で入る', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const r = ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  assert.equal(r.role, 'student');
  assert.equal(r.studentId, 'DEMO-A');
  assert.equal(r.language, 'ja');
  assert.equal(r.mustChangePassword, false);
  assert.equal(r.newStudents.length, 1);
  ok(ctx.api('api_confirm', r.token, '2026-11', { '2': [{ start: '09:00', end: '13:00' }] }, 0));
  // 管理者のトークンはそのまま使える（「管理者に戻る」）
  ok(ctx.api('api_adminGetSettings', ctx.admin));
  // 2回目は試用データを作り直さない
  assert.equal(ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A')).newStudents.length, 0);
});

test('生徒モード: 試用の学生は、配られたIDとパスワードでそのままログインでき、初回のパスワード変更を求められない', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const s = ok(ctx.api('api_adminSeedDemo', ctx.admin)).students[0];
  const login = ok(ctx.api('api_login', s.loginId, s.initialPassword));
  assert.equal(login.mustChangePassword, false);
  ok(ctx.api('api_getMonth', login.token, '2026-10'));
});

test('生徒モード: DEMO 以外の学生には入れない（FORBIDDEN）。知らない学籍番号は NOT_FOUND', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const st = addStudent(ctx);
  assert.equal(ctx.api('api_adminActAsDemoStudent', ctx.admin, st.studentId).error, 'FORBIDDEN');
  assert.equal(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'no-such').error, 'NOT_FOUND');
  assert.equal(ctx.api('api_adminActAsDemoStudent', ctx.admin, '').error, 'BAD_REQUEST');
});

test('古い版で作った表に、今は使わない列（estimated_salary）が残っていても、書き込みの列がずれない（2026-10-01 追加）', () => {
  const w = world();
  let sheet = null;
  for (const ss of w.env.spreadsheets.values()) sheet = sheet || ss.getSheetByName('MONTHLY_SUBMISSIONS');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const at = header.indexOf('max_rolling7_minutes') + 1;
  header.splice(at, 0, 'estimated_salary');
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '3': [sh('21:00', '06:00')] }, 0));
  ok(w.api('api_saveDraft', w.st.token, '2026-10', { '3': [sh('09:00', '13:00')] }, 1));
  const m = ok(w.api('api_getMonth', w.st.token, '2026-10'));
  assert.equal(m.status, '下書き');
  assert.equal(m.version, 2);
  assert.deepEqual(m.shifts, { '3': [{ start: '09:00', end: '13:00' }] });
  const row = sheet.getRange(2, 1, 1, header.length).getValues()[0];
  assert.equal(row[at], '');
});

test('学生の言語: ja・ne・vi・en・my・si・bn を登録でき、それ以外は BAD_REQUEST（2026-10-01 4言語を追加）', () => {
  const ctx = boot();
  ['ja', 'ne', 'vi', 'en', 'my', 'si', 'bn'].forEach((lang, i) => {
    ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'L' + i, language: lang })));
  });
  assert.equal(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'LX', language: 'zh' })).error, 'BAD_REQUEST');
});
