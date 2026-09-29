'use strict';
// サーバの窓口（api_*）のテスト用の下準備。テスト専用。
// 実装役はこのファイルを変更してはならない。
// 注意: 最低賃金の金額はテスト用の架空の値であり、実際の金額ではない。

const assert = require('node:assert/strict');
const { load } = require('./load');

// 新しい学校を1つ用意する: setupInitial を実行し、初期管理者でログインしてパスワードを変える。
function boot(options) {
  const app = load({ now: (options && options.now) || '2026-09-01 10:00' });
  const api = (name, ...args) => app.call(name, ...args);
  app.get('setupInitial')();
  const line = app.env.logs.find((l) => /^INITIAL_ADMIN /.test(l));
  assert.ok(line, 'setupInitial は "INITIAL_ADMIN loginId=... password=..." を Logger.log に1行出すこと');
  const m = /loginId=(\S+) password=(\S+)/.exec(line);
  assert.ok(m, 'INITIAL_ADMIN の行の形式が違う: ' + line);
  const first = api('api_login', m[1], m[2]);
  assert.equal(first.ok, true, '初期管理者でログインできない: ' + JSON.stringify(first));
  assert.equal(first.data.role, 'admin');
  const adminPassword = 'admin-pass-0001';
  const ch = api('api_changePassword', first.data.token, m[2], adminPassword);
  assert.equal(ch.ok, true, JSON.stringify(ch));
  const ctx = { app, env: app.env, api, admin: first.data.token, adminLoginId: m[1], adminPassword, students: [] };
  // 時計を進めるとセッション（120分）が切れるので、管理者と作った学生を全員ログインし直す。
  ctx.at = (time) => {
    ctx.env.clock.set(time);
    ctx.admin = ok(api('api_login', ctx.adminLoginId, ctx.adminPassword), '再ログイン(管理者)').token;
    for (const st of ctx.students) st.token = ok(api('api_login', st.loginId, st.password), '再ログイン(学生)').token;
  };
  return ctx;
}

function ok(res, label) {
  assert.equal(res && res.ok, true, (label || '') + ' 失敗: ' + JSON.stringify(res));
  return res.data;
}

function studentRecord(overrides) {
  return {
    studentId: '251001',
    name: 'コセヒラ コウヘイ',
    className: 'A',
    birthDate: '2000-04-01',
    language: 'ja',
    enrollmentDate: '2025-04-01',
    graduationDate: null,
    withdrawalDate: null,
    status: '在籍',
    workPermission: true,
    permissionExpires: '2027-12-31',
    permissionCheckedAt: '2025-04-01',
    ...(overrides || {}),
  };
}

// 学生を作り、初回ログインとパスワード変更まで済ませる。
function addStudent(ctx, overrides) {
  const rec = studentRecord(overrides);
  const created = ok(ctx.api('api_adminUpsertStudent', ctx.admin, rec), 'api_adminUpsertStudent');
  const login = ok(ctx.api('api_login', created.loginId, created.initialPassword), 'api_login(学生)');
  const password = 'student-pass-' + rec.studentId;
  ok(ctx.api('api_changePassword', login.token, created.initialPassword, password), 'api_changePassword(学生)');
  const st = { ...created, token: login.token, password, record: rec };
  ctx.students.push(st);
  return st;
}

// 勤務先を登録し、管理者が OK にする（verify: false なら確認中のまま）。
function addWorkplace(ctx, student, overrides, verify) {
  const wp = {
    name: 'コンビニA', prefecture: '愛知県', jobDescription: 'レジ・品出し', baseHourlyWage: 1200,
    earlyStart: null, earlyEnd: null, earlyPremium: null, ...(overrides || {}),
  };
  const res = ok(ctx.api('api_saveWorkplace', student.token, wp), 'api_saveWorkplace');
  if (verify !== false) {
    ok(ctx.api('api_adminVerifyWorkplace', ctx.admin, res.workplaceId, 'OK'), 'api_adminVerifyWorkplace');
  }
  return res.workplaceId;
}

// 標準の学校設定: 愛知県の最低賃金と、クラスAの 2026年9〜12月分の締切。
function standardMasters(ctx) {
  ok(ctx.api('api_adminSetMinimumWage', ctx.admin,
    { prefecture: '愛知県', amount: 1100, effectiveFrom: '2025-10-18', effectiveTo: null }), 'api_adminSetMinimumWage');
  const deadlines = [
    ['2026-09', '2026-08-31 23:59'], ['2026-10', '2026-09-30 23:59'],
    ['2026-11', '2026-10-31 23:59'], ['2026-12', '2026-11-30 23:59'],
  ];
  for (const [ym, at] of deadlines) {
    ok(ctx.api('api_adminSetDeadline', ctx.admin, { yearMonth: ym, className: 'A', deadlineAt: at, actualDeadlineAt: null }), 'api_adminSetDeadline');
  }
}

// よく使う組み合わせ: 学校・学生1人・OKの勤務先1つ。
function world(options) {
  const ctx = boot(options);
  standardMasters(ctx);
  const st = addStudent(ctx);
  const wp = addWorkplace(ctx, st);
  return Object.assign(ctx, { st, wp });
}

const sh = (workplace, start, end) => ({ workplace, start, end });

function everyDay(from, to, shift) {
  const out = {};
  for (let d = from; d <= to; d++) out[String(d)] = [{ ...shift }];
  return out;
}

function auditRows(ctx) {
  const id = ctx.env.properties.get('AUDIT_LOG_ID');
  assert.ok(id, 'Script Properties に AUDIT_LOG_ID が無い');
  const sheet = ctx.env.spreadsheets.get(id).getSheetByName('AUDIT_LOG');
  assert.ok(sheet, 'AuditLog に AUDIT_LOG シートが無い');
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  return values.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// すべてのスプレッドシートの全セルを文字列として返す（平文の漏れを探すため）。
function allCells(ctx) {
  const out = [];
  for (const ss of ctx.env.spreadsheets.values()) {
    for (const sheet of ss.getSheets()) {
      for (const row of sheet.getDataRange().getValues()) for (const v of row) out.push(String(v));
    }
  }
  return out;
}

module.exports = { boot, ok, studentRecord, addStudent, addWorkplace, standardMasters, world, sh, everyDay, auditRows, allCells };
