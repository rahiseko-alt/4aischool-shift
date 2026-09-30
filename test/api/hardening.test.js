'use strict';
// 実装後の点検で見つかった穴を塞いだことを確かめるテスト（2026-09-30 追加）。
// 実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, addStudent, studentRecord, auditRows } = require('../helpers/api');

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

test('数式のような勤務先名は、そのままの文字で保存・表示され、シートには数式として残らない', () => {
  const w = world();
  const name = '=IMPORTRANGE("x","USERS!A1")';
  const id = ok(w.api('api_saveWorkplace', w.st.token, {
    name, prefecture: '愛知県', jobDescription: '+SUM(1)', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null,
  })).workplaceId;
  const wp = ok(w.api('api_listWorkplaces', w.st.token)).find((x) => x.workplaceId === id);
  assert.equal(wp.name, name);
  assert.equal(wp.jobDescription, '+SUM(1)');
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

test('学生情報: 生年月日・入学日・許可の有無は必須、日付は実在する日だけ', () => {
  const ctx = boot();
  for (const bad of [
    studentRecord({ birthDate: null }),
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

test('締切・最低賃金・長期休業: 日付や金額の形が違えば BAD_REQUEST', () => {
  const ctx = boot();
  assert.equal(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: '2026-10', className: 'A', deadlineAt: '2026-09-30', actualDeadlineAt: null }).error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_adminSetMinimumWage', ctx.admin, { prefecture: '愛知', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null }).error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_adminSetMinimumWage', ctx.admin, { prefecture: '愛知県', amount: '1100', effectiveFrom: '2025-10-18', effectiveTo: null }).error, 'BAD_REQUEST');
  assert.equal(ctx.api('api_adminSetHoliday', ctx.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 'abc' }).error, 'BAD_REQUEST');
});

test('勤務先の登録・変更は監査ログに残る', () => {
  const w = world();
  const n = auditRows(w).filter((r) => r.action === 'MASTER_UPDATE' && r.role === 'student').length;
  ok(w.api('api_saveWorkplace', w.st.token, { name: 'B', prefecture: '愛知県', jobDescription: '接客', baseHourlyWage: 1200, earlyStart: null, earlyEnd: null, earlyPremium: null }));
  assert.equal(auditRows(w).filter((r) => r.action === 'MASTER_UPDATE' && r.role === 'student').length, n + 1);
});

test('発行するログインIDは重複しない（30人）', () => {
  const ctx = boot();
  const ids = new Set();
  for (let i = 0; i < 30; i++) {
    ids.add(ok(ctx.api('api_adminUpsertStudent', ctx.admin, studentRecord({ studentId: 'S' + i }))).loginId);
  }
  assert.equal(ids.size, 30);
});
