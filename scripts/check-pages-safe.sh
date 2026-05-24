#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/tsutat/Documents/販売管理アプリ"

if [ "$(pwd)" != "$PROJECT_ROOT" ]; then
  echo "ERROR: プロジェクトルートで実行してください: $PROJECT_ROOT" >&2
  exit 1
fi

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

require_file() {
  if [ ! -f "$1" ]; then
    fail "$1 が見つかりません。"
  fi
}

reject_path() {
  if [ -e "$1" ]; then
    fail "$1 は公開用 docs/ に含めないでください。"
  fi
}

report_matches() {
  local label="$1"
  local pattern="$2"
  shift 2
  local matches
  matches="$(grep -RInE "$pattern" "$@" 2>/dev/null | awk -F: '{print $1 ":" $2}' || true)"
  if [ -n "$matches" ]; then
    echo "$matches" >&2
    fail "$label らしき値が docs/ 内に見つかりました。"
  fi
}

if [ ! -d docs ]; then
  fail "docs/ が見つかりません。先に scripts/build-pages.sh を実行してください。"
fi

require_file docs/index.html
require_file docs/styles.css
require_file docs/src/main.mjs
require_file docs/src/csvParser.mjs
require_file docs/src/fileLoader.mjs
require_file docs/src/sheetsPayload.mjs
require_file docs/vendor/jszip.min.js

reject_path docs/gas
reject_path docs/scripts
reject_path docs/tests
reject_path docs/.clasp.json
reject_path docs/.clasprc.json
reject_path docs/.env

if find docs -name '.env.*' -o -name '*.key' -o -name '*.pem' -o -name '*.secret.*' | grep -q .; then
  find docs -name '.env.*' -o -name '*.key' -o -name '*.pem' -o -name '*.secret.*'
  fail "envまたは秘密鍵らしきファイルが docs/ 内に見つかりました。"
fi

safe_targets=(docs/index.html docs/styles.css docs/src)
all_targets=(docs/index.html docs/styles.css docs/src docs/vendor)

report_matches "Apps Script WebアプリURL" 'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+' "${all_targets[@]}"
report_matches "Google APIキー" 'AIza[0-9A-Za-z_-]{20,}' "${all_targets[@]}"
report_matches "OAuthトークン" 'ya29\.[0-9A-Za-z_-]+' "${all_targets[@]}"
report_matches "保存用トークン" 'SAVE_TOKEN[[:space:]]*[:=][[:space:]]*["'\''][^"'\'']+["'\'']' "${safe_targets[@]}"
report_matches "Spreadsheet ID / Drive Folder ID / Script ID" '[A-Za-z0-9_-]{40,}' "${safe_targets[@]}"

echo "docs/ safety check passed."
