'use strict';
// 3言語の固定辞書。実装役はこのファイルを変更してはならない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const app = load();
const I18N = app.plain(app.get('I18N'));

// 仕様書第14章と課題票で決めた、日本語の固定語。
const JA_FIXED = {
  'error.OVER_28H': '28時間超過',
  'error.OVER_8H_HOLIDAY': '8時間超過',
  'error.NO_PERMIT': '許可未確認',
  'error.PERMIT_EXPIRED': '許可期限切れ',
  'error.NOT_ENROLLED': '在籍対象外',
  'error.MINOR_NIGHT': '18歳未満深夜',
  'error.MINOR_OVER': '18歳未満時間超過',
  'error.MISSING': '入力不足',
  'error.PREV_MONTH_DRAFT': '前月未確定',
  'error.LABOR_HOURS': '労基法上要確認',
  'error.ACTUAL_OVER': '実績超過',
  'error.INVALID_TIME': '時刻不正',
  'error.SHIFT_OVERLAP': '時間重複',
  'error.SHIFT_TOO_LONG': '16時間超',
  'error.BUSY': '混雑中。1分後に再試行',
  'error.DEADLINE_PASSED': '締切済み',
};

const API_ERRORS = ['AUTH_REQUIRED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'LOGIN_LOCKED', 'LOGIN_FAILED',
  'DEADLINE_PASSED', 'NOT_OPEN', 'VERSION_CONFLICT', 'VALIDATION_FAILED', 'BUSY', 'NOT_FOUND', 'BAD_REQUEST', 'INTERNAL'];

test('I18N は ja・ne・vi の3つだけを持つ', () => {
  assert.deepEqual(Object.keys(I18N).sort(), ['ja', 'ne', 'vi']);
});

test('3言語のキーが完全に一致する（訳の欠けが無い）', () => {
  const ja = Object.keys(I18N.ja).sort();
  assert.deepEqual(Object.keys(I18N.ne).sort(), ja, 'ne のキーが ja と違う');
  assert.deepEqual(Object.keys(I18N.vi).sort(), ja, 'vi のキーが ja と違う');
});

test('キーは error. / label. / button. のどれかで始まる', () => {
  for (const k of Object.keys(I18N.ja)) assert.match(k, /^(error|label|button)\.[A-Za-z0-9_.]+$/, k);
  for (const g of ['label.', 'button.']) assert.ok(Object.keys(I18N.ja).some((k) => k.startsWith(g)), g + ' のキーが1つも無い');
});

test('すべての値が空でない文字列', () => {
  for (const lang of ['ja', 'ne', 'vi']) {
    for (const [k, v] of Object.entries(I18N[lang])) {
      assert.equal(typeof v, 'string', `${lang}.${k}`);
      assert.ok(v.trim().length > 0, `${lang}.${k} が空`);
    }
  }
});

test('日本語の法令エラーは仕様どおりの固定語', () => {
  for (const [k, v] of Object.entries(JA_FIXED)) assert.equal(I18N.ja[k], v, k);
});

test('窓口のエラーコードもすべて辞書にある', () => {
  for (const c of API_ERRORS) assert.ok(I18N.ja['error.' + c], 'error.' + c);
});

test('ネパール語の error.* はデーバナーガリー文字を含み、日本語をそのまま写していない', () => {
  for (const k of Object.keys(I18N.ja).filter((x) => x.startsWith('error.'))) {
    assert.match(I18N.ne[k], /[ऀ-ॿ]/, 'ne ' + k);
    assert.notEqual(I18N.ne[k], I18N.ja[k], 'ne ' + k);
  }
});

test('ベトナム語の error.* はラテン文字で書かれ、かな・漢字を含まない', () => {
  for (const k of Object.keys(I18N.ja).filter((x) => x.startsWith('error.'))) {
    assert.match(I18N.vi[k], /[A-Za-zÀ-ỹ]/, 'vi ' + k);
    assert.doesNotMatch(I18N.vi[k], /[぀-ヿ一-鿿]/, 'vi ' + k);
  }
});
