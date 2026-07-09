#!/usr/bin/env bash
# EMIC 全台公開 API 快速探測
# 用法:
#   ./emic_api_probe.sh ems              # 367.json 全國處理中緊急救護統計
#   ./emic_api_probe.sh ems 新北市       # 單縣市處理中案件
#   ./emic_api_probe.sh kml 378          # 下載 KML 圖層
#   ./emic_api_probe.sh layer 367        # 探測單一 EMICData 圖層
#   ./emic_api_probe.sh ws 372 10100 新北市  # WSTransfer 縣市篩選
set -euo pipefail
BASE="https://gis2.emic.gov.tw"
UA="EMIC-Probe/1.0"
today() { date +%Y-%m-%d; }

cmd="${1:-help}"
case "$cmd" in
  ems)
    county="${2:-}"
    curl -sk "$BASE/EMICData/367.json" -H "User-Agent: $UA" | python3 -c "
import sys,json
from collections import Counter
import codecs; d=json.load(codecs.getreader('utf-8-sig')(sys.stdin.buffer))['Root']['Data']
county=sys.argv[1] if len(sys.argv)>1 and sys.argv[1] else ''
rows=[x for x in d if x.get('CASESTATUS')=='處理中' and '緊急救護' in (x.get('DISASTERMAIN_TYPE') or '')]
if county:
    rows=[x for x in rows if x.get('COUNTYN')==county]
    print(f'=== {county} 處理中緊急救護 {len(rows)} 件 ===')
    for x in sorted(rows, key=lambda z: z.get('CASEDT',''))[-20:]:
        print(x.get('CASEDT'), x.get('TOWNN'), (x.get('CASELOC') or '')[:60])
else:
    c=Counter(x.get('COUNTYN') for x in rows)
    print('=== 全國處理中緊急救護', len(rows), '件（依縣市）===')
    for k,v in c.most_common(25):
        print(f'  {k}: {v}')
" "$county"
    ;;
  kml)
    id="${2:-378}"
    out="${3:-/tmp/emic_${id}.kml}"
    curl -sk "$BASE/EMICData/${id}.kml" -H "User-Agent: $UA" -o "$out"
    python3 -c "
import re,sys
xml=open(sys.argv[1],encoding='utf-8',errors='replace').read()
name=re.search(r'<name>([^<]+)</name>', xml)
pm=len(re.findall(r'<Placemark>', xml, re.I))
print(f'layer {sys.argv[2]} name={name.group(1) if name else \"?\"} placemarks={pm} -> {sys.argv[1]}')
" "$out" "$id"
    ;;
  layer)
    id="${2:-367}"
    for ext in json kml; do
      url="$BASE/EMICData/${id}.${ext}"
      code=$(curl -sk -o /tmp/emic_layer.tmp -w '%{http_code}' "$url" -H "User-Agent: $UA" || true)
      if [[ "$code" == "200" ]] && [[ -s /tmp/emic_layer.tmp ]]; then
        echo "OK $url ($(wc -c </tmp/emic_layer.tmp) bytes)"
        head -c 200 /tmp/emic_layer.tmp; echo
        break
      fi
    done
    ;;
  ws)
    sn="${2:-372}"; eoc="${3:-10100}"; city="${4:-新北市}"
    f1="$(today) 00:00:00"; f2="$(today) 23:59:59"
    key="A517BF73C90519F6"
    url="$BASE/EMIC_Transfer/WebService/WSTransfer.ashx?op=GET&SN=${sn}&key=${key}"
    if [[ "$sn" == "372" ]]; then
      url+="&F1=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$f1'))")"
      url+="&F2=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$f2'))")"
      url+="&F3=${eoc}&F4=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$city'))")&F5="
    fi
    curl -sk "$url" -H "User-Agent: $UA" -o /tmp/emic_ws.kml
    python3 -c "import re;xml=open('/tmp/emic_ws.kml',encoding='utf-8',errors='replace').read();print('placemarks',len(re.findall(r'<Placemark>',xml,re.I)),'-> /tmp/emic_ws.kml')"
    ;;
  discase)
    curl -sk -X POST "$BASE/emict/webpages/DVN/EmerPrj.ashx?f=GetDisCase" \
      -H "Content-Type: application/json" -d '{}' -H "User-Agent: $UA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'全國專案 {len(d)} 筆 (EOC_ID 多為 00000)')
for x in d[:5]:
    print(x.get('PRJ_NO'), x.get('CASE_NAME'), x.get('PRJ_ETIME'))
"
    ;;
  projects)
    curl -sk "$BASE/EMICData/375.json" -H "User-Agent: $UA" | python3 -c "
import sys,json,codecs
from collections import Counter
d=json.load(codecs.getreader('utf-8-sig')(sys.stdin.buffer))['Root']['Data']
print(f'375.json 災害專案 {len(d)} 筆')
for k,v in Counter(x.get('EOC_ID') for x in d).most_common(10):
    print(f'  EOC {k}: {v}')
"
    ;;
  weather)
    curl -sk "$BASE/EMICData/205.json" -H "User-Agent: $UA" | python3 -c "
import sys,json,codecs
d=json.load(codecs.getreader('utf-8-sig')(sys.stdin.buffer))['Root']['Data']
print(f'氣象警戒 {len(d)} 筆')
for x in d[:5]:
    print(x.get('PUBDATE'), x.get('TITLE'))
"
    ;;
  catalog)
    for f in EMIC_API_CATALOG.json EMIC_API_DEEP.json; do
      p="$(dirname "$0")/../$f"
      [[ -f "$p" ]] && echo "=== $f ===" && python3 -c "import json;d=json.load(open('$p'));print(json.dumps(d.get('recommended',d.get('summary',{})),ensure_ascii=False,indent=2))"
    done
    ;;
  help|*)
    echo "EMIC API probe — CATALOG: ../EMIC_API_CATALOG.json  DEEP: ../EMIC_API_DEEP.json"
    echo "  $0 ems [縣市名]     # 367.json 緊急救護"
    echo "  $0 kml [圖層ID]     # EMICData KML"
    echo "  $0 layer [圖層ID]   # 探測單圖層"
    echo "  $0 ws [SN] [EOC] [縣市]  # WSTransfer"
    echo "  $0 discase          # EmerPrj GetDisCase (免登入)"
    echo "  $0 projects         # 375.json 災害專案統計"
    echo "  $0 weather          # 205.json 氣象警戒"
    echo "  $0 catalog          # 推薦端點摘要"
    ;;
esac