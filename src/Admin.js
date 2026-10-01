// 管理者の窓口

// 学生情報の検証。必須: 学籍番号（英数字とハイフン20文字まで）・氏名・クラス・生年月日・入学日・言語・在籍状態・許可の有無。
function admin_isValidStudent_(st) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return false;
  if (typeof st.studentId !== 'string' || !/^[A-Za-z0-9-]{1,20}$/.test(st.studentId)) return false;
  if (!util_isNonEmptyString_(st.name, 100) || !util_isNonEmptyString_(st.className, 30)) return false;
  if (!util_isDate_(st.birthDate) || !util_isDate_(st.enrollmentDate)) return false;
  var optionalDates = [st.graduationDate, st.withdrawalDate, st.permissionExpires, st.permissionCheckedAt];
  for (var i = 0; i < optionalDates.length; i++) {
    var d = optionalDates[i];
    if (d !== null && d !== undefined && d !== '' && !util_isDate_(d)) return false;
  }
  if (['ja', 'ne', 'vi', 'en', 'my', 'si', 'bn'].indexOf(st.language) < 0) return false;
  if (['在籍', '休学', '卒業', '退学'].indexOf(st.status) < 0) return false;
  if (typeof st.workPermission !== 'boolean') return false;
  return true;
}

// 学生のログイン行を探す（管理者の行は対象にしない）
function admin_findStudentUser_(users, studentId) {
  if (typeof studentId !== 'string' || studentId === '') return null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].role === 'student' && users[i].student_id === studentId) return users[i];
  }
  return null;
}

function api_adminUpsertStudent(token, student) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!admin_isValidStudent_(student)) return { ok: false, error: 'BAD_REQUEST' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var students = db_readAllRows_('STUDENTS');
      var existing = null;
      for (var i = 0; i < students.length; i++) {
        if (students[i].student_id === student.studentId) {
          existing = students[i];
          break;
        }
      }

      var now = util_nowJst_();

      if (existing) {
        existing.name = student.name;
        existing.class = student.className;
        existing.birth_date = student.birthDate || '';
        existing.language = student.language || 'ja';
        existing.enrollment_date = student.enrollmentDate || '';
        existing.graduation_date = student.graduationDate || '';
        existing.withdrawal_date = student.withdrawalDate || '';
        existing.status = student.status || '在籍';
        existing.work_permission = student.workPermission ? 'true' : 'false';
        existing.permission_expires = student.permissionExpires || '';
        existing.permission_checked_at = student.permissionCheckedAt || '';
        existing.updated_at = now;

        db_updateRow_('STUDENTS', existing._rowNum, existing);
        db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', student.studentId, '', null, { op: 'update_student' });

        return {
          ok: true,
          data: {
            studentId: student.studentId,
            created: false
          }
        };
      } else {
        var loginId = util_generateLoginId_();
        var initialPassword = util_generatePassword_(14);
        var salt = util_generateSalt_();
        var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
        var hash = util_hashPassword_(initialPassword, salt, pepper, 10000);

        var newStudent = {
          student_id: student.studentId,
          login_id: loginId,
          name: student.name,
          class: student.className,
          birth_date: student.birthDate || '',
          language: student.language || 'ja',
          enrollment_date: student.enrollmentDate || '',
          graduation_date: student.graduationDate || '',
          withdrawal_date: student.withdrawalDate || '',
          status: student.status || '在籍',
          work_permission: student.workPermission ? 'true' : 'false',
          permission_expires: student.permissionExpires || '',
          permission_checked_at: student.permissionCheckedAt || '',
          created_at: now,
          updated_at: now
        };
        db_insertRow_('STUDENTS', newStudent);

        var newUser = {
          login_id: loginId,
          role: 'student',
          student_id: student.studentId,
          password_salt: salt,
          password_hash: hash,
          hash_iterations: '10000',
          force_password_change: 'true',
          failed_login_count: '0',
          locked_until: '',
          created_at: now
        };
        db_insertRow_('USERS', newUser);

        db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', student.studentId, '', null, { op: 'create_student' });

        return {
          ok: true,
          data: {
            studentId: student.studentId,
            created: true,
            loginId: loginId,
            initialPassword: initialPassword
          }
        };
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminResetPassword(token, studentId) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var targetUser = admin_findStudentUser_(db_readAllRows_('USERS'), studentId);

      if (!targetUser) return { ok: false, error: 'NOT_FOUND' };

      var initialPassword = util_generatePassword_(14);
      var salt = util_generateSalt_();
      var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
      var hash = util_hashPassword_(initialPassword, salt, pepper, 10000);

      targetUser.password_salt = salt;
      targetUser.password_hash = hash;
      targetUser.force_password_change = 'true';
      targetUser.failed_login_count = '0';
      targetUser.locked_until = '';
      db_updateRow_('USERS', targetUser._rowNum, targetUser);

      db_logAudit_('PASSWORD_RESET', auth.user.login_id, 'admin', studentId, '', null, {});

      return {
        ok: true,
        data: {
          initialPassword: initialPassword
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminUnlockLogin(token, studentId) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var targetUser = admin_findStudentUser_(db_readAllRows_('USERS'), studentId);

      if (!targetUser) return { ok: false, error: 'NOT_FOUND' };

      targetUser.failed_login_count = '0';
      targetUser.locked_until = '';
      db_updateRow_('USERS', targetUser._rowNum, targetUser);

      db_logAudit_('LOGIN_UNLOCK', auth.user.login_id, 'admin', studentId, '', null, {});

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminGrantUnlock(token, studentId, yearMonth, until) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (typeof studentId !== 'string' || !util_isYearMonth_(yearMonth) || !util_isDateTime_(until)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    var exists = db_readAllRows_('STUDENTS').some(function (st) { return st.student_id === studentId; });
    if (!exists) return { ok: false, error: 'NOT_FOUND' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var sub = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].student_id === studentId && rows[i].year_month === yearMonth) {
          sub = rows[i];
          break;
        }
      }

      var now = util_nowJst_();

      if (sub) {
        sub.unlock_until = until;
        sub.updated_at = now;
        db_updateRow_('MONTHLY_SUBMISSIONS', sub._rowNum, sub);
      } else {
        var newSub = {
          submission_id: util_uuid_(),
          student_id: studentId,
          year_month: yearMonth,
          status: '未入力',
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
          unlock_until: until
        };
        db_insertRow_('MONTHLY_SUBMISSIONS', newSub);
      }

      db_logAudit_('ADMIN_UNLOCK', auth.user.login_id, 'admin', studentId, yearMonth, null, { unlockUntil: until });

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminSchoolConfirm(token, studentId, yearMonth) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var students = db_readAllRows_('STUDENTS');
      var student = null;
      for (var i = 0; i < students.length; i++) {
        if (students[i].student_id === studentId) {
          student = students[i];
          break;
        }
      }
      if (!student) return { ok: false, error: 'NOT_FOUND' };

      var allowedStatuses = ['退学', '休学', '卒業'];
      if (allowedStatuses.indexOf(student.status) === -1) {
        return { ok: false, error: 'FORBIDDEN' };
      }

      var rows = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var sub = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].student_id === studentId && rows[i].year_month === yearMonth) {
          sub = rows[i];
          break;
        }
      }

      if (sub && sub.status !== '未入力') {
        return { ok: false, error: 'FORBIDDEN' };
      }

      var now = util_nowJst_();
      var version = sub ? Number(sub.version) || 0 : 0;
      var newVersion = version + 1;

      if (sub) {
        sub.status = '学校確定';
        sub.version = String(newVersion);
        sub.updated_at = now;
        db_updateRow_('MONTHLY_SUBMISSIONS', sub._rowNum, sub);
      } else {
        var newSub = {
          submission_id: util_uuid_(),
          student_id: studentId,
          year_month: yearMonth,
          status: '学校確定',
          shift_json: '{}',
          actual_json: '',
          actual_status: '未確認',
          total_minutes: '0',
          max_rolling7_minutes: '0',
          validation_codes: '[]',
          actual_total_minutes: '0',
          actual_max_rolling7_minutes: '0',
          actual_codes: '[]',
          version: String(newVersion),
          confirmed_at: '',
          updated_at: now,
          unlock_until: ''
        };
        db_insertRow_('MONTHLY_SUBMISSIONS', newSub);
      }

      db_logAudit_('SCHOOL_CONFIRM', auth.user.login_id, 'admin', studentId, yearMonth, newVersion, {});

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminSetDeadline(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object') return { ok: false, error: 'BAD_REQUEST' };
    var yearMonth = params.yearMonth;
    var className = params.className;
    var deadlineAt = params.deadlineAt;
    var actualDeadlineAt = params.actualDeadlineAt || null;

    if (!util_isYearMonth_(yearMonth) || !util_isNonEmptyString_(className, 30) || !util_isDateTime_(deadlineAt)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (actualDeadlineAt !== null && !util_isDateTime_(actualDeadlineAt)) return { ok: false, error: 'BAD_REQUEST' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('DEADLINES');
      var existing = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].year_month === yearMonth && rows[i].class === className) {
          existing = rows[i];
          break;
        }
      }

      if (existing) {
        existing.deadline_at = deadlineAt;
        existing.actual_deadline_at = actualDeadlineAt || '';
        db_updateRow_('DEADLINES', existing._rowNum, existing);
      } else {
        db_insertRow_('DEADLINES', {
          year_month: yearMonth,
          class: className,
          deadline_at: deadlineAt,
          actual_deadline_at: actualDeadlineAt || ''
        });
      }

      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', yearMonth, null, { op: 'set_deadline', class: className });

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminGetSettings(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var s = student_getSettings_();
    return { ok: true, data: s };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminSetSettings(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: 'BAD_REQUEST' };
    for (var pk in params) {
      if (!Object.prototype.hasOwnProperty.call(params, pk)) continue;
      if (!settings_isValid_(pk, params[pk])) return { ok: false, error: 'BAD_REQUEST' };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('SETTINGS');
      var rowMap = {};
      for (var i = 0; i < rows.length; i++) {
        rowMap[rows[i].key] = rows[i];
      }

      for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        var val = params[k];
        var strVal = String(val);
        if (rowMap[k]) {
          rowMap[k].value = strVal;
          db_updateRow_('SETTINGS', rowMap[k]._rowNum, rowMap[k]);
        } else {
          db_insertRow_('SETTINGS', { key: k, value: strVal });
        }
      }

      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'set_settings' });

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminCreateAdmin(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var loginId = util_generateLoginId_();
      var initialPassword = util_generatePassword_(14);
      var salt = util_generateSalt_();
      var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
      var hash = util_hashPassword_(initialPassword, salt, pepper, 10000);
      var now = util_nowJst_();

      var newUser = {
        login_id: loginId,
        role: 'admin',
        student_id: '',
        password_salt: salt,
        password_hash: hash,
        hash_iterations: '10000',
        force_password_change: 'true',
        failed_login_count: '0',
        locked_until: '',
        created_at: now
      };
      db_insertRow_('USERS', newUser);

      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'create_admin', loginId: loginId });

      return {
        ok: true,
        data: {
          loginId: loginId,
          initialPassword: initialPassword
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminStudentDetail(token, studentId) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!studentId || typeof studentId !== 'string') return { ok: false, error: 'BAD_REQUEST' };

    var students = db_readAllRows_('STUDENTS');
    var targetStudent = null;
    for (var i = 0; i < students.length; i++) {
      if (students[i].student_id === studentId) {
        targetStudent = students[i];
        break;
      }
    }
    if (!targetStudent) return { ok: false, error: 'NOT_FOUND' };

    var studentData = {
      studentId: targetStudent.student_id,
      loginId: targetStudent.login_id || '',
      name: targetStudent.name,
      className: targetStudent.class,
      birthDate: targetStudent.birth_date || '',
      language: targetStudent.language || 'ja',
      enrollmentDate: targetStudent.enrollment_date || '',
      graduationDate: targetStudent.graduation_date || null,
      withdrawalDate: targetStudent.withdrawal_date || null,
      status: targetStudent.status || '在籍',
      workPermission: targetStudent.work_permission === 'true',
      permissionExpires: targetStudent.permission_expires || null,
      permissionCheckedAt: targetStudent.permission_checked_at || null
    };

    var subRows = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var mySubs = [];
    for (var k = 0; k < subRows.length; k++) {
      if (subRows[k].student_id === studentId) {
        mySubs.push(subRows[k]);
      }
    }
    mySubs.sort(function(a, b) {
      return b.year_month.localeCompare(a.year_month);
    });

    // 学生が入れた中身（予定・実績の時間、合計、注意）もそのまま返す。管理者が画面で確かめられるように。
    var parse = function (txt, fallback) {
      if (!txt) return fallback;
      try { return JSON.parse(txt); } catch (e) { return fallback; }
    };
    var num = function (v) { return v === '' || v === undefined || v === null ? null : Number(v); };
    var monthsList = mySubs.map(function(s) {
      return {
        yearMonth: s.year_month,
        status: s.status,
        actualStatus: s.actual_status || '未確認',
        shifts: parse(s.shift_json, {}),
        totalMinutes: num(s.total_minutes),
        codes: parse(s.validation_codes, []),
        actual: s.actual_json ? parse(s.actual_json, null) : null,
        actualTotalMinutes: s.actual_json ? num(s.actual_total_minutes) : null,
        actualCodes: parse(s.actual_codes, []),
        publicHolidays: util_jpHolidaysOfMonth_(s.year_month),
        unlockUntil: s.unlock_until || null
      };
    });

    return {
      ok: true,
      data: {
        student: studentData,
        months: monthsList
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminBoard(token, yearMonth, filters) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    var f = filters || {};

    var allStudents = db_readAllRows_('STUDENTS');
    var allSubs = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var subMap = {};
    for (var i = 0; i < allSubs.length; i++) {
      var s = allSubs[i];
      if (s.year_month === yearMonth) {
        subMap[s.student_id] = s;
      }
    }

    var daysInMonth = core_getDaysInMonth_(yearMonth);
    var firstDayStr = core_buildDateStr_(yearMonth, 1);
    var lastDayStr = core_buildDateStr_(yearMonth, daysInMonth);

    // 対象学生の判定
    // 入学日がその月の末日以前で、退学日・卒業日（早いほう、無ければ無期限）がその月の初日以後の学生。
    // 加えて、その月の行を持つ学生。
    var targetStudents = [];
    for (var j = 0; j < allStudents.length; j++) {
      var st = allStudents[j];
      var hasSub = !!subMap[st.student_id];

      var enrollmentValid = !st.enrollment_date || st.enrollment_date <= lastDayStr;

      var endDates = [];
      if (st.withdrawal_date) endDates.push(st.withdrawal_date);
      if (st.graduation_date) endDates.push(st.graduation_date);
      var earliestEnd = null;
      if (endDates.length > 0) {
        endDates.sort();
        earliestEnd = endDates[0];
      }

      var activeInMonth = enrollmentValid && (!earliestEnd || earliestEnd >= firstDayStr);

      if (activeInMonth || hasSub) {
        targetStudents.push(st);
      }
    }

    // クラス絞り込み
    var classTargetStudents = targetStudents;
    if (f.className) {
      classTargetStudents = targetStudents.filter(function(st) {
        return st.class === f.className;
      });
    }

    var counts = {
      students: classTargetStudents.length,
      confirmed: 0,
      draft: 0,
      notSubmitted: 0,
      error: 0,
      outOfScope: 0
    };

    var allRows = [];
    var now = util_nowJst_();
    var nextMonthFirstDay = core_addDays_(lastDayStr, 1) + ' 00:00';
    var isActualPeriod = (now >= nextMonthFirstDay);
    var actualUnconfirmedCount = 0;

    for (var k = 0; k < classTargetStudents.length; k++) {
      var cSt = classTargetStudents[k];
      var cSub = subMap[cSt.student_id];

      var displayStatus = '未提出';
      var errorCodes = [];
      var actualStatus = '未確認';
      var actualOver = false;
      var updatedAt = null;

      if (cSub) {
        if (cSub.status === '確定済') {
          displayStatus = '確定済';
        } else if (cSub.status === '学校確定') {
          displayStatus = '対象外';
        } else if (cSub.status === '下書き') {
          displayStatus = '下書き';
        } else {
          displayStatus = '未提出';
        }

        if (cSub.validation_codes) {
          try {
            var parsed = JSON.parse(cSub.validation_codes);
            if (Array.isArray(parsed)) {
              // 重複排除
              var codeSet = {};
              for (var ci = 0; ci < parsed.length; ci++) {
                codeSet[parsed[ci]] = true;
              }
              errorCodes = Object.keys(codeSet);
            }
          } catch (e) {}
        }

        if (cSub.actual_status) {
          actualStatus = cSub.actual_status;
        }

        if (cSub.actual_codes) {
          try {
            var aParsed = JSON.parse(cSub.actual_codes);
            if (Array.isArray(aParsed) && aParsed.indexOf('ACTUAL_OVER') !== -1) {
              actualOver = true;
            }
          } catch (e) {}
        }

        if (cSub.updated_at) {
          updatedAt = cSub.updated_at;
        }
      }

      // counts 集計
      if (displayStatus === '確定済') counts.confirmed++;
      else if (displayStatus === '下書き') counts.draft++;
      else if (displayStatus === '未提出') counts.notSubmitted++;
      else if (displayStatus === '対象外') counts.outOfScope++;

      if (errorCodes.length > 0) counts.error++;

      if (isActualPeriod && displayStatus !== '対象外') {
        if (actualStatus === '未確認') {
          actualUnconfirmedCount++;
        }
      }

      allRows.push({
        studentId: cSt.student_id,
        name: cSt.name,
        className: cSt.class,
        displayStatus: displayStatus,
        errorCodes: errorCodes,
        actualStatus: actualStatus,
        actualOver: actualOver,
        updatedAt: updatedAt
      });
    }

    // rows の絞り込み（status, query）
    var filteredRows = allRows;
    if (f.status) {
      filteredRows = filteredRows.filter(function(r) {
        return r.displayStatus === f.status;
      });
    }
    if (f.query) {
      var q = f.query.trim();
      filteredRows = filteredRows.filter(function(r) {
        return r.studentId.indexOf(q) === 0 || r.name.indexOf(q) !== -1;
      });
    }

    filteredRows.sort(function(a, b) {
      return a.studentId.localeCompare(b.studentId);
    });

    return {
      ok: true,
      data: {
        counts: counts,
        actualUnconfirmed: actualUnconfirmedCount,
        rows: filteredRows
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminSetHoliday(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object') return { ok: false, error: 'BAD_REQUEST' };
    var name = params.name;
    var startDate = params.startDate;
    var endDate = params.endDate;
    var schoolYear = params.schoolYear;

    if (!util_isNonEmptyString_(name, 50) || !util_isDate_(startDate) || !util_isDate_(endDate)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (startDate > endDate) return { ok: false, error: 'BAD_REQUEST' };
    schoolYear = Number(schoolYear);
    if (!(schoolYear >= 2000 && schoolYear <= 2100 && Math.floor(schoolYear) === schoolYear)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('SCHOOL_HOLIDAYS');
      var holidayId = params.holidayId;

      if (holidayId) {
        var existing = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].holiday_id === holidayId) {
            existing = rows[i];
            break;
          }
        }
        if (existing) {
          existing.name = name;
          existing.start_date = startDate;
          existing.end_date = endDate;
          existing.school_year = schoolYear != null ? String(schoolYear) : '';
          db_updateRow_('SCHOOL_HOLIDAYS', existing._rowNum, existing);
          db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'update_holiday', holidayId: holidayId });
          return { ok: true, data: { holidayId: holidayId } };
        }
      }

      var newId = 'HOL_' + util_uuid_().slice(0, 8);
      var newHol = {
        holiday_id: newId,
        name: name,
        start_date: startDate,
        end_date: endDate,
        school_year: schoolYear != null ? String(schoolYear) : ''
      };
      db_insertRow_('SCHOOL_HOLIDAYS', newHol);
      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'set_holiday', holidayId: newId });

      return { ok: true, data: { holidayId: newId } };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminDeleteHoliday(token, holidayId) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!holidayId) return { ok: false, error: 'BAD_REQUEST' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('SCHOOL_HOLIDAYS');
      var existing = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].holiday_id === holidayId) {
          existing = rows[i];
          break;
        }
      }
      if (!existing) return { ok: false, error: 'NOT_FOUND' };

      db_deleteRow_('SCHOOL_HOLIDAYS', existing._rowNum);
      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'delete_holiday', holidayId: holidayId });

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminListHolidays(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var rows = db_readAllRows_('SCHOOL_HOLIDAYS');
    var list = rows.map(function(h) {
      return {
        holidayId: h.holiday_id,
        name: h.name,
        startDate: h.start_date,
        endDate: h.end_date,
        schoolYear: h.school_year ? Number(h.school_year) : null
      };
    });
    return { ok: true, data: list };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminPurgeExpired(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var settings = student_getSettings_();
      var retentionMonths = settings.retentionMonths || 24;

      var currentYm = util_currentYearMonth_();
      var parts = currentYm.split('-');
      var cy = Number(parts[0]);
      var cm = Number(parts[1]);

      var cutoffDate = new Date(Date.UTC(cy, cm - 1 - retentionMonths, 1));
      var cutoffYm = cutoffDate.getUTCFullYear() + '-' + String(cutoffDate.getUTCMonth() + 1).padStart(2, '0');

      var rows = db_readAllRows_('MONTHLY_SUBMISSIONS');
      var deletedRows = 0;

      // 行番号がずれないよう、後ろから削除
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i].year_month < cutoffYm) {
          db_deleteRow_('MONTHLY_SUBMISSIONS', rows[i]._rowNum);
          deletedRows++;
        }
      }

      db_logAudit_('PURGE', auth.user.login_id, 'admin', '', '', null, { deletedRows: deletedRows });

      return { ok: true, data: { deletedRows: deletedRows } };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

// 試用データの一括投入（管理画面の「試用データを入れる」）。何度押しても重複しない。
// 本物の学生・本物の締切とは混ざらないよう、クラス名を「DEMO」に固定する。
var DEMO_CLASS_ = 'DEMO';
var DEMO_STUDENTS_ = [
  { studentId: 'DEMO-A', name: '生徒A', language: 'ja' }
];

function api_adminSeedDemo(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    // 1. DEMO クラスの締切（無い月だけ）を、まとめて1回で書く。
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };
    try {
      // 期限は遠い先にして、いつでも試せるようにする
      var hasDeadline = {};
      db_readAllRows_('DEADLINES').forEach(function (d) { if (d.class === DEMO_CLASS_) hasDeadline[d.year_month] = true; });
      var ym = util_currentYearMonth_();
      var deadlines = [];
      for (var k = -1; k <= 12; k++) {
        var target = admin_addMonths_(ym, k);
        if (hasDeadline[target]) continue;
        deadlines.push({ year_month: target, class: DEMO_CLASS_, deadline_at: '2099-12-31 23:59', actual_deadline_at: '2099-12-31 23:59' });
      }
      db_insertRows_('DEADLINES', deadlines);
    } finally {
      lock.releaseLock();
    }

    // 2. 架空の学生（途中で止まっても、次に押せば足りない分だけ入る）
    var existing = {};
    db_readAllRows_('STUDENTS').forEach(function (s) { existing[s.student_id] = true; });
    var created = [];
    for (var j = 0; j < DEMO_STUDENTS_.length; j++) {
      var demo = DEMO_STUDENTS_[j];
      if (existing[demo.studentId]) continue;
      var res = api_adminUpsertStudent(token, {
        studentId: demo.studentId, name: demo.name, className: DEMO_CLASS_, birthDate: '2003-04-01',
        language: demo.language, enrollmentDate: '2025-04-01', graduationDate: null, withdrawalDate: null,
        status: '在籍', workPermission: true, permissionExpires: '2099-12-31', permissionCheckedAt: '2025-04-01'
      });
      if (!res.ok) return res;
      // 試用の学生は、初回のパスワード変更を求めない（スマホからすぐ試せるように）。
      var users = db_readAllRows_('USERS');
      for (var u = 0; u < users.length; u++) {
        if (users[u].student_id === demo.studentId) {
          users[u].force_password_change = 'false';
          db_updateRow_('USERS', users[u]._rowNum, users[u]);
        }
      }
      created.push({ studentId: demo.studentId, name: demo.name, loginId: res.data.loginId, initialPassword: res.data.initialPassword });
    }

    db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null,
      { op: 'seed_demo', students: created.length, deadlines: deadlines.length });
    return { ok: true, data: { className: DEMO_CLASS_, students: created } };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

// ---- 見本データ（生徒モードを初めて押したときに一緒に入る。管理画面の見た目を試すためのもの） ----
// 架空の学生10人（クラス DEMO）と、前月・今月・翌月の予定・実績、学校の長期休業（秋季・冬季）。
// 確定にする月も、本物の確定と同じ evaluateMonth の検算を通し、止まる注意があれば下書きにする。
var SAMPLE_STUDENTS_ = [
  { id: 'DEMO-01', name: 'グエン・ティ・ラン', lang: 'vi', birth: '2002-03-14', type: 'evening', cur: '確定', next: '確定', actual: '予定どおり' },
  { id: 'DEMO-02', name: 'タパ・ラジェシュ', lang: 'ne', birth: '2001-07-02', type: 'night', cur: '確定', next: '下書き', actual: '修正あり' },
  { id: 'DEMO-03', name: 'チャン・ヴァン・ミン', lang: 'vi', birth: '2003-11-20', type: 'weekend', cur: '確定', next: '確定', actual: '予定どおり' },
  { id: 'DEMO-04', name: 'グルン・アニタ', lang: 'ne', birth: '2000-01-30', type: 'weekday', cur: '下書き', next: 'なし', actual: '予定どおり' },
  { id: 'DEMO-05', name: 'アウン・チョー・ミン', lang: 'my', birth: '2002-09-09', type: 'heavy', cur: '確定', next: '確定', actual: '修正あり' },
  { id: 'DEMO-06', name: 'ペレラ・ニマル', lang: 'si', birth: '2001-04-18', type: 'evening', cur: '確定', next: '下書き', actual: '予定どおり', permitEndsNext: true },
  { id: 'DEMO-07', name: 'ラーマン・ハサン', lang: 'bn', birth: '2003-06-25', type: 'weekend', cur: 'なし', next: 'なし', actual: '未確認' },
  { id: 'DEMO-08', name: 'ジョン・スミス', lang: 'en', birth: '1999-12-05', type: 'weekday', cur: '確定', next: '確定', actual: '予定どおり' },
  { id: 'DEMO-09', name: 'レ・ティ・ホア', lang: 'vi', birth: '2009-05-10', type: 'evening', cur: '下書き', next: 'なし', actual: '予定どおり' },
  { id: 'DEMO-10', name: 'シュレスタ・ビカス', lang: 'ne', birth: '2002-02-14', type: 'heavy', cur: '確定', next: '超過', actual: '予定どおり' }
];
var SAMPLE_HOLIDAYS_ = [
  { name: '秋季休業', start: '2026-09-21', end: '2026-09-30', year: 2026 },
  { name: '冬季休業', start: '2026-12-21', end: '2027-01-07', year: 2026 }
];

// 勤務の型ごとに、その日の予定を返す（無ければ null）。長期休業中は週末型が8時間まで働く。
function admin_sampleShift_(type, dow, isHoliday, day, over) {
  if (type === 'evening') return (dow === 1 || dow === 3 || dow === 5) ? { start: '17:00', end: '21:00' } : null;
  if (type === 'night') return (dow === 2 || dow === 4 || dow === 6) ? { start: '22:00', end: '05:00' } : null;
  if (type === 'weekend') {
    if (dow === 0 || dow === 6) return { start: '09:00', end: '17:00' };
    return isHoliday && dow === 3 ? { start: '09:00', end: '18:00' } : null;
  }
  if (type === 'weekday') return (dow >= 1 && dow <= 5) ? { start: '18:00', end: '22:00' } : null;
  if (type === 'heavy') {
    if (dow >= 1 && dow <= 6) return { start: '10:00', end: '14:30' };
    return over ? { start: '10:00', end: '14:30' } : null; // 日曜も入れると7日で31時間30分（28時間超）
  }
  return null;
}

function admin_sampleMonthShifts_(sample, ym, holidays, over) {
  var shifts = {};
  var days = core_getDaysInMonth_(ym);
  for (var d = 1; d <= days; d++) {
    var dateStr = core_buildDateStr_(ym, d);
    var dow = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, d)).getUTCDay();
    var sh = admin_sampleShift_(sample.type, dow, core_isHoliday_(holidays, dateStr), d, over);
    if (sh) shifts[String(d)] = [sh];
  }
  return shifts;
}

function admin_seedSampleData_(token, auth) {
  // 1. 長期休業（同じ名前・開始日のものが無ければ足す）
  var holRows = db_readAllRows_('SCHOOL_HOLIDAYS');
  var newHol = SAMPLE_HOLIDAYS_.filter(function (h) {
    return !holRows.some(function (r) { return r.name === h.name && r.start_date === h.start; });
  }).map(function (h) {
    return { holiday_id: 'HOL_' + util_uuid_().slice(0, 8), name: h.name, start_date: h.start, end_date: h.end, school_year: String(h.year) };
  });
  db_insertRows_('SCHOOL_HOLIDAYS', newHol);
  var holidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function (h) { return { startDate: h.start_date, endDate: h.end_date }; });

  // 2. 学生（無い人だけ）
  var ym = util_currentYearMonth_();
  var prevYm = admin_addMonths_(ym, -1), nextYm = admin_addMonths_(ym, 1);
  var existing = {};
  db_readAllRows_('STUDENTS').forEach(function (s) { existing[s.student_id] = true; });
  var added = [];
  for (var i = 0; i < SAMPLE_STUDENTS_.length; i++) {
    var sm = SAMPLE_STUDENTS_[i];
    if (existing[sm.id]) continue;
    var permitEnd = sm.permitEndsNext ? core_buildDateStr_(nextYm, 15) : '2099-12-31';
    var res = api_adminUpsertStudent(token, {
      studentId: sm.id, name: sm.name, className: DEMO_CLASS_, birthDate: sm.birth, language: sm.lang,
      enrollmentDate: '2025-04-01', graduationDate: null, withdrawalDate: null, status: '在籍',
      workPermission: true, permissionExpires: permitEnd, permissionCheckedAt: '2025-04-01'
    });
    if (!res.ok) return res;
    added.push(sm);
  }
  if (!added.length) return { ok: true };

  // 3. 3か月分の申告（新しく入れた学生だけ）。前月の実働を次の月の28時間の検算に渡す。
  var now = util_nowJst_();
  var rows = [];
  added.forEach(function (sm) {
    var student = {
      birthDate: sm.birth, enrollmentDate: '2025-04-01', withdrawalDate: null, graduationDate: null, status: '在籍',
      workPermission: true, permissionExpires: sm.permitEndsNext ? core_buildDateStr_(nextYm, 15) : '2099-12-31'
    };
    var prevDaily = {};
    [[prevYm, '確定'], [ym, sm.cur], [nextYm, sm.next]].forEach(function (pair, idx) {
      var month = pair[0], plan = pair[1];
      if (plan === 'なし') { prevDaily = {}; return; }
      var shifts = admin_sampleMonthShifts_(sm, month, holidays, plan === '超過');
      var ev = evaluateMonth({ yearMonth: month, mode: 'plan', student: student, shifts: shifts,
        prevMonthDaily: prevDaily, prevMonthSource: idx === 0 ? 'not_applicable' : 'confirmed', nextMonthDaily: {}, holidays: holidays, settings: {} });
      var blocking = ev.codes.filter(function (c) { return c.severity === 'block'; });
      var status = (plan === '確定' && !blocking.length) ? '確定済' : '下書き';
      var row = {
        submission_id: util_uuid_(), student_id: sm.id, year_month: month, status: status,
        shift_json: JSON.stringify(shifts), actual_json: '', actual_status: '未確認',
        total_minutes: String(ev.totalMinutes), max_rolling7_minutes: String(ev.maxRolling7Minutes),
        validation_codes: JSON.stringify(blocking.map(function (c) { return c.code; })),
        actual_total_minutes: '0', actual_max_rolling7_minutes: '0', actual_codes: '[]',
        version: '1', confirmed_at: status === '確定済' ? now : '', updated_at: now, unlock_until: ''
      };
      // 前月だけ実績も入れる（予定どおり／1日だけ短く働いた修正あり／未確認）
      if (idx === 0 && sm.actual !== '未確認') {
        var actual = JSON.parse(JSON.stringify(shifts));
        if (sm.actual === '修正あり') {
          var firstDay = Object.keys(actual)[0];
          if (firstDay) actual[firstDay] = [{ start: actual[firstDay][0].start, end: core_minutesToTime_((core_timeToMinutes_(actual[firstDay][0].start) + 120) % 1440) }];
        }
        var aev = evaluateMonth({ yearMonth: month, mode: 'actual', student: student, shifts: actual,
          prevMonthDaily: {}, prevMonthSource: 'not_applicable', nextMonthDaily: {}, holidays: holidays, settings: {} });
        row.actual_json = JSON.stringify(actual);
        row.actual_status = sm.actual;
        row.actual_total_minutes = String(aev.totalMinutes);
        row.actual_max_rolling7_minutes = String(aev.maxRolling7Minutes);
        row.actual_codes = JSON.stringify(aev.codes.map(function (c) { return c.code; }));
        row.version = '2';
      }
      rows.push(row);
      prevDaily = ev.daily;
    });
  });
  db_insertRows_('MONTHLY_SUBMISSIONS', rows);
  db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'seed_sample', students: added.length, submissions: rows.length, holidays: newHol.length });
  return { ok: true };
}

// 生徒モード: 管理者が、試用の学生（クラス DEMO）の画面にパスワード無しで入る。
// DEMO 以外の学生には入れない。試用データがまだ無ければ先に入れる。
function api_adminActAsDemoStudent(token, studentId) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;
    if (!studentId || typeof studentId !== 'string') return { ok: false, error: 'BAD_REQUEST' };

    // 試用の学生が揃っていなければ、先に試用データを入れる（揃っていれば何もしない）。
    var students = db_readAllRows_('STUDENTS');
    var newStudents = [];
    var missing = DEMO_STUDENTS_.some(function (d) {
      return !students.some(function (s) { return s.student_id === d.studentId; });
    });
    if (missing) {
      var seeded = api_adminSeedDemo(token);
      if (!seeded.ok) return seeded;
      newStudents = seeded.data.students;
    }
    // 見本データ（10人・3か月分・長期休業）も、まだ無ければ入れる
    var sampleMissing = SAMPLE_STUDENTS_.some(function (d) {
      return !students.some(function (s) { return s.student_id === d.id; });
    });
    if (sampleMissing) {
      var sample = admin_seedSampleData_(token, auth);
      if (!sample.ok) return sample;
    }
    if (missing || sampleMissing) students = db_readAllRows_('STUDENTS');

    var student = null;
    students.forEach(function (s) { if (s.student_id === studentId) student = s; });
    if (!student) return { ok: false, error: 'NOT_FOUND' };
    if (student.class !== DEMO_CLASS_) return { ok: false, error: 'FORBIDDEN' };

    var user = null;
    db_readAllRows_('USERS').forEach(function (x) { if (x.student_id === studentId && x.role === 'student') user = x; });
    if (!user) return { ok: false, error: 'NOT_FOUND' };

    var now = util_nowJst_();
    var newToken = util_generateToken_();
    db_insertRow_('SESSIONS', {
      token_hash: util_sha256Hex_(newToken),
      login_id: user.login_id,
      role: 'student',
      expires_at: util_addMinutesToJst_(now, auth_sessionTtlMinutes_()),
      created_at: now
    });
    db_logAudit_('LOGIN_OK', auth.user.login_id, 'admin', studentId, '', null, { via: 'demo_student_mode' });

    return {
      ok: true,
      data: {
        token: newToken, role: 'student', studentId: studentId, name: student.name,
        language: student.language || 'ja', loginId: user.login_id,
        mustChangePassword: user.force_password_change === 'true',
        newStudents: newStudents
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function admin_addMonths_(ym, n) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1);
}
