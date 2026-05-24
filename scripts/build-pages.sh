#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/tsutat/Documents/販売管理アプリ"

if [ "$(pwd)" != "$PROJECT_ROOT" ]; then
  echo "ERROR: プロジェクトルートで実行してください: $PROJECT_ROOT" >&2
  exit 1
fi

mkdir -p docs/src docs/vendor

cp index.html docs/index.html
cp styles.css docs/styles.css
cp src/main.mjs docs/src/main.mjs
cp src/csvParser.mjs docs/src/csvParser.mjs
cp src/fileLoader.mjs docs/src/fileLoader.mjs
cp src/sheetsPayload.mjs docs/src/sheetsPayload.mjs
cp vendor/jszip.min.js docs/vendor/jszip.min.js

echo "Copied files:"
printf '%s\n' \
  "docs/index.html" \
  "docs/styles.css" \
  "docs/src/main.mjs" \
  "docs/src/csvParser.mjs" \
  "docs/src/fileLoader.mjs" \
  "docs/src/sheetsPayload.mjs" \
  "docs/vendor/jszip.min.js"
