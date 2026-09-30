// 学生の窓口

function api_getMonth(token, yearMonth) {
  try {
    var auth = auth_verifySession_(token, 'student');
    if (!auth.ok) return auth;

    if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var studentId = auth.user.student_id;
    var students = db_readAllRows_('STUDENTS');
    var student = null;
    for (var i = 0; i < students.length; i++) {
      if (students[i].student_id === studentId) {
        student = students[i];
        break;
      }
    }

    var submissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var sub = null;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].student_id === studentId && submissions[i].year_month === yearMonth) {
        sub = submissions[i];
        break;
      }
    }

    var className = student ? student.class : '';
    var deadlines = db_readAllRows_('DEADLINES');
    var dlRow = null;
    for (var i = 0; i < deadlines.length; i++) {
      if (deadlines[i].year_month === yearMonth && deadlines[i].class === className) {
        dlRow = deadlines[i];
        break;
      }
    }

    var now = util_nowJst_();
    var deadlineAt = dlRow && dlRow.deadline_at ? dlRow.deadline_at : null;
    var unlockUntil = sub && sub.unlock_until ? sub.unlock_until : null;

    var closed = false;
    if (deadlineAt && now > deadlineAt) {
      if (!unlockUntil || now > unlockUntil) {
        closed = true;
      }
    }

    var version = sub ? Number(sub.version) || 0 : 0;
    var status = sub && sub.status ? sub.status : '未入力';
    var shifts = sub && sub.shift_json ? JSON.parse(sub.shift_json) : {};

    // 祝日・長期休業日の取得
    var holidays = db_readAllRows_('SCHOOL_HOLIDAYS');
    var monthHolidays = [];
    var daysInMonth = core_getDaysInMonth_(yearMonth);
    for (var d = 1; d <= daysInMonth; d++) {
      var dStr = core_buildDateStr_(yearMonth, d);
      if (core_isHoliday_(holidays, dStr)) {
        monthHolidays.push(dStr);
      }
    }

    // 評価の計算
    var workplaces = db_readAllRows_('WORKPLACES').filter(function(w) {
      return w.student_id === studentId && w.active !== 'false';
    }).map(function(w) {
      return {
        id: w.workplace_id,
        prefecture: w.prefecture,
        baseHourlyWage: Number(w.baseHourlyWage || w.base_hourly_wage) || 0,
        earlyStart: w.early_start || null,
        earlyEnd: w.early_end || null,
        earlyPremium: w.early_premium ? Number(w.early_premium) : null,
        verificationStatus: w.verification_status || '確認中'
      };
    });

    var minimumWages = db_readAllRows_('MINIMUM_WAGES').map(function(m) {
      return {
        prefecture: m.prefecture,
        amount: Number(m.amount) || 0,
        effectiveFrom: m.effective_from,
        effectiveTo: m.effective_to || null
      };
    });

    var studentPayload = student ? {
      birthDate: student.birth_date,
      enrollmentDate: student.enrollment_date,
      withdrawalDate: student.withdrawal_date || null,
      graduationDate: student.graduation_date || null,
      status: student.status,
      workPermission: student.work_permission === 'true',
      permissionExpires: student.permission_expires || null
    } : {};

    var evaluation = evaluateMonth({
      yearMonth: yearMonth,
      mode: 'plan',
      student: studentPayload,
      workplaces: workplaces,
      shifts: shifts,
      prevMonthDaily: {},
      prevMonthSource: 'confirmed',
      nextMonthDaily: {},
      holidays: holidays,
      minimumWages: minimumWages,
      settings: {}
    });

    // 実績受付
    var nextMonthFirstDay = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1) + ' 00:00';
    var actualOpen = now >= nextMonthFirstDay;
    var actualDeadlineAt = dlRow && dlRow.actual_deadline_at ? dlRow.actual_deadline_at : null;

    var actualShifts = sub && sub.actual_json ? JSON.parse(sub.actual_json) : null;
    var actualEvaluation = actualShifts ? evaluateMonth({
      yearMonth: yearMonth,
      mode: 'actual',
      student: studentPayload,
      workplaces: workplaces,
      shifts: actualShifts,
      prevMonthDaily: {},
      prevMonthSource: 'confirmed',
      nextMonthDaily: {},
      holidays: holidays,
      minimumWages: minimumWages,
      settings: {}
    }) : null;

    return {
      ok: true,
      data: {
        yearMonth: yearMonth,
        status: status,
        closed: closed,
        deadlineAt: deadlineAt,
        unlockUntil: unlockUntil,
        version: version,
        shifts: shifts,
        evaluation: evaluation,
        holidays: monthHolidays,
        actual: {
          status: sub && sub.actual_status ? sub.actual_status : '未確認',
          shifts: actualShifts,
          evaluation: actualEvaluation,
          open: actualOpen,
          deadlineAt: actualDeadlineAt
        }
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

// 段階2でのスタブ入口
function api_saveDraft(token, yearMonth, shifts, expectedVersion) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_confirm(token, yearMonth, shifts, expectedVersion) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_saveActual(token, yearMonth, shifts, expectedVersion) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_confirmActual(token, yearMonth, expectedVersion) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_getHistory(token) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_saveWorkplace(token, workplace) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_listWorkplaces(token) {
  var auth = auth_verifySession_(token, 'student');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}
