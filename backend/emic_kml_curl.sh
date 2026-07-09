#!/bin/bash
# 一鍵列出 EMIC 災情 KML（直接 curl 官方，不讀 dashboard_data.json）
# 用法: ./emic_kml_curl.sh [1=只新北|0=全國]
set -euo pipefail
URL="${EMIC_KML_URL:-https://gis2.emic.gov.tw/EMICData/378.kml}"
NTPC_ONLY="${1:-1}"

curl -sk "$URL" | python3 -c "
import html, re, sys, xml.etree.ElementTree as ET

ntpc_only = '${NTPC_ONLY}' == '1'
ns = {'k': 'http://www.opengis.net/kml/2.2'}
xml = sys.stdin.read()
root = ET.fromstring(xml)

def field(desc, label):
    m = re.search(r'>\s*' + re.escape(label) + r'\s*</td>\s*<td[^>]*>\s*([^<]+)', desc, re.I)
    return html.unescape(m.group(1).strip()) if m else ''

rows = []
for pm in root.findall('.//k:Placemark', ns):
    coord = pm.find('.//k:Point/k:coordinates', ns)
    if coord is None or not (coord.text or '').strip():
        continue
    desc_el = pm.find('k:description', ns)
    desc = html.unescape(desc_el.text or '') if desc_el is not None else ''
    addr = field(desc, '案件地點')
    if ntpc_only and '新北市' not in addr:
        continue
    rows.append((
        field(desc, '報案時間'),
        field(desc, '案件狀態'),
        field(desc, '主要類別'),
        addr[:48],
    ))

rows.sort(reverse=True)
print(f\"{'報案時間':<20} {'狀態':<8} {'類別':<10} 地點\")
print('-' * 90)
for rt, st, cat, addr in rows:
    print(f'{rt:<20} {st:<8} {cat:<10} {addr}')
print(f'\n共 {len(rows)} 筆（ntpc_only={ntpc_only}）')
"