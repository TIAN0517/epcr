#!/usr/bin/env bash
# 啟動前確保 SERVICE JWT 存在且 4000 可用
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="$DIR/token.txt"
BUNDLE="https://epcr.tpf.gov.tw:4008/client/main-es2015.0886a0b65c3c5e2b1af8.js"
API="https://epcr.tpf.gov.tw:4000/DispatchRecords/listDispatchDevicesCoords"

fetch_token() {
  curl -sk "$BUNDLE" | python3 -c "
import re,sys
c=sys.stdin.read()
m=re.search(r'JWT_TOKEN:\"(eyJ[^\"]+)\"',c)
if not m: sys.exit(1)
open('$TOKEN','w').write(m.group(1))
"
}

verify_token() {
  [[ -f "$TOKEN" ]] || return 1
  local t
  t="$(tr -d '\n' < "$TOKEN")"
  [[ "$t" == eyJ* ]] || return 1
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $t" "$API" || true)"
  [[ "$code" == "200" ]]
}

if verify_token; then
  exit 0
fi

echo "[ensure_token] 刷新 SERVICE JWT…" >&2
fetch_token
verify_token || { echo "[ensure_token] JWT 仍無效" >&2; exit 1; }
echo "[ensure_token] OK" >&2