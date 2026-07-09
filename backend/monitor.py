#!/usr/bin/env python3
"""EPCR 整合監控 — 僅輸出即時新資料"""
import json, os, re, sys, time, datetime, urllib.request, ssl

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "dashboard_data.json")
KNOWN_FILE = os.path.join(BASE, "known_cases.json")
NEW_CASES_FILE = os.path.join(BASE, "new_cases.json")
ADDR_CACHE_FILE = os.path.join(BASE, "addr_cache.json")
TOKEN_FILE = os.path.join(BASE, "..", "token.txt")

VITAL = "https://epcr.tpf.gov.tw:4001"
EPCR = "https://epcr.tpf.gov.tw:4000"
HOSPITAL = "https://epcr.tpf.gov.tw:4002"
EMIC_KML_URL = os.environ.get("EMIC_KML_URL", "https://gis2.emic.gov.tw/EMICData/378.kml")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

STATUS_MAP = {5: "已派遣", 6: "已出發", 7: "已到達", 8: "執行中(有影像)"}
ACTIVE_STATUSES = (5, 6, 7, 8)
# 推播策略：只推現場三段 — 接案(5) / 出發(6) / 到達(7)
# 不推 執行中(有影像=8)、生命徵象、即時影像、送醫/到院相關
PUSH_SCENE_ONLY = os.environ.get("PUSH_SCENE_ONLY", os.environ.get("PUSH_ONLY_DISPATCHED", "1")).lower() not in (
    "0", "false", "no", "off",
)
# 相容舊變數名
PUSH_ONLY_DISPATCHED = PUSH_SCENE_ONLY
PUSH_SCENE_STATUSES = (5, 6, 7)  # 接案、出發、到達
PUSH_LABEL = {5: "接案", 6: "出發", 7: "到達"}
# 只推新北市案件（地址含「新北」或新北郵遞區號）；其它縣市不推
PUSH_NTPC_ONLY = os.environ.get("PUSH_NTPC_ONLY", "1").lower() not in (
    "0", "false", "no", "off",
)
# 新北常見三碼郵遞區號（220–253 等）
_NTPC_ZIP_PREFIXES = (
    "207", "208", "220", "221", "222", "223", "224", "226", "227", "228",
    "231", "232", "233", "234", "235", "236", "237", "238", "239",
    "241", "242", "243", "244", "247", "248", "249", "251", "252", "253",
)

# 時間窗（分鐘）— 只保留新資料
DISPATCH_MAX_MIN = int(os.environ.get("DISPATCH_MAX_MINUTES", "180"))
VITALS_MAX_MIN = int(os.environ.get("VITALS_MAX_MINUTES", "30"))
GPS_LIVE_MIN = int(os.environ.get("GPS_LIVE_MINUTES", "30"))
GPS_MAX_MIN = int(os.environ.get("GPS_MAX_MINUTES", "60"))
EVENTS_MAX_MIN = int(os.environ.get("EVENTS_MAX_MINUTES", "60"))
IMAGES_MAX_MIN = int(os.environ.get("IMAGES_MAX_MINUTES", "60"))
NEW_CASE_MIN = int(os.environ.get("NEW_CASE_MINUTES", "15"))
CASE_RETAIN_MIN = int(os.environ.get("CASE_RETAIN_MINUTES", "15"))
KNOWN_KEEP = int(os.environ.get("KNOWN_CASES_KEEP", "5000"))
ADDR_CACHE_TTL = int(os.environ.get("ADDR_CACHE_TTL", "300"))
ADDR_FETCH_MAX = int(os.environ.get("ADDR_FETCH_MAX", "18"))
EMIC_KML_JSON = os.environ.get(
    "EMIC_KML_JSON", os.path.join(BASE, "emic_kml.json")
)
VITAL_CASE_FETCH_MAX = int(os.environ.get("VITAL_CASE_FETCH_MAX", "12"))
HOSPITAL_FETCH_COUNT = int(os.environ.get("HOSPITAL_FETCH_COUNT", "50"))
DEVICES_FETCH_COUNT = int(os.environ.get("DEVICES_FETCH_COUNT", "80"))

from gps_cases import process_gps_cases, enrich_units_with_gps_cases




def _feature_on(name, default="0"):
    return os.environ.get(name, default).lower() not in ("0", "false", "no", "off")


FEATURE_GPS_CASES = _feature_on("EMIC_FEATURE_GPS_CASES")
FEATURE_EDT = _feature_on("EMIC_FEATURE_EDT")
FEATURE_KML = _feature_on("EMIC_FEATURE_KML")
KML_ALERTS_FILE = os.path.join(BASE, "emic_kml_alerts.json")


def load_kml_alerts():
    if not FEATURE_KML:
        return []
    try:
        raw = json.load(open(KML_ALERTS_FILE, encoding="utf-8"))
        items = raw.get("alerts") or []
        return [a for a in items if a.get("type") == "emic_kml"][:10]
    except (OSError, json.JSONDecodeError, TypeError):
        return []


def fetch(url, token=None, timeout=15):
    headers = {"User-Agent": "EPCR-Monitor/3.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"_error": str(e), "_url": url}


def fetch_text(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "EPCR-Monitor/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.read().decode("utf-8-sig", errors="replace")
    except Exception as e:
        return None


def load_token():
    if os.path.exists(TOKEN_FILE):
        t = open(TOKEN_FILE).read().strip()
        if t.startswith("eyJ"):
            return t
    return None


def verify_token(token):
    """確認 4000 端口 Bearer 有效（GPS 為官方同源接口）。"""
    if not token:
        return False
    r = fetch(f"{EPCR}/DispatchRecords/listDispatchDevicesCoords", token, timeout=12)
    return isinstance(r, list) and len(r) > 0 and "_error" not in r


def ensure_token():
    token = load_token()
    if verify_token(token):
        return token
    token = load_token_from_bundle()
    if token and verify_token(token):
        open(TOKEN_FILE, "w").write(token)
        return token
    return token


def load_token_from_bundle():
    return _bundle_fetch_token()


def _bundle_fetch_token():
    import re
    try:
        req = urllib.request.Request(
            "https://epcr.tpf.gov.tw:4008/client/main-es2015.0886a0b65c3c5e2b1af8.js",
            headers={"User-Agent": "EPCR-Monitor/3.0"},
        )
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            c = r.read().decode()
        m = re.search(r'JWT_TOKEN:"(eyJ[^"]+)"', c)
        return m.group(1) if m else None
    except Exception:
        return None


def load_token_from_bundle():
    return _bundle_fetch_token()


def minutes_ago(iso):
    if not iso:
        return 99999
    try:
        t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 60
    except Exception:
        return 99999


def latest_ts(row, keys):
    vals = [row.get(k) for k in keys if row.get(k)]
    return max(vals) if vals else None


def _trim_status_map(status_map):
    """保留最近 KNOWN_KEEP 筆派遣狀態，避免 known 檔無限膨脹。"""
    if not status_map or len(status_map) <= KNOWN_KEEP:
        return status_map
    keys = list(status_map.keys())[-KNOWN_KEEP:]
    return {key: status_map[key] for key in keys}


def load_known():
    if os.path.exists(KNOWN_FILE):
        try:
            k = json.load(open(KNOWN_FILE))
            status_map = k.get("statusMap") or {}
            if status_map:
                status_map = _trim_status_map(status_map)
                k["statusMap"] = status_map
                k["dispatchUuids"] = list(status_map.keys())
            return k
        except Exception:
            pass
    return {"dispatchUuids": [], "recordUuids": [], "statusMap": {}}


def save_known(k):
    status_map = _trim_status_map(k.get("statusMap") or {})
    k["statusMap"] = status_map
    k["dispatchUuids"] = list(status_map.keys())
    k["recordUuids"] = k.get("recordUuids") or []
    k["recordUuids"] = k["recordUuids"][-KNOWN_KEEP:]
    json.dump(k, open(KNOWN_FILE, "w"))


def build_ambulance_id_map(*record_lists):
    """AmbulanceId → 車編，供 /Devices 直推 GPS 對照。"""
    m = {}
    for records in record_lists:
        for row in records if isinstance(records, list) else []:
            amb = row.get("Ambulance") or {}
            aid = amb.get("id")
            code = amb.get("code")
            if aid and code:
                m[aid] = {
                    "code": code,
                    "licenseNo": amb.get("licenseNo"),
                    "branch": (amb.get("Branch") or {}).get("name"),
                }
    return m


def parse_device_gps(devices_raw, amb_id_map):
    """4000 /Devices 車機直推 GPS（通常比派遣表更即時）。"""
    pts = []
    for dev in devices_raw if isinstance(devices_raw, list) else []:
        lat, lng = dev.get("currentlatitude"), dev.get("currentlongitude")
        if not lat or not lng:
            continue
        gps_age = round(minutes_ago(dev.get("updatedAt")), 1)
        if gps_age > GPS_MAX_MIN:
            continue
        amb = amb_id_map.get(dev.get("AmbulanceId")) or {}
        code = amb.get("code")
        if not code:
            continue
        is_live = gps_age <= GPS_LIVE_MIN
        pts.append({
            "ambulanceCode": code,
            "licenseNo": amb.get("licenseNo"),
            "branch": amb.get("branch"),
            "lat": lat,
            "lng": lng,
            "gpsUpdatedAt": dev.get("updatedAt"),
            "gpsAgeMin": gps_age,
            "isLive": is_live,
            "isStale": not is_live,
            "gpsSource": "devices",
            "deviceId": dev.get("deviceId"),
        })
    pts.sort(key=lambda x: (0 if x.get("isLive") else 1, x.get("gpsAgeMin", 9999)))
    return pts


def merge_gps_sources(dispatch_pts, device_pts):
    """合併 listDispatchDevicesCoords + /Devices，保留較新座標。"""
    by_code = {}
    for pt in dispatch_pts + device_pts:
        code = pt.get("ambulanceCode")
        if not code:
            continue
        prev = by_code.get(code)
        if not prev or pt.get("gpsAgeMin", 99999) < prev.get("gpsAgeMin", 99999):
            row = dict(pt)
            if prev and prev.get("gpsSource") != row.get("gpsSource"):
                row["gpsSource"] = f"{prev.get('gpsSource')}+{row.get('gpsSource')}"
            by_code[code] = row
    out = list(by_code.values())
    out.sort(key=lambda x: (0 if x.get("isLive") else 1, x.get("gpsAgeMin", 9999)))
    return out


def _norm_addr_fragment(s):
    return re.sub(r"\s+", "", (s or ""))[:24]


def poll_emic119():
    """讀 emic_kml_poll 即時寫入的 JSON（推播由 kml_poll 專責，這裡只供儀表板）。"""
    try:
        raw = json.load(open(EMIC_KML_JSON, encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        raw = {}

    cases = raw.get("cases") or []
    ntpc_ems = [
        c for c in cases
        if c.get("isNtpc") and c.get("isActive") and "緊急救護" in (c.get("category") or "")
    ]
    summary = dict(raw.get("summary") or {})
    summary.setdefault("ntpcEmsActive", len(ntpc_ems))
    return {
        "updatedAt": raw.get("updatedAt")
        or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": raw.get("source") or EMIC_KML_URL,
        "summary": summary,
        "cases": cases[:300],
        "ntpcEmsActive": ntpc_ems[:80],
    }


def correlate_emic_epcr(emic_cases, dispatch_list):
    """119 KML 與 EPCR 派遣地址粗對照。"""
    correlations = []
    used = set()
    for d in dispatch_list:
        d_addr = _norm_addr_fragment(d.get("epcrAddress") or d.get("realAddress"))
        if len(d_addr) < 8:
            continue
        for c in emic_cases:
            cid = c.get("id")
            if not cid or cid in used:
                continue
            c_addr = _norm_addr_fragment(c.get("address"))
            if len(c_addr) < 8:
                continue
            if d_addr[:8] in c_addr or c_addr[:8] in d_addr:
                used.add(cid)
                match = {
                    "caseId": cid,
                    "address": c.get("address"),
                    "reportTime": c.get("reportTime"),
                    "category": c.get("category"),
                    "lat": c.get("lat"),
                    "lng": c.get("lng"),
                }
                d["emicMatch"] = match
                correlations.append({
                    "dispatchUuid": d.get("uuid"),
                    "ambulanceCode": d.get("ambulanceCode"),
                    "emicCaseId": cid,
                    "emicAddress": c.get("address"),
                    "emicReportTime": c.get("reportTime"),
                    "match": "address",
                })
                break
    return correlations


def enrich_hospital_eta(dispatch_list, dispatches_raw, hospital_raw):
    """4002 送醫距離/ETA 併入派遣列。"""
    by_pcr, by_code = {}, {}
    for h in hospital_raw if isinstance(hospital_raw, list) else []:
        if minutes_ago(h.get("updatedAt")) > DISPATCH_MAX_MIN:
            continue
        entry = {
            "hospitalDistance": h.get("distance"),
            "hospitalEta": h.get("eta"),
            "hospitalUpdatedAt": h.get("updatedAt"),
            "hospitalRecordUuid": h.get("recordUuid"),
            "hospitalCaseId": h.get("caseId"),
        }
        rid = h.get("recordUuid")
        code = h.get("ambulanceCode")
        if rid:
            by_pcr[rid] = entry
        if code:
            by_code[code] = entry

    raw_by_uuid = {
        r.get("uuid"): r for r in (dispatches_raw if isinstance(dispatches_raw, list) else [])
        if r.get("uuid")
    }
    for d in dispatch_list:
        raw = raw_by_uuid.get(d.get("uuid")) or {}
        pcrs = [p.get("uuid") for p in (raw.get("Pcrs") or []) if p.get("uuid")]
        d["pcrUuids"] = pcrs
        hit = None
        for pcr in pcrs:
            if pcr in by_pcr:
                hit = by_pcr[pcr]
                break
        if not hit:
            hit = by_code.get(d.get("ambulanceCode"))
        if hit:
            d.update(hit)
    return dispatch_list


def fetch_merged_vitals(global_trendings, pcr_uuids):
    """4001 全域 trendings + 執行中 PCR 逐案輪詢（socket.io 替代）。"""
    merged = list(global_trendings) if isinstance(global_trendings, list) else []
    seen = {x.get("recordUuid") for x in merged if x.get("recordUuid")}
    for rid in pcr_uuids[:VITAL_CASE_FETCH_MAX]:
        if not rid or rid in seen:
            continue
        seen.add(rid)
        rows = fetch(f"{VITAL}/trendings?recordUuid={rid}&sort=-createdAt&count=8")
        if isinstance(rows, list):
            merged.extend(rows)
    merged.sort(key=lambda x: x.get("createdAt") or x.get("updatedAt") or "", reverse=True)
    return merged


def parse_gps(gps_data):
    pts = []
    for row in gps_data if isinstance(gps_data, list) else []:
        amb = row.get("Ambulance") or {}
        devs = amb.get("Devices") or []
        if not devs:
            continue
        d = devs[0]
        lat, lng = d.get("currentlatitude"), d.get("currentlongitude")
        if not lat or not lng:
            continue
        sid = row.get("StatusId")
        if sid not in ACTIVE_STATUSES:
            continue
        gps_age = round(minutes_ago(d.get("updatedAt")), 1)
        if gps_age > GPS_MAX_MIN:
            continue
        disp_age = round(minutes_ago(row.get("dispatchedAt")), 1)
        is_live = gps_age <= GPS_LIVE_MIN and sid in ACTIVE_STATUSES
        pts.append({
            "uuid": row.get("uuid"),
            "ambulanceCode": amb.get("code") or row.get("ambulanceCode"),
            "licenseNo": amb.get("licenseNo"),
            "branch": (amb.get("Branch") or {}).get("name"),
            "statusId": sid,
            "statusName": STATUS_MAP.get(sid, f"Status{sid}"),
            "realAddress": row.get("realAddress"),
            "lat": lat,
            "lng": lng,
            "gpsUpdatedAt": d.get("updatedAt"),
            "gpsAgeMin": gps_age,
            "dispatchedAt": row.get("dispatchedAt"),
            "dispAgeMin": disp_age,
            "isLive": is_live,
            "isStale": not is_live,
            "gpsSource": "dispatch_coords",
        })
    pts.sort(key=lambda x: (0 if x.get("isLive") else 1, x.get("gpsAgeMin", 9999)))
    return pts


def _dispatch_row(row, gps_live=False):
    amb = row.get("Ambulance") or {}
    branch = amb.get("Branch") or {}
    uuid = row.get("uuid")
    sid = row.get("StatusId")
    disp_age = round(minutes_ago(row.get("dispatchedAt")), 1)
    act_ts = latest_ts(row, ("arrivedAt", "departedAt", "dispatchedAt"))
    act_age = round(minutes_ago(act_ts), 1)
    return {
        "uuid": uuid,
        "statusId": sid,
        "statusName": STATUS_MAP.get(sid, f"Status{sid}"),
        "branch": branch.get("name"),
        "ambulanceCode": amb.get("code"),
        "licenseNo": amb.get("licenseNo"),
        "dispatchedAt": row.get("dispatchedAt"),
        "departedAt": row.get("departedAt"),
        "arrivedAt": row.get("arrivedAt"),
        "ageMin": round(min(disp_age, act_age), 1),
        "gpsLive": gps_live,
        "hasLiveVideo": sid == 8,
        "mseUrl": f"https://mer2voip.tpf.gov.tw:30080/live?app=rtmp&stream=live{uuid}" if uuid else None,
    }


def parse_dispatches(records, live_gps):
    """僅保留近期派遣；再合併 GPS 仍活躍但派遣表殭屍的車輛。"""
    live_codes = {p["ambulanceCode"] for p in live_gps if p.get("isLive") and p.get("ambulanceCode")}
    by_code = {}
    for row in records if isinstance(records, list) else []:
        sid = row.get("StatusId")
        if sid not in ACTIVE_STATUSES:
            continue
        amb = row.get("Ambulance") or {}
        code = amb.get("code")
        disp_age = minutes_ago(row.get("dispatchedAt"))
        act_age = minutes_ago(latest_ts(row, ("arrivedAt", "departedAt", "dispatchedAt")))
        if disp_age > DISPATCH_MAX_MIN and act_age > DISPATCH_MAX_MIN:
            continue
        item = _dispatch_row(row, gps_live=code in live_codes)
        if code:
            by_code[code] = item

    for p in live_gps:
        if not p.get("isLive"):
            continue
        if p.get("dispAgeMin", 99999) > DISPATCH_MAX_MIN:
            continue
        code = p.get("ambulanceCode")
        if not code or code in by_code:
            continue
        by_code[code] = {
            "uuid": p.get("uuid"),
            "statusId": p.get("statusId"),
            "statusName": p.get("statusName"),
            "branch": p.get("branch"),
            "ambulanceCode": code,
            "licenseNo": p.get("licenseNo"),
            "dispatchedAt": p.get("dispatchedAt"),
            "departedAt": None,
            "arrivedAt": None,
            "ageMin": p.get("dispAgeMin"),
            "gpsLive": True,
            "hasLiveVideo": p.get("statusId") == 8,
            "mseUrl": f"https://mer2voip.tpf.gov.tw:30080/live?app=rtmp&stream=live{p.get('uuid')}" if p.get("uuid") else None,
            "lat": p.get("lat"),
            "lng": p.get("lng"),
            "gpsAgeMin": p.get("gpsAgeMin"),
            "gpsUpdatedAt": p.get("gpsUpdatedAt"),
            "realAddress": p.get("realAddress"),
            "isStale": False,
        }

    cars = list(by_code.values())
    cars.sort(key=lambda x: (0 if x.get("gpsLive") else 1, x.get("ageMin", 9999)))
    return cars


def load_addr_cache():
    if os.path.exists(ADDR_CACHE_FILE):
        try:
            return json.load(open(ADDR_CACHE_FILE))
        except Exception:
            pass
    return {}


def save_addr_cache(cache):
    if len(cache) > 600:
        items = sorted(cache.items(), key=lambda x: x[1].get("ts", 0))[-500:]
        cache = dict(items)
    json.dump(cache, open(ADDR_CACHE_FILE, "w"), ensure_ascii=False)


def _pcr_scene_from_raw(raw_row):
    pcrs = (raw_row or {}).get("Pcrs") or []
    if not pcrs:
        return {}
    p = pcrs[0]
    lat = p.get("latitude") or p.get("lat")
    lng = p.get("longitude") or p.get("lng")
    text = (p.get("sceneAddress") or p.get("patientAddress") or "").strip()
    out = {}
    if lat is not None and lng is not None:
        out["sceneLat"] = lat
        out["sceneLng"] = lng
    if text:
        out["sceneAddressText"] = text
    return out


def _target_address_line(d):
    addr = (
        d.get("targetAddress")
        or d.get("sceneAddressText")
        or d.get("geocodedSceneAddress")
        or d.get("realAddress")
        or d.get("epcrAddress")
    )
    if not addr:
        return ""
    return f" → {addr}"


def enrich_scene_targets(dispatch_list, dispatches_raw, token):
    """案發目標：PCR 座標反查 + patientAddress/sceneAddress（不依賴 378）。"""
    if not dispatch_list:
        return dispatch_list
    raw_by_uuid = {
        r.get("uuid"): r for r in (dispatches_raw if isinstance(dispatches_raw, list) else [])
        if r.get("uuid")
    }
    cache = load_addr_cache()
    now = time.time()
    geocode_budget = ADDR_FETCH_MAX
    try:
        from geocode import reverse_geocode
    except ImportError:
        reverse_geocode = None

    detail_budget = ADDR_FETCH_MAX
    for d in dispatch_list:
        raw = raw_by_uuid.get(d.get("uuid")) or {}
        scene = _pcr_scene_from_raw(raw)
        if (
            token
            and detail_budget > 0
            and d.get("statusId") in (5, 6)
            and (not scene.get("sceneLat") or not scene.get("sceneAddressText"))
        ):
            det = fetch(f"{EPCR}/DispatchRecords/{d.get('uuid')}", token, timeout=10)
            if isinstance(det, dict) and not det.get("_error"):
                detail_budget -= 1
                extra = _pcr_scene_from_raw(det)
                scene = {**scene, **extra}
        d.update(scene)
        uid = d.get("uuid")
        hit = cache.get(uid) if uid else None
        if hit and (now - hit.get("ts", 0)) < ADDR_CACHE_TTL:
            if hit.get("targetAddress"):
                d["targetAddress"] = hit["targetAddress"]
            if hit.get("geocodedSceneAddress"):
                d["geocodedSceneAddress"] = hit["geocodedSceneAddress"]
            if d.get("targetAddress") or d.get("sceneAddressText"):
                continue

        target = d.get("sceneAddressText")
        geo_addr = None
        sid = d.get("statusId")
        if (
            not target
            and reverse_geocode
            and geocode_budget > 0
            and sid in (5, 6)
            and d.get("sceneLat") is not None
            and d.get("sceneLng") is not None
        ):
            geo = reverse_geocode(d["sceneLat"], d["sceneLng"])
            geocode_budget -= 1
            if geo and not geo.get("error"):
                geo_addr = geo.get("fullAddress") or geo.get("short")
                d["geocodedSceneAddress"] = geo_addr
                d["geocodedSceneShort"] = geo.get("short")
        target = target or geo_addr or d.get("realAddress") or d.get("epcrAddress")
        if target:
            d["targetAddress"] = target
        if uid and (target or geo_addr or scene):
            prev = cache.get(uid) or {}
            prev.update({
                "ts": now,
                "targetAddress": target,
                "geocodedSceneAddress": geo_addr,
            })
            cache[uid] = prev
    save_addr_cache(cache)
    return dispatch_list


def enrich_dispatch_addresses(dispatch_list, token):
    """補齊 EPCR 官方地址（派遣詳情），供與 E點通 GPS 反查對照。"""
    if not token or not dispatch_list:
        return dispatch_list
    cache = load_addr_cache()
    now = time.time()
    need = []
    for d in dispatch_list:
        uid = d.get("uuid")
        if not uid:
            continue
        hit = cache.get(uid)
        if hit and (now - hit.get("ts", 0)) < ADDR_CACHE_TTL:
            d["epcrAddress"] = hit.get("epcrAddress")
            d["realAddress"] = hit.get("realAddress") or d.get("realAddress")
            d["caseId"] = hit.get("caseId")
            continue
        need.append(uid)

    for uid in need[:ADDR_FETCH_MAX]:
        det = fetch(f"{EPCR}/DispatchRecords/{uid}", token, timeout=10)
        if not isinstance(det, dict) or det.get("_error"):
            continue
        cr = det.get("CaseRecord") or {}
        cache[uid] = {
            "ts": now,
            "epcrAddress": cr.get("address"),
            "realAddress": det.get("realAddress"),
            "caseId": cr.get("CaseID") or cr.get("caseId"),
        }

    save_addr_cache(cache)
    for d in dispatch_list:
        uid = d.get("uuid")
        hit = cache.get(uid) if uid else None
        if not hit:
            continue
        d["epcrAddress"] = hit.get("epcrAddress")
        d["realAddress"] = hit.get("realAddress") or d.get("realAddress")
        d["caseId"] = hit.get("caseId")
    return dispatch_list


def merge_dispatch_gps(dispatch_list, gps_pts):
    """派遣列表 + GPS 座標合併為即時動態單位。"""
    by_code = {p["ambulanceCode"]: p for p in gps_pts if p.get("ambulanceCode")}
    by_uuid = {p["uuid"]: p for p in gps_pts if p.get("uuid")}
    merged = []
    for d in dispatch_list:
        g = by_code.get(d.get("ambulanceCode")) or by_uuid.get(d.get("uuid"))
        row = dict(d)
        if g:
            row.update({
                "lat": g.get("lat"),
                "lng": g.get("lng"),
                "gpsAgeMin": g.get("gpsAgeMin"),
                "gpsUpdatedAt": g.get("gpsUpdatedAt"),
                "realAddress": g.get("realAddress") or row.get("realAddress"),
                "branch": row.get("branch") or g.get("branch"),
                "gpsLive": g.get("isLive", False),
                "isStale": g.get("isStale", True),
                "gpsSource": g.get("gpsSource"),
            })
        else:
            row.setdefault("gpsLive", row.get("gpsLive", False))
            row.setdefault("isStale", True)
        merged.append(row)
    merged.sort(key=lambda x: (
        0 if x.get("gpsLive") else 1,
        x.get("gpsAgeMin", 9999) if x.get("gpsAgeMin") is not None else 9999,
        x.get("ageMin", 9999),
    ))
    return merged


def parse_edt_kpi(branches, branch_dispatch_sum, case_sample, availability):
    """E點通 resourceManagement 同源 KPI（僅統計，不重複即時派遣 UI）。"""
    kpi = {"source": "resourceManagement", "gpsNote": "同源 API · 8秒輪詢"}
    rows = []

    if isinstance(case_sample, dict) and "_error" not in case_sample:
        kpi["caseSampleSize"] = case_sample.get("CaseSampleSize")
        kpi["avgReactionTime"] = case_sample.get("AvgReactionTime")
        kpi["avgWorkTime"] = case_sample.get("duWorkTime")

    amb_sum = amb_working = 0
    if isinstance(branches, list):
        for b in branches:
            a_sum = b.get("Ambulancesum") or 0
            d_sum = b.get("DispatchRecordsum") or 0
            amb_sum += a_sum
            amb_working += d_sum
            zc = b.get("ZipCode") or {}
            rows.append({
                "name": b.get("name"),
                "district": zc.get("name") if isinstance(zc, dict) else None,
                "ambulanceSum": a_sum,
                "dispatchSum": d_sum,
            })
        rows.sort(key=lambda x: (-(x.get("dispatchSum") or 0), x.get("name") or ""))

    kpi["ambulanceSum"] = amb_sum
    kpi["ambulanceWorking"] = amb_working
    if amb_sum:
        kpi["vehicleUsagePct"] = round(amb_working / amb_sum * 100, 1)

    branch_total = len(branches) if isinstance(branches, list) else 0
    branch_working = len(branch_dispatch_sum) if isinstance(branch_dispatch_sum, list) else 0
    kpi["branchSum"] = branch_total
    kpi["branchWorking"] = branch_working
    if branch_total:
        kpi["branchUsagePct"] = round(branch_working / branch_total * 100, 1)

    if isinstance(availability, dict) and "_error" not in availability:
        kpi["availability"] = availability.get("Availability")
        kpi["prCarUseSum"] = availability.get("PrCarSUseSum")
        kpi["prCarSum"] = availability.get("PrCarSum")

    return kpi, rows


def status_counts(units):
    counts = {5: 0, 6: 0, 7: 0, 8: 0}
    for u in units:
        sid = u.get("statusId")
        if sid in counts:
            counts[sid] += 1
    counts["all"] = len(units)
    return counts


def parse_vitals(trendings):
    active = {}
    for x in trendings if isinstance(trendings, list) else []:
        u = x.get("recordUuid")
        if not u:
            continue
        age_min = minutes_ago(x.get("createdAt"))
        if age_min > VITALS_MAX_MIN:
            continue
        entry = {
            "recordUuid": u,
            "lastSeen": x.get("createdAt"),
            "ageMin": round(age_min, 1),
            "hr": x.get("hr"), "spo2": x.get("spo2"),
            "NBPm": x.get("NBPm"), "NBPs": x.get("NBPs"), "NBPd": x.get("NBPd"),
            "respRate": x.get("respRate"), "temp": x.get("temperature"),
            "CaseID": x.get("CaseID"),
            "streamUrl": f"https://mer2voip.tpf.gov.tw:30080/live?app=rtmp&stream=live{u}",
        }
        if u not in active or x["createdAt"] > active[u]["lastSeen"]:
            active[u] = entry
    live = list(active.values())
    live.sort(key=lambda x: x["lastSeen"], reverse=True)
    return live


def _iso_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _case_id(c):
    return c.get("uuid") or c.get("recordUuid") or ""


def apply_new_case_retention(known, fresh_cases, dispatch_index):
    """新案件首次出現後保留 CASE_RETAIN_MIN 分鐘再從列表移除。"""
    retained = dict(known.get("retainedNewCases") or {})
    for c in fresh_cases:
        key = _case_id(c)
        if not key:
            continue
        if key not in retained:
            retained[key] = {"firstSeenAt": _iso_now(), "case": c}
        else:
            retained[key]["case"] = {**(retained[key].get("case") or {}), **c}

    out = []
    pruned = {}
    for key, entry in retained.items():
        first = entry.get("firstSeenAt")
        age = minutes_ago(first)
        if age > CASE_RETAIN_MIN:
            continue
        case = dict(entry.get("case") or {})
        uid = case.get("uuid")
        if uid and uid in dispatch_index:
            case.update(dispatch_index[uid])
        case["firstSeenAt"] = first
        case["retainSecLeft"] = max(0, int((CASE_RETAIN_MIN - age) * 60))
        out.append(case)
        pruned[key] = entry

    known["retainedNewCases"] = pruned
    out.sort(key=lambda x: x.get("dispatchedAt") or x.get("lastSeen") or "", reverse=True)
    return out[:20]


def filter_recent_items(items, ts_fields, max_min):
    out = []
    for x in items if isinstance(items, list) else []:
        ts = None
        for f in ts_fields:
            if x.get(f):
                ts = x[f]
                break
        if minutes_ago(ts) <= max_min:
            out.append(x)
    out.sort(key=lambda x: x.get(ts_fields[0]) or x.get(ts_fields[1]) or "", reverse=True)
    return out


def _scene_push_msg(d, stage_id):
    """接案/出發/到達 推播文案。"""
    label = PUSH_LABEL.get(stage_id, STATUS_MAP.get(stage_id, str(stage_id)))
    return (
        f"{label} {d.get('ambulanceCode') or '—'} | {d.get('branch') or '—'}"
        f"{_target_address_line(d)}"
    )


def _is_ntpc_case(d):
    """是否為新北市案件（地址 / 郵遞區號 / 分隊文字）。"""
    if not d:
        return False
    parts = [
        d.get("targetAddress"),
        d.get("sceneAddressText"),
        d.get("geocodedSceneAddress"),
        d.get("realAddress"),
        d.get("epcrAddress"),
        d.get("branch"),
        (d.get("data") or {}).get("targetAddress") if isinstance(d.get("data"), dict) else None,
    ]
    blob = " ".join(str(p) for p in parts if p)
    if not blob.strip():
        # 無地址時：EPCR 本體為新北消防，預設視為新北（避免全被濾掉）
        # 若明確要「沒地址就不推」，設 PUSH_NTPC_REQUIRE_ADDR=1
        if os.environ.get("PUSH_NTPC_REQUIRE_ADDR", "0").lower() in ("1", "true", "yes", "on"):
            return False
        return True
    if "新北" in blob:
        return True
    # 開頭三碼郵遞區號
    m = re.match(r"^(\d{3})", blob.strip())
    if m and m.group(1) in _NTPC_ZIP_PREFIXES:
        return True
    # 排除常見外縣市字樣
    for other in ("台北市", "臺北市", "桃園", "基隆", "宜蘭", "新竹", "高雄", "台中", "臺中", "台南", "臺南"):
        if other in blob and "新北" not in blob:
            return False
    return "新北" in blob


def _should_push_alert(alert):
    """外送：只推新北市 + 接案(5)/出發(6)/到達(7)；不推影像、生命徵象、送醫/到院。"""
    if not PUSH_SCENE_ONLY:
        return alert.get("type") in (
            "new_case", "new_vitals", "live_video", "status_change", "emic_kml",
        )
    if alert.get("type") not in ("new_case", "status_change"):
        return False
    data = alert.get("data") or {}
    sid = data.get("statusId")
    if sid not in PUSH_SCENE_STATUSES:
        return False
    if PUSH_NTPC_ONLY and not _is_ntpc_case(data):
        return False
    return True


def detect_new_cases(known, dispatches, vitals):
    alerts = []
    new_cases = []
    known_rec = set(known.get("recordUuids", []))
    status_map = dict(known.get("statusMap") or {})

    for d in dispatches:
        uid = d.get("uuid")
        if not uid:
            continue
        is_new = uid not in status_map
        is_recent = d.get("ageMin", 999) <= NEW_CASE_MIN
        old_status = status_map.get(uid)
        new_status = d.get("statusId")

        if is_new and is_recent:
            new_cases.append({**d, "caseType": "dispatch", "isNew": True})
            # 首次出現且落在 接案/出發/到達 → 推該階段
            if new_status in PUSH_SCENE_STATUSES:
                alerts.append({
                    "type": "new_case" if new_status == 5 else "status_change",
                    "priority": 1 if new_status == 5 else 2,
                    "msg": _scene_push_msg(d, new_status),
                    "data": d,
                })
        elif old_status and new_status != old_status:
            if PUSH_SCENE_ONLY:
                # 只推進入 出發(6) / 到達(7)；進入 8 或其它不推
                if new_status in (6, 7):
                    alerts.append({
                        "type": "status_change",
                        "priority": 2,
                        "msg": (
                            f"{PUSH_LABEL.get(new_status)} {d.get('ambulanceCode') or '—'}: "
                            f"{STATUS_MAP.get(old_status, old_status)} → {STATUS_MAP.get(new_status, new_status)}"
                            f"{_target_address_line(d)}"
                        ),
                        "data": d,
                    })
            else:
                alerts.append({
                    "type": "status_change",
                    "priority": 2,
                    "msg": (
                        f"狀態變更 {d.get('ambulanceCode')}: "
                        f"{STATUS_MAP.get(old_status)} → {d.get('statusName')}"
                        f"{_target_address_line(d)}"
                    ),
                    "data": d,
                })
                if new_status == 8:
                    alerts.append({
                        "type": "live_video",
                        "priority": 1,
                        "msg": f"即時影像上線 {d.get('ambulanceCode')} {d.get('branch')}",
                        "data": d,
                    })
        if uid in status_map:
            del status_map[uid]
        status_map[uid] = new_status

    for v in vitals:
        rid = v.get("recordUuid")
        if not rid:
            continue
        is_new = rid not in known_rec
        is_fresh = v.get("ageMin", 999) <= 10
        if is_new and is_fresh:
            new_cases.append({**v, "caseType": "vitals", "isNew": True})
            # 生命徵象/到院過程不推播（僅儀表板）
            if not PUSH_SCENE_ONLY:
                alerts.append({
                    "type": "new_vitals",
                    "priority": 1,
                    "msg": f"新生命徵象 {rid[:8]}… HR={v.get('hr')} SpO2={v.get('spo2')}",
                    "data": v,
                })
        if not PUSH_SCENE_ONLY:
            if v.get("hr") and str(v["hr"]).isdigit() and int(v["hr"]) > 120:
                alerts.append({"type": "high_hr", "priority": 2, "msg": f"高心率 {rid[:8]}… HR={v['hr']}", "data": v})
            if v.get("spo2") and str(v["spo2"]).isdigit() and int(v["spo2"]) < 90:
                alerts.append({"type": "low_spo2", "priority": 2, "msg": f"低血氧 {rid[:8]}… SpO2={v['spo2']}", "data": v})
        known_rec.add(rid)

    known["recordUuids"] = list(known_rec)
    known["statusMap"] = status_map

    dispatch_index = {d["uuid"]: d for d in dispatches if d.get("uuid")}
    new_cases = apply_new_case_retention(known, new_cases, dispatch_index)

    save_known(known)

    alerts.sort(key=lambda x: x.get("priority", 9))
    return new_cases, alerts[:20]


def poll_once():
    token = ensure_token()
    token_ok = verify_token(token)

    trendings_global = fetch(f"{VITAL}/trendings?sort=-createdAt&count=40")
    images_raw = fetch(f"{VITAL}/ImageData?sort=-createdAt&count=12")
    events_raw = fetch(f"{VITAL}/events?sort=-Timestamp&count=15")

    emic119 = poll_emic119()

    dispatches_raw, gps_raw, devices_raw, branches = [], [], [], []
    hospital_raw = []
    case_sample, branch_dispatch_sum, availability = {}, [], {}
    if token_ok:
        q = "StatusId%5B%24in%5D%5B0%5D=5&StatusId%5B%24in%5D%5B1%5D=6&StatusId%5B%24in%5D%5B2%5D=7&StatusId%5B%24in%5D%5B3%5D=8"
        dispatches_raw = fetch(f"{EPCR}/DispatchRecords?{q}", token)
        gps_raw = fetch(f"{EPCR}/DispatchRecords/listDispatchDevicesCoords", token)
        devices_raw = fetch(
            f"{EPCR}/Devices?sort=-updatedAt&count={DEVICES_FETCH_COUNT}", token
        )
        hospital_raw = fetch(
            f"{HOSPITAL}/Dispatches?sort=-createdAt&count={HOSPITAL_FETCH_COUNT}", token
        )
        branches = fetch(f"{EPCR}/Branches/listBranchWithCaseRecordAndAmbulance", token)
        case_sample = fetch(f"{EPCR}/CaseRecords/CaseSampleSize?isSimulation=false", token)
        branch_dispatch_sum = fetch(f"{EPCR}/DispatchRecords/branchDispatchRecordSum", token)
        availability = fetch(f"{EPCR}/Ambulances/calculateAmbulanceAvailability", token)

    amb_map = build_ambulance_id_map(dispatches_raw, gps_raw)
    gps_dispatch_pts = parse_gps(gps_raw)
    gps_device_pts = parse_device_gps(devices_raw, amb_map)
    gps_pts = merge_gps_sources(gps_dispatch_pts, gps_device_pts)

    dispatch_list = merge_dispatch_gps(parse_dispatches(dispatches_raw, gps_pts), gps_pts)
    dispatch_list = enrich_dispatch_addresses(dispatch_list, token if token_ok else None)
    dispatch_list = enrich_scene_targets(dispatch_list, dispatches_raw, token if token_ok else None)
    dispatch_list = enrich_hospital_eta(dispatch_list, dispatches_raw, hospital_raw)
    emic_correlations = correlate_emic_epcr(
        emic119.get("ntpcEmsActive") or [], dispatch_list
    )

    pcr_uuids = []
    for d in dispatch_list:
        pcr_uuids.extend(d.get("pcrUuids") or [])
    trendings = fetch_merged_vitals(trendings_global, pcr_uuids)
    vitals = parse_vitals(trendings)
    sc = status_counts(dispatch_list)

    events = filter_recent_items(events_raw, ("Timestamp", "createdAt"), EVENTS_MAX_MIN)
    images = filter_recent_items(images_raw, ("createdAt",), IMAGES_MAX_MIN)

    known = load_known()
    old_status_map = dict(known.get("statusMap", {}))
    new_cases, alerts = detect_new_cases(known, dispatch_list, vitals)

    gps_cases, gps_cases_recent, gps_alerts, gps_db = [], [], [], {}
    if FEATURE_GPS_CASES:
        gps_cases, gps_cases_recent, gps_alerts, gps_db = process_gps_cases(
            dispatch_list, old_status_map
        )
        if gps_alerts:
            alerts = [a for a in alerts if a.get("type") != "gps_arrived"]
            alerts.extend(gps_alerts)
            alerts.sort(key=lambda x: x.get("priority", 9))
            alerts = alerts[:20]
        dispatch_list = enrich_units_with_gps_cases(dispatch_list, gps_db)
        gps_pts = enrich_units_with_gps_cases(gps_pts, gps_db)
    else:
        alerts = [a for a in alerts if a.get("type") != "gps_arrived"]

    if FEATURE_KML:
        kml_alerts = load_kml_alerts()
        if kml_alerts:
            alerts = kml_alerts + [a for a in alerts if a.get("type") != "emic_kml"]
            alerts.sort(key=lambda x: x.get("priority", 9))
            alerts = alerts[:20]

    if alerts:
        try:
            import alerts as alertmod
            for a in alerts:
                if not _should_push_alert(a):
                    continue
                alertmod.push_alert(a)
        except Exception as e:
            print(f"[!] alert push: {e}")

    if FEATURE_EDT:
        edt_kpi, edt_branches = parse_edt_kpi(
            branches, branch_dispatch_sum, case_sample, availability
        )
    else:
        edt_kpi = {"source": "disabled", "gpsNote": "E點通已暫停"}
        edt_branches = []

    live_video = [d for d in dispatch_list if d.get("hasLiveVideo") and d.get("ageMin", 9999) <= DISPATCH_MAX_MIN]
    latest_images = [{
        "id": x.get("id"), "recordUuid": x.get("recordUuid"),
        "fileName": x.get("fileName"), "createdAt": x.get("createdAt"),
        "download": f"{VITAL}/imageData/getFile/{x.get('id')}",
    } for x in images[:8]]

    result = {
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tokenOk": token_ok,
        "pollInterval": int(os.environ.get("POLL_INTERVAL", "10")),
        "filters": {
            "dispatchMaxMin": DISPATCH_MAX_MIN,
            "vitalsMaxMin": VITALS_MAX_MIN,
            "gpsLiveMin": GPS_LIVE_MIN,
            "gpsMaxMin": GPS_MAX_MIN,
            "eventsMaxMin": EVENTS_MAX_MIN,
            "imagesMaxMin": IMAGES_MAX_MIN,
        },
        "dataNote": (
            f"完整線路 · 4000派遣+Devices GPS · 4001徵象(PCR) · 4002送醫 · EMIC378 · ≤{DISPATCH_MAX_MIN}分"
        ),
        "pipelines": {
            "dispatch": "4000/DispatchRecords StatusId 5-8",
            "gps": ["4000/listDispatchDevicesCoords", "4000/Devices"],
            "vitals": ["4001/trendings global", "4001/trendings?recordUuid= per PCR"],
            "hospital": "4002/Dispatches",
            "emic119": EMIC_KML_URL,
            "video": "mer2voip:30080 MSE",
        },
        "summary": {
            "activeDispatches": len(dispatch_list),
            "liveVitals": len(vitals),
            "gpsPoints": len(gps_pts),
            "gpsLive": len([p for p in gps_pts if p.get("isLive")]),
            "gpsDevicePoints": len(gps_device_pts),
            "gpsDeviceLive": len([p for p in gps_device_pts if p.get("isLive")]),
            "hospitalEtaRows": len([d for d in dispatch_list if d.get("hospitalEta") is not None]),
            "emic119Total": (emic119.get("summary") or {}).get("total", 0),
            "emic119NtpcEms": (emic119.get("summary") or {}).get("ntpcEmsActive", 0),
            "emicCorrelations": len(emic_correlations),
            "liveVideoCases": len(live_video),
            "newCasesThisPoll": len(new_cases),
            "recentEvents": len(events),
            "recentImages": len(latest_images),
            "totalAlerts": len(alerts),
            "status5": sc[5],
            "status6": sc[6],
            "status7": sc[7],
            "status8": sc[8],
            "gpsCases": len(gps_cases),
        },
        "statusCounts": sc,
        "newCases": new_cases,
        "alerts": alerts,
        "dispatches": dispatch_list,
        "liveUnits": dispatch_list,
        "vitals": vitals[:20],
        "gps": gps_pts,
        "deviceGps": gps_device_pts,
        "emic119": emic119,
        "emicCorrelations": emic_correlations,
        "gpsCases": gps_cases,
        "gpsCasesRecent": gps_cases_recent,
        "liveVideo": live_video,
        "images": latest_images,
        "events": [{
            "EventType": e.get("EventType") or e.get("type"),
            "Timestamp": e.get("Timestamp") or e.get("createdAt"),
            "recordUuid": e.get("recordUuid"),
        } for e in events[:10]],
        "branches": (branches if isinstance(branches, list) else [])[:40],
        "edtKpi": edt_kpi,
        "edtBranches": edt_branches[:80],
    }

    json.dump(new_cases, open(NEW_CASES_FILE, "w"), ensure_ascii=False, indent=2)
    json.dump(result, open(DATA_FILE, "w"), ensure_ascii=False, indent=2)
    return result


def main():
    interval = int(os.environ.get("POLL_INTERVAL", "8"))
    once = "--once" in sys.argv
    print(f"[*] EPCR Monitor v4 — 完整即時線路 (interval={interval}s)")
    print(f"[*] 4000+Devices GPS · 4001 PCR徵象 · 4002 ETA · EMIC378")
    while True:
        try:
            r = poll_once()
            s = r["summary"]
            print(
                f"[{r['updatedAt'][:19]}] disp={s['activeDispatches']} gps={s['gpsLive']}/{s['gpsPoints']} "
                f"dev={s.get('gpsDeviceLive', 0)} eta={s.get('hospitalEtaRows', 0)} "
                f"emic={s.get('emic119NtpcEms', 0)} match={s.get('emicCorrelations', 0)} "
                f"vitals={s['liveVitals']} video={s['liveVideoCases']}"
            )
        except Exception as e:
            print(f"[!] poll error: {e}")
        if once:
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()