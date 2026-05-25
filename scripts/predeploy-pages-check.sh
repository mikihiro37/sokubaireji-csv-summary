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

report_matches() {
  local label="$1"
  local pattern="$2"
  local target="$3"
  local matches
  matches="$(grep -RInE "$pattern" "$target" 2>/dev/null | awk -F: '{print $1 ":" $2}' || true)"
  if [ -n "$matches" ]; then
    echo "$matches" >&2
    fail "$label が docs/ 内に見つかりました。"
  fi
}

echo "==> Build pages"
npm run build:pages

echo
echo "==> Check docs safety"
npm run check:pages

echo
echo "==> Public files in docs/"
find docs -type f | sort

echo
echo "==> Extra dangerous path checks"
for path in \
  docs/gas \
  docs/scripts \
  docs/tests \
  docs/node_modules \
  docs/appsscript.json \
  docs/Code.gs \
  docs/README.md \
  docs/package.json \
  docs/.clasp.json \
  docs/.clasprc.json \
  docs/.env
do
  if [ -e "$path" ]; then
    fail "$path は公開対象に含めないでください。"
  fi
done

if find docs -name '.env.*' -o -name '*.key' -o -name '*.pem' -o -name '*.secret.*' | grep -q .; then
  find docs -name '.env.*' -o -name '*.key' -o -name '*.pem' -o -name '*.secret.*'
  fail "envまたは秘密鍵らしきファイルが docs/ 内に見つかりました。"
fi

echo "Extra dangerous paths: OK"

echo
echo "==> Extra secret-like text checks"
safe_targets="docs/index.html docs/styles.css docs/src"
report_matches "Apps ScriptデプロイURLらしき文字列" 'https://script\.google\.com/macros/s/|macros/s/' docs
report_matches "公開不要な設定名" 'SPREADSHEET_ID|PDF_FOLDER_ID|\.clasp|\.clasprc|appsscript\.json|Code\.gs' docs
report_matches "Google APIキーらしき文字列" 'AIza[0-9A-Za-z_-]{20,}' docs
report_matches "OAuthトークンらしき文字列" 'ya29\.[0-9A-Za-z_-]+' docs
report_matches "Google IDらしき長い文字列" '[A-Za-z0-9_-]{45,}' $safe_targets
echo "Extra secret-like text: OK"

echo
echo "==> Git status"
git status --short

echo
echo "==> Git diff stat"
git diff --stat

echo
echo "Predeploy check completed."
echo "ここまでOKなら、Cloudflare Pages Direct Uploadには docs/ の中身だけをアップロードしてください。"
echo "このスクリプトはCloudflareへの自動アップロード、git push、clasp push、Webアプリ再デプロイは行いません。"
