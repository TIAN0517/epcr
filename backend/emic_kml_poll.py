#!/usr/bin/env python3
"""
輪詢 EMIC 378.kml → emic_kml.json + 即時推播

- 來源: https://gis2.emic.gov.tw/EMICData/378.kml
- 新案定義: KML 內首次出現的 id（案號優先，否則 lat|lng|報案時間）
- 不限制報案時間/整點；條件 GET 偵測更新後立即 push_alert
- EMIC_KML_POLL_SEC 僅控制檢查頻率（預設 3 秒），非「攒批推播」
"""
import html
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.abspath(__file__))
EMIC_KML_URL = os.environ.get(
    "EMIC_KML_URL", "https://gis2.emic.gov.tw/EMICData/378.kml"
)
OUT_JSON = os.environ.get("EMIC_KML_JSON", os.path.join(BASE, "emic_kml.json"))
KNOWN_FILE = os.path.join(BASE, "emic_kml_known.json")
ALERTS_FILE = os.path.join(BASE, "emic_kml_alerts.json")
POLL_SEC = int(
    os.environ.get(
        "EMIC_KML_POLL_SEC",
        os.environ.get("EMIC_KML_CACHE_SEC", "1"),
    )
)
PUSH_REGION = os.environ.get("EMIC_KML_PUSH_REGION", "all").lower()
PUSH_ACTIVE_ONLY = os.environ.get("EMIC_KML_PUSH_ACTIVE_ONLY", "0").lower() not in (
    "0", "false", "no", "off",
)
_KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
_last_modified = None
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def _county_from_address(address: str) -> str:
    addr = (address or "").strip()
    m = re.match(r"^(.+?[縣市])", addr)
    return m.group(1) if m else ""


def _emic_field(desc, label):
    m = re.search(
        rf">\s*{re.escape(label)}\s*</td>\s*<td[^>]*>\s*([^<]+)",
        desc,
        flags=re.I,
    )
    return html.unescape(m.group(1).strip()) if m else ""


def _report_ms(report_time: str) -> float:
    t = (report_time or "").strip()
    if not t or t.startswith("2026-12-31"):
        return 0.0
    try:
        # YYYY-MM-DD HH:mm:ss
        ts = time.mktime(time.strptime(t[:19], "%Y-%m-%d %H:%M:%S"))
        if ts > time.time() + 86400 * 7:
            return 0.0
        return ts
    except ValueError:
        return 0.0


def parse_emic_kml(xml_text: str) -> list:
    root = ET.fromstring(xml_text)
    styles = {}
    for st in root.findall(".//k:Style", _KML_NS):
        sid = (st.get("id") or "").strip()
        icon_el = st.find(".//k:Icon/k:href", _KML_NS)
        if sid and icon_el is not None and icon_el.text:
            styles[sid] = icon_el.text.strip()

    cases = []
    for pm in root.findall(".//k:Placemark", _KML_NS):
        name_el = pm.find("k:name", _KML_NS)
        desc_el = pm.find("k:description", _KML_NS)
        style_el = pm.find("k:styleUrl", _KML_NS)
        coord_el = pm.find(".//k:Point/k:coordinates", _KML_NS)
        if coord_el is None or not (coord_el.text or "").strip():
            continue
        parts = [p.strip() for p in coord_el.text.split(",")]
        if len(parts) < 2:
            continue
        try:
            lng, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue

        desc = html.unescape(desc_el.text or "") if desc_el is not None else ""
        style_key = (style_el.text or "").lstrip("#").strip() if style_el is not None else ""
        category = _emic_field(desc, "主要類別") or (
            name_el.text if name_el is not None else ""
        )
        status = _emic_field(desc, "案件狀態")
        address = _emic_field(desc, "案件地點")
        report_time = _emic_field(desc, "報案時間")
        case_no = (
            _emic_field(desc, "案號")
            or _emic_field(desc, "案件編號")
            or _emic_field(desc, "CASEID")
        )
        legacy_key = f"{lat}|{lng}|{report_time or len(cases)}"
        case_key = case_no or legacy_key

        cases.append({
            "id": case_key,
            "legacyId": legacy_key,
            "caseNo": case_no or None,
            "name": (name_el.text or category or "災情").strip()
            if name_el is not None
            else category,
            "lat": lat,
            "lng": lng,
            "style": style_key,
            "icon": styles.get(style_key),
            "category": category,
            "status": status,
            "address": address,
            "subCategory": _emic_field(desc, "次要類別"),
            "reportTime": report_time,
            "county": _county_from_address(address),
            "isNtpc": "新北市" in address,
            "isKaohsiung": "高雄市" in address,
            "isActive": status == "處理中",
        })

    def _sort_key(c):
        ms = _report_ms(c.get("reportTime", ""))
        return (0 if ms > 0 else 1, -ms)

    cases.sort(key=_sort_key)
    return cases


def _region_match(c: dict) -> bool:
    if PUSH_REGION in ("kaohsiung", "kh", "高雄"):
        return bool(c.get("isKaohsiung"))
    if PUSH_REGION in ("ntpc", "新北"):
        return bool(c.get("isNtpc"))
    return True


def _load_known() -> set:
    try:
        raw = json.load(open(KNOWN_FILE, encoding="utf-8"))
        return set(raw.get("ids", []))
    except (OSError, json.JSONDecodeError, TypeError):
        return set()


def _save_known(ids: set) -> None:
    tmp = KNOWN_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"ids": sorted(ids)[-5000:]}, f, ensure_ascii=False)
    os.replace(tmp, KNOWN_FILE)


def _case_seen(c: dict, known_ids: set) -> bool:
    cid = c.get("id")
    legacy = c.get("legacyId")
    return (cid and cid in known_ids) or (legacy and legacy in known_ids)


def _detect_push_alerts(cases: list, known_ids: set) -> tuple:
    """首次出現即推播；不卡報案時間、不攒批整點。"""
    alerts = []
    new_known = set(known_ids)
    for c in cases:
        if PUSH_ACTIVE_ONLY and not c.get("isActive"):
            continue
        if not _region_match(c):
            continue
        if _case_seen(c, known_ids):
            continue
        cid = c.get("id")
        if not cid:
            continue
        new_known.add(cid)
        if c.get("legacyId"):
            new_known.add(c["legacyId"])
        addr = (c.get("address") or "—")[:56]
        cat = c.get("category") or c.get("name") or "119"
        county = c.get("county") or (
            "高雄市" if c.get("isKaohsiung") else ("新北市" if c.get("isNtpc") else "全國")
        )
        case_no = c.get("caseNo")
        no_txt = f" #{case_no}" if case_no else ""
        rt = c.get("reportTime") or ""
        sub = c.get("subCategory") or ""
        sub_txt = f"({sub})" if sub else ""
        alerts.append({
            "type": "emic_kml",
            "priority": 1,
            "county": county,
            "msg": f"🚨 {county} {cat}{sub_txt} | {addr}" + (f" | {rt}" if rt else ""),
            "data": c,
        })
    if len(alerts) > 15:
        print(
            f"[BOOTSTRAP] suppress mass push n={len(alerts)} (seed known only)",
            flush=True,
        )
        for c in cases:
            if c.get("id"):
                new_known.add(c["id"])
            if c.get("legacyId"):
                new_known.add(c["legacyId"])
        return [], new_known
    return alerts, new_known


def _fetch_kml_text():
    """條件 GET：未變更回 None（不解析、不等待整點）。"""
    global _last_modified
    headers = {"User-Agent": "EMIC-KML-Poll/2.0"}
    if _last_modified:
        headers["If-Modified-Since"] = _last_modified
    req = urllib.request.Request(EMIC_KML_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25, context=CTX) as r:
            lm = r.headers.get("Last-Modified")
            if lm:
                _last_modified = lm
            xml_text = r.read().decode("utf-8-sig", errors="replace")
            return xml_text, False
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return None, True
        raise


def fetch_and_write() -> dict:
    xml_text, not_modified = _fetch_kml_text()
    if not_modified or not xml_text:
        try:
            cached = json.load(open(OUT_JSON, encoding="utf-8"))
            cached["unchanged"] = True
            return cached
        except (OSError, json.JSONDecodeError, TypeError):
            return {
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": EMIC_KML_URL,
                "unchanged": True,
                "summary": {},
                "cases": [],
            }

    cases = parse_emic_kml(xml_text)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ntpc = sum(1 for c in cases if c.get("isNtpc"))
    kaohsiung = sum(1 for c in cases if c.get("isKaohsiung"))
    active = sum(1 for c in cases if c.get("isActive"))
    known_ids = _load_known()
    push_alerts, new_known = _detect_push_alerts(cases, known_ids)
    if push_alerts:
        try:
            import alerts as alertmod
            for a in push_alerts:
                alertmod.push_alert(a)
            print(f"[PUSH] emic_kml new={len(push_alerts)}", flush=True)
        except Exception as e:
            print(f"[ERR] push: {e}", file=sys.stderr, flush=True)
    if new_known != known_ids:
        _save_known(new_known)
    payload = {
        "updatedAt": now_iso,
        "source": EMIC_KML_URL,
        "pushRegion": PUSH_REGION,
        "summary": {
            "total": len(cases),
            "ntpc": ntpc,
            "kaohsiung": kaohsiung,
            "active": active,
            "ntpcActive": sum(
                1 for c in cases if c.get("isNtpc") and c.get("isActive")
            ),
            "kaohsiungActive": sum(
                1 for c in cases if c.get("isKaohsiung") and c.get("isActive")
            ),
            "shown": len(cases),
        },
        "cases": cases,
    }

    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT_JSON)

    alert_payload = {
        "updatedAt": now_iso,
        "alerts": push_alerts[-20:],
    }
    tmp_a = ALERTS_FILE + ".tmp"
    with open(tmp_a, "w", encoding="utf-8") as f:
        json.dump(alert_payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp_a, ALERTS_FILE)
    return payload


def main():
    once = len(sys.argv) > 1 and sys.argv[1] in ("once", "-1", "--once")
    while True:
        try:
            data = fetch_and_write()
            s = data["summary"]
            extra = " unchanged" if data.get("unchanged") else ""
            print(
                f"[{data['updatedAt']}] EMIC378 poll={POLL_SEC}s region={PUSH_REGION} "
                f"total={s.get('total', 0)} ntpc={s.get('ntpc', 0)} active={s.get('active', 0)}{extra}",
                flush=True,
            )
        except Exception as e:
            print(f"[ERR] {e}", file=sys.stderr, flush=True)
        if once:
            break
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()