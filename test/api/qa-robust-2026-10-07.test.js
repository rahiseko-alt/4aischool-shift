'use strict';
// 2026-10-07 の点検（管理画面の一覧・生徒モード）で見つけた不具合の確認。
// - 一覧の検索: 学籍番号の前方一致は大文字小文字を区別しない。全角・半角とスペースをそろえ、カナ（name_kana）でも探せる
// - 生徒モードの試用データ作り: スクリプトのロックを持ったまま書く（同時に2回押されても行が重ならない）

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok } = require('../helpers/api');

function withRoster() {
  const ctx = boot({ now: '2026-10-01 10:00' });
  ok(ctx.api('api_adminAddClass', ctx.admin, 'A'));
  ok(ctx.api('api_adminImportRoster', ctx.admin, {
    className: 'A', enrollmentDate: '2026-04-01',
    rows: [
      { studentId: 'AIBC26001', name: 'ADHIKARI GOMA DEVI', nameKana: 'アディカリ　ゴマ　デヴィ' },
      { studentId: 'AIBC26002', name: 'TARO YAMADA', nameKana: 'ヤマダ タロウ' },
      { studentId: 'SBC26003', name: 'グエン・ティ・ラン', nameKana: '' },
    ],
  }));
  const search = (q) => ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { query: q })).rows.map((r) => r.studentId);
  return { ctx, search };
}

test('一覧の検索: 学籍番号の前方一致は大文字・小文字を区別しない', () => {
  const { search } = withRoster();
  assert.deepEqual(search('aibc26001'), ['AIBC26001']);
  assert.deepEqual(search('Aibc260'), ['AIBC26001', 'AIBC26002']);
  assert.deepEqual(search('26001'), [], '学籍番号は前方一致だけ');
});

test('一覧の検索: 全角の英数字・前後と途中のスペースをそろえて探す', () => {
  const { search } = withRoster();
  assert.deepEqual(search('ＡＩＢＣ２６００２'), ['AIBC26002']);
  assert.deepEqual(search('  aibc26002  '), ['AIBC26002']);
  assert.deepEqual(search('adhikari   goma'), ['AIBC26001'], '氏名も大文字小文字・スペースの数を区別しない');
  assert.deepEqual(search('ｇｒｏｕｐ'), []);
});

test('一覧の検索: カナでも探せる（半角カナ・ひらがな・全角スペースも同じに扱う）', () => {
  const { search } = withRoster();
  assert.deepEqual(search('アディカリ'), ['AIBC26001']);
  assert.deepEqual(search('ｱﾃﾞｨｶﾘ'), ['AIBC26001']);
  assert.deepEqual(search('あでぃかり　ごま'), ['AIBC26001']);
  assert.deepEqual(search('ヤマダ　タロウ'), ['AIBC26002']);
  assert.deepEqual(search('ラン'), ['SBC26003'], '氏名（カタカナ）も今までどおり部分一致');
});

test('一覧の検索: 絞り込みは件数の札には効かない（今までどおり）', () => {
  const { ctx } = withRoster();
  const data = ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { query: 'yamada' }));
  assert.deepEqual(data.rows.map((r) => r.studentId), ['AIBC26002']);
  assert.equal(data.counts.students, 3);
});

// 書き込みのたびに、そのときロックを持っていたかを記録する
function recordLockOnWrites(ctx) {
  const seen = [];
  const c = ctx.app.context;
  for (const fn of ['db_insertRow_', 'db_insertRows_', 'db_updateRow_']) {
    const orig = c[fn];
    c[fn] = function (sheetName) {
      if (['STUDENTS', 'USERS', 'MONTHLY_SUBMISSIONS', 'DEADLINES'].includes(sheetName)) seen.push([fn, sheetName, ctx.env.lockHeld]);
      return orig.apply(this, arguments);
    };
  }
  return seen;
}

test('生徒モード: 試用データ（生徒A・見本の10人・3か月分）は、ロックを持ったまま書く', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const seen = recordLockOnWrites(ctx);
  ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  assert.ok(seen.some((x) => x[1] === 'MONTHLY_SUBMISSIONS'), '見本の申告が書かれていない');
  assert.ok(seen.some((x) => x[1] === 'STUDENTS'), '学生が書かれていない');
  const unlocked = seen.filter((x) => !x[2]);
  assert.deepEqual(unlocked, [], 'ロックの外で書いた: ' + JSON.stringify(unlocked));
  assert.equal(ctx.env.lockHeld, false, '終わったらロックを放す');
});

test('生徒モード: 試用データを作るときにロックが取れなければ BUSY で、何も書かない。あとで押せば1回分だけ入る', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  const students = () => ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { className: 'DEMO' })).rows.length;
  ctx.env.setLockBusy(true);
  assert.equal(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A').error, 'BUSY');
  ctx.env.setLockBusy(false);
  assert.equal(students(), 0, 'BUSY なのに学生が入った');
  const r = ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  assert.equal(r.newStudents.length, 1);
  assert.equal(students(), 11);
  ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  assert.equal(students(), 11);
  const subs = ok(ctx.api('api_adminBoard', ctx.admin, '2026-09', { className: 'DEMO' })).rows.filter((x) => x.displayStatus !== '未提出').length;
  assert.ok(subs >= 8);
});

test('生徒モード: ロックを取ったあとで読み直す（先に別の画面が作り終えていたら、作り直さない）', () => {
  const ctx = boot({ now: '2026-10-01 10:00' });
  // ロックを取る直前に、別の画面が試用データを作り終えた状態をまねる
  const lock = ctx.env.globals.LockService.getScriptLock();
  const origTry = lock.tryLock;
  let raced = false;
  lock.tryLock = function () {
    if (!raced) {
      raced = true;
      lock.tryLock = origTry;
      const other = ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A');
      assert.equal(other.ok, true);
    }
    return origTry.apply(this, arguments);
  };
  const r = ok(ctx.api('api_adminActAsDemoStudent', ctx.admin, 'DEMO-A'));
  lock.tryLock = origTry;
  assert.ok(raced);
  assert.equal(r.newStudents.length, 0, '先に作られていたのに、もう一度作った');
  const rows = ok(ctx.api('api_adminBoard', ctx.admin, '2026-10', { className: 'DEMO' })).rows;
  assert.equal(rows.length, 11);
  const ids = rows.map((x) => x.studentId);
  assert.equal(new Set(ids).size, ids.length);
  // 見本の申告も1回分だけ（学生詳細の月が重ならない）
  const d = ok(ctx.api('api_adminStudentDetail', ctx.admin, 'DEMO-01'));
  const yms = d.months.map((m) => m.yearMonth);
  assert.equal(new Set(yms).size, yms.length, '見本の申告が重なった: ' + yms);
});
