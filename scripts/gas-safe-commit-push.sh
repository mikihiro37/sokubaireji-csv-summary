#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/Users/tsutat/Documents/販売管理アプリ"
MESSAGE="${1:-}"
SCRIPT_NAME="$(basename "$0")"

usage() {
  echo "Usage: ./scripts/gas-safe-commit-push.sh \"commit message\""
}

stop() {
  echo "ERROR: $1" >&2
  echo "commit と clasp push は実行していません。" >&2
  exit 1
}

warn() {
  echo "WARNING: $1" >&2
}

run() {
  echo
  echo "==> $*"
  "$@"
}

if [ -z "$MESSAGE" ]; then
  usage
  exit 1
fi

if [ "$(pwd)" != "$PROJECT_ROOT" ]; then
  stop "プロジェクトルートで実行してください: $PROJECT_ROOT"
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  stop "Gitリポジトリではありません。"
fi

if [ "$(git rev-parse --show-toplevel)" != "$PROJECT_ROOT" ]; then
  stop "Gitルートが想定と異なります。"
fi

echo "==> git status --short"
git status --short

if [ -n "$(git status --short -- .clasp.json)" ]; then
  stop ".clasp.json が変更対象に含まれています。"
fi

if [ -e ".clasprc.json" ] || [ -n "$(git status --short -- .clasprc.json)" ]; then
  stop ".clasprc.json がリポジトリ内に存在する、または変更対象に含まれています。"
fi

danger_status="$(git status --short -- .env .env.* "*.key" "*.pem" "*.secret.*" || true)"
if [ -n "$danger_status" ]; then
  echo "$danger_status"
  stop ".env または秘密鍵らしきファイルが変更対象に含まれています。"
fi

untracked_files="$(git ls-files --others --exclude-standard)"
if [ -n "$untracked_files" ]; then
  echo "$untracked_files"
  stop "未追跡ファイルがあります。内容確認後、必要なファイルだけ手動で git add してください。"
fi

if git diff -- gas/appsscript.json appsscript.json | grep -q "oauthScopes"; then
  stop "appsscript.json の oauthScopes に差分があります。権限変更の人間確認が必要です。"
fi

script_id_hits="$(grep -RIn --exclude-dir=.git --exclude=.clasp.json --exclude="$SCRIPT_NAME" "scriptId" . || true)"
if [ -n "$script_id_hits" ]; then
  echo "$script_id_hits"
  stop ".clasp.json 以外に scriptId が含まれています。"
fi

if grep -nE 'var spreadsheetId = "[A-Za-z0-9_-]{25,}"|var saveToken = "[A-Za-z0-9_-]{20,}"|var pdfFolderId = "[A-Za-z0-9_-]{25,}"' gas/Code.gs; then
  stop "setupProperties() 周辺に実ID・実トークンらしき固定値があります。"
fi

if grep -RInE --exclude-dir=.git --exclude=.clasp.json --exclude="$SCRIPT_NAME" '(AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]+|[0-9A-Za-z_-]{40,})' README.md gas src index.html styles.css package.json 2>/dev/null; then
  stop "実ID・トークンらしき長い値がコードまたはREADMEに含まれています。"
fi

run npm test
run bash -c 'node --input-type=commonjs --check < gas/Code.gs'

if [ -f "src/main.mjs" ]; then
  run node --check src/main.mjs
fi

echo
echo "==> git diff --stat"
git diff --stat

changed_files="$(git diff --name-only)"
if [ -z "$changed_files" ]; then
  stop "コミット対象の変更がありません。"
fi

echo
echo "==> git add tracked changes"
echo "$changed_files"
git add -- $changed_files

echo
echo "==> git commit"
git commit -m "$MESSAGE"

echo
echo "==> clasp push"
clasp push

echo
echo "完了しました。Webアプリの新バージョン再デプロイは手動で行ってください。"
echo "OAuth scope変更、Google権限承認、スクリプトプロパティ設定が必要な場合も手動確認してください。"
