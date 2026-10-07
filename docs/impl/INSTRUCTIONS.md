# 実装指示書（実装役向け）

この文書は、外国人留学生アルバイト申告アプリを実装する担当者（AI を含む）への指示である。
**この文書が最優先**。次に `docs/impl/SPEC.md`（実装仕様）、次に `docs/source/decisions-2026-09-29.md`、最後に `docs/source/spec-v1.1.md`（原文）。
`docs/source/mockup-v1.webp`（画面見本）は色と配置の参考にだけ使う。**見本の文字・数字・項目・曜日は信用しない**（第9章）。

---

## 第0章 絶対に守ること（違反したら作業は不合格）

1. **テストを変えない。** `test/` の中の既存のファイル（`test/helpers/` を含む）を、変更・削除・名前変更・移動しない。`test.skip`・`test.todo`・`only` を足さない。テストを通すために期待値を書き換えない。
   - テストを増やしたいときは `test/extra/` に新しいファイルを作る。既存のテストと矛盾するテストは書かない。
2. **この文書と `docs/` を変えない。** 例外は第11章の `docs/impl/REPORT.md` と `docs/impl/BLOCKERS.md` だけ。
3. **触ってよいのは `src/`・`test/extra/`・`package.json`（scripts の追加だけ）・`docs/impl/REPORT.md`・`docs/impl/BLOCKERS.md` だけ。** それ以外のファイル（`.github/`・`.claude/`・`AGENTS.md`・`CONTEXT.md`・`README.md`・`GEMINI.md`・`scripts/` など）は開いて読んでよいが、書き換えない。
4. **npm のパッケージを入れない。** `npm install` を実行しない。`node_modules/` と `package-lock.json` を作らない。使うのは Node.js 22 の標準機能だけ。
5. **頼まれていない機能を足さない。** 仕様に無い画面・ボタン・設定・関数・ファイルを作らない。「ついでに良くする」をしない。
6. **第10章の順序を守る。** 前の段階のテストが全部通るまで、次の段階のコードを書かない。
7. **詰まったら止まる。** 同じテストが3回直しても通らないときは、テストを疑って書き換えるのではなく、`docs/impl/BLOCKERS.md` に書いて作業を止める（第11章）。
8. **「全部通った」と書く前に、必ず `npm test` と `npm run check-locked` を実際に実行し、その出力（`# pass`・`# fail` の行と `OK` の行）をそのまま `docs/impl/REPORT.md` に貼る。** 実行していない結果を書かない。

---

## 第1章 作るもの

Google Apps Script（GAS）の Web アプリ。Google スプレッドシートを保存先にする。
学生が翌月のアルバイト予定を入力して確定し、月末に実績を確認する。法令の検算（28時間・長期休業8時間・18歳未満など）はサーバが行う。勤務先・時給・給与は扱わない（2026-10-01 決定。時間だけを見る）。管理者は管理ボードで全体を見る。

詳しい要件は `docs/impl/SPEC.md`。用語は `CONTEXT.md`。

---

## 第2章 作業環境

- Node.js 22 以上。確認: `node --version`
- テストの実行: `npm test`（中身は `node --test "test/**/*.test.js"`）
- 変更禁止のファイルが渡した時のままかの確認: `npm run check-locked`（`OK` と出ること）。自動チェック（GitHub Actions）も同じ確認と、`npm` を通さない `node --test` でのテストを行う
- 一部だけ実行: `node --test test/core/shift-calc.test.js`
- テストは `src/` の `.js` ファイルを**すべて、名前の順に**1つの共有の場所へ読み込む（GAS と同じ）。読み込み方は `test/helpers/load.js` を読めば分かる。
- GAS の機能は、テスト中は `test/helpers/gas-fake.js` の偽物に置き換わる。**偽物にある機能だけを使う**（第4章）。偽物に無い機能を使うとテストが落ちる。そのときに偽物を書き換えてはいけない。

---

## 第3章 ファイル構成（これ以外のファイルを src/ に作らない）

```
src/
  appsscript.json   GAS の設定（下記の内容で固定）
  Code.js           doGet（画面を返すだけ）
  Core.js           計算の心臓部 evaluateMonth と、その内部関数（名前は core_ で始め _ で終える）
  Util.js           日付・文字列・乱数などの小道具
  Db.js             スプレッドシートの読み書き・設定値・監査ログ
  Auth.js           ログイン・パスワード・セッション・setupInitial
  Student.js        学生の窓口（api_getMonth など）
  Admin.js          管理者の窓口（api_admin* のうち印刷以外）
  Print.js          api_adminPrintHtml
  I18n.js           7言語の辞書 I18N（ja・ne・vi・en・my・si・bn）
  Backup.js         backupMonthly・installTriggers（DriveApp と ScriptApp はここでだけ使う）
  index.html        画面の骨組み
  client_css.html   画面の CSS
  client_js.html    画面の JavaScript
```

`appsscript.json` はこの内容にする:

```json
{
  "timeZone": "Asia/Tokyo",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

### コードの書き方

- `import`・`export`・`require` は使わない。どのファイルもトップレベルには「関数の宣言」と「定数の宣言」だけを書く。**トップレベルで他のファイルの関数を呼ばない**（読み込み順で壊れるため）。
- **ブラウザから呼んでよい関数（公開関数）は第6章の一覧だけ。** それ以外のトップレベル関数は、名前の末尾を必ず `_` にする（例: `db_read_`）。GAS は名前が `_` で終わる関数をブラウザから呼べなくする。テスト `test/rules.test.js` が一覧外の公開関数を検出する。
- 日付は `"YYYY-MM-DD"`、日時は `"YYYY-MM-DD HH:MM"`（日本時間、分まで）、年月は `"YYYY-MM"` の**文字列**で扱う。
- 現在の日本時間は `new Date()` の時刻に 9 時間を足し、`getUTC*` で取り出して作る。日本に夏時間は無い。`Utilities.formatDate` は使わない。
- スプレッドシートには**文字列だけ**を書く（数値・真偽値も `String()` してから書く）。読むときは必ず `Number()`・`=== 'true'` などで変換する。テストの偽物は、書いた値をすべて文字列として返す。
- `Date` オブジェクトや配列・オブジェクトをそのままセルに書かない（偽物がエラーにする）。JSON は `JSON.stringify` した文字列で書く。

---

## 第4章 使ってよい GAS の機能（これ以外は使わない）

| 機能 | 使ってよいもの |
| --- | --- |
| SpreadsheetApp | `create(name)`、`openById(id)`、`flush()` |
| Spreadsheet | `getId()`、`getSheetByName(name)`、`insertSheet(name)`、`getSheets()` |
| Sheet | `getRange(row, col, numRows, numCols)`（A1 表記は不可）、`getDataRange()`、`getLastRow()`、`getLastColumn()`、`appendRow(values)`、`deleteRow(row)`、`deleteRows(row, n)`、`setFrozenRows(n)`、`getMaxRows()`、`getMaxColumns()` |
| Range | `getValues()`、`setValues(values)`、`getValue()`、`setValue(v)`、`setNumberFormat(fmt)` |
| LockService | `getScriptLock()` → `tryLock(ms)`、`releaseLock()`、`hasLock()` |
| PropertiesService | `getScriptProperties()` → `getProperty`、`setProperty`、`deleteProperty`、`getProperties` |
| Utilities | `getUuid()`、`computeHmacSha256Signature(value, key)`、`computeDigest(Utilities.DigestAlgorithm.SHA_256, value)`、`base64Encode`、`base64EncodeWebSafe`、`sleep` |
| Logger | `log(format, ...values)`（`%s` の置き換えだけ） |
| HtmlService | `createTemplateFromFile(name)`、`createHtmlOutputFromFile(name)`、`.evaluate()`、`.setTitle()`、`.addMetaTag()`、`.getContent()`（**Code.js の doGet と、画面の部品の読み込みの中でだけ**） |
| DriveApp・ScriptApp | **Backup.js の中でだけ**（第8章） |

- 乱数は `Utilities.getUuid()` から作る。`Math.random` は使わない。
- 使ってはいけないもの（テストが検出する）: `localStorage`・`sessionStorage`・`indexedDB`・`document.cookie`・`Utilities.formatDate`・`Session`・`UrlFetchApp`・`MailApp`・`GmailApp`・`CacheService`・`eval`・`new Function`・外部の JavaScript・CSS・Web フォントの読み込み・PDF 生成。

---

## 第5章 計算の心臓部 `evaluateMonth`（Core.js）

入力と出力の形、判定規則は `docs/impl/SPEC.md` の「モジュール1: 計算の心臓部」に**すべて**書いてある。ここでは、書き漏れやすい点だけを挙げる。

- 画面・スプレッドシート・現在時刻・乱数に触れない。`new Date()`（引数なし）・`Date.now()`・`Math.random`・GAS の機能を Core.js に書かない（テストが検出する）。日付の計算は `new Date(Date.UTC(年, 月-1, 日))` を使う。
- `shifts` のキーは `"1"`〜`"31"` の文字列。`result.shifts` は入力と同じキーと同じ並び順（配列の添字 = `shiftIndex`）で返す。入力エラーのシフトは計算しない。
- `result.daily` は**対象月の全日**のキーを持つ（働かない日は 0）。前月・翌月の日は入れない。
- `codes` の各要素は `{ code, severity, date?, shiftIndex? }`。シフトに関するものは `date` と `shiftIndex`、日に関するものは `date`、7日間に関するものは `date` に**その7日間の初日**を入れ、`windowEnd` に最終日を入れる（2026-10-07 追加。画面はこれを使って「10/26〜11/3」のように出し、その月の中の日の行を赤くする）。`NO_PERMIT`・`PREV_MONTH_DRAFT`・`ACTUAL_OVER` は `date` なし。
- 休憩の位置: `休憩開始 = 開始 + floor(((拘束 − 休憩) ÷ 2) ÷ 15) × 15`。`breakStart`・`breakEnd` は `"HH:MM"`（24時を過ぎたら 00:00 から数え直す）。休憩が0分なら両方 `null`。
- 深夜帯は、開始日の 0:00〜5:00 と 22:00〜翌5:00。休憩と重なる分は数えない（18歳未満の深夜の判定に使う）。
- 7日間の窓は「対象月の初日の6日前」から「対象月の末日」までの各日を初日として作る。
- 18歳未満の7日40時間は、7日間のうち1日でも18歳未満の日を含む窓に当てはめる。どの日も成人の窓で 2,400 分を超えたら `LABOR_HOURS`。
- 成人の1日8時間超は `OVER_8H`（block。2026-10-01 に注意 `LABOR_HOURS` から変更）。長期休業日は `OVER_8H_HOLIDAY` だけを出し、`OVER_8H` を重ねない。実績モードでは `ACTUAL_OVER` の対象。
- 7日間の検算は、**違反した窓ごとに1つ**コードを出す（最初の1つだけで止めない）。`date` はその窓の初日。
- `maxRolling7Minutes` は、28時間の検算をしない窓（7日すべてが長期休業日）も含めた、すべての窓の合計の最大値。
- 時刻は `/^([01]\d|2[0-3]):(00|15|30|45)$/` に合うものだけ（`"9:00"`・`"24:00"`・`"09:10"` は `INVALID_TIME`）。
- シフトは `{ start, end }`。開始・終了のどちらかが無いシフトは `MISSING`。それ以外の項目（古いデータの `workplace` など）は無視する。
- 在籍状態が `退学` で退学日が空、`卒業` で卒業日が空なら、すべてのシフトが `NOT_ENROLLED`。
- `workPermission` が false なら（シフトが1件以上あるとき）`NO_PERMIT`。期限が空でも `NO_PERMIT` にしない（2026-10-03 変更）。`PERMIT_EXPIRED` は `workPermission` が true で期限があるときだけ見る。
- テスト: `test/core/*.test.js`。

---

## 第6章 サーバの窓口（公開関数の一覧と契約）

### 6.1 共通の約束

- 返り値は必ず `{ ok: true, data: ... }` か `{ ok: false, error: 'コード', details?: ... }`。**例外を外に投げない。** 想定外の例外は `{ ok: false, error: 'INTERNAL' }` にする。
- エラーコード: `AUTH_REQUIRED`・`FORBIDDEN`・`PASSWORD_CHANGE_REQUIRED`・`LOGIN_LOCKED`・`LOGIN_FAILED`・`DEADLINE_PASSED`・`NOT_OPEN`・`VERSION_CONFLICT`・`VALIDATION_FAILED`・`BUSY`・`NOT_FOUND`・`BAD_REQUEST`・`INTERNAL`。
- 第1引数はセッショントークン（`api_login` を除く）。**最初に**トークンを確かめる。無効なら `AUTH_REQUIRED`。
- 次に役割を確かめる。学生の窓口を管理者が呼んだら、また管理者の窓口を学生が呼んだら `FORBIDDEN`。**引数の検証より先に行う**（でたらめな引数でも、役割違いなら `FORBIDDEN`）。
- パスワード変更が必要な利用者は、`api_changePassword`・`api_logout` 以外のすべてで `PASSWORD_CHANGE_REQUIRED`。
- 学生の窓口は学籍番号を引数に取らない。対象の学生は必ずセッションから決める。
- 書き込みはスクリプトロックの中で行う: `tryLock(5000)` が false なら `BUSY` を返して何も書かない。ロックは `try { ... } finally { releaseLock() }` で必ず解放する。ロックの中では、対象の行を読み直してから書く。
- 検算（evaluateMonth）はロックの外で行う。
- 成功した書き込みごとに、監査ログ（第7章）に1行追記する。失敗したときは追記しない（`LOGIN_FAIL` を除く）。

### 6.2 確かめる順番（保存系の窓口）

`api_saveDraft`・`api_confirm`・`api_saveActual`・`api_confirmActual` は、この順で確かめ、最初に当てはまったエラーを返す:

1. トークン → `AUTH_REQUIRED`／`PASSWORD_CHANGE_REQUIRED`／`FORBIDDEN`
2. 引数の形（年月・シフトの形・version が0以上の整数か） → `BAD_REQUEST`
3. その月が学校確定済み → `FORBIDDEN`
4. 受付期間。予定と実績で**別々に**見る:
   - 予定（`api_saveDraft`・`api_confirm`）: 締切表に行が無い → `NOT_OPEN`、予定の締切（`deadlineAt`）後で修正許可も無い → `DEADLINE_PASSED`
   - 実績（`api_saveActual`・`api_confirmActual`）: 締切表に行が無い → `NOT_OPEN`、対象月の翌月1日 00:00 より前 → `NOT_OPEN`、実績確認期限後で修正許可も無い → `DEADLINE_PASSED`。**予定の締切は見ない**（予定の締切を過ぎていても実績は保存できる）
5. 検算の結果 → `VALIDATION_FAILED`
6. ロック → `BUSY`
7. version → `VERSION_CONFLICT`
8. 書き込み・監査ログ

**シフトの形（BAD_REQUEST になるもの）**: オブジェクトでない／配列である／キーが `"1"`〜その月の日数の整数表記でない（`"0"`・`"01"`・`"32"` は不可）／値が配列でない／配列の要素がオブジェクトでない／1日に11件以上。
保存する前に、各シフトを `{ start, end }` の2項目だけに整え（それ以外の項目は捨てる）、空の日は消す。

### 6.3 認証

| 関数 | 引数 | 成功時の data | 主なエラー |
| --- | --- | --- | --- |
| `api_login` | `loginId, password` | `{ token, role: 'student'\|'admin', mustChangePassword, studentId: string\|null }` | `LOGIN_FAILED`（IDが無い・パスワード違いを区別しない）、`LOGIN_LOCKED`（`details.lockedUntil`） |（2026-10-01: 学生は `loginId` に学籍番号を入れればパスワード無しで入れる。2026-10-06: クラス名に「国際」を含む学生は K＋学籍番号の下2桁、「総合」を含む学生は S＋下2桁でも入れる（大文字小文字は問わない。同じ番号に2人以上当たるときは入れない）。管理者は従来どおり。2026-10-07: パスワードが入っていて、管理者のログインID（大文字小文字は問わない）と同じなら、学籍番号より先に管理者として照合する）
| `api_logout` | `token` | `null` | `AUTH_REQUIRED` |
| `api_changePassword` | `token, currentPassword, newPassword` | `null` | `LOGIN_FAILED`（現在のパスワード違い）、`LOGIN_LOCKED`（`details.lockedUntil`）、`BAD_REQUEST`（`details.reason`: `PASSWORD_SHORT`＝10文字未満、`PASSWORD_BLANK`＝空白だけ、`SAME_PASSWORD`＝現在と同じ。2026-10-07） |

- 2026-10-07: `api_changePassword`・`api_adminChangeCredentials` の「今のパスワード」の違いも、ログインの失敗と同じ回数に数える（5回でロック、ロック中は `LOGIN_LOCKED`、成功で0に戻す）。パスワードは前後の空白も含めてそのまま扱う（画面でも削らない）。
- 2026-10-07: 管理者のログインIDと大文字小文字を問わず同じ学籍番号は、`api_adminUpsertStudent`（新規）・`api_adminImportRoster` で登録しない（`BAD_REQUEST`、`details: { reason: 'ID_TAKEN', studentId }`。名簿は1人も登録しない）。
- 5回続けて失敗したら、その時点から15分ロック。ロック中は正しいパスワードでも `LOGIN_LOCKED`。ロック時刻を過ぎたら入れる。成功したら失敗回数を0に戻す。**ロック中の試行はパスワードを照合せず、失敗回数にも数えず、ロックを延ばさない。**
- トークン: 128ビット以上のランダム値（`Utilities.getUuid()` を2つ使うなど）。**SESSIONS シートにはトークンの SHA-256 だけを保存する**（平文を保存しない）。有効期限はログイン時刻＋設定の分数（既定120分）。
- パスワード: ユーザーごとのランダムな salt（32文字以上）と、Script Properties の `PASSWORD_PEPPER` を鍵にした HMAC-SHA256 を、ユーザーごとに保存した回数（既定10,000回）反復する。
  例: `h = HMAC(pepper, salt + ':' + password)`、以後 `h = HMAC(pepper, base64(h) + salt)` を繰り返す。比較は1文字ずつ全部比べる（途中で抜けない）。
- ログインID: 8文字。使う文字は `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789`（0・O・1・I・l を除く）。重複しないこと。
- 初期パスワード: 12文字以上のランダム。初回ログインで変更を強制する（`mustChangePassword: true`）。

### 6.4 学生の窓口

| 関数 | 引数 | 成功時の data |
| --- | --- | --- |
| `api_getMonth` | `token, yearMonth` | 下記 |
| `api_saveDraft` | `token, yearMonth, shifts, expectedVersion` | `{ version, status: '下書き', evaluation }` |
| `api_confirm` | `token, yearMonth, shifts, expectedVersion` | `{ version, status: '確定済', evaluation }` |
| `api_saveActual` | `token, yearMonth, shifts, expectedVersion` | `{ version, actualStatus: '未確認', evaluation }`（evaluation は実績モード） |
| `api_confirmActual` | `token, yearMonth, expectedVersion` | `{ version, actualStatus: '予定どおり'\|'修正あり' }` |
| `api_getHistory` | `token` | `[{ yearMonth, status, actualStatus }]`（自分の月だけ、新しい順） |

`api_getMonth` の data:

```
{
  yearMonth, status: '未入力'|'下書き'|'確定済'|'学校確定',
  closed: boolean,             // 締切を過ぎ、有効な修正許可が無い。または notOpen
  notOpen: boolean,            // 締切表にその月・クラスの行が無い（保存・確定・実績はすべて NOT_OPEN。2026-10-07 追加）
  deadlineAt: 'YYYY-MM-DD HH:MM'|null, unlockUntil: 'YYYY-MM-DD HH:MM'|null,
  unlockActive: boolean,       // 締切（予定、または実績の期間中の実績の期限）を過ぎていて、修正許可がまだ有効（2026-10-07 追加）
  version: number,             // 行が無ければ 0
  shifts: {...},               // 保存した予定（行が無ければ {}）
  evaluation: {...},           // 予定を evaluateMonth(mode 'plan') で計算した結果
  holidays: ['YYYY-MM-DD', ...], // その月の長期休業日
  publicHolidays: { 'YYYY-MM-DD': '祝日名' }, // その月の日本の祝日（表示用。法令の判定には使わない）
  actual: { status: '未確認'|'予定どおり'|'修正あり', shifts: {...}|null, evaluation: {...}|null,
            open: boolean, deadlineAt: 'YYYY-MM-DD HH:MM'|null }
}
```

- `api_confirm`: ブロック（severity が block）のコードが1つでもあれば `VALIDATION_FAILED`（`details: { inputErrors: [], codes: [...] }`）で**何も保存しない**。`codes` の要素は evaluateMonth の `codes` と同じ**オブジェクト** `{ code, severity, date?, shiftIndex? }` のうち severity が block のもの（文字列の配列ではない）。注意（warn）だけなら確定する。シフト0件でも確定できる（勤務なし）。
- 入力エラーがあれば、下書きでも実績でも `VALIDATION_FAILED`（`details: { inputErrors: [...], codes: [] }`）で保存しない。
- 確定済みの月を下書き保存したら、状態は下書きに戻る。
- `expectedVersion` は、`api_getMonth` で読んだ `version`（行が無ければ 0）。行の version と違えば `VERSION_CONFLICT`。保存に成功するたびに version を1増やす。予定と実績は同じ行・同じ version を使う。
- 締切: 学生のクラスと年月で締切表（DEADLINES）を引く。行が無ければ `NOT_OPEN`。現在の日時（分まで）が `deadlineAt` より**後**なら締切済み（`deadlineAt` の分ちょうどはまだ受け付ける）。ただし、その行の修正許可 `unlock_until` があり、現在がそれ以前（同じ分を含む）なら受け付ける。
- 実績の受付期間: 対象月の翌月1日 00:00 から、実績確認期限まで。実績確認期限は締切表の `actualDeadlineAt`、空なら「翌月の（設定 `actualConfirmDefaultDay`）日 23:59」。修正許可は実績にも効く。`api_getMonth` の `actual.open` は `api_saveActual` と同じ条件（締切表の行が無い月・学校確定の月は false。2026-10-07）。
- `api_confirmActual`: 実績を一度も保存していなければ `BAD_REQUEST`。予定が確定済みで、実績と予定が同じ（日ごとに、開始・終了の組が並び順を問わず一致）なら「予定どおり」、それ以外は「修正あり」。
- 前月データの取得元（evaluateMonth の `prevMonthSource` と `prevMonthDaily`）:
  1. 前月の末日が入学日より前 → `not_applicable`
  2. 前月が学校確定 → `not_applicable`
  3. 前月の実績が「予定どおり」か「修正あり」 → 実績の日ごとの実働（`actual`）
  4. 前月の予定が確定済み → 予定の日ごとの実働（`confirmed`）
  5. それ以外 → `none`（`{}`）
- 翌月データ（`nextMonthDaily`）は、翌月の行に 3 か 4 が当てはまればその日ごとの実働、無ければ `{}`。

### 6.5 管理者の窓口

| 関数 | 引数 | 成功時の data |
| --- | --- | --- |
| `api_adminUpsertStudent` | `token, student`（`student.mode?: 'create'\|'update'`、`student.expectedVersion?`） | 新規: `{ studentId, created: true, loginId, initialPassword }`、更新: `{ studentId, created: false }`（2026-10-07: 学籍番号は全角を半角にそろえ、大文字小文字を問わず探す。`mode: 'create'` は同じ学籍番号がいれば BAD_REQUEST（`details.reason: 'DUPLICATE'`）、`mode: 'update'` はいなければ NOT_FOUND、mode 無しはこれまでどおり。`expectedVersion` が学生詳細の `version` と違えば VERSION_CONFLICT。生年月日は任意。内容の誤りは BAD_REQUEST に `details: { field, message }`（日本語の理由）を付ける。画面からの追加・編集（mode あり）では DEMO クラスに入れられず、DEMO の学生はクラスを変えられない） |
| `api_adminResetPassword` | `token, studentId` | `{ initialPassword }`（失敗回数・ロックも解除し、変更を強制） |
| `api_adminUnlockLogin` | `token, studentId` | `null` |
| `api_adminCreateAdmin` | `token` | `{ loginId, initialPassword }` |
| `api_adminImportRoster` | `token, { className, enrollmentDate, rows: [{ studentId, name, nameKana }] }`（最大300人） | `{ created: [学籍番号], skipped: [学籍番号], codeConflicts: [{ code, studentIds }] }`（2026-10-02 追加。既存・重複は飛ばす。1行でも形が違えば BAD_REQUEST で何も登録しない。2026-10-07: 形が違う行は `details: { row（1から）, field, message }`。クラス名・学籍番号はそろえる。DEMO には登録できない。`codeConflicts` は、登録した学生の短い番号が在籍中のほかの学生と重なるもの） |
| `api_adminListClasses` / `api_adminAddClass` / `api_adminDeleteClass` | `token` / `token, name` / `token, name` | `[{ name, students }]` / `{ name, exists }` / `null`（2026-10-03 追加。学生がいるクラスは消せない＝BAD_REQUEST、2026-10-07 から `details.message` に人数。追加するクラス名は NFKC・見えない文字の除去・続いた空白を1つにしてそろえ、同じ名前が既にあれば増やさず `exists: true`） |
| `api_adminStudentDetail` | `token, studentId` | `{ student, months: [{ yearMonth, status, actualStatus, shifts, totalMinutes, codes, actual: object\|null, actualTotalMinutes: number\|null, actualCodes, unlockUntil, unlockExpired: boolean, publicHolidays }] }`（新しい月が先。`unlockExpired` は修正許可の期限が今より前。2026-10-07 追加） |
| `api_adminGrantUnlock` | `token, studentId, yearMonth, until` | `null`（行が無ければ未入力の行を作る。version は変えない。`until` は `YYYY-MM-DD HH:MM` か日付だけ `YYYY-MM-DD`（その日の 23:59）。形が違えば BAD_REQUEST `details.reason: 'UNTIL_FORMAT'`、今以前なら BAD_REQUEST `'UNTIL_NOT_FUTURE'`。2026-10-07） |
| `api_adminSchoolConfirm` | `token, studentId, yearMonth` | `null`（年月の形が違えば BAD_REQUEST。断る理由は下記） |
| `api_adminChangeCredentials` | `token, { currentPassword, newLoginId\|null, newPassword\|null }` | `{ loginId }`（自分のIDとパスワードを変える。空欄はそのまま。今のパスワード違いは LOGIN_FAILED。IDは英数字と `._-` の4〜32文字で、他の利用者のIDや学籍番号と大文字小文字を問わず重ならないこと（重なれば BAD_REQUEST、`details.reason: 'ID_TAKEN'`）。パスワードは10文字以上。今のログインは切らない。2026-10-06 追加。2026-10-07: 新しいパスワードが今と同じなら `details.reason: 'SAME_PASSWORD'`、空白だけなら `'PASSWORD_BLANK'`。今のパスワード違いは回数に数え、5回で LOGIN_LOCKED） |
| `api_adminUndoSchoolConfirm` | `token, studentId, yearMonth` | `null`（学校確定の月を未入力に戻す。学校確定でなければ FORBIDDEN `details.reason: 'NOT_SCHOOL_CONFIRMED'`、行が無ければ NOT_FOUND、年月の形が違えば BAD_REQUEST。2026-10-03 追加） |
| `api_adminBoard` | `token, yearMonth, { className?, status?, query? }` | 下記 |
| `api_adminSetDeadline` | `token, { yearMonth, className, deadlineAt, actualDeadlineAt\|null }` | `null`（年月＋クラスで上書き。`actualDeadlineAt` が null・省略なら登録済みの実績確認の期限を残し、空文字 `''` なら消して既定に戻す。実績確認の期限は対象月の末日 23:59 より後（でなければ BAD_REQUEST `details.reason: 'ACTUAL_BEFORE_MONTH_END'`）、かつ予定の期限より後（`'ACTUAL_BEFORE_PLAN'`）。クラスが1つでも登録されている学校では、クラスの表にも学生にも無いクラス名は BAD_REQUEST `'UNKNOWN_CLASS'`。2026-10-07） |
| `api_adminListDeadlines` | `token` | `[{ yearMonth, className, deadlineAt, actualDeadlineAt\|null }]`（登録済みの入力期限。新しい月が先、同じ月はクラス名の順。2026-10-07 追加） |
| `api_adminSetHoliday` | `token, { holidayId?, name, startDate, endDate, schoolYear }` | `{ holidayId }`（開始＞終了は `BAD_REQUEST`） |
| `api_adminDeleteHoliday` | `token, holidayId` | `null` |
| `api_adminListHolidays` | `token` | `[{ holidayId, name, startDate, endDate, schoolYear }]` |
| `api_adminGetSettings` | `token` | `{ schoolName, retentionMonths, timezone, sessionTtlMinutes, allowLeaveOfAbsence, actualConfirmDefaultDay }` |
| `api_adminSetSettings` | `token, 一部の項目` | `null` |
| `api_adminPrintHtml` | `token, { studentIds, yearMonths }` | `{ html }` |
| `api_adminPurgeExpired` | `token` | `{ deletedRows }` |

- `student` の形: `{ studentId, name, className, birthDate, language: 'ja'|'ne'|'vi', enrollmentDate, graduationDate|null, withdrawalDate|null, status: '在籍'|'休学'|'卒業'|'退学', workPermission: boolean, permissionExpires|null, permissionCheckedAt|null }`。学籍番号・氏名・クラスが空、日付の形が違う、言語・在籍状態が一覧外なら `BAD_REQUEST`。既存の学籍番号なら更新し、ログインIDは変えない。
  - 2026-10-07 追加: `birthDate` は空・null でよい。氏名の見えない文字（ゼロ幅の空白など）は取り除き、取り除いて空なら誤り。氏名は100文字まで。学籍番号の中の空白は誤り。次も `BAD_REQUEST`（`details.field` はその項目）: 日付の年が1900〜2100年の外、生年月日が今日より後・入学日より後、卒業日・退学日が入学日より前、「退学」で退学日が無い、「卒業」で卒業日が無い、「在籍」で退学日がある（`field: 'status'`）。
  - 学生詳細の `student` に `version`（その行の版。更新日時は分までなので中身から作る）・`loginCode`（短い番号。在籍中の学生の中で1人に決まるときだけ。無ければ null）・`loginCodeConflict`（在籍中のほかの学生と重なって使えないとき true）を付ける。短い番号で数えるのは、在籍・休学で、卒業日・退学日を過ぎていない学生だけ（ログインも同じ）。
- 学校確定: 学生の在籍状態が 退学・休学・卒業 のどれかで、その月が未入力（行が無い、または状態が未入力）で、入学より前の月（月の末日が入学日より前）でないときだけ。それ以外は `FORBIDDEN` で、`details.reason` に理由（`'STUDENT_ENROLLED'` 在籍中・`'ALREADY_ENTERED'` 入力済み・`'ALREADY_SCHOOL_CONFIRMED'` すでに学校確定・`'BEFORE_ENROLLMENT'` 入学前。2026-10-07）。状態を `学校確定` にし、version を1増やす。
- 設定の既定値: `retentionMonths` 24、`sessionTtlMinutes` 120、`allowLeaveOfAbsence` false、`actualConfirmDefaultDay` 10、`timezone` 'Asia/Tokyo'、`schoolName` ''。

`api_adminBoard` の data:

```
{
  counts: { students, confirmed, draft, notSubmitted, error, outOfScope },
  actualUnconfirmed,
  rows: [{ studentId, name, className, displayStatus: '確定済'|'下書き'|'未提出'|'対象外',
           errorCodes: [...], actualStatus, actualOver: boolean, updatedAt: 'YYYY-MM-DD HH:MM'|null }],
  backup: { configured: boolean, lastAt: 'YYYY-MM-DD HH:MM'|null, warn: boolean }
}
```

- 対象の学生: 入学日がその月の末日以前で、退学日・卒業日（早いほう、無ければ無期限）がその月の初日以後の学生。加えて、その月の行を持つ学生。
- クラスの絞り込みが無い（全クラス）ときは、試用の DEMO クラスの学生を `rows`・`counts` に入れない。`className: 'DEMO'` のときだけ出す（2026-10-07）。
- `counts` はクラスの絞り込みだけを反映する。`rows` は、クラス・状態（`displayStatus` と一致）・検索（学籍番号の前方一致、または氏名の部分一致）をすべて反映する。`rows` は学籍番号の昇順。
- 表示状態: 確定済→確定済、学校確定→対象外、下書き→下書き、行が無い・未入力→未提出。
- `errorCodes`: 表示のたびに、今の学生情報・長期休業・前後の月で計算し直した block のコードの**文字列**の配列（例 `['OVER_28H']`、重複なし。学校確定の月は空。2026-10-03 変更）。`error` は `errorCodes` が空でない行の数。
- `actualOver`: 最後に保存した実績に `ACTUAL_OVER` があれば true。
- `actualUnconfirmed`: 現在が対象月の翌月1日 00:00 以後のときだけ、**ボードの対象の学生（クラスの絞り込み後）**のうち、表示状態が対象外でなく、実績が未確認（スプレッドシートに行が無い学生も未確認）の人数。それより前は 0。
- 締切を過ぎても、下書きの月の表示状態は `下書き` のまま（未提出にしない）。
- `backup`: 保存先（`BACKUP_FOLDER_ID`）が未設定、最後のバックアップ（`LAST_BACKUP_AT`）が無い、または40日以上前なら `warn: true`。
- 一覧を返す前に、保存先フォルダ（「ShiftDB バックアップ」）・毎月の自動実行・最初のバックアップが無ければ用意する（`backup_ensureSetup_`。失敗しても一覧は返す）。
- `errorCodes` の計算では、確定済の月に翌月の下書きの時間を数えない（月をまたぐ28時間超は翌月の側に出る）。学生の `api_getMonth` の表示も同じ。

`api_adminPrintHtml`:

- `studentIds` は1〜50件、`yearMonths` は1〜24件。外れたら `BAD_REQUEST`。
- 学生×月ごとに `<section class="student-page">…</section>` を1つ出す（`class` の値は `student-page` だけにする）。
- 表は紙の予定表と同じ形: 日付(曜日)・勤務予定時間（開始〜終了）・休憩時間・実働(合計)時間を、予定と実績の両方について1日1行で並べ、最後に「勤務予定時間合計」（と実績の合計）を書く。勤務先・時給・給与の欄は無い。
- `<style>` に `@page { size: A4 landscape; }` と `.student-page { break-after: page; }` を**この形のまま**入れる（`@page` の中に余白などを足さない。足したい指定は別の規則に書く）。
- 予定と実績を並べ、実績の超過日は網掛けにする。学校確定の月は「対象外」と表示する。
- 学生の氏名など、保存されている文字は**必ず** `& < > " '` をエスケープする。
- ページの高さは固定せず、はみ出しを切り捨てない（`overflow: hidden` を使わない）。予定の多い月は、`student-page` の `style` の `--fs`（文字 11〜6px）・`--rh`（行の高さ 6.6〜3.5mm）を小さくして全日・合計・署名を A4 縦1枚に収める。最小でも収まらない月は、行の途中で切らずに次の紙へ続ける（2026-10-07）。

`api_adminPurgeExpired`: 現在の年月から保存期間（月数）を引いた年月より前の月次申告の行を消す（例: 2026-10 で24か月 → 2024-09 以前を消し、2024-10 は残す）。

### 6.6 そのほかの公開関数

| 関数 | 役割 |
| --- | --- |
| `doGet()` | `index.html` を返す。`setTitle` とスマートフォン用の viewport を付ける |
| `setupInitial()` | 初期設定（下記）。2回目以降は何もせず `Logger.log('ALREADY_SET_UP')`。`SHIFT_DB_ID` の表が開けて管理者がいるときも作り直さず `Logger.log('SHIFT_DB_EXISTS...')`（表が開けない・管理者がいないときは途中で失敗したとみなして最初から作る） |
| `resetAdminPassword()` | 管理者パスワードの再発行（エディタから実行）。スクリプトのプロパティ `ADMIN_RESET_LOGIN_ID` に管理者のログインIDがあるときだけ動き、そのプロパティを消してから、新しいパスワード（次のログインで変更を求める）を `Logger.log('ADMIN_PASSWORD_RESET loginId=%s password=%s')` に出す |
| `backupMonthly()` | 第8章 |
| `installTriggers()` | 第8章 |
| `evaluateMonth(input)` | 第5章 |

`setupInitial()` が行うこと:

1. `SpreadsheetApp.create('ShiftDB')` と `SpreadsheetApp.create('AuditLog')` を作り、第7章のシートと見出し行を作る。
2. Script Properties に `SHIFT_DB_ID`・`AUDIT_LOG_ID`・`PASSWORD_PEPPER`（32文字以上のランダム）・`SETUP_DONE`（'true'）を置く。
3. 管理者を1人作り、`Logger.log('INITIAL_ADMIN loginId=%s password=%s', ログインID, 初期パスワード)` を**1行だけ**出す（これ以外の形にしない。テストがこの行を読む）。
4. DriveApp は使わない（バックアップ用フォルダは第8章）。

---

## 第7章 シート

ShiftDB の各シートの1行目は見出し（列名）にする。列の並びは次を推奨する（テストは AUDIT_LOG 以外の列の並びに依存しない）。

| シート | 列 |
| --- | --- |
| STUDENTS | student_id, login_id, name, class, birth_date, language, enrollment_date, graduation_date, withdrawal_date, status, work_permission, permission_expires, permission_checked_at, created_at, updated_at |
| USERS | login_id, role, student_id, password_salt, password_hash, hash_iterations, force_password_change, failed_login_count, locked_until, created_at |
| MONTHLY_SUBMISSIONS | submission_id, student_id, year_month, status, shift_json, actual_json, actual_status, total_minutes, max_rolling7_minutes, validation_codes, actual_total_minutes, actual_max_rolling7_minutes, actual_codes, version, confirmed_at, updated_at, unlock_until |
| SCHOOL_HOLIDAYS | holiday_id, name, start_date, end_date, school_year |
| DEADLINES | year_month, class, deadline_at, actual_deadline_at |
| SETTINGS | key, value |
| SESSIONS | token_hash, login_id, role, expires_at, created_at |

AuditLog スプレッドシートの `AUDIT_LOG` シートは、**この列・この順で固定**（テストが読む）:

`timestamp, user_id, role, action, student_id, year_month, version, details`

- `timestamp` は `"YYYY-MM-DD HH:MM"`、`user_id` は操作した人のログインID、`role` は `student`／`admin`。
- `action` は次のどれか: `SAVE_DRAFT`・`CONFIRM`・`ACTUAL_SAVE`・`ACTUAL_CONFIRM`・`LOGIN_OK`・`LOGIN_FAIL`・`PASSWORD_CHANGE`・`PASSWORD_RESET`・`LOGIN_UNLOCK`・`ADMIN_UNLOCK`・`SCHOOL_CONFIRM`・`MASTER_UPDATE`・`PURGE`。
- 保存・確定・学校確定の行には、書き込み後の `version` を入れる。
- パスワード・トークン・秘密鍵を、どのシートにもログにも書かない（テストが全セルを検査する）。

---

## 第8章 バックアップ（Backup.js）

- `backupMonthly()`: Script Properties の `BACKUP_FOLDER_ID` のフォルダへ、ShiftDB と AuditLog を `ShiftDB_YYYY-MM`・`AuditLog_YYYY-MM` の名前で複製する。同じ年月の複製が済んでいれば何もしない（Script Properties の `LAST_BACKUP_YM` で判定）。
- `installTriggers()`: 既存の `backupMonthly` のトリガーを消してから、毎月1日 3時台に `backupMonthly` を呼ぶトリガーを1つ作る。
- `BACKUP_FOLDER_ID` は、管理者が Drive にフォルダを作って手で設定する（第12章の手順書に書く）。
- この2つは自動テストしない。

---

## 第9章 画面

### 9.1 共通

- `index.html` 1枚。ログイン後、役割に応じて学生画面か管理画面を表示する。画面の切り替えは同じページの中で行う（ページを読み直さない）。
- トークンは JavaScript の変数にだけ持つ。ページを読み直したら再ログイン。
- サーバの呼び出しはすべて `google.script.run` の1つの小さな関数を通す。失敗（`withFailureHandler`、または `error: 'BUSY'`）のときは 2秒・4秒・8秒待って最大3回やり直し、それでも駄目なら「混雑中。1分後に再試行」を表示する。
- エラーは辞書の固定語だけで表示する。説明のポップアップは出さない。
- 画面上の計算は表示用。確定できるかはサーバの返事で決める。
- 画面に「法律上問題ありません」などの文言を出さない。確定できたときの表示は「確定済み」だけ。
- `I18N` は `index.html` に `<?!= JSON.stringify(I18N) ?>` などで埋め込む。

### 9.2 学生画面

- 言語切替（日本語｜नेपाली｜Tiếng Việt）を上部に置く。訳が無い語は日本語で表示する。
- 上部に対象月・学籍番号・氏名・提出期限（`deadlineAt`）。
- 学校の紙の予定表と同じ形の表にする（2026-10-01 決定）。1日1行: `1(土)` ｜ 勤務予定時間 `<input type="time" step="900">`〜`<input type="time" step="900">` ｜ 休憩 ｜ 実働。最後の行に「勤務予定時間合計: 72時間」。**曜日は日付から計算する**（見本の曜日は1日ずれていて誤り）。勤務先の欄は無い。
- 休憩・実働・月の合計は、入力のたびに画面の中で計算して表示する（休憩のきまりはサーバと同じ。終了が開始以前なら翌日の終了）。「1時間」「45分」「7時間30分」の形で書く。確定できるかはサーバの返事で決める。
- 開始・終了の両方を空にした日は勤務なし。片方だけなら保存時にサーバが「入力不足」で止める。古いデータで1日に2件以上あれば、その日の行を件数分並べる。
- 日付のあるコードはその日の行の下に、日付の無いコードは表の上に出す。
- 長期休業日（`holidays`）の日は、行全体に色を付け「長期休暇」と表示する。土日は日付の色を変える。
- スマホ（幅 360px）で横にはみ出さないこと。
- ボタンは「途中保存」と「確定」。締切済み（`closed`）なら入力欄とボタンを無効にし「締切済み」とだけ表示する（サーバでも拒否される）。締切表に行が無い月（`notOpen`）は「この月はまだ受付していません。学校に確認してください」、学校確定の月は「対象外」の案内を出す。締切後に修正許可が有効（`unlockActive`）なら、提出期限の代わりに「修正許可: 〜MM/DD HH:MM」を出す（2026-10-07）。
- 実績確認（`actual.open` のとき）: 予定と同じ1日1行の表（日付・勤務時間・休憩・実働、最後に合計）。行ごとに予定を小さく表示し、「予定どおり」で予定のシフトを写す。最後に保存と確認。
- 提出履歴の一覧。

### 9.3 管理画面（日本語だけ）

- 対象月・クラス・状態・検索、件数（学生数・確定済・下書き・未提出・エラー・対象外）、実績未確認。
- 学生一覧（学籍番号・氏名・クラス・状態・エラー・実績・更新日・印刷）。実績超過の学生は赤。
- 学生詳細（学生情報の編集、修正許可、学校確定、パスワード再発行、ロック解除、2年間一括印刷）。
- 締切の設定、長期休業の設定、学校設定、学生の追加、保存期限超過データの削除、クラス一括印刷（50名ずつ）、表示中を一括印刷。
- 印刷は `api_adminPrintHtml` の HTML を新しいウィンドウに書いて `print()` を呼ぶ。

### 9.4 画面見本（mockup-v1.webp）について

色（紺と金）、角丸のカード、ボタンの配置は参考にしてよい。次の点は**見本が誤り**なので真似しない:
曜日（2026/10/1 は木曜）、学籍番号でのログイン、PDF ボタン、200名一括印刷、言語切替が無いこと、実績確認の表示が無いこと、長期休業でない日（10/5）の赤枠、見本内の氏名・金額などの具体的な値。

---

## 第10章 作業の順序と関門

各段階の最後に `npm test` を実行し、**その段階のテストが全部通ったら**コミットしてから次に進む。前の段階のテストが後から落ちたら、次に進まずに直す。

| 段階 | 作るもの | 通すテスト | コミットの見出し |
| --- | --- | --- | --- |
| 1 | `appsscript.json`、`Core.js`（evaluateMonth） | `node --test "test/core/*.test.js"` | `段階1: 計算の心臓部` |
| 2 | `Util.js`・`Db.js`・`Auth.js`（setupInitial・ログイン・ログアウト・パスワード変更）、`api_adminUpsertStudent`・`api_adminResetPassword`・`api_adminUnlockLogin`・`api_getMonth`（読むだけ）、**第6章の公開関数すべての「入口」**（下記） | `node --test test/api/auth.test.js` | `段階2: 認証` |
| 3 | 学生の窓口の残り（保存・確定・実績・履歴）、管理者の `api_adminSetDeadline`・`api_adminGetSettings`・`api_adminSetSettings`・`api_adminGrantUnlock`・`api_adminSchoolConfirm` | `node --test test/api/submission.test.js test/api/actual.test.js test/api/permissions.test.js` | `段階3: 学生の窓口` |
| 4 | 管理者の窓口の残り（ボード・学生詳細・長期休業・管理者の追加・保存期限）、`Print.js` | `node --test test/api/admin.test.js` | `段階4: 管理者の窓口` |
| 5 | `I18n.js`、`Code.js`、`Backup.js` | `npm test`（全部） | `段階5: 辞書と公開関数` |
| 6 | `index.html`・`client_css.html`・`client_js.html` | `npm test`（全部。画面を足しても落ちないこと） | `段階6: 画面` |
| 7 | `docs/impl/REPORT.md`（第11章と第12章） | `npm test` と `npm run check-locked` | `段階7: 完了報告` |

**「入口」とは（段階2）**: 第6章の公開関数を、段階2の時点ですべて名前どおりに作っておく。まだ中身を作らない関数は、最初にトークンと役割の確認（6.1）だけを行い、通ったら `{ ok: false, error: 'INTERNAL' }` を返す仮の形にする。後の段階で、その仮の1行を本当の処理に置き換える。仮の形のまま段階7に進まない（`INTERNAL` を返す仮の窓口が残っていたら未完成）。

- 段階1〜5で画面のファイルを作らない。段階6で `src/*.js` の窓口の振る舞いを変えない（変える必要があれば BLOCKERS.md に書いて止まる）。
- `test/rules.test.js` と `test/i18n.test.js` は段階5で全部通ればよい（それまでは落ちていてよい）。

---

## 第11章 詰まったとき・終わったとき

### 詰まったとき（BLOCKERS.md）

次のどれかに当てはまったら、それ以上コードを書かずに `docs/impl/BLOCKERS.md` に書いて止まる。

- 同じテストが、3回直しても通らない。
- テストと仕様が矛盾していると思う。
- この文書に書いていないことを決めないと進めない。
- 使ってよい GAS の機能（第4章）だけでは実現できない。

書く内容: どのテストか（ファイル名とテスト名）／実行した命令とその出力の最後の30行／自分が何を試したか／何が矛盾していると思うか。**テストや docs を直して解決しない。**

### 終わったとき（REPORT.md）

`docs/impl/REPORT.md` に次を書く。

1. `npm test` を実行した日時と、その出力の最後の8行（`# tests`・`# pass`・`# fail` などの行）をそのまま貼る。`npm run check-locked` の出力も貼る。
2. `git diff --stat <作業開始時のコミット> -- test/ docs/ .github/ scripts/ GEMINI.md AGENTS.md CONTEXT.md` の出力をそのまま貼る（`test/extra/` と `docs/impl/REPORT.md`・`docs/impl/BLOCKERS.md` 以外に変更が無いこと）。
3. 作ったファイルの一覧。
4. 自動テストでは確かめていないこと（画面・バックアップ）と、第12章の手順書の場所。

---

## 第12章 段階7で書く手順書

`docs/impl/REPORT.md` の末尾に、次の手順を日本語で書く（学校の担当者が読む）。

1. 学校が管理する Google アカウントで Apps Script のプロジェクトを作り、`src/` の中身を置く。
2. エディタで `setupInitial` を実行し、実行ログの `INITIAL_ADMIN` の行から管理者のログインIDと初期パスワードを控える。
3. Drive にバックアップ用フォルダを作り、そのIDを Script Properties の `BACKUP_FOLDER_ID` に入れて、`installTriggers` を実行する。
4. 「ウェブアプリとしてデプロイ」（次のユーザーとして実行: 自分、アクセス: 全員）。
5. 管理画面で、長期休業・締切・学生を登録する。
6. 実機確認（iOS Safari と Android Chrome）: ログイン → パスワード変更 → 31日分の入力 → 22:00〜02:00 の入力 → 途中保存 → 確定 → 言語の切替、の順に確かめる項目の一覧。
7. 締切前の負荷確認: 30人程度が同時に保存したときに「混雑中」以外のエラーが出ないか確かめる手順。
