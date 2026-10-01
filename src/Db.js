// スプレッドシート読み書き・監査ログ・設定値
// 実装役向けルール: 末尾に _ を付けた関数のみ定義する

var DB_TABLES_ = {
  STUDENTS: [
    'student_id', 'login_id', 'name', 'class', 'birth_date', 'language',
    'enrollment_date', 'graduation_date', 'withdrawal_date', 'status',
    'work_permission', 'permission_expires', 'permission_checked_at',
    'created_at', 'updated_at'
  ],
  USERS: [
    'login_id', 'role', 'student_id', 'password_salt', 'password_hash',
    'hash_iterations', 'force_password_change', 'failed_login_count',
    'locked_until', 'created_at'
  ],
  WORKPLACES: [
    'workplace_id', 'student_id', 'name', 'prefecture', 'job_description',
    'base_hourly_wage', 'early_start', 'early_end', 'early_premium',
    'verification_status', 'verified_by', 'verified_at', 'created_at', 'active'
  ],
  MONTHLY_SUBMISSIONS: [
    'submission_id', 'student_id', 'year_month', 'status', 'shift_json',
    'actual_json', 'actual_status', 'total_minutes', 'max_rolling7_minutes',
    'estimated_salary', 'validation_codes', 'actual_total_minutes',
    'actual_max_rolling7_minutes', 'actual_codes', 'version',
    'confirmed_at', 'updated_at', 'unlock_until'
  ],
  SCHOOL_HOLIDAYS: [
    'holiday_id', 'name', 'start_date', 'end_date', 'school_year'
  ],
  DEADLINES: [
    'year_month', 'class', 'deadline_at', 'actual_deadline_at'
  ],
  MINIMUM_WAGES: [
    'prefecture', 'amount', 'effective_from', 'effective_to'
  ],
  SETTINGS: [
    'key', 'value'
  ],
  SESSIONS: [
    'token_hash', 'login_id', 'role', 'expires_at', 'created_at'
  ]
};

var DB_AUDIT_LOG_HEADERS_ = [
  'timestamp', 'user_id', 'role', 'action', 'student_id', 'year_month', 'version', 'details'
];

// 本物の GAS では openById が1回ごとに時間がかかるので、1回の実行の中では開いたものを使い回す。
var db_openCache_ = {};
function db_openById_(id) {
  if (!db_openCache_[id]) db_openCache_[id] = SpreadsheetApp.openById(id);
  return db_openCache_[id];
}

function db_getShiftDb_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHIFT_DB_ID');
  if (!id) throw new Error('SHIFT_DB_ID is not set in script properties');
  return db_openById_(id);
}

function db_getAuditLogDb_() {
  var id = PropertiesService.getScriptProperties().getProperty('AUDIT_LOG_ID');
  if (!id) throw new Error('AUDIT_LOG_ID is not set in script properties');
  return db_openById_(id);
}

function db_getSheet_(ss, sheetName) {
  var s = ss.getSheetByName(sheetName);
  if (!s) throw new Error('Sheet not found: ' + sheetName);
  return s;
}

// 本物のスプレッドシートは、書いた文字列を日付・時刻・数値・数式に自動で読み替える。
// "2026-10" が日付に、"=USERS!E2" が数式になるのを防ぐため、ShiftDB へは値の先頭に ' を付けて書く
// （' は文字列として固定する印で、本物のスプレッドシートは読み出し時に外す）。読むときも念のため外す。
function db_toCell_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return s === '' ? '' : "'" + s;
}

function db_fromCell_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

// 監査ログは人が読むので ' を付けないが、数式として解釈される文字で始まる値だけは無害化する。
function db_auditCell_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 新しく作ったシートの全体を「書式なしテキスト」にする（自動変換を防ぐ二重の備え）。
function db_setPlainText_(sheet) {
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat('@');
}

function db_readAllRows_(sheetName) {
  var ss = db_getShiftDb_();
  var sheet = db_getSheet_(ss, sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var rowObj = { _rowNum: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      rowObj[db_fromCell_(headers[c])] = db_fromCell_(data[r][c]);
    }
    rows.push(rowObj);
  }
  return rows;
}

function db_insertRow_(sheetName, obj) {
  var ss = db_getShiftDb_();
  var sheet = db_getSheet_(ss, sheetName);
  var headers = DB_TABLES_[sheetName];
  if (!headers) throw new Error('Unknown table: ' + sheetName);

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    row.push(db_toCell_(obj[h]));
  }
  sheet.appendRow(row);
  return obj;
}

// 複数行を1回の書き込みで足す（1行ずつ appendRow すると本物のシートでは遅い）。
function db_insertRows_(sheetName, objs) {
  if (!objs.length) return;
  var sheet = db_getSheet_(db_getShiftDb_(), sheetName);
  var headers = DB_TABLES_[sheetName];
  if (!headers) throw new Error('Unknown table: ' + sheetName);
  var rows = objs.map(function (obj) {
    return headers.map(function (h) { return db_toCell_(obj[h]); });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function db_updateRow_(sheetName, rowNum, obj) {
  var ss = db_getShiftDb_();
  var sheet = db_getSheet_(ss, sheetName);
  var headers = DB_TABLES_[sheetName];
  if (!headers) throw new Error('Unknown table: ' + sheetName);

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    row.push(db_toCell_(obj[h]));
  }
  sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  return obj;
}

function db_deleteRow_(sheetName, rowNum) {
  var ss = db_getShiftDb_();
  var sheet = db_getSheet_(ss, sheetName);
  sheet.deleteRow(rowNum);
}

function db_logAudit_(action, userId, role, studentId, yearMonth, version, details) {
  var ss = db_getAuditLogDb_();
  var sheet = db_getSheet_(ss, 'AUDIT_LOG');
  var ts = util_nowJst_();
  var row = [
    ts,
    String(userId || '').slice(0, 64),
    role || '',
    action,
    studentId || '',
    yearMonth || '',
    version !== undefined && version !== null ? String(version) : '',
    details ? JSON.stringify(details) : ''
  ].map(db_auditCell_);
  sheet.appendRow(row);
}
