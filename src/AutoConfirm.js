// 締切後の自動確定（2026-10-14）。
// 締切（クラスごと・月ごと）を過ぎても、その月の行が無い在籍中の学生の月を、空欄のまま「確定済」にする。
// 本人が一度も保存していない印として version を '0' にする（本人が保存した確定済は version が 1 以上）。
// 管理者の一覧には「確定済（本人未入力）」と出る。すでに行がある月（確定済・下書き・学校確定）は書き換えない。
// 何度走っても同じ月を二重に確定しない。

function autoConfirmMonths() {
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { Logger.log('BUSY: 自動確定は次の実行に回します'); return; }
    var done = 0;
    try {
      done = autoConfirm_(util_nowJst_());
    } finally {
      lock.releaseLock();
    }
    Logger.log('AUTO_CONFIRM done=' + done);
  } catch (err) {
    util_logError_(err);
  }
}

// ロックの中で呼ぶ。確定した月の数を返す。
function autoConfirm_(now) {
  var deadlines = db_readAllRows_('DEADLINES').filter(function (d) {
    return d.year_month && d['class'] && d.deadline_at && now > d.deadline_at;
  });
  if (!deadlines.length) return 0;

  var students = db_readAllRows_('STUDENTS');
  var subs = db_readAllRows_('MONTHLY_SUBMISSIONS');
  var bySub = {};
  subs.forEach(function (s) { bySub[s.student_id + '|' + s.year_month] = s; });

  var count = 0;
  deadlines.forEach(function (d) {
    var firstDay = core_buildDateStr_(d.year_month, 1);
    var lastDay = core_buildDateStr_(d.year_month, core_getDaysInMonth_(d.year_month));
    students.forEach(function (st) {
      if (st['class'] !== d['class'] || st['class'] === DEMO_CLASS_) return;
      if (st.status !== '在籍') return;
      if (st.enrollment_date && st.enrollment_date > lastDay) return;
      if ((st.withdrawal_date && st.withdrawal_date < firstDay) || (st.graduation_date && st.graduation_date < firstDay)) return;

      var key = st.student_id + '|' + d.year_month;
      var sub = bySub[key];
      if (sub && sub.status !== '未入力') return; // 入力済み・学校確定の月は書き換えない

      if (sub) {
        sub.status = '確定済';
        sub.shift_json = '{}';
        sub.version = '0';
        sub.updated_at = now;
        db_updateRow_('MONTHLY_SUBMISSIONS', sub._rowNum, sub);
      } else {
        bySub[key] = {
          submission_id: util_uuid_(),
          student_id: st.student_id,
          year_month: d.year_month,
          status: '確定済',
          shift_json: '{}',
          actual_json: '',
          actual_status: '未確認',
          total_minutes: '0',
          max_rolling7_minutes: '0',
          validation_codes: '[]',
          actual_total_minutes: '0',
          actual_max_rolling7_minutes: '0',
          actual_codes: '[]',
          version: '0',
          confirmed_at: '',
          updated_at: now,
          unlock_until: ''
        };
        db_insertRow_('MONTHLY_SUBMISSIONS', bySub[key]);
      }
      db_logAudit_('AUTO_CONFIRM', 'system', 'system', st.student_id, d.year_month, 0, {});
      count++;
    });
  });
  return count;
}
