// 学生の窓口

// 学校設定の項目と、受け付ける値の範囲。ここに無い項目は読みも書きもしない。
var SETTINGS_RULES_ = {
  schoolName: { type: 'string', max: 100 },
  retentionMonths: { type: 'int', min: 24, max: 120 },
  sessionTtlMinutes: { type: 'int', min: 5, max: 720 },
  allowLeaveOfAbsence: { type: 'bool' },
  actualConfirmDefaultDay: { type: 'int', min: 1, max: 28 }
};
var SETTINGS_DEFAULTS_ = {
  schoolName: '', retentionMonths: 24, sessionTtlMinutes: 120,
  allowLeaveOfAbsence: false, actualConfirmDefaultDay: 10
};

function settings_isValid_(key, value) {
  var rule = SETTINGS_RULES_[key];
  if (!rule) return false;
  if (rule.type === 'string') return typeof value === 'string' && value.length <= rule.max;
  if (rule.type === 'bool') return typeof value === 'boolean';
  return typeof value === 'number' && Math.floor(value) === value && value >= rule.min && value <= rule.max;
}

function student_getSettings_() {
  var rows = db_readAllRows_('SETTINGS');
  var map = { timezone: 'Asia/Tokyo' };
  for (var k in SETTINGS_DEFAULTS_) map[k] = SETTINGS_DEFAULTS_[k];
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i].key;
    var rule = SETTINGS_RULES_[key];
    if (!rule) continue;
    var raw = rows[i].value;
    var v = rule.type === 'int' ? Number(raw) : rule.type === 'bool' ? raw === 'true' : raw;
    if (settings_isValid_(key, v)) map[key] = v;
  }
  return map;
}

// shifts のバリデーション
function student_validateShiftsFormat_(shifts, yearMonth) {
  if (!shifts || typeof shifts !== 'object' || Array.isArray(shifts)) return false;
  var daysInMonth = core_getDaysInMonth_(yearMonth);
  for (var dayStr in shifts) {
    if (!Object.prototype.hasOwnProperty.call(shifts, dayStr)) continue;
    if (!/^[1-9]\d*$/.test(dayStr)) return false;
    var dayNum = Number(dayStr);
    if (dayNum < 1 || dayNum > daysInMonth) return false;
    var list = shifts[dayStr];
    if (!Array.isArray(list)) return false;
    if (list.length > 10) return false; // 1日11件以上は不可
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    }
  }
  return true;
}

// 保存用に { start, end } だけに整え、空の日を消す (それ以外の項目は捨てる)
function student_cleanShifts_(shifts) {
  var clean = {};
  for (var dayStr in shifts) {
    if (!Object.prototype.hasOwnProperty.call(shifts, dayStr)) continue;
    var list = shifts[dayStr];
    if (!Array.isArray(list) || list.length === 0) continue;
    var cleanList = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      cleanList.push({
        start: s.start !== undefined ? String(s.start) : '',
        end: s.end !== undefined ? String(s.end) : ''
      });
    }
    if (cleanList.length > 0) {
      clean[dayStr] = cleanList;
    }
  }
  return clean;
}

function student_getAdjacentMonthData_(student, targetYm, isPrev) {
  var parts = targetYm.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var adjDate = isPrev ? new Date(Date.UTC(y, m - 2, 1)) : new Date(Date.UTC(y, m, 1));
  var adjYm = adjDate.getUTCFullYear() + '-' + String(adjDate.getUTCMonth() + 1).padStart(2, '0');

  if (isPrev) {
    // 1. 前月の末日が入学日より前 → not_applicable
    var prevDays = core_getDaysInMonth_(adjYm);
    var prevLastDay = core_buildDateStr_(adjYm, prevDays);
    if (student.enrollment_date && prevLastDay < student.enrollment_date) {
      return { source: 'not_applicable', daily: {} };
    }
  }

  var subs = db_readAllRows_('MONTHLY_SUBMISSIONS');
  var adjSub = null;
  for (var i = 0; i < subs.length; i++) {
    if (subs[i].student_id === student.student_id && subs[i].year_month === adjYm) {
      adjSub = subs[i];
      break;
    }
  }

  if (isPrev) {
    // 2. 前月が学校確定 → not_applicable
    if (adjSub && adjSub.status === '学校確定') {
      return { source: 'not_applicable', daily: {} };
    }
  }

  // 3. 実績が「予定どおり」か「修正あり」
  if (adjSub && (adjSub.actual_status === '予定どおり' || adjSub.actual_status === '修正あり')) {
    var aShifts = adjSub.actual_json ? JSON.parse(adjSub.actual_json) : {};
    var aEval = evaluateMonth({
      yearMonth: adjYm,
      mode: 'actual',
      student: {},
      shifts: aShifts,
      prevMonthDaily: {},
      prevMonthSource: 'confirmed',
      nextMonthDaily: {},
      holidays: [],
      settings: {}
    });
    return { source: 'actual', daily: aEval.daily };
  }

  // 4. 予定が確定済み
  if (adjSub && adjSub.status === '確定済') {
    var pShifts = adjSub.shift_json ? JSON.parse(adjSub.shift_json) : {};
    var pEval = evaluateMonth({
      yearMonth: adjYm,
      mode: 'plan',
      student: {},
      shifts: pShifts,
      prevMonthDaily: {},
      prevMonthSource: 'confirmed',
      nextMonthDaily: {},
      holidays: [],
      settings: {}
    });
    return { source: 'confirmed', daily: pEval.daily };
  }

  // 5. それ以外
  return { source: 'none', daily: {} };
}

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
    if (!student) return { ok: false, error: 'NOT_FOUND' };

    var submissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var sub = null;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].student_id === studentId && submissions[i].year_month === yearMonth) {
        sub = submissions[i];
        break;
      }
    }

    var className = student.class;
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

    var holidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function(h) {
      return { startDate: h.start_date, endDate: h.end_date };
    });
    var monthHolidays = [];
    var daysInMonth = core_getDaysInMonth_(yearMonth);
    for (var d = 1; d <= daysInMonth; d++) {
      var dStr = core_buildDateStr_(yearMonth, d);
      if (core_isHoliday_(holidays, dStr)) {
        monthHolidays.push(dStr);
      }
    }

    var studentPayload = {
      birthDate: student.birth_date,
      enrollmentDate: student.enrollment_date,
      withdrawalDate: student.withdrawal_date || null,
      graduationDate: student.graduation_date || null,
      status: student.status,
      workPermission: student.work_permission === 'true',
      permissionExpires: student.permission_expires || null
    };

    var settings = student_getSettings_();
    var prevData = student_getAdjacentMonthData_(student, yearMonth, true);
    var nextData = student_getAdjacentMonthData_(student, yearMonth, false);

    var evaluation = evaluateMonth({
      yearMonth: yearMonth,
      mode: 'plan',
      student: studentPayload,
      shifts: shifts,
      prevMonthDaily: prevData.daily,
      prevMonthSource: prevData.source,
      nextMonthDaily: nextData.daily,
      holidays: holidays,
      settings: settings
    });

    var nextMonthFirstDay = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1) + ' 00:00';
    var actualOpen = now >= nextMonthFirstDay;
    var actualDeadlineAt = null;
    if (dlRow && dlRow.actual_deadline_at) {
      actualDeadlineAt = dlRow.actual_deadline_at;
    } else {
      var nextYmParts = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1).slice(0, 7);
      actualDeadlineAt = core_buildDateStr_(nextYmParts, settings.actualConfirmDefaultDay) + ' 23:59';
    }

    if (now > actualDeadlineAt) {
      if (!unlockUntil || now > unlockUntil) {
        actualOpen = false;
      }
    }

    var actualShifts = sub && sub.actual_json ? JSON.parse(sub.actual_json) : null;
    var actualEvaluation = actualShifts ? evaluateMonth({
      yearMonth: yearMonth,
      mode: 'actual',
      student: studentPayload,
      shifts: actualShifts,
      prevMonthDaily: prevData.daily,
      prevMonthSource: prevData.source,
      nextMonthDaily: nextData.daily,
      holidays: holidays,
      settings: settings
    }) : null;

    return {
      ok: true,
      data: {
        yearMonth: yearMonth,
        student: { studentId: student.student_id, name: student.name },
        status: status,
        closed: closed,
        deadlineAt: deadlineAt,
        unlockUntil: unlockUntil,
        version: version,
        shifts: shifts,
        evaluation: evaluation,
        holidays: monthHolidays,
        publicHolidays: util_jpHolidaysOfMonth_(yearMonth),
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

function api_saveDraft(token, yearMonth, shifts, expectedVersion) {
  return student_saveSubmission_(token, yearMonth, shifts, expectedVersion, 'draft');
}

function api_confirm(token, yearMonth, shifts, expectedVersion) {
  return student_saveSubmission_(token, yearMonth, shifts, expectedVersion, 'confirm');
}

function student_saveSubmission_(token, yearMonth, shifts, expectedVersion, actionType) {
  try {
    // 1. トークン
    var auth = auth_verifySession_(token, 'student');
    if (!auth.ok) return auth;

    // 2. 引数の形
    if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (typeof expectedVersion !== 'number' || expectedVersion < 0 || expectedVersion % 1 !== 0) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (!student_validateShiftsFormat_(shifts, yearMonth)) {
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
    if (!student) return { ok: false, error: 'NOT_FOUND' };

    var submissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var sub = null;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].student_id === studentId && submissions[i].year_month === yearMonth) {
        sub = submissions[i];
        break;
      }
    }

    // 3. その月が学校確定済み
    if (sub && sub.status === '学校確定') {
      return { ok: false, error: 'FORBIDDEN' };
    }

    // 4. 受付期間
    var className = student.class;
    var deadlines = db_readAllRows_('DEADLINES');
    var dlRow = null;
    for (var i = 0; i < deadlines.length; i++) {
      if (deadlines[i].year_month === yearMonth && deadlines[i].class === className) {
        dlRow = deadlines[i];
        break;
      }
    }
    if (!dlRow) return { ok: false, error: 'NOT_OPEN' };

    var now = util_nowJst_();
    var unlockUntil = sub && sub.unlock_until ? sub.unlock_until : null;
    if (dlRow.deadline_at && now > dlRow.deadline_at) {
      if (!unlockUntil || now > unlockUntil) {
        return { ok: false, error: 'DEADLINE_PASSED' };
      }
    }

    // 5. 検算 (ロックの外)
    var holidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function(h) {
      return { startDate: h.start_date, endDate: h.end_date };
    });

    var settings = student_getSettings_();
    var prevData = student_getAdjacentMonthData_(student, yearMonth, true);
    var nextData = student_getAdjacentMonthData_(student, yearMonth, false);

    var studentPayload = {
      birthDate: student.birth_date,
      enrollmentDate: student.enrollment_date,
      withdrawalDate: student.withdrawal_date || null,
      graduationDate: student.graduation_date || null,
      status: student.status,
      workPermission: student.work_permission === 'true',
      permissionExpires: student.permission_expires || null
    };

    var cleanedShifts = student_cleanShifts_(shifts);

    var evalResult = evaluateMonth({
      yearMonth: yearMonth,
      mode: 'plan',
      student: studentPayload,
      shifts: cleanedShifts,
      prevMonthDaily: prevData.daily,
      prevMonthSource: prevData.source,
      nextMonthDaily: nextData.daily,
      holidays: holidays,
      settings: settings
    });

    if (evalResult.inputErrors && evalResult.inputErrors.length > 0) {
      return {
        ok: false,
        error: 'VALIDATION_FAILED',
        details: { inputErrors: evalResult.inputErrors, codes: [] }
      };
    }

    if (actionType === 'confirm') {
      var blockingCodes = evalResult.codes.filter(function(c) { return c.severity === 'block'; });
      if (blockingCodes.length > 0) {
        return {
          ok: false,
          error: 'VALIDATION_FAILED',
          details: { inputErrors: [], codes: blockingCodes }
        };
      }
    }

    // 6. ロック
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      // 対象行の再読み込み
      var freshSubs = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var freshSub = null;
      for (var i = 0; i < freshSubs.length; i++) {
        if (freshSubs[i].student_id === studentId && freshSubs[i].year_month === yearMonth) {
          freshSub = freshSubs[i];
          break;
        }
      }

      var currentVersion = freshSub ? Number(freshSub.version) || 0 : 0;
      // 7. version 照合
      if (currentVersion !== expectedVersion) {
        return { ok: false, error: 'VERSION_CONFLICT' };
      }

      var newVersion = currentVersion + 1;
      var newStatus = (actionType === 'confirm') ? '確定済' : '下書き';
      var shiftJson = JSON.stringify(cleanedShifts);
      var valCodesJson = JSON.stringify(evalResult.codes.filter(function(c) { return c.severity === 'block'; }).map(function(c) { return c.code; }));

      if (freshSub) {
        freshSub.status = newStatus;
        freshSub.shift_json = shiftJson;
        freshSub.total_minutes = String(evalResult.totalMinutes);
        freshSub.max_rolling7_minutes = String(evalResult.maxRolling7Minutes);
        freshSub.validation_codes = valCodesJson;
        freshSub.version = String(newVersion);
        freshSub.updated_at = now;
        if (actionType === 'confirm') freshSub.confirmed_at = now;
        db_updateRow_('MONTHLY_SUBMISSIONS', freshSub._rowNum, freshSub);
      } else {
        var newSub = {
          submission_id: util_uuid_(),
          student_id: studentId,
          year_month: yearMonth,
          status: newStatus,
          shift_json: shiftJson,
          actual_json: '',
          actual_status: '未確認',
          total_minutes: String(evalResult.totalMinutes),
          max_rolling7_minutes: String(evalResult.maxRolling7Minutes),
          validation_codes: valCodesJson,
          actual_total_minutes: '0',
          actual_max_rolling7_minutes: '0',
          actual_codes: '[]',
          version: String(newVersion),
          confirmed_at: (actionType === 'confirm') ? now : '',
          updated_at: now,
          unlock_until: ''
        };
        db_insertRow_('MONTHLY_SUBMISSIONS', newSub);
      }

      // 8. 監査ログ
      var auditAction = (actionType === 'confirm') ? 'CONFIRM' : 'SAVE_DRAFT';
      db_logAudit_(auditAction, auth.user.login_id, 'student', studentId, yearMonth, newVersion, {});

      return {
        ok: true,
        data: {
          version: newVersion,
          status: newStatus,
          evaluation: evalResult
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_saveActual(token, yearMonth, shifts, expectedVersion) {
  try {
    var auth = auth_verifySession_(token, 'student');
    if (!auth.ok) return auth;

    if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (typeof expectedVersion !== 'number' || expectedVersion < 0 || expectedVersion % 1 !== 0) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (!student_validateShiftsFormat_(shifts, yearMonth)) {
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
    if (!student) return { ok: false, error: 'NOT_FOUND' };

    var submissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var sub = null;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].student_id === studentId && submissions[i].year_month === yearMonth) {
        sub = submissions[i];
        break;
      }
    }

    if (sub && sub.status === '学校確定') {
      return { ok: false, error: 'FORBIDDEN' };
    }

    var className = student.class;
    var deadlines = db_readAllRows_('DEADLINES');
    var dlRow = null;
    for (var i = 0; i < deadlines.length; i++) {
      if (deadlines[i].year_month === yearMonth && deadlines[i].class === className) {
        dlRow = deadlines[i];
        break;
      }
    }
    if (!dlRow) return { ok: false, error: 'NOT_OPEN' };

    var now = util_nowJst_();
    var daysInMonth = core_getDaysInMonth_(yearMonth);
    var nextMonthFirstDay = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1) + ' 00:00';
    if (now < nextMonthFirstDay) {
      return { ok: false, error: 'NOT_OPEN' };
    }

    var settings = student_getSettings_();
    var actualDeadlineAt = null;
    if (dlRow.actual_deadline_at) {
      actualDeadlineAt = dlRow.actual_deadline_at;
    } else {
      var nextYmParts = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1).slice(0, 7);
      actualDeadlineAt = core_buildDateStr_(nextYmParts, settings.actualConfirmDefaultDay) + ' 23:59';
    }

    var unlockUntil = sub && sub.unlock_until ? sub.unlock_until : null;
    if (now > actualDeadlineAt) {
      if (!unlockUntil || now > unlockUntil) {
        return { ok: false, error: 'DEADLINE_PASSED' };
      }
    }

    // 検算 (mode: 'actual')
    var holidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function(h) {
      return { startDate: h.start_date, endDate: h.end_date };
    });

    var prevData = student_getAdjacentMonthData_(student, yearMonth, true);
    var nextData = student_getAdjacentMonthData_(student, yearMonth, false);

    var studentPayload = {
      birthDate: student.birth_date,
      enrollmentDate: student.enrollment_date,
      withdrawalDate: student.withdrawal_date || null,
      graduationDate: student.graduation_date || null,
      status: student.status,
      workPermission: student.work_permission === 'true',
      permissionExpires: student.permission_expires || null
    };

    var cleanedShifts = student_cleanShifts_(shifts);

    var evalResult = evaluateMonth({
      yearMonth: yearMonth,
      mode: 'actual',
      student: studentPayload,
      shifts: cleanedShifts,
      prevMonthDaily: prevData.daily,
      prevMonthSource: prevData.source,
      nextMonthDaily: nextData.daily,
      holidays: holidays,
      settings: settings
    });

    if (evalResult.inputErrors && evalResult.inputErrors.length > 0) {
      return {
        ok: false,
        error: 'VALIDATION_FAILED',
        details: { inputErrors: evalResult.inputErrors, codes: [] }
      };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var freshSubs = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var freshSub = null;
      for (var i = 0; i < freshSubs.length; i++) {
        if (freshSubs[i].student_id === studentId && freshSubs[i].year_month === yearMonth) {
          freshSub = freshSubs[i];
          break;
        }
      }

      var currentVersion = freshSub ? Number(freshSub.version) || 0 : 0;
      if (currentVersion !== expectedVersion) {
        return { ok: false, error: 'VERSION_CONFLICT' };
      }

      var newVersion = currentVersion + 1;
      var actualJson = JSON.stringify(cleanedShifts);
      var actualCodesJson = JSON.stringify(evalResult.codes.map(function(c) { return c.code; }));

      if (freshSub) {
        freshSub.actual_json = actualJson;
        freshSub.actual_status = '未確認';
        freshSub.actual_total_minutes = String(evalResult.totalMinutes);
        freshSub.actual_max_rolling7_minutes = String(evalResult.maxRolling7Minutes);
        freshSub.actual_codes = actualCodesJson;
        freshSub.version = String(newVersion);
        freshSub.updated_at = now;
        db_updateRow_('MONTHLY_SUBMISSIONS', freshSub._rowNum, freshSub);
      } else {
        var newSub = {
          submission_id: util_uuid_(),
          student_id: studentId,
          year_month: yearMonth,
          status: '未入力',
          shift_json: '{}',
          actual_json: actualJson,
          actual_status: '未確認',
          total_minutes: '0',
          max_rolling7_minutes: '0',
          validation_codes: '[]',
          actual_total_minutes: String(evalResult.totalMinutes),
          actual_max_rolling7_minutes: String(evalResult.maxRolling7Minutes),
          actual_codes: actualCodesJson,
          version: String(newVersion),
          confirmed_at: '',
          updated_at: now,
          unlock_until: ''
        };
        db_insertRow_('MONTHLY_SUBMISSIONS', newSub);
      }

      db_logAudit_('ACTUAL_SAVE', auth.user.login_id, 'student', studentId, yearMonth, newVersion, {});

      return {
        ok: true,
        data: {
          version: newVersion,
          actualStatus: '未確認',
          evaluation: evalResult
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_confirmActual(token, yearMonth, expectedVersion) {
  try {
    var auth = auth_verifySession_(token, 'student');
    if (!auth.ok) return auth;

    if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (typeof expectedVersion !== 'number' || expectedVersion < 0 || expectedVersion % 1 !== 0) {
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
    if (!student) return { ok: false, error: 'NOT_FOUND' };

    var submissions = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var sub = null;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].student_id === studentId && submissions[i].year_month === yearMonth) {
        sub = submissions[i];
        break;
      }
    }

    if (sub && sub.status === '学校確定') {
      return { ok: false, error: 'FORBIDDEN' };
    }

    // 実績を一度も保存していなければ BAD_REQUEST
    if (!sub || !sub.actual_json) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var className = student.class;
    var deadlines = db_readAllRows_('DEADLINES');
    var dlRow = null;
    for (var i = 0; i < deadlines.length; i++) {
      if (deadlines[i].year_month === yearMonth && deadlines[i].class === className) {
        dlRow = deadlines[i];
        break;
      }
    }
    if (!dlRow) return { ok: false, error: 'NOT_OPEN' };

    var now = util_nowJst_();
    var daysInMonth = core_getDaysInMonth_(yearMonth);
    var nextMonthFirstDay = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1) + ' 00:00';
    if (now < nextMonthFirstDay) {
      return { ok: false, error: 'NOT_OPEN' };
    }

    var settings = student_getSettings_();
    var actualDeadlineAt = null;
    if (dlRow.actual_deadline_at) {
      actualDeadlineAt = dlRow.actual_deadline_at;
    } else {
      var nextYmParts = core_addDays_(core_buildDateStr_(yearMonth, daysInMonth), 1).slice(0, 7);
      actualDeadlineAt = core_buildDateStr_(nextYmParts, settings.actualConfirmDefaultDay) + ' 23:59';
    }

    var unlockUntil = sub.unlock_until ? sub.unlock_until : null;
    if (now > actualDeadlineAt) {
      if (!unlockUntil || now > unlockUntil) {
        return { ok: false, error: 'DEADLINE_PASSED' };
      }
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var freshSubs = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var freshSub = null;
      for (var i = 0; i < freshSubs.length; i++) {
        if (freshSubs[i].student_id === studentId && freshSubs[i].year_month === yearMonth) {
          freshSub = freshSubs[i];
          break;
        }
      }

      if (!freshSub || !freshSub.actual_json) return { ok: false, error: 'BAD_REQUEST' };

      var currentVersion = Number(freshSub.version) || 0;
      if (currentVersion !== expectedVersion) {
        return { ok: false, error: 'VERSION_CONFLICT' };
      }

      // 予定と実績の一致判定
      var isSameAsPlan = false;
      if (freshSub.status === '確定済') {
        var planShifts = freshSub.shift_json ? JSON.parse(freshSub.shift_json) : {};
        var actShifts = freshSub.actual_json ? JSON.parse(freshSub.actual_json) : {};
        isSameAsPlan = student_areShiftsEqual_(planShifts, actShifts);
      }

      var finalActualStatus = isSameAsPlan ? '予定どおり' : '修正あり';
      var newVersion = currentVersion + 1;

      freshSub.actual_status = finalActualStatus;
      freshSub.version = String(newVersion);
      freshSub.updated_at = now;
      db_updateRow_('MONTHLY_SUBMISSIONS', freshSub._rowNum, freshSub);

      db_logAudit_('ACTUAL_CONFIRM', auth.user.login_id, 'student', studentId, yearMonth, newVersion, { actualStatus: finalActualStatus });

      return {
        ok: true,
        data: {
          version: newVersion,
          actualStatus: finalActualStatus
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function student_areShiftsEqual_(s1, s2) {
  var keys1 = Object.keys(s1).sort();
  var keys2 = Object.keys(s2).sort();
  if (keys1.length !== keys2.length) return false;
  for (var i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false;
  }
  for (var i = 0; i < keys1.length; i++) {
    var k = keys1[i];
    var l1 = s1[k] || [];
    var l2 = s2[k] || [];
    if (l1.length !== l2.length) return false;

    var sorted1 = l1.map(function(x) { return x.start + '|' + x.end; }).sort();
    var sorted2 = l2.map(function(x) { return x.start + '|' + x.end; }).sort();
    for (var j = 0; j < sorted1.length; j++) {
      if (sorted1[j] !== sorted2[j]) return false;
    }
  }
  return true;
}

function api_getHistory(token) {
  try {
    var auth = auth_verifySession_(token, 'student');
    if (!auth.ok) return auth;

    var studentId = auth.user.student_id;
    var rows = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var mySubs = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].student_id === studentId) {
        mySubs.push(rows[i]);
      }
    }
    // 年月の降順
    mySubs.sort(function(a, b) {
      return b.year_month.localeCompare(a.year_month);
    });

    var result = mySubs.map(function(s) {
      return {
        yearMonth: s.year_month,
        status: s.status,
        actualStatus: s.actual_status || '未確認'
      };
    });

    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}
