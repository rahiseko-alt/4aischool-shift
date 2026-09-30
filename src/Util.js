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

function util_generateLoginId_() {
  var raw = (Utilities.getUuid() + Utilities.getUuid()).replace(/[^a-zA-Z0-9]/g, '');
  var out = '';
  var chars = UTIL_LOGIN_ID_CHARS_;
  for (var i = 0; i < 8; i++) {
    var code = raw.charCodeAt(i % raw.length) + raw.charCodeAt((i + 7) % raw.length) + (i * 13);
    out += chars.charAt(code % chars.length);
  }
  return out;
}

function util_generatePassword_(length) {
  var len = length || 16;
  var raw = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/[^a-zA-Z0-9]/g, '');
  var out = '';
  var chars = UTIL_PASS_CHARS_;
  for (var i = 0; i < len; i++) {
    var code = raw.charCodeAt(i % raw.length) + raw.charCodeAt((i + 11) % raw.length) + (i * 17);
    out += chars.charAt(code % chars.length);
  }
  return out;
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
