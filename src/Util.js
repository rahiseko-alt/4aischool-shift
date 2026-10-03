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

// パスワードの保存用ハッシュ: HMAC-SHA256(鍵=秘密鍵, 値=salt + ':' + password) を求め、
// 以後「base64(前の結果) + salt」の HMAC を iterations 回目まで繰り返す（指示書 6.3 の方式）。
// GAS の Utilities を1万回呼ぶと数分かかるため、同じ計算を JavaScript だけで行う。
function util_hashPassword_(password, salt, pepper, iterations) {
  var iter = iterations || 10000;
  var key = util_hmacKey_(util_utf8Bytes_(pepper));
  var sig = util_hmacWithKey_(key, util_utf8Bytes_(salt + ':' + password));
  var saltBytes = util_utf8Bytes_(salt);
  for (var i = 1; i < iter; i++) {
    sig = util_hmacWithKey_(key, util_asciiBytes_(util_base64_(sig)).concat(saltBytes));
  }
  return util_base64_(sig);
}

function util_utf8Bytes_(str) {
  var out = [];
  var s = unescape(encodeURIComponent(String(str)));
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

function util_asciiBytes_(str) {
  var out = new Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

var UTIL_B64_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function util_base64_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var n = (b0 << 16) | (b1 << 8) | b2;
    out += UTIL_B64_.charAt((n >> 18) & 63) + UTIL_B64_.charAt((n >> 12) & 63) +
      (i + 1 < bytes.length ? UTIL_B64_.charAt((n >> 6) & 63) : '=') +
      (i + 2 < bytes.length ? UTIL_B64_.charAt(n & 63) : '=');
  }
  return out;
}

var UTIL_K256_ = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

// SHA-256。bytes は 0〜255 の数の配列。32バイトの配列を返す。
function util_sha256_(bytes) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var len = bytes.length;
  var msg = bytes.slice();
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var bitLenHi = Math.floor(len / 0x20000000), bitLenLo = (len * 8) >>> 0;
  msg.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255,
    (bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);
  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      w[t] = (msg[off + 4 * t] << 24) | (msg[off + 4 * t + 1] << 16) | (msg[off + 4 * t + 2] << 8) | msg[off + 4 * t + 3];
    }
    for (t = 16; t < 64; t++) {
      var x = w[t - 15], y = w[t - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (k + S1 + ch + UTIL_K256_[t] + w[t]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }
  var out = [];
  for (var i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
  return out;
}

// HMAC の鍵は毎回同じなので、内側・外側の詰め物を1回だけ作っておく
function util_hmacKey_(keyBytes) {
  var k = keyBytes.length > 64 ? util_sha256_(keyBytes) : keyBytes.slice();
  while (k.length < 64) k.push(0);
  var ipad = [], opad = [];
  for (var i = 0; i < 64; i++) { ipad.push(k[i] ^ 0x36); opad.push(k[i] ^ 0x5c); }
  return { ipad: ipad, opad: opad };
}

function util_hmacWithKey_(key, msgBytes) {
  return util_sha256_(key.opad.concat(util_sha256_(key.ipad.concat(msgBytes))));
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

// 日本の祝日（表示用。法令の判定には使わない）。{ 'YYYY-MM-DD': '名前' } を返す。
// 国民の祝日に関する法律（2020年以降の形）に沿って計算する。春分・秋分は 1980〜2099年の近似式。
function util_jpHolidays_(year) {
  var y = Number(year);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var key = function (m, d) { return y + '-' + pad(m) + '-' + pad(d); };
  var dow = function (m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  var nthMonday = function (m, n) { var first = dow(m, 1); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
  var shift = (y - 1980) * 0.242194 - Math.floor((y - 1980) / 4);
  var h = {};
  h[key(1, 1)] = '元日';
  h[key(1, nthMonday(1, 2))] = '成人の日';
  h[key(2, 11)] = '建国記念の日';
  h[key(2, 23)] = '天皇誕生日';
  h[key(3, Math.floor(20.8431 + shift))] = '春分の日';
  h[key(4, 29)] = '昭和の日';
  h[key(5, 3)] = '憲法記念日';
  h[key(5, 4)] = 'みどりの日';
  h[key(5, 5)] = 'こどもの日';
  h[key(7, nthMonday(7, 3))] = '海の日';
  h[key(8, 11)] = '山の日';
  h[key(9, nthMonday(9, 3))] = '敬老の日';
  h[key(9, Math.floor(23.2488 + shift))] = '秋分の日';
  h[key(10, nthMonday(10, 2))] = 'スポーツの日';
  h[key(11, 3)] = '文化の日';
  h[key(11, 23)] = '勤労感謝の日';

  var addDays = function (k, n) {
    var t = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)) + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  var base = Object.keys(h).sort();
  // 国民の休日: 前日と翌日が祝日に挟まれた平日
  base.forEach(function (k) {
    var mid = addDays(k, 1), next = addDays(k, 2);
    if (!h[mid] && h[next] && new Date(Date.UTC(y, Number(mid.slice(5, 7)) - 1, Number(mid.slice(8, 10)))).getUTCDay() !== 0) {
      h[mid] = '国民の休日';
    }
  });
  // 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
  base.forEach(function (k) {
    if (new Date(Date.UTC(y, Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))).getUTCDay() !== 0) return;
    var d = addDays(k, 1);
    while (h[d]) d = addDays(d, 1);
    h[d] = '振替休日';
  });
  var out = {};
  Object.keys(h).sort().forEach(function (k) { out[k] = h[k]; });
  return out;
}

// その月の祝日だけ（表示用）
function util_jpHolidaysOfMonth_(yearMonth) {
  var all = util_jpHolidays_(Number(yearMonth.slice(0, 4)));
  var out = {};
  Object.keys(all).forEach(function (k) { if (k.slice(0, 7) === yearMonth) out[k] = all[k]; });
  return out;
}

// 窓口で想定外のエラーが起きたときに記録する（Apps Script の「実行数」の画面に残る）。
// 画面には INTERNAL（システムエラー）としか出ないので、原因はここを見て調べる。
function util_logError_(err) {
  try {
    if (typeof console !== 'undefined' && console.error) console.error(err && err.stack ? err.stack : String(err));
  } catch (e) {}
}

// 表に入っている JSON を読む。壊れていたら fallback を返し、記録に残す（その月だけでなく前後の月まで開けなくなるのを防ぐ）
function util_parseJson_(text, fallback) {
  if (text === undefined || text === null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    util_logError_(new Error('壊れた JSON を読み飛ばした: ' + String(text).slice(0, 80)));
    return fallback;
  }
}
