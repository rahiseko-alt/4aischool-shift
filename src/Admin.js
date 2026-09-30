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

// 段階2でのスタブ入口
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

function api_adminVerifyWorkplace(token, workplaceId, status) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminGrantUnlock(token, studentId, yearMonth, until) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminSchoolConfirm(token, studentId, yearMonth) {
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

function api_adminSetDeadline(token, params) {
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

function api_adminSetMinimumWage(token, params) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminListMinimumWages(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminGetSettings(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminSetSettings(token, params) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}

function api_adminPurgeExpired(token) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}
