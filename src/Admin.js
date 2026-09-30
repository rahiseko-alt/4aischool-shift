// 管理者の窓口

function api_adminUpsertStudent(token, student) {
  try {
    var auth = auth_verifySession_(token, 'admin');
    if (!auth.ok) return auth;

    if (!student || typeof student !== 'object') return { ok: false, error: 'BAD_REQUEST' };
    if (!student.studentId || !student.name || !student.className) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    var validLangs = ['ja', 'ne', 'vi'];
    if (student.language && validLangs.indexOf(student.language) === -1) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    var validStatuses = ['在籍', '休学', '卒業', '退学'];
    if (student.status && validStatuses.indexOf(student.status) === -1) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

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
      var users = db_readAllRows_('USERS');
      var targetUser = null;
      for (var i = 0; i < users.length; i++) {
        if (users[i].student_id === studentId) {
          targetUser = users[i];
          break;
        }
      }

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
      var users = db_readAllRows_('USERS');
      var targetUser = null;
      for (var i = 0; i < users.length; i++) {
        if (users[i].student_id === studentId) {
          targetUser = users[i];
          break;
        }
      }

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

      // 在籍状態が 退学・休学・卒業 のどれか
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

      // 未入力（行が無い、または状態が未入力）のときだけ
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

    if (!yearMonth || !className || !deadlineAt) return { ok: false, error: 'BAD_REQUEST' };

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

    if (!prefecture || !amount || !effectiveFrom) return { ok: false, error: 'BAD_REQUEST' };

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

    if (!params || typeof params !== 'object') return { ok: false, error: 'BAD_REQUEST' };

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

// 段階3以降のスタブ
function api_adminCreateAdmin(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminStudentDetail(token, studentId) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminBoard(token, yearMonth, filters) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminQuarterCheck(token, params) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminSetHoliday(token, params) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminDeleteHoliday(token, holidayId) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminListHolidays(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminPurgeExpired(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}
