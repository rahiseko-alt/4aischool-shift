# この置き場所で作業する AI への指示

作業を始める前に `docs/impl/INSTRUCTIONS.md` を最初から最後まで読むこと。そこに書いてあることが最優先である。

特に次の8つを破ったら、作業は不合格になる。

1. `test/` の既存のファイルを変えない。消さない。スキップしない。テストを足すなら `test/extra/` に新しく作る。
2. `docs/`・`.github/`・`.claude/`・`scripts/`・この `GEMINI.md`・`AGENTS.md`・`CONTEXT.md`・`README.md` を変えない（例外: `docs/impl/REPORT.md` と `docs/impl/BLOCKERS.md`）。
3. 書いてよいのは `src/`・`test/extra/`・`package.json` の scripts・上の2つの報告ファイルだけ。
4. `npm install` をしない。外部のライブラリを使わない。
5. 頼まれていない機能・画面・ファイルを足さない。
6. `docs/impl/INSTRUCTIONS.md` 第10章の順番を守る。前の段階のテストが全部通るまで次に進まない。
7. 3回直しても通らないテストがあれば、`docs/impl/BLOCKERS.md` に書いて止まる。テストを書き換えて通さない。
8. 「通った」と書く前に `npm test` と `npm run check-locked` を実際に実行し、その出力を `docs/impl/REPORT.md` に貼る。
