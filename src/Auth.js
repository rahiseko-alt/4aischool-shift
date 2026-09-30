// 認証・セッション・初期設定

function setupInitial() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === 'true') {
    Logger.log('ALREADY_SET_UP');
    return;
  }

  // 1. ShiftDB 作成
  var shiftDb = SpreadsheetApp.create('ShiftDB');
  var tableNames = [
    'STUDENTS', 'USERS', 'WORKPLACES', 'MONTHLY_SUBMISSIONS',
    'SCHOOL_HOLIDAYS', 'DEADLINES', 'MINIMUM_WAGES', 'SETTINGS', 'SESSIONS'
  ];

  for (var i = 0; i < tableNames.length; i++) {
    var tName = tableNames[i];
    var s = shiftDb.getSheetByName(tName) || shiftDb.insertSheet(tName);
    var headers = DB_TABLES_[tName];
    s.appendRow(headers);
  }
  var defaultSheet1 = shiftDb.getSheetByName('Sheet1');
  if (defaultSheet1 && shiftDb.getSheets().length > 1) {
    try { shiftDb.deleteSheet(defaultSheet1); } catch (e) {}
  }

  // 2. AuditLog 作成
  var auditDb = SpreadsheetApp.create('AuditLog');
  var auditSheet = auditDb.getSheetByName('AUDIT_LOG') || auditDb.insertSheet('AUDIT_LOG');
  auditSheet.appendRow(DB_AUDIT_LOG_HEADERS_);
  var defaultSheet2 = auditDb.getSheetByName('Sheet1');
  if (defaultSheet2 && auditDb.getSheets().length > 1) {
    try { auditDb.deleteSheet(defaultSheet2); } catch (e) {}
  }

  // 3. Script Properties 設定
  var pepper = util_generateSalt_() + util_generateSalt_();
  props.setProperty('SHIFT_DB_ID', shiftDb.getId());
  props.setProperty('AUDIT_LOG_ID', auditDb.getId());
  props.setProperty('PASSWORD_PEPPER', pepper);
  props.setProperty('SETUP_DONE', 'true');

  // 4. 初期管理者作成
  var adminLoginId = util_generateLoginId_();
  var adminPassword = util_generatePassword_(16);
  var salt = util_generateSalt_();
  var hash = util_hashPassword_(adminPassword, salt, pepper, 10000);
  var now = util_nowJst_();

  var usersSheet = shiftDb.getSheetByName('USERS');
  usersSheet.appendRow([
    adminLoginId,
    'admin',
    '',
    salt,
    hash,
    '10000',
    'true',
    '0',
    '',
    now
  ]);

  Logger.log('INITIAL_ADMIN loginId=%s password=%s', adminLoginId, adminPassword);
}

function api_login(loginId, password) {
  try {
    if (!loginId || typeof loginId !== 'string' || !password || typeof password !== 'string') {
      return { ok: false, error: 'LOGIN_FAILED' };
    }

    var lock = LockService.getScriptLock();
    var hasLock = lock.tryLock(5000);
    if (!hasLock) return { ok: false, error: 'BUSY' };

    try {
      var users = db_readAllRows_('USERS');
      var user = null;
      for (var i = 0; i < users.length; i++) {
        if (users[i].login_id === loginId) {
          user = users[i];
          break;
        }
      }

      var now = util_nowJst_();

      if (!user) {
        db_logAudit_('LOGIN_FAIL', loginId, 'unknown', '', '', null, { reason: 'not_found' });
        return { ok: false, error: 'LOGIN_FAILED' };
      }

      // ロック確認
      if (user.locked_until && user.locked_until > now) {
        return { ok: false, error: 'LOGIN_LOCKED', details: { lockedUntil: user.locked_until } };
      }

      // パスワード照合
      var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
      var iter = Number(user.hash_iterations) || 10000;
      var computedHash = util_hashPassword_(password, user.password_salt, pepper, iter);

      if (!util_constantTimeEquals_(computedHash, user.password_hash)) {
        var fails = (Number(user.failed_login_count) || 0) + 1;
        var lockedUntil = '';
        if (fails >= 5) {
          lockedUntil = util_addMinutesToJst_(now, 15);
        }
        user.failed_login_count = String(fails);
        user.locked_until = lockedUntil;
        db_updateRow_('USERS', user._rowNum, user);

        db_logAudit_('LOGIN_FAIL', loginId, user.role, user.student_id, '', null, { fails: fails });
        if (fails >= 5) {
          return { ok: false, error: 'LOGIN_LOCKED', details: { lockedUntil: lockedUntil } };
        }
        return { ok: false, error: 'LOGIN_FAILED' };
      }

      // ログイン成功: 失敗回数・ロックをリセット
      user.failed_login_count = '0';
      user.locked_until = '';
      db_updateRow_('USERS', user._rowNum, user);

      // セッション発行 (有効期限120分)
      var token = util_generateToken_();
      var tokenHash = util_sha256Hex_(token);
      var expiresAt = util_addMinutesToJst_(now, 120);

      db_insertRow_('SESSIONS', {
        token_hash: tokenHash,
        login_id: user.login_id,
        role: user.role,
        expires_at: expiresAt,
        created_at: now
      });

      db_logAudit_('LOGIN_OK', user.login_id, user.role, user.student_id, '', null, {});

      return {
        ok: true,
        data: {
          token: token,
          role: user.role,
          mustChangePassword: user.force_password_change === 'true',
          studentId: user.student_id || null
        }
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_logout(token) {
  try {
    if (!token || typeof token !== 'string') return { ok: false, error: 'AUTH_REQUIRED' };

    var auth = auth_verifySession_(token);
    if (!auth.ok) return { ok: false, error: 'AUTH_REQUIRED' };

    var sessions = db_readAllRows_('SESSIONS');
    var tokenHash = util_sha256Hex_(token);
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].token_hash === tokenHash) {
        db_deleteRow_('SESSIONS', sessions[i]._rowNum);
        break;
      }
    }
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function api_changePassword(token, currentPassword, newPassword) {
  try {
    if (!token || typeof token !== 'string') return { ok: false, error: 'AUTH_REQUIRED' };
    if (!currentPassword || typeof currentPassword !== 'string') return { ok: false, error: 'BAD_REQUEST' };
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 10) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    if (currentPassword === newPassword) return { ok: false, error: 'BAD_REQUEST' };

    var auth = auth_verifySession_(token, null, true); // パスワード変更画面なので mustChangePassword を許容
    if (!auth.ok) return auth;

    var user = auth.user;
    var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
    var iter = Number(user.hash_iterations) || 10000;
    var currentHash = util_hashPassword_(currentPassword, user.password_salt, pepper, iter);

    if (!util_constantTimeEquals_(currentHash, user.password_hash)) {
      return { ok: false, error: 'LOGIN_FAILED' };
    }

    var newSalt = util_generateSalt_();
    var newHash = util_hashPassword_(newPassword, newSalt, pepper, iter);

    user.password_salt = newSalt;
    user.password_hash = newHash;
    user.force_password_change = 'false';
    db_updateRow_('USERS', user._rowNum, user);

    db_logAudit_('PASSWORD_CHANGE', user.login_id, user.role, user.student_id, '', null, {});

    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: 'INTERNAL' };
  }
}

function auth_verifySession_(token, requiredRole, allowMustChange) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'AUTH_REQUIRED' };

  var tokenHash = util_sha256Hex_(token);
  var sessions = db_readAllRows_('SESSIONS');
  var now = util_nowJst_();
  var session = null;

  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].token_hash === tokenHash) {
      session = sessions[i];
      break;
    }
  }

  if (!session) return { ok: false, error: 'AUTH_REQUIRED' };
  if (session.expires_at <= now) {
    return { ok: false, error: 'AUTH_REQUIRED' };
  }

  var users = db_readAllRows_('USERS');
  var user = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].login_id === session.login_id) {
      user = users[i];
      break;
    }
  }

  if (!user) return { ok: false, error: 'AUTH_REQUIRED' };

  if (requiredRole && user.role !== requiredRole) {
    return { ok: false, error: 'FORBIDDEN' };
  }

  if (!allowMustChange && user.force_password_change === 'true') {
    return { ok: false, error: 'PASSWORD_CHANGE_REQUIRED' };
  }

  return { ok: true, user: user, session: session };
}
