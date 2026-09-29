#!/bin/sh
# 実装役が変えてはいけないファイル（テスト・指示書・この仕組み自体）が、渡した時のままかを確かめる。
# 一覧と指紋は test/LOCKED.sha256。実装役はこのファイルも一覧も変更してはならない。
set -e
cd "$(dirname "$0")/.."
if sha256sum --quiet -c test/LOCKED.sha256; then
  echo "OK: 変更禁止のファイルは渡した時のまま"
else
  echo "NG: 変更禁止のファイルが書き換えられている（上の FAILED の行）" >&2
  exit 1
fi
