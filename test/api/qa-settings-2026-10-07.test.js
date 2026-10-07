'use strict';
// 点検（2026-10-07）: 長期休業・その他 設定・保存期限の削除・バックアップ・マニュアルのシート。
// 番号は点検の指摘の番号と同じ。

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ok, world, sh, everyDay } = require('../helpers/api');

const YM = '2026-10';

// ---- 1. 長期休業を消したり変えたりしたら、実績の注意も計算し直す ----

// 10/10〜16 に毎日5時間（7日で35時間）。10月まるごと長期休業なら 28時間の対象外で、消すと実績超過になる。
function actualWorld() {
  const w = world();
  ok(w.api('api_adminSetHoliday', w.admin, { name: '秋季休業', startDate: '2026-10-01', endDate: '2026-10-31', schoolYear: 2026 }));
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  ok(w.api('api_saveActual', w.st.token, YM, everyDay(10, 16, sh('09:00', '14:00')), m.version));
  return w;
}
const boardRow = (w) => ok(w.api('api_adminBoard', w.admin, YM, {})).rows.find((r) => r.studentId === w.st.studentId);
const detailMonth = (w) => ok(w.api('api_adminStudentDetail', w.admin, w.st.studentId)).months.find((m) => m.yearMonth === YM);

test('1: 長期休業を消すと、管理一覧の実績超過と学生詳細の実績の注意が、いまの長期休業で計算し直される', () => {
  const w = actualWorld();
  assert.equal(boardRow(w).actualOver, false);
  assert.equal(detailMonth(w).actualCodes.includes('OVER_28H'), false);
  const hol = ok(w.api('api_adminListHolidays', w.admin))[0];
  ok(w.api('api_adminDeleteHoliday', w.admin, hol.holidayId));
  assert.equal(boardRow(w).actualOver, true);
  const codes = detailMonth(w).actualCodes;
  assert.ok(codes.includes('OVER_28H'), JSON.stringify(codes));
  assert.ok(codes.includes('ACTUAL_OVER'), JSON.stringify(codes));
});

test('1: 長期休業を後から足すと、保存時に出ていた実績超過が消える', () => {
  const w = world();
  w.at('2026-11-02 10:00');
  const m = ok(w.api('api_getMonth', w.st.token, YM));
  ok(w.api('api_saveActual', w.st.token, YM, everyDay(10, 16, sh('09:00', '14:00')), m.version));
  assert.equal(boardRow(w).actualOver, true);
  ok(w.api('api_adminSetHoliday', w.admin, { name: '秋季休業', startDate: '2026-10-01', endDate: '2026-10-31', schoolYear: 2026 }));
  assert.equal(boardRow(w).actualOver, false);
  assert.deepEqual(detailMonth(w).actualCodes.filter((c) => c === 'OVER_28H' || c === 'ACTUAL_OVER'), []);
});

test('1: 実績の無い月の実績の注意は空', () => {
  const w = world();
  ok(w.api('api_saveDraft', w.st.token, YM, { '1': [sh('09:00', '12:00')] }, 0));
  assert.deepEqual(detailMonth(w).actualCodes, []);
  assert.equal(boardRow(w).actualOver, false);
});

// ---- 2. 長期休業の編集: 知らない holidayId は新しく作らず NOT_FOUND ----

test('2: holidayId を付けると、その長期休業を書き換える（行は増えない）', () => {
  const w = world();
  const id = ok(w.api('api_adminSetHoliday', w.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 })).holidayId;
  ok(w.api('api_adminSetHoliday', w.admin, { holidayId: id, name: '冬休み', startDate: '2026-12-20', endDate: '2027-01-05', schoolYear: 2026 }));
  assert.deepEqual(ok(w.api('api_adminListHolidays', w.admin)),
    [{ holidayId: id, name: '冬休み', startDate: '2026-12-20', endDate: '2027-01-05', schoolYear: 2026 }]);
});

test('2: 知らない holidayId の編集は NOT_FOUND で、新しい行を作らない', () => {
  const w = world();
  const r = w.api('api_adminSetHoliday', w.admin, { holidayId: 'HOL_nothere', name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 });
  assert.equal(r.error, 'NOT_FOUND');
  assert.deepEqual(ok(w.api('api_adminListHolidays', w.admin)), []);
});

// ---- 7. 長期休業の一覧は開始日の順 ----

test('7: 長期休業の一覧は、登録した順でなく開始日の順に並ぶ', () => {
  const w = world();
  ok(w.api('api_adminSetHoliday', w.admin, { name: '冬季休業', startDate: '2026-12-24', endDate: '2027-01-07', schoolYear: 2026 }));
  ok(w.api('api_adminSetHoliday', w.admin, { name: '夏季休業', startDate: '2026-08-01', endDate: '2026-08-31', schoolYear: 2026 }));
  ok(w.api('api_adminSetHoliday', w.admin, { name: '春季休業', startDate: '2027-03-10', endDate: '2027-03-31', schoolYear: 2026 }));
  assert.deepEqual(ok(w.api('api_adminListHolidays', w.admin)).map((h) => h.name), ['夏季休業', '冬季休業', '春季休業']);
});

// ---- 8. 保存期限の削除: 確認で見せた保存期間と違えば消さない ----

function purgeWorld() {
  const w = boot({ now: '2024-08-01 10:00' });
  for (const [ym, at] of [['2024-09', '2024-08-31 23:59'], ['2024-10', '2024-09-30 23:59'], ['2024-11', '2024-10-31 23:59']]) {
    ok(w.api('api_adminSetDeadline', w.admin, { yearMonth: ym, className: 'A', deadlineAt: at, actualDeadlineAt: null }));
  }
  const { addStudent } = require('../helpers/api');
  const st = addStudent(w);
  for (const ym of ['2024-09', '2024-10', '2024-11']) ok(w.api('api_saveDraft', st.token, ym, {}, 0));
  w.at('2026-10-05 10:00'); // 24か月なら 2024-10 より前（2024-09）だけが消える
  return Object.assign(w, { st });
}
const months = (w) => ok(w.api('api_getHistory', w.st.token)).map((x) => x.yearMonth).sort();

test('8: preview は消さずに、保存期間・どの月より前を消すか・件数を返す', () => {
  const w = purgeWorld();
  const p = ok(w.api('api_adminPurgeExpired', w.admin, { preview: true }));
  assert.deepEqual(p, { retentionMonths: 24, cutoffYm: '2024-10', count: 1 });
  assert.deepEqual(months(w), ['2024-09', '2024-10', '2024-11']);
});

test('8: 確認の後に保存期間が変わっていたら、消さずに SETTINGS_CHANGED で断る', () => {
  const w = purgeWorld();
  const p = ok(w.api('api_adminPurgeExpired', w.admin, { preview: true }));
  ok(w.api('api_adminSetSettings', w.admin, { retentionMonths: 25 })); // 別の画面で変えた
  const r = w.api('api_adminPurgeExpired', w.admin, { retentionMonths: p.retentionMonths, cutoffYm: p.cutoffYm });
  assert.equal(r.ok, false);
  assert.equal(r.details && r.details.reason, 'SETTINGS_CHANGED');
  assert.deepEqual(months(w), ['2024-09', '2024-10', '2024-11']);
  // 境目の月が違っても断る（確認の後に月が変わった）
  const r2 = w.api('api_adminPurgeExpired', w.admin, { retentionMonths: 25, cutoffYm: '2024-11' });
  assert.equal(r2.details && r2.details.reason, 'SETTINGS_CHANGED');
  assert.deepEqual(months(w), ['2024-09', '2024-10', '2024-11']);
});

test('8: 確認で見せた保存期間と境目が今と同じなら消す', () => {
  const w = purgeWorld();
  const p = ok(w.api('api_adminPurgeExpired', w.admin, { preview: true }));
  const r = ok(w.api('api_adminPurgeExpired', w.admin, { retentionMonths: p.retentionMonths, cutoffYm: p.cutoffYm }));
  assert.equal(r.deletedRows, 1);
  assert.deepEqual(months(w), ['2024-10', '2024-11']);
});

test('8: 保存期間が数字でないなどの形違いは BAD_REQUEST で、何も消さない', () => {
  const w = purgeWorld();
  assert.equal(w.api('api_adminPurgeExpired', w.admin, { retentionMonths: '24', cutoffYm: '2024-10' }).error, 'BAD_REQUEST');
  assert.equal(w.api('api_adminPurgeExpired', w.admin, { retentionMonths: 24, cutoffYm: '2024/10' }).error, 'BAD_REQUEST');
  assert.deepEqual(months(w), ['2024-09', '2024-10', '2024-11']);
});

// ---- 9・10. その他 設定: 送った項目だけ書き換える・どの項目が悪いかを返す ----

test('9: 送った項目だけを書き換え、ほかの項目（別の画面で変えたもの）は戻さない', () => {
  const ctx = boot();
  ok(ctx.api('api_adminSetSettings', ctx.admin, { sessionTtlMinutes: 30 })); // 別の画面
  ok(ctx.api('api_adminSetSettings', ctx.admin, { retentionMonths: 36 })); // 古い画面からは変えた項目だけ
  const s = ok(ctx.api('api_adminGetSettings', ctx.admin));
  assert.equal(s.sessionTtlMinutes, 30);
  assert.equal(s.retentionMonths, 36);
  ok(ctx.api('api_adminSetSettings', ctx.admin, {})); // 何も変えていなければ何もしない
  assert.equal(ok(ctx.api('api_adminGetSettings', ctx.admin)).sessionTtlMinutes, 30);
});

test('10: 範囲外の設定は BAD_REQUEST で、どの項目かを details.field で返す', () => {
  const ctx = boot();
  const r = ctx.api('api_adminSetSettings', ctx.admin, { retentionMonths: 36, sessionTtlMinutes: 1 });
  assert.equal(r.error, 'BAD_REQUEST');
  assert.equal(r.details && r.details.field, 'sessionTtlMinutes');
  assert.equal(ok(ctx.api('api_adminGetSettings', ctx.admin)).retentionMonths, 24); // 1つでも悪ければ何も変えない
});

// ---- 12. バックアップ: 片方の写しが失敗しても、開くたびに写しを作らない ----

function failAudit(w) {
  const drive = w.app.context.DriveApp;
  const auditId = w.env.properties.get('AUDIT_LOG_ID');
  const orig = drive.getFileById;
  drive.getFileById = (id) => {
    if (id === auditId) return { makeCopy() { throw new Error('quota'); } };
    return orig.call(drive, id);
  };
  return () => { drive.getFileById = orig; };
}
const copyNames = (w) => w.env.drive.copies.map((c) => c.name).sort();

test('12: AuditLog の写しが失敗しても、同じ日に何度開いても ShiftDB の写しは1つだけ。翌日に1回だけやり直し、足りない方だけ写す', () => {
  const w = world();
  const restore = failAudit(w);
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.deepEqual(copyNames(w), ['ShiftDB_2026-09']);
  const b = ok(w.api('api_adminBoard', w.admin, YM, {})).backup;
  assert.equal(b.warn, true);
  assert.equal(b.reason, 'NEVER');
  assert.ok(w.env.properties.get('LAST_BACKUP_ATTEMPT_AT'), '試した日時を残す');
  // 翌日: まだ失敗する → 1回だけ試す（ShiftDB は今月分があるので写さない）
  w.at('2026-09-02 10:00');
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.deepEqual(copyNames(w), ['ShiftDB_2026-09']);
  // 翌々日: 直った → AuditLog だけ写して、バックアップ済みになる
  restore();
  w.at('2026-09-03 10:00');
  const b2 = ok(w.api('api_adminBoard', w.admin, YM, {})).backup;
  assert.deepEqual(copyNames(w), ['AuditLog_2026-09', 'ShiftDB_2026-09']);
  assert.equal(b2.warn, false);
  assert.equal(b2.reason, null);
  ok(w.api('api_adminBoard', w.admin, YM, {}));
  assert.equal(w.env.drive.copies.length, 2);
});

test('12: 毎月の自動実行でも、今月すでに写したファイルは写し直さない', () => {
  const w = world();
  const restore = failAudit(w);
  const backupMonthly = w.app.get('backupMonthly');
  ok(w.api('api_adminBoard', w.admin, YM, {})); // 保存先を用意し、ShiftDB だけ写せた
  restore();
  backupMonthly();
  assert.deepEqual(copyNames(w), ['AuditLog_2026-09', 'ShiftDB_2026-09']);
  backupMonthly();
  assert.equal(w.env.drive.copies.length, 2);
});

// ---- 13. バックアップの注意: 理由を分ける ----

test('13: バックアップの状態に理由（NO_FOLDER・NEVER・BAD_DATE・OLD）が入り、壊れた日時・未来の日時も注意にする', () => {
  const w = world();
  w.env.drive.driveFail = true;
  const backup = () => ok(w.api('api_adminBoard', w.admin, YM, {})).backup;
  assert.equal(backup().reason, 'NO_FOLDER');
  w.env.properties.set('BACKUP_FOLDER_ID', 'folder-1');
  w.env.properties.set('BACKUP_TRIGGER_OK', 'true');
  assert.equal(backup().reason, 'NEVER');
  w.env.properties.set('LAST_BACKUP_AT', 'こわれた');
  assert.deepEqual([backup().warn, backup().reason], [true, 'BAD_DATE']);
  w.env.properties.set('LAST_BACKUP_AT', '2026-13-45 03:00');
  assert.deepEqual([backup().warn, backup().reason], [true, 'BAD_DATE']);
  w.env.properties.set('LAST_BACKUP_AT', '2027-01-01 03:00'); // 未来
  assert.deepEqual([backup().warn, backup().reason], [true, 'BAD_DATE']);
  w.env.properties.set('LAST_BACKUP_AT', '2026-07-01 03:00');
  assert.deepEqual([backup().warn, backup().reason], [true, 'OLD']);
  w.env.properties.set('LAST_BACKUP_AT', '2026-08-31 03:00');
  assert.deepEqual([backup().warn, backup().reason], [false, null]);
});

// ---- 14. マニュアルと ChatGPT 用の文章に CLASSES のシート ----

test('14: マニュアルと ChatGPT 用の文章に CLASSES（クラス）のシートが書いてあり、版が上がっている', () => {
  const ctx = boot();
  ok(ctx.api('api_adminBoard', ctx.admin, YM, {}));
  const ss = ctx.env.spreadsheets.get(ctx.env.properties.get('SHIFT_DB_ID'));
  const text = (name) => { const s = ss.getSheetByName(name); return s.getRange(1, 1, s.getLastRow(), 1).getValues().map((r) => r[0]).join('\n'); };
  assert.match(text('マニュアル'), /CLASSES（クラス）/);
  assert.match(text('困ったとき（ChatGPT用）'), /CLASSES/);
  assert.notEqual(ctx.app.get('MANUAL_VERSION_'), '2026-10-06b');
  // バックアップの注意の直し方がマニュアルにある（画面の注意から案内する）
  assert.match(text('マニュアル'), /バックアップの赤い注意/);
  assert.match(text('マニュアル'), /まだ一度もバックアップできていません/);
  assert.match(text('マニュアル'), /保存先が未設定です/);
});
