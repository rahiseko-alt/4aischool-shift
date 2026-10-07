'use strict';
// 2026-10-07 の点検で見つかった、学生の追加・編集フォーム、名簿の一括登録、クラス、DEMO クラス、
// ログインの短い番号（K/S）の不具合の直し。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot, ok, studentRecord } = require('../helpers/api');

const NOW = '2026-10-07 10:00';
const rec = (o) => studentRecord({ className: 'A', ...(o || {}) });
const upsert = (ctx, o) => ctx.api('api_adminUpsertStudent', ctx.admin, rec(o));
const detail = (ctx, id) => ok(ctx.api('api_adminStudentDetail', ctx.admin, id)).student;
const studentCount = (ctx) => ctx.api('api_adminListClasses', ctx.admin).data.reduce((n, c) => n + c.students, 0);

// ---- 1・2 学生の追加は上書きしない。学籍番号は大文字小文字を問わない ----

test('学生の追加（mode: create）: 既にいる学籍番号なら、大文字小文字が違っても上書きせずに断る', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'AIBC26001', name: '元の名前', mode: 'create' }));
  for (const id of ['AIBC26001', 'aibc26001', ' Aibc26001 ']) {
    const r = upsert(ctx, { studentId: id, name: '上書き', mode: 'create' });
    assert.equal(r.ok, false, id);
    assert.equal(r.error, 'BAD_REQUEST');
    assert.equal(r.details.field, 'studentId');
    assert.equal(r.details.reason, 'DUPLICATE');
    assert.match(r.details.message, /その学籍番号はすでに登録されています/);
  }
  assert.equal(detail(ctx, 'AIBC26001').name, '元の名前');
  assert.equal(studentCount(ctx), 1);
});

test('学生の更新: 小文字で送っても同じ学生を更新し、2人目を作らない（mode なし・mode: update とも）', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'AIBC26001' }));
  const r = ok(upsert(ctx, { studentId: 'aibc26001', name: '新しい名前' }));
  assert.equal(r.created, false);
  assert.equal(r.studentId, 'AIBC26001');
  const r2 = ok(upsert(ctx, { studentId: 'aibc26001', name: 'もう一度', mode: 'update' }));
  assert.equal(r2.created, false);
  assert.equal(detail(ctx, 'AIBC26001').name, 'もう一度');
  assert.equal(studentCount(ctx), 1);
});

test('学生の更新（mode: update）: いない学籍番号なら NOT_FOUND で、新しく作らない', () => {
  const ctx = boot({ now: NOW });
  assert.equal(upsert(ctx, { studentId: 'NOPE1', mode: 'update' }).error, 'NOT_FOUND');
  assert.equal(studentCount(ctx), 0);
  assert.equal(upsert(ctx, { studentId: 'X1', mode: 'replace' }).error, 'BAD_REQUEST');
});

// ---- 3 2つの画面で同じ学生を編集したら、後の方を止める ----

test('学生の更新: 開いたときの版（expectedVersion）が変わっていれば、同じ分の中でも VERSION_CONFLICT で止める', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'S1' }));
  const v1 = detail(ctx, 'S1').version;
  assert.equal(typeof v1, 'string');
  assert.ok(v1.length > 0);
  // 画面1が更新（時計は進めない）
  ok(upsert(ctx, { studentId: 'S1', name: '画面1', mode: 'update', expectedVersion: v1 }));
  // 画面2は古い版のまま更新しようとする
  const r = upsert(ctx, { studentId: 'S1', name: '画面2', mode: 'update', expectedVersion: v1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'VERSION_CONFLICT');
  assert.match(r.details.message, /ほかの画面で先に更新されました。開き直してください/);
  assert.equal(detail(ctx, 'S1').name, '画面1');
  // 開き直せば更新できる
  ok(upsert(ctx, { studentId: 'S1', name: '画面2', mode: 'update', expectedVersion: detail(ctx, 'S1').version }));
  assert.equal(detail(ctx, 'S1').name, '画面2');
});

// ---- 4 日付と在籍状態の食い違い ----

test('学生情報: 日付の食い違いは、項目と理由を書いた BAD_REQUEST で断る', () => {
  const ctx = boot({ now: NOW });
  const cases = [
    [{ birthDate: '2026-10-08' }, 'birthDate', /生年月日.*未来/],
    [{ birthDate: '2025-05-01', enrollmentDate: '2025-04-01' }, 'birthDate', /生年月日.*入学日より後/],
    [{ graduationDate: '2025-03-31' }, 'graduationDate', /卒業日.*入学日より前/],
    [{ status: '退学', withdrawalDate: '2025-03-01' }, 'withdrawalDate', /退学日.*入学日より前/],
    [{ enrollmentDate: '2101-04-01' }, 'enrollmentDate', /入学日.*年/],
    [{ birthDate: '1850-01-01' }, 'birthDate', /生年月日.*年/],
    [{ status: '退学', withdrawalDate: null }, 'withdrawalDate', /退学.*退学日/],
    [{ status: '在籍', withdrawalDate: '2026-09-30' }, 'status', /退学日.*在籍/],
    [{ status: '卒業', graduationDate: null }, 'graduationDate', /卒業.*卒業日/],
  ];
  for (const [o, field, re] of cases) {
    const r = upsert(ctx, { studentId: 'D1', ...o });
    assert.equal(r.error, 'BAD_REQUEST', JSON.stringify(o));
    assert.equal(r.details && r.details.field, field, JSON.stringify(o) + ' ' + JSON.stringify(r));
    assert.match(r.details.message, re, JSON.stringify(o));
  }
  assert.equal(studentCount(ctx), 0);
  ok(upsert(ctx, { studentId: 'D2', status: '退学', withdrawalDate: '2026-09-30' }));
  ok(upsert(ctx, { studentId: 'D3', status: '卒業', graduationDate: '2026-09-30' }));
  ok(upsert(ctx, { studentId: 'D4', status: '在籍', graduationDate: '2027-03-31' })); // 卒業予定日は先に入れてよい
});

// ---- 6 生年月日は任意 ----

test('学生情報: 生年月日は空でもよい（名簿で入れた学生をそのまま編集できる）', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'B1', birthDate: null, mode: 'create' }));
  assert.equal(detail(ctx, 'B1').birthDate, '');
  ok(ctx.api('api_adminImportRoster', ctx.admin, { className: 'A', enrollmentDate: '2026-04-01', rows: [{ studentId: 'AIBC26009', name: 'TARO', nameKana: '' }] }));
  const s = detail(ctx, 'AIBC26009');
  ok(upsert(ctx, { ...s, birthDate: s.birthDate || null, name: 'TARO Y', mode: 'update', expectedVersion: s.version }));
  assert.equal(detail(ctx, 'AIBC26009').name, 'TARO Y');
  assert.equal(detail(ctx, 'AIBC26009').birthDate, '');
});

// ---- 7 学籍番号・氏名の形 ----

test('学籍番号: 全角の英数字は半角にそろえる。中に空白があれば理由を書いて断る', () => {
  const ctx = boot({ now: NOW });
  const r = ok(upsert(ctx, { studentId: '２５１００１', mode: 'create' }));
  assert.equal(r.studentId, '251001');
  assert.equal(detail(ctx, '251001').studentId, '251001');
  ok(upsert(ctx, { studentId: 'ＡＩＢＣ２６００２', mode: 'create' }));
  assert.equal(detail(ctx, 'AIBC26002').studentId, 'AIBC26002');
  for (const id of ['AIBC 26003', 'AIBC　26003']) {
    const bad = upsert(ctx, { studentId: id, mode: 'create' });
    assert.equal(bad.error, 'BAD_REQUEST');
    assert.equal(bad.details.field, 'studentId');
    assert.match(bad.details.message, /学籍番号.*空白/);
  }
  const bad2 = upsert(ctx, { studentId: 'AB_12', mode: 'create' });
  assert.equal(bad2.details.field, 'studentId');
  assert.match(bad2.details.message, /学籍番号.*英数字/);
});

test('氏名: 見えない文字は取り除く。取り除いて空なら、また100文字を超えたら、理由を書いて断る', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'N1', name: '​ヤマダ‍ タロウ﻿' }));
  assert.equal(detail(ctx, 'N1').name, 'ヤマダ タロウ');
  const empty = upsert(ctx, { studentId: 'N2', name: '​‌⁠ ' });
  assert.equal(empty.details.field, 'name');
  assert.match(empty.details.message, /氏名/);
  const long = upsert(ctx, { studentId: 'N3', name: 'あ'.repeat(101) });
  assert.equal(long.details.field, 'name');
  assert.match(long.details.message, /氏名.*100文字/);
});

// ---- 13 クラス名をそろえる ----

test('クラス名: 全角英数字・見えない文字・続いた空白をそろえる（追加・学生・名簿）。既にあれば exists で知らせる', () => {
  const ctx = boot({ now: NOW });
  assert.deepEqual(ok(ctx.api('api_adminAddClass', ctx.admin, '国際  ビジネス科')), { name: '国際 ビジネス科', exists: false });
  assert.deepEqual(ok(ctx.api('api_adminAddClass', ctx.admin, '国際　ビジネス科​')), { name: '国際 ビジネス科', exists: true });
  ok(upsert(ctx, { studentId: 'C1', className: 'ＡＢ​' }));
  assert.equal(detail(ctx, 'C1').className, 'AB');
  ok(ctx.api('api_adminImportRoster', ctx.admin, { className: ' 国際　ビジネス科 ', enrollmentDate: '2026-04-01', rows: [{ studentId: 'AIBC26001', name: 'A', nameKana: '' }] }));
  assert.equal(detail(ctx, 'AIBC26001').className, '国際 ビジネス科');
  assert.deepEqual(ok(ctx.api('api_adminListClasses', ctx.admin)).map((c) => c.name), ['AB', '国際 ビジネス科']);
});

test('クラスの削除: 学生がいて消せないときは、理由（何人いるか）を返す', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'C1', className: '残る' }));
  ok(upsert(ctx, { studentId: 'C2', className: '残る' }));
  const r = ctx.api('api_adminDeleteClass', ctx.admin, '残る');
  assert.equal(r.error, 'BAD_REQUEST');
  assert.match(r.details.message, /学生が2人/);
});

// ---- 15 DEMO クラスを本物の学生と混ぜない ----

function withDemo() {
  const ctx = boot({ now: NOW });
  ok(ctx.api('api_adminSeedDemo', ctx.admin));
  ok(upsert(ctx, { studentId: 'R1', className: 'A' }));
  return ctx;
}

test('DEMO: 管理一覧の「全クラス」と集計には DEMO の学生を出さない。DEMO を選んだときだけ出す', () => {
  const ctx = withDemo();
  const all = ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', {}));
  assert.deepEqual(all.rows.map((r) => r.studentId), ['R1']);
  assert.equal(all.counts.students, 1);
  const demo = ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { className: 'DEMO' }));
  assert.deepEqual(demo.rows.map((r) => r.studentId), ['DEMO-A']);
});

test('DEMO: 画面からの追加・編集で、本物の学生を DEMO に入れたり、DEMO の学生を他のクラスに移したりできない', () => {
  const ctx = withDemo();
  const a = upsert(ctx, { studentId: 'R2', className: 'DEMO', mode: 'create' });
  assert.equal(a.error, 'BAD_REQUEST');
  assert.equal(a.details.field, 'className');
  const b = upsert(ctx, { studentId: 'R1', className: 'DEMO', mode: 'update' });
  assert.equal(b.details.field, 'className');
  const d = detail(ctx, 'DEMO-A');
  const c = upsert(ctx, { ...d, className: 'A', mode: 'update' });
  assert.equal(c.details.field, 'className');
  assert.equal(detail(ctx, 'DEMO-A').className, 'DEMO');
  ok(upsert(ctx, { ...d, name: '生徒A2', mode: 'update' })); // クラスを変えなければ編集できる
  const roster = ctx.api('api_adminImportRoster', ctx.admin, { className: 'DEMO', enrollmentDate: '2026-04-01', rows: [{ studentId: 'AIBC26001', name: 'A', nameKana: '' }] });
  assert.equal(roster.error, 'BAD_REQUEST');
});

// ---- 12・16 ログインの短い番号 ----

const K = '国際ビジネス科';
const roster = (ctx, className, rows, enrollmentDate) =>
  ok(ctx.api('api_adminImportRoster', ctx.admin, { className, enrollmentDate: enrollmentDate || '2026-04-01', rows }));

test('短い番号: 卒業・退学した学生（状態か、卒業日・退学日を過ぎた）は数えず、新入生が K01 で入れる', () => {
  const ctx = boot({ now: NOW });
  ok(upsert(ctx, { studentId: 'AIBC24001', className: K, status: '卒業', enrollmentDate: '2024-04-01', graduationDate: '2026-03-15' }));
  ok(upsert(ctx, { studentId: 'AIBC23001', className: K, status: '在籍', enrollmentDate: '2023-04-01', graduationDate: '2026-03-15' }));
  ok(upsert(ctx, { studentId: 'AIBC25001', className: K, status: '退学', enrollmentDate: '2025-04-01', withdrawalDate: '2026-01-31' }));
  roster(ctx, K, [{ studentId: 'AIBC26001', name: 'NEW', nameKana: '' }]);
  assert.equal(ok(ctx.api('api_login', 'K01', '')).studentId, 'AIBC26001');
  assert.equal(detail(ctx, 'AIBC26001').loginCode, 'K01');
  assert.equal(detail(ctx, 'AIBC26001').loginCodeConflict, false);
  // 卒業した学生の詳細には短い番号を出さない
  assert.equal(detail(ctx, 'AIBC24001').loginCode, null);
});

test('短い番号: 在籍中の2人で重なるときは、詳細に番号を出さず、重なりを知らせる', () => {
  const ctx = boot({ now: NOW });
  roster(ctx, K, [{ studentId: 'AIBC26001', name: 'A', nameKana: '' }]);
  ok(upsert(ctx, { studentId: 'AIBC25001', className: K, status: '休学', enrollmentDate: '2025-04-01' }));
  const s = detail(ctx, 'AIBC26001');
  assert.equal(s.loginCode, null);
  assert.equal(s.loginCodeConflict, true);
  assert.equal(ctx.api('api_login', 'K01', '').ok, false);
});

test('名簿の一括登録: 登録した学生の短い番号がほかの学生と重なれば、結果で知らせる', () => {
  const ctx = boot({ now: NOW });
  roster(ctx, K, [{ studentId: 'AIBC25001', name: 'OLD', nameKana: '' }], '2025-04-01');
  const r = roster(ctx, K, [{ studentId: 'AIBC26001', name: 'A', nameKana: '' }, { studentId: 'AIBC26002', name: 'B', nameKana: '' }]);
  assert.deepEqual(r.created, ['AIBC26001', 'AIBC26002']);
  assert.deepEqual(r.codeConflicts, [{ code: 'K01', studentIds: ['AIBC25001', 'AIBC26001'] }]);
  const none = roster(ctx, '総合ビジネス科', [{ studentId: 'AIGB26001', name: 'C', nameKana: '' }]);
  assert.deepEqual(none.codeConflicts, []);
});

test('名簿の一括登録: 形が違う行は、何行目のどこが違うかを返して、1人も登録しない', () => {
  const ctx = boot({ now: NOW });
  const r = ctx.api('api_adminImportRoster', ctx.admin, { className: 'A', enrollmentDate: '2026-04-01', rows: [
    { studentId: 'AIBC26001', name: 'A', nameKana: '' },
    { studentId: 'AIBC 26002', name: 'B', nameKana: '' },
  ] });
  assert.equal(r.error, 'BAD_REQUEST');
  assert.equal(r.details.row, 2);
  assert.match(r.details.message, /2行目.*学籍番号/);
  assert.equal(studentCount(ctx), 0);
  // 全角の学籍番号は半角にそろえて登録する
  roster(ctx, 'A', [{ studentId: 'ＡＩＢＣ２６００３', name: 'C', nameKana: '' }]);
  assert.equal(detail(ctx, 'AIBC26003').studentId, 'AIBC26003');
});

// ---- 8・9・11・12 名簿の読み取り（画面の JavaScript をそのまま動かす） ----

function rosterLib() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'client_js.html'), 'utf8');
  const m = /\/\/ ==== 名簿の読み取り（ここから） ====([\s\S]*?)\/\/ ==== 名簿の読み取り（ここまで） ====/.exec(code);
  assert.ok(m, 'client_js.html に名簿の読み取りの区切りが無い');
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx);
  return { parseRoster: (t) => JSON.parse(JSON.stringify(ctx.parseRoster(t))), rosterCodeClashes: (r, c) => JSON.parse(JSON.stringify(ctx.rosterCodeClashes(r, c))) };
}

test('名簿の読み取り: 番号の列・見出しの行・空行・セル内改行のカナは読み取れる', () => {
  const { parseRoster } = rosterLib();
  const r = parseRoster('No\t学籍番号\t氏名\tカナ\n1\tTEST26001\tTARO  YAMADA\t"タロウ　\nヤマダ"\n\n2\ttest26002\tHANAKO SATO\tハナコ　サトウ\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [
    { line: 2, studentId: 'TEST26001', name: 'TARO YAMADA', nameKana: 'タロウ　ヤマダ' },
    { line: 5, studentId: 'TEST26002', name: 'HANAKO SATO', nameKana: 'ハナコ　サトウ' },
  ]);
});

test('名簿の読み取り: 読み取れない行は黙って捨てず、何行目かと理由をエラーに出す', () => {
  const { parseRoster } = rosterLib();
  const r = parseRoster('1\tTEST26001\tTARO\tタロウ\n2\t26002\tJIRO\tジロウ\n3\tTEST26003\t\t\n4\tTEST26001\tSAME\t\n');
  assert.deepEqual(r.rows.map((x) => x.studentId), ['TEST26001']);
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3, 4]);
  assert.match(r.errors[0].message, /学籍番号/);
  assert.match(r.errors[1].message, /氏名/);
  assert.match(r.errors[2].message, /重複/);
});

test('名簿の読み取り: 閉じていない " があっても、後ろの行を飲み込まない（" はそのままの文字として読む）', () => {
  const { parseRoster } = rosterLib();
  const r = parseRoster('1\tTEST26001\t"TARO\tタロウ\n2\tTEST26002\tJIRO\tジロウ\n3\tTEST26003\tSABURO\tサブロウ\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.studentId, x.name]), [['TEST26001', '"TARO'], ['TEST26002', 'JIRO'], ['TEST26003', 'SABURO']]);
  // 途中に " があるセル・"" の入ったセルも崩れない
  const r2 = parseRoster('TEST26004\tA "B" C\tエー\nTEST26005\t"D ""E"""\tディー\n');
  assert.deepEqual(r2.rows.map((x) => x.name), ['A "B" C', 'D "E"']);
  // 閉じる " がずっと後ろ（4行以上先）にあるときも、セル内改行とはみなさない
  const r3 = parseRoster('TEST26006\tF\t"カナ\nTEST26007\tG\tジー\nTEST26008\tH\tエイチ\nTEST26009\tI\tアイ\nTEST26010\tJ\t"\n');
  assert.deepEqual(r3.rows.map((x) => x.studentId), ['TEST26006', 'TEST26007', 'TEST26008', 'TEST26009', 'TEST26010']);
});

test('名簿の読み取り: 301行以上・長すぎる学籍番号や氏名はエラーにする', () => {
  const { parseRoster } = rosterLib();
  const many = Array.from({ length: 301 }, (_, i) => 'TEST' + (30000 + i) + '\tN\t').join('\n');
  const r = parseRoster(many);
  assert.ok(r.errors.some((e) => /300/.test(e.message)), JSON.stringify(r.errors.slice(0, 2)));
  const r2 = parseRoster('AB' + '1'.repeat(19) + '\tN\t\nTEST26001\t' + 'X'.repeat(101) + '\t\n');
  assert.deepEqual(r2.errors.map((e) => e.line), [1, 2]);
  assert.match(r2.errors[0].message, /20文字/);
  assert.match(r2.errors[1].message, /100文字/);
});

test('名簿の読み取り: 全角の学籍番号は半角にそろえる。同じクラスで短い番号が重なる学生を挙げる', () => {
  const { parseRoster, rosterCodeClashes } = rosterLib();
  const r = parseRoster('ＴＥＳＴ２６００１\tA\t\nTEST25001\tB\t\nTEST26002\tC\t\n');
  assert.deepEqual(r.rows.map((x) => x.studentId), ['TEST26001', 'TEST25001', 'TEST26002']);
  assert.deepEqual(rosterCodeClashes(r.rows, '国際ビジネス科'), [{ code: 'K01', studentIds: ['TEST26001', 'TEST25001'] }]);
  assert.deepEqual(rosterCodeClashes(r.rows, 'A'), []);
});
