// 小道具・日付・文字列・暗号化
// 実装役向けルール: 末尾に _ を付けた関数のみ定義する

function util_nowJst_() {
  var d = new Date();
  var jstMs = d.getTime() + 9 * 60 * 60 * 1000;
  var jst = new Date(jstMs);
  var y = jst.getUTCFullYear();
  var m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  var day = String(jst.getUTCDate()).padStart(2, '0');
  var h = String(jst.getUTCHours()).padStart(2, '0');
  var min = String(jst.getUTCMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function util_todayJst_() {
  return util_nowJst_().slice(0, 10);
}

function util_currentYearMonth_() {
  return util_nowJst_().slice(0, 7);
}

function util_uuid_() {
  return Utilities.getUuid();
}

// 紛らわしい文字 0, O, 1, I, l を除いた英数字57文字
var UTIL_LOGIN_ID_CHARS_ = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
// パスワード用にもフォーマット文字列誤動作を防ぐため英数字のみを使用
var UTIL_PASS_CHARS_ = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Utilities.getUuid() の16進数字を乱数源にして、指定の文字から1文字ずつ偏りなく選ぶ。
function util_randomString_(len, chars) {
  var out = '';
  var limit = Math.floor(256 / chars.length) * chars.length;
  while (out.length < len) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    // UUID v4 の固定部分（13桁目の版番号と17桁目の変種）を避け、残りを2桁ずつ使う
    var usable = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
    for (var i = 0; i + 2 <= usable.length && out.length < len; i += 2) {
      var v = parseInt(usable.substr(i, 2), 16);
      if (v < limit) out += chars.charAt(v % chars.length);
    }
  }
  return out;
}

// 既存のログインIDと重ならない新しいIDを作る
function util_generateLoginId_() {
  var used = {};
  try {
    db_readAllRows_('USERS').forEach(function (u) { used[u.login_id] = true; });
  } catch (e) {
    // setupInitial の最初の1人目（まだ表が無い）では重複を気にしなくてよい
  }
  var id;
  do { id = util_randomString_(8, UTIL_LOGIN_ID_CHARS_); } while (used[id]);
  return id;
}

function util_generatePassword_(length) {
  return util_randomString_(Math.max(12, length || 16), UTIL_PASS_CHARS_);
}

function util_isDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
  return d.getUTCMonth() + 1 === Number(s.slice(5, 7)) && d.getUTCDate() === Number(s.slice(8, 10));
}

function util_isDateTime_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(s) && util_isDate_(s.slice(0, 10));
}

function util_isYearMonth_(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function util_isNonEmptyString_(s, max) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= (max || 100);
}

function util_generateSalt_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function util_generateToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function util_sha256Hex_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    var hex = b.toString(16);
    if (hex.length === 1) hex = '0' + hex;
    out += hex;
  }
  return out;
}

function util_hashPassword_(password, salt, pepper, iterations) {
  var iter = iterations || 10000;
  var val = salt + ':' + password;
  var sig = Utilities.computeHmacSha256Signature(val, pepper);
  for (var i = 1; i < iter; i++) {
    val = Utilities.base64Encode(sig) + salt;
    sig = Utilities.computeHmacSha256Signature(val, pepper);
  }
  return Utilities.base64Encode(sig);
}

function util_constantTimeEquals_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var diff = a.length ^ b.length;
  for (var i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ^ b.charCodeAt(i % b.length));
  }
  return diff === 0;
}

function util_addMinutesToJst_(jstStr, minutes) {
  var parts = jstStr.split(' ');
  var dParts = parts[0].split('-');
  var tParts = parts[1].split(':');
  var dt = new Date(Date.UTC(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2]), Number(tParts[0]), Number(tParts[1]) + minutes));
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  var d = String(dt.getUTCDate()).padStart(2, '0');
  var h = String(dt.getUTCHours()).padStart(2, '0');
  var min = String(dt.getUTCMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}
