"""救護車到達現場 / GPS 停駐 — 自動反查地址並記錄案件。"""
import datetime
import json
import os
import time

from geocode import reverse_geocode

BASE = os.path.dirname(os.path.abspath(__file__))
GPS_CASES_FILE = os.path.join(BASE, "gps_cases.json")

ARRIVED_STATUSES = (7, 8)
ACTIVE_STATUSES = (5, 6, 7, 8)
GPS_CASE_KEEP = int(os.environ.get("GPS_CASE_KEEP", "300"))
GPS_GEOCODE_MAX = int(os.environ.get("GPS_GEOCODE_MAX", "10"))


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _coord_key(lat, lng):
    return f"{float(lat):.5f},{float(lng):.5f}"


def load_gps_cases():
    if os.path.exists(GPS_CASES_FILE):
        try:
            data = json.load(open(GPS_CASES_FILE))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def save_gps_cases(cases):
    if len(cases) > GPS_CASE_KEEP:
        items = sorted(
            cases.items(),
            key=lambda x: x[1].get("updatedAt") or x[1].get("recordedAt") or "",
        )[-GPS_CASE_KEEP:]
        cases = dict(items)
    json.dump(cases, open(GPS_CASES_FILE, "w"), ensure_ascii=False, indent=2)


def _case_trigger(unit, old_status):
    sid = unit.get("statusId")
    lat, lng = unit.get("lat"), unit.get("lng")
    if not lat or not lng:
        return None
    if sid in ARRIVED_STATUSES:
        if old_status not in ARRIVED_STATUSES:
            return "arrived"
        if unit.get("isStale"):
            return "gps_stale"
        return "on_scene"
    if unit.get("isStale") and sid in ACTIVE_STATUSES:
        return "gps_stale"
    return None


def _build_case(unit, trigger, geo, existing=None):
    now = _now_iso()
    lat, lng = unit.get("lat"), unit.get("lng")
    geo_err = geo.get("error") if isinstance(geo, dict) else None
    geocoded = geo.get("fullAddress") if isinstance(geo, dict) else None
    row = {
        "uuid": unit.get("uuid"),
        "ambulanceCode": unit.get("ambulanceCode"),
        "licenseNo": unit.get("licenseNo"),
        "branch": unit.get("branch"),
        "statusId": unit.get("statusId"),
        "statusName": unit.get("statusName"),
        "caseId": unit.get("caseId"),
        "epcrAddress": unit.get("epcrAddress"),
        "realAddress": unit.get("realAddress"),
        "lat": lat,
        "lng": lng,
        "coordKey": _coord_key(lat, lng),
        "gpsUpdatedAt": unit.get("gpsUpdatedAt"),
        "gpsAgeMin": unit.get("gpsAgeMin"),
        "dispatchedAt": unit.get("dispatchedAt"),
        "arrivedAt": unit.get("arrivedAt"),
        "isStale": unit.get("isStale", False),
        "trigger": trigger,
        "geocodedAddress": geocoded,
        "geocodeShort": geo.get("short") if isinstance(geo, dict) else None,
        "nlsc": geo.get("nlsc") if isinstance(geo, dict) else None,
        "nlscSect": geo.get("nlscSect") if isinstance(geo, dict) else None,
        "geocodeSource": geo.get("source") if isinstance(geo, dict) else None,
        "geocodeError": geo_err,
        "recordedAt": existing.get("recordedAt") if existing else now,
        "updatedAt": now,
        "geocodedAt": now if geocoded else (existing or {}).get("geocodedAt"),
    }
    if existing and existing.get("geocodedAddress") and not geocoded:
        row["geocodedAddress"] = existing.get("geocodedAddress")
        row["geocodeShort"] = existing.get("geocodeShort")
        row["nlsc"] = existing.get("nlsc")
        row["nlscSect"] = existing.get("nlscSect")
        row["geocodeSource"] = existing.get("geocodeSource")
        row["geocodedAt"] = existing.get("geocodedAt")
    return row


def process_gps_cases(live_units, status_map):
    """
    掃描即時派遣單位：已到達/執行中或 GPS 停駐時反查座標並持久化。
    回傳 (active_cases_list, new_alerts, cases_db)
    """
    cases_db = load_gps_cases()
    active_uuids = set()
    new_alerts = []
    geocode_budget = GPS_GEOCODE_MAX
    now_ts = time.time()

    for unit in live_units:
        uid = unit.get("uuid")
        if not uid:
            continue
        active_uuids.add(uid)
        old_status = status_map.get(uid)
        trigger = _case_trigger(unit, old_status)
        if not trigger:
            continue

        existing = cases_db.get(uid)
        lat, lng = unit.get("lat"), unit.get("lng")
        coord = _coord_key(lat, lng)
        need_geo = True
        if existing:
            if existing.get("coordKey") == coord and existing.get("geocodedAddress"):
                need_geo = False
            elif trigger == "on_scene" and existing.get("geocodedAddress"):
                need_geo = False

        geo = {"error": "pending"}

        def _geo_from_existing(hit):
            return {
                "fullAddress": hit.get("geocodedAddress"),
                "short": hit.get("geocodeShort"),
                "nlsc": hit.get("nlsc"),
                "nlscSect": hit.get("nlscSect"),
                "source": hit.get("geocodeSource"),
            }

        if need_geo:
            if geocode_budget <= 0:
                if existing:
                    cases_db[uid] = _build_case(
                        unit, trigger, _geo_from_existing(existing), existing
                    )
                continue
            geo = reverse_geocode(lat, lng)
            geocode_budget -= 1
            if geo.get("error") and existing:
                geo = _geo_from_existing(existing)
        elif existing:
            geo = _geo_from_existing(existing)

        is_new = uid not in cases_db or (
            need_geo and geo.get("fullAddress") and not (existing or {}).get("geocodedAddress")
        )
        is_reloc = existing and existing.get("coordKey") != coord and geo.get("fullAddress")

        row = _build_case(unit, trigger, geo, existing)
        cases_db[uid] = row

        addr = row.get("geocodedAddress") or row.get("epcrAddress") or "（反查中）"
        code = row.get("ambulanceCode") or "—"
        if is_new or is_reloc:
            new_alerts.append({
                "type": "gps_arrived",
                "priority": 2,
                "msg": f"救護車 GPS 案件 {code} · {addr}",
                "data": row,
            })

    # 保留近期案件；標記已結案
    for uid, row in list(cases_db.items()):
        if uid in active_uuids:
            row["active"] = True
            row["closedAt"] = None
        else:
            row["active"] = False
            if not row.get("closedAt"):
                row["closedAt"] = _now_iso()

    save_gps_cases(cases_db)

    active_cases = [
        cases_db[uid]
        for uid in active_uuids
        if uid in cases_db and cases_db[uid].get("geocodedAddress")
    ]
    active_cases.sort(
        key=lambda x: x.get("updatedAt") or x.get("recordedAt") or "",
        reverse=True,
    )

    recent_cases = sorted(
        cases_db.values(),
        key=lambda x: x.get("updatedAt") or x.get("recordedAt") or "",
        reverse=True,
    )[:40]

    return active_cases, recent_cases, new_alerts, cases_db


def enrich_units_with_gps_cases(live_units, cases_db):
    for unit in live_units:
        uid = unit.get("uuid")
        hit = cases_db.get(uid) if uid else None
        if not hit or not hit.get("geocodedAddress"):
            continue
        unit["gpsCaseAddress"] = hit.get("geocodedAddress")
        unit["gpsCaseNlsc"] = hit.get("nlscSect") or hit.get("nlsc")
        unit["gpsCaseTrigger"] = hit.get("trigger")
        unit["gpsCaseRecordedAt"] = hit.get("recordedAt")
    return live_units