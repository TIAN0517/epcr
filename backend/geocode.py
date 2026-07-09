"""共用座標反查（Google + NLSC + Nominatim fallback）。"""
import json
import os
import urllib.request
import ssl

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

_GEO_CACHE = {}
_GEO_CACHE_MAX = int(os.environ.get("GEO_CACHE_MAX", "500"))
GOOGLE_GEO_KEY = os.environ.get(
    "GOOGLE_GEOCODE_KEY", "AIzaSyB-ZbIMj6Now6cnwor9QRwjx6zEnzdYvU4"
)


def _google_reverse(lat_f, lng_f):
    url = (
        f"https://maps.googleapis.com/maps/api/geocode/json"
        f"?latlng={lat_f},{lng_f}&language=zh-TW&key={GOOGLE_GEO_KEY}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "EMIC-Dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=10, context=CTX) as r:
        data = json.loads(r.read().decode())
    if data.get("status") != "OK" or not data.get("results"):
        return None
    top = data["results"][0]
    full = top.get("formatted_address") or ""
    road = next(
        (
            c["long_name"]
            for c in top.get("address_components", [])
            if "route" in c.get("types", [])
        ),
        "",
    )
    num = next(
        (
            c["long_name"]
            for c in top.get("address_components", [])
            if "street_number" in c.get("types", [])
        ),
        "",
    )
    short = f"{road}{num}" if road else full
    return {"fullAddress": full, "short": short or full}


def _nlsc_reverse(lat_f, lng_f):
    url = f"https://api.nlsc.gov.tw/other/TownVillagePointQuery/{lng_f}/{lat_f}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "EMIC-Dashboard/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=8, context=CTX) as r:
        data = json.loads(r.read().decode())
    cty = data.get("ctyName") or ""
    town = data.get("townName") or ""
    village = data.get("villageName") or ""
    sect = data.get("sectName") or ""
    sect_label = sect if not sect or sect.endswith("段") else f"{sect}段"
    return {
        "nlsc": f"{cty}{town}{village}",
        "nlscDetail": data,
        "nlscSect": f"{cty}{town}{village}{sect_label}" if sect else f"{cty}{town}{village}",
    }


def _nominatim_reverse(lat_f, lng_f):
    url = (
        f"https://nominatim.openstreetmap.org/reverse?lat={lat_f}&lon={lng_f}"
        f"&format=json&accept-language=zh-TW&zoom=18&addressdetails=1"
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "EMIC-Dashboard/1.0 (epcr-monitor)"}
    )
    with urllib.request.urlopen(req, timeout=10, context=CTX) as r:
        data = json.loads(r.read().decode())
    addr = data.get("display_name") or ""
    parts = data.get("address") or {}
    short = parts.get("road") or parts.get("suburb") or parts.get("city_district") or ""
    if parts.get("city"):
        short = (parts.get("city", "") + short).strip()
    if parts.get("county"):
        short = parts.get("county", "") + short
    return {"fullAddress": addr, "short": short or addr}


def reverse_geocode(lat, lng):
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return {"error": "invalid coordinates"}
    key = f"{lat_f:.5f},{lng_f:.5f}"
    if key in _GEO_CACHE:
        return _GEO_CACHE[key]

    google = None
    try:
        google = _google_reverse(lat_f, lng_f)
    except Exception:
        pass

    nlsc = {}
    try:
        nlsc = _nlsc_reverse(lat_f, lng_f)
    except Exception:
        pass

    nominatim = None
    if not google:
        try:
            nominatim = _nominatim_reverse(lat_f, lng_f)
        except Exception as e:
            return {"error": str(e)}

    full = (google or nominatim or {}).get("fullAddress") or ""
    short = (google or nominatim or {}).get("short") or full
    result = {
        "fullAddress": full,
        "display": full,
        "short": short,
        "nlsc": nlsc.get("nlsc", ""),
        "nlscSect": nlsc.get("nlscSect", ""),
        "nlscDetail": nlsc.get("nlscDetail"),
        "lat": lat_f,
        "lng": lng_f,
        "source": "google" if google else "nominatim",
        "edtSource": "listDispatchDevicesCoords",
        "edtNote": "與 E點通資源管理同源 GPS",
    }
    if len(_GEO_CACHE) >= _GEO_CACHE_MAX:
        _GEO_CACHE.pop(next(iter(_GEO_CACHE)))
    _GEO_CACHE[key] = result
    return result