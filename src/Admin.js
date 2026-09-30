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
  if (['ja', 'ne', 'vi'].indexOf(st.language) < 0) return false;
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

function api_adminVerifyWorkplace(token, workplaceId, status) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (status !== 'OK' && status !== '禁止') return { ok: false, error: 'BAD_REQUEST' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('WORKPLACES');
      var wp = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].workplace_id === workplaceId) {
          wp = rows[i];
          break;
        }
      }
      if (!wp) return { ok: false, error: 'NOT_FOUND' };

      var now = util_nowJst_();
      wp.verification_status = status;
      wp.verified_by = auth.user.login_id;
      wp.verified_at = now;
      db_updateRow_('WORKPLACES', wp._rowNum, wp);

      db_logAudit_('WORKPLACE_VERIFY', auth.user.login_id, 'admin', wp.student_id, '', null, { workplaceId: workplaceId, status: status });

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
          estimated_salary: '0',
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
          estimated_salary: '0',
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

function api_adminSetMinimumWage(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object') return { ok: false, error: 'BAD_REQUEST' };
    var prefecture = params.prefecture;
    var amount = params.amount;
    var effectiveFrom = params.effectiveFrom;
    var effectiveTo = params.effectiveTo || null;

    if (PREFECTURES_.indexOf(prefecture) < 0) return { ok: false, error: 'BAD_REQUEST' };
    if (typeof amount !== 'number' || Math.floor(amount) !== amount || amount < 1 || amount > 10000) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (!util_isDate_(effectiveFrom)) return { ok: false, error: 'BAD_REQUEST' };
    if (effectiveTo !== null && (!util_isDate_(effectiveTo) || effectiveTo < effectiveFrom)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };

    try {
      var rows = db_readAllRows_('MINIMUM_WAGES');
      var existing = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].prefecture === prefecture && rows[i].effective_from === effectiveFrom) {
          existing = rows[i];
          break;
        }
      }

      if (existing) {
        existing.amount = String(amount);
        existing.effective_to = effectiveTo || '';
        db_updateRow_('MINIMUM_WAGES', existing._rowNum, existing);
      } else {
        db_insertRow_('MINIMUM_WAGES', {
          prefecture: prefecture,
          amount: String(amount),
          effective_from: effectiveFrom,
          effective_to: effectiveTo || ''
        });
      }

      db_logAudit_('MASTER_UPDATE', auth.user.login_id, 'admin', '', '', null, { op: 'set_min_wage', prefecture: prefecture, effectiveFrom: effectiveFrom });

      return { ok: true, data: null };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminListMinimumWages(token) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    var rows = db_readAllRows_('MINIMUM_WAGES');
    var list = rows.map(function(r) {
      return {
        prefecture: r.prefecture,
        amount: Number(r.amount) || 0,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to || null
      };
    });
    return { ok: true, data: list };
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

    var wpRows = db_readAllRows_('WORKPLACES');
    var workplacesList = [];
    for (var j = 0; j < wpRows.length; j++) {
      var wp = wpRows[j];
      if (wp.student_id === studentId && wp.active !== 'false') {
        workplacesList.push({
          workplaceId: wp.workplace_id,
          name: wp.name,
          prefecture: wp.prefecture,
          jobDescription: wp.job_description,
          baseHourlyWage: Number(wp.baseHourlyWage || wp.base_hourly_wage) || 0,
          earlyStart: wp.early_start || null,
          earlyEnd: wp.early_end || null,
          earlyPremium: wp.early_premium ? Number(wp.early_premium) : null,
          verificationStatus: wp.verification_status || '確認中',
          verifiedBy: wp.verified_by || null,
          verifiedAt: wp.verified_at || null
        });
      }
    }

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

    var monthsList = mySubs.map(function(s) {
      return {
        yearMonth: s.year_month,
        status: s.status,
        actualStatus: s.actual_status || '未確認'
      };
    });

    return {
      ok: true,
      data: {
        student: studentData,
        workplaces: workplacesList,
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
        updatedAt: updatedAt,
        pendingWorkplaces: 0
      });
    }

    // 勤務先の確認待ち集計
    var allWorkplaces = db_readAllRows_('WORKPLACES');
    // 画面で「どの学生の勤務先が確認待ちか」を探せるよう、行ごとの件数も返す
    var pendingByStudent = {};
    allWorkplaces.forEach(function (w) {
      if (w.verification_status === '確認中' && w.active !== 'false') {
        pendingByStudent[w.student_id] = (pendingByStudent[w.student_id] || 0) + 1;
      }
    });
    allRows.forEach(function (r) { r.pendingWorkplaces = pendingByStudent[r.studentId] || 0; });
    var holidays = db_readAllRows_('SCHOOL_HOLIDAYS').map(function(h) {
      return { startDate: h.start_date, endDate: h.end_date };
    });
    var settings = student_getSettings_();
    var slaDays = settings.workplaceSlaDays || 3;

    var workplacesPending = 0;
    var workplacesOverdue = 0;
    var todayStr = util_todayJst_();

    for (var wIdx = 0; wIdx < allWorkplaces.length; wIdx++) {
      var wp = allWorkplaces[wIdx];
      if (wp.active !== 'false' && wp.verification_status === '確認中') {
        workplacesPending++;

        // 営業日数計算: 登録日の翌日から今日まで
        var createdDate = (wp.created_at || '').slice(0, 10);
        if (createdDate && createdDate < todayStr) {
          var busDays = 0;
          var cur = core_addDays_(createdDate, 1);
          while (cur <= todayStr) {
            var parts = cur.split('-');
            var dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
            var dayOfWeek = dt.getUTCDay(); // 0: Sun, 6: Sat
            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !core_isHoliday_(holidays, cur)) {
              busDays++;
            }
            cur = core_addDays_(cur, 1);
          }
          if (busDays > slaDays) {
            workplacesOverdue++;
          }
        }
      }
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
        workplacesPending: workplacesPending,
        workplacesOverdue: workplacesOverdue,
        actualUnconfirmed: actualUnconfirmedCount,
        rows: filteredRows
      }
    };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_adminQuarterCheck(token, params) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!params || typeof params !== 'object') return { ok: false, error: 'BAD_REQUEST' };
    var endYearMonth = params.endYearMonth;
    var className = params.className || null;

    if (!endYearMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(endYearMonth)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    var parts = endYearMonth.split('-');
    var ey = Number(parts[0]);
    var em = Number(parts[1]);

    var d1 = new Date(Date.UTC(ey, em - 3, 1));
    var ym1 = d1.getUTCFullYear() + '-' + String(d1.getUTCMonth() + 1).padStart(2, '0');
    var d2 = new Date(Date.UTC(ey, em - 2, 1));
    var ym2 = d2.getUTCFullYear() + '-' + String(d2.getUTCMonth() + 1).padStart(2, '0');
    var ym3 = endYearMonth;

    var months = [ym1, ym2, ym3];

    var allStudents = db_readAllRows_('STUDENTS');
    if (className) {
      allStudents = allStudents.filter(function(st) { return st.class === className; });
    }
    allStudents.sort(function(a, b) { return a.student_id.localeCompare(b.student_id); });

    var allSubs = db_readAllRows_('MONTHLY_SUBMISSIONS');
    var subMap = {};
    for (var i = 0; i < allSubs.length; i++) {
      var s = allSubs[i];
      subMap[s.student_id + '_' + s.year_month] = s;
    }

    var rows = [];
    for (var j = 0; j < allStudents.length; j++) {
      var st = allStudents[j];
      var studentMonths = [];

      for (var mi = 0; mi < months.length; mi++) {
        var ym = months[mi];
        var sub = subMap[st.student_id + '_' + ym];

        var displayStatus = '未提出';
        var actualStatus = '未確認';
        var actualTotalMinutes = null;
        var actualOver = false;

        if (sub) {
          if (sub.status === '確定済') displayStatus = '確定済';
          else if (sub.status === '学校確定') displayStatus = '対象外';
          else if (sub.status === '下書き') displayStatus = '下書き';

          if (sub.actual_status) actualStatus = sub.actual_status;
          if (sub.actual_json) actualTotalMinutes = Number(sub.actual_total_minutes) || 0;

          if (sub.actual_codes) {
            try {
              var aParsed = JSON.parse(sub.actual_codes);
              if (Array.isArray(aParsed) && aParsed.indexOf('ACTUAL_OVER') !== -1) {
                actualOver = true;
              }
            } catch (e) {}
          }
        }

        studentMonths.push({
          yearMonth: ym,
          displayStatus: displayStatus,
          actualStatus: actualStatus,
          actualTotalMinutes: actualTotalMinutes,
          actualOver: actualOver
        });
      }

      rows.push({
        studentId: st.student_id,
        name: st.name,
        className: st.class,
        months: studentMonths
      });
    }

    db_logAudit_('QUARTER_CHECK', auth.user.login_id, 'admin', '', endYearMonth, null, { className: className });

    return {
      ok: true,
      data: {
        months: months,
        rows: rows
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
