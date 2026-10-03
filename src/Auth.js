// 認証・セッション・初期設定

function setupInitial() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === 'true') {
    Logger.log('ALREADY_SET_UP');
    return;
  }
  // データの表がすでにあるなら作り直さない（やり直すと、学生の入った表とつながらない空の表ができる）
  if (props.getProperty('SHIFT_DB_ID')) {
    Logger.log('SHIFT_DB_EXISTS: 初期設定は済んでいます。やり直す場合はスクリプトのプロパティ SHIFT_DB_ID を消してから');
    return;
  }

  // 1. ShiftDB 作成（全シートを書式なしテキストにしてから見出しを書く）
  var shiftDb = SpreadsheetApp.create('ShiftDB');
  var tableNames = [
    'STUDENTS', 'USERS', 'MONTHLY_SUBMISSIONS',
    'SCHOOL_HOLIDAYS', 'DEADLINES', 'SETTINGS', 'SESSIONS', 'CLASSES'
  ];
  for (var i = 0; i < tableNames.length; i++) {
    var tName = tableNames[i];
    var s = shiftDb.getSheetByName(tName) || shiftDb.insertSheet(tName);
    db_setPlainText_(s);
    s.appendRow(DB_TABLES_[tName]);
    s.setFrozenRows(1);
  }
  setup_removeOtherSheets_(shiftDb, tableNames);

  // 2. AuditLog 作成
  var auditDb = SpreadsheetApp.create('AuditLog');
  var auditSheet = auditDb.getSheetByName('AUDIT_LOG') || auditDb.insertSheet('AUDIT_LOG');
  db_setPlainText_(auditSheet);
  auditSheet.appendRow(DB_AUDIT_LOG_HEADERS_);
  auditSheet.setFrozenRows(1);
  setup_removeOtherSheets_(auditDb, ['AUDIT_LOG']);

  // 3. Script Properties 設定（SETUP_DONE は最後に置く。途中で失敗したら再実行できるように）
  var pepper = util_generateSalt_() + util_generateSalt_();
  props.setProperty('SHIFT_DB_ID', shiftDb.getId());
  props.setProperty('AUDIT_LOG_ID', auditDb.getId());
  props.setProperty('PASSWORD_PEPPER', pepper);

  // 4. 初期管理者作成
  var adminLoginId = util_generateLoginId_();
  var adminPassword = util_generatePassword_(16);
  var salt = util_generateSalt_();
  db_insertRow_('USERS', {
    login_id: adminLoginId,
    role: 'admin',
    student_id: '',
    password_salt: salt,
    password_hash: util_hashPassword_(adminPassword, salt, pepper, 10000),
    hash_iterations: '10000',
    force_password_change: 'true',
    failed_login_count: '0',
    locked_until: '',
    created_at: util_nowJst_()
  });

  props.setProperty('SETUP_DONE', 'true');
  Logger.log('INITIAL_ADMIN loginId=%s password=%s', adminLoginId, adminPassword);
}

// 管理者のパスワードを忘れたときの再発行（Apps Script のエディタから実行する）。
// スクリプトのプロパティ ADMIN_RESET_LOGIN_ID に管理者のログインIDを入れたときだけ動き、1回動くとその許可を消す。
// 新しいパスワードは実行ログに出る（次のログインで変更を求める）。
function resetAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  var loginId = props.getProperty('ADMIN_RESET_LOGIN_ID');
  if (!loginId) {
    Logger.log('NOT_ALLOWED: スクリプトのプロパティ ADMIN_RESET_LOGIN_ID に管理者のログインIDを入れてから実行してください');
    return;
  }
  props.deleteProperty('ADMIN_RESET_LOGIN_ID');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('BUSY: しばらくしてからやり直してください（許可はもう一度入れる）'); return; }
  try {
    var user = db_readAllRows_('USERS').filter(function (u) { return u.login_id === loginId && u.role === 'admin'; })[0];
    if (!user) { Logger.log('NOT_FOUND: その管理者はいません: ' + loginId); return; }
    var password = util_generatePassword_(16);
    var salt = util_generateSalt_();
    user.password_salt = salt;
    user.password_hash = util_hashPassword_(password, salt, props.getProperty('PASSWORD_PEPPER'), 10000);
    user.hash_iterations = '10000';
    user.force_password_change = 'true';
    user.failed_login_count = '0';
    user.locked_until = '';
    db_updateRow_('USERS', user._rowNum, user);
    db_logAudit_('ADMIN_PASSWORD_RESET', 'editor', 'admin', '', '', null, { loginId: loginId });
    Logger.log('ADMIN_PASSWORD_RESET loginId=%s password=%s', loginId, password);
  } finally {
    lock.releaseLock();
  }
}

// 新しいスプレッドシートに最初からある空のシート（言語により名前が違う）を消す。
function setup_removeOtherSheets_(ss, keepNames) {
  ss.getSheets().forEach(function (sh) {
    if (keepNames.indexOf(sh.getName()) < 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) {}
    }
  });
}

// 期限切れのセッションをまとめて消す（ロックの中で呼ぶ）。
function auth_purgeExpiredSessions_(now) {
  db_deleteRowsWhere_('SESSIONS', function (r) { return !r.expires_at || r.expires_at <= now; });
}

function auth_sessionTtlMinutes_() {
  var n = Number(student_getSettings_().sessionTtlMinutes);
  return n >= 5 && n <= 720 ? Math.floor(n) : 120;
}

function api_login(loginId, password) {
  try {
    // 学生は学籍番号だけで入れる（パスワード不要。2026-10-01 利用者の判断。管理者は従来どおりパスワードが要る）
    if (typeof loginId === 'string' && loginId.trim()) {
      var byNumber = auth_loginByStudentNumber_(loginId);
      if (byNumber) return byNumber;
    }
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

      // ロック確認。ロックが切れていたら失敗回数も0から数え直す。
      if (user.locked_until && user.locked_until > now) {
        return { ok: false, error: 'LOGIN_LOCKED', details: { lockedUntil: user.locked_until } };
      }
      if (user.locked_until) {
        user.locked_until = '';
        user.failed_login_count = '0';
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

      // セッション発行（有効期限は設定の分数）。ついでに期限切れのセッションを片付ける。
      auth_purgeExpiredSessions_(now);
      var token = util_generateToken_();
      var tokenHash = util_sha256Hex_(token);
      var expiresAt = util_addMinutesToJst_(now, auth_sessionTtlMinutes_());

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
    util_logError_(err);
    return { ok: false, error: 'INTERNAL' };
  }
}

// 学籍番号（前後の空白・大文字小文字は問わない）に当たる学生がいれば、その学生のセッションを出す。いなければ null
function auth_loginByStudentNumber_(input) {
  var number = input.trim().toUpperCase();
  var student = null;
  db_readAllRows_('STUDENTS').forEach(function (s) { if (String(s.student_id).toUpperCase() === number) student = s; });
  if (!student) return null;
  var user = null;
  db_readAllRows_('USERS').forEach(function (u) { if (u.role === 'student' && u.student_id === student.student_id) user = u; });
  if (!user) return null;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };
  try {
    var now = util_nowJst_();
    auth_purgeExpiredSessions_(now);
    // 学籍番号で入る学生には初回のパスワード変更を求めない
    if (user.force_password_change === 'true') {
      user.force_password_change = 'false';
      db_updateRow_('USERS', user._rowNum, user);
    }
    var token = util_generateToken_();
    db_insertRow_('SESSIONS', {
      token_hash: util_sha256Hex_(token),
      login_id: user.login_id,
      role: 'student',
      expires_at: util_addMinutesToJst_(now, auth_sessionTtlMinutes_()),
      created_at: now
    });
    db_logAudit_('LOGIN_OK', user.login_id, 'student', user.student_id, '', null, { via: 'student_number' });
    return { ok: true, data: { token: token, role: 'student', mustChangePassword: false, studentId: user.student_id } };
  } finally {
    lock.releaseLock();
  }
}

function api_logout(token) {
  try {
    if (!token || typeof token !== 'string') return { ok: false, error: 'AUTH_REQUIRED' };

    var auth = auth_verifySession_(token);
    if (!auth.ok) return { ok: false, error: 'AUTH_REQUIRED' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { ok: false, error: 'BUSY' };
    try {
      // ロックの中で読み直してから消す（他の人の削除で行番号がずれるのを防ぐ）
      var sessions = db_readAllRows_('SESSIONS');
      var tokenHash = util_sha256Hex_(token);
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].token_hash === tokenHash) {
          db_deleteRow_('SESSIONS', sessions[i]._rowNum);
          break;
        }
      }
    } finally {
      lock.releaseLock();
    }
    return { ok: true, data: null };
  } catch (err) {
    util_logError_(err);
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
    util_logError_(err);
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
