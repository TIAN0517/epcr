#!/usr/bin/env python3
"""EPCR 私密儀表板 — 無公開 API"""
import html
import json, os, re, threading, time, urllib.request, ssl, http.server, socketserver
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, parse_qs

import auth
from geocode import reverse_geocode

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "dashboard_data.json")
TOKEN_FILE = os.path.join(BASE, "..", "token.txt")
VITAL = "https://epcr.tpf.gov.tw:4001"
PORT = int(os.environ.get("DASHBOARD_PORT", "8765"))
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
EMIC_KML_URL = os.environ.get(
    "EMIC_KML_URL", "https://gis2.emic.gov.tw/EMICData/378.kml"
)
_EMIC_CACHE = {"ts": 0, "data": None}
_EMIC_CACHE_TTL = int(os.environ.get("EMIC_KML_CACHE_SEC", "90"))
_KML_NS = {"k": "http://www.opengis.net/kml/2.2"}


def _feature_on(name, default="0"):
    return os.environ.get(name, default).lower() not in ("0", "false", "no", "off")


FEATURE_GEOCODE = _feature_on("EMIC_FEATURE_GEOCODE")

BLOCKED_PREFIXES = ("/api/", "/dashboard_data", "/known_cases", "/monitor_state",
                    "/alerts_history", "/token", "/.env", "/_m", "/_login", "/_logout")
BLOCKED_SUFFIXES = (".json", ".jsonl", ".txt", ".sh", ".py")
STATIC_FILES = {
    "/favicon.ico": os.path.join(BASE, "favicon.ico"),
    "/images/login110.png": os.path.join(BASE, "images", "login110.png"),
    "/images/bird50.png": os.path.join(BASE, "images", "bird50.png"),
}


def load_token():
    if os.path.exists(TOKEN_FILE):
        t = open(TOKEN_FILE).read().strip()
        if t.startswith("eyJ"):
            return t
    return None





def _emic_field(desc, label):
    m = re.search(
        rf">\s*{re.escape(label)}\s*</td>\s*<td[^>]*>\s*([^<]+)",
        desc,
        flags=re.I,
    )
    return html.unescape(m.group(1).strip()) if m else ""


def _parse_emic_kml(xml_text):
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
        category = _emic_field(desc, "主要類別") or (name_el.text if name_el is not None else "")
        status = _emic_field(desc, "案件狀態")
        address = _emic_field(desc, "案件地點")
        sub_cat = _emic_field(desc, "次要類別")
        report_time = _emic_field(desc, "報案時間")

        cases.append({
            "name": (name_el.text or category or "災情").strip() if name_el is not None else category,
            "lat": lat,
            "lng": lng,
            "style": style_key,
            "icon": styles.get(style_key),
            "category": category,
            "status": status,
            "address": address,
            "subCategory": sub_cat,
            "reportTime": report_time,
            "isNtpc": "新北市" in address,
            "isKaohsiung": "高雄市" in address,
            "isActive": status == "處理中",
        })

    return cases, styles


def fetch_emic_kml(ntpc_only=True, active_only=False, ems_only=False, kaohsiung_only=False):
    now = time.time()
    if _EMIC_CACHE["data"] and (now - _EMIC_CACHE["ts"]) < _EMIC_CACHE_TTL:
        payload = _EMIC_CACHE["data"]
    else:
        req = urllib.request.Request(
            EMIC_KML_URL,
            headers={"User-Agent": "EMIC-Dashboard/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
            xml_text = r.read().decode("utf-8-sig", errors="replace")
        cases, styles = _parse_emic_kml(xml_text)
        payload = {
            "source": EMIC_KML_URL,
            "documentName": "災情",
            "styles": styles,
            "cases": cases,
        }
        _EMIC_CACHE["ts"] = now
        _EMIC_CACHE["data"] = payload

    cases = list(payload["cases"])
    if kaohsiung_only:
        cases = [c for c in cases if c.get("isKaohsiung")]
    elif ntpc_only:
        cases = [c for c in cases if c.get("isNtpc")]
    if active_only:
        cases = [c for c in cases if c.get("isActive")]
    if ems_only:
        cases = [c for c in cases if "緊急救護" in (c.get("category") or "")]

    active = sum(1 for c in payload["cases"] if c.get("isActive"))
    ntpc = sum(1 for c in payload["cases"] if c.get("isNtpc"))
    ntpc_active = sum(1 for c in payload["cases"] if c.get("isNtpc") and c.get("isActive"))
    kaohsiung = sum(1 for c in payload["cases"] if c.get("isKaohsiung"))
    kaohsiung_active = sum(
        1 for c in payload["cases"] if c.get("isKaohsiung") and c.get("isActive")
    )

    return {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_EMIC_CACHE["ts"])),
        "source": payload["source"],
        "filters": {
            "ntpcOnly": ntpc_only,
            "kaohsiungOnly": kaohsiung_only,
            "activeOnly": active_only,
            "emsOnly": ems_only,
        },
        "summary": {
            "total": len(payload["cases"]),
            "ntpc": ntpc,
            "kaohsiung": kaohsiung,
            "active": active,
            "ntpcActive": ntpc_active,
            "kaohsiungActive": kaohsiung_active,
            "shown": len(cases),
        },
        "cases": cases,
    }


def fetch_json(url, token=None):
    headers = {"User-Agent": "EPCR-Dashboard/3.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
        return json.loads(r.read().decode())


INDEX_HTML = os.path.join(BASE, "index.html")
INDEX_CACHE = {"mtime": 0, "routes": "", "body": b""}


def _load_index_html():
    routes = auth.get_route_paths()
    routes_js = json.dumps(routes, ensure_ascii=False)
    mtime = os.path.getmtime(INDEX_HTML) if os.path.exists(INDEX_HTML) else 0
    if INDEX_CACHE["mtime"] == mtime and INDEX_CACHE["routes"] == routes_js and INDEX_CACHE["body"]:
        return INDEX_CACHE["body"]
    raw = open(INDEX_HTML, encoding="utf-8").read()
    injected = raw.replace("__ROUTES_JSON__", routes_js)
    body = injected.encode("utf-8")
    INDEX_CACHE["mtime"] = mtime
    INDEX_CACHE["routes"] = routes_js
    INDEX_CACHE["body"] = body
    return body


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

    def _headers_dict(self):
        return {k: v for k, v in self.headers.items()}

    def _authed(self):
        return auth.verify_session(auth.get_cookie_from_headers(self._headers_dict()))

    def send_json(self, data, code=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, private")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, content, code=200):
        body = content.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _blocked(self, path):
        if path in ("/api/data", "/api/alerts", "/api/case"):
            return True
        for p in BLOCKED_PREFIXES:
            if path.startswith(p):
                return True
        for s in BLOCKED_SUFFIXES:
            if path.endswith(s) and path != "/index.html":
                return True
        if path in ("/case.html", "/videowall.html"):
            return True  # 併入單頁
        return False

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", errors="ignore") if length else ""

        if path == auth.get_route_paths()["login"]:
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}
            pwd = data.get("password", "")
            if auth.verify_password(pwd):
                sid = auth.make_session()
                self.send_json({"ok": True}, extra_headers={
                    "Set-Cookie": f"emic_sid={sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800"
                })
            else:
                self.send_json({"ok": False, "error": "密碼錯誤"})
            return
        self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)

        if self._blocked(path):
            self.send_json({"error": "not found"}, 404)
            return

        if path == auth.get_route_paths()["logout"]:
            self.send_response(302)
            self.send_header("Set-Cookie", "emic_sid=; Path=/; HttpOnly; Max-Age=0")
            self.send_header("Location", "/")
            self.end_headers()
            return

        if path == auth.get_route_paths()["session"]:
            self.send_json({"authed": self._authed()})
            return

        if path == auth.get_route_paths()["sync"]:
            if not self._authed():
                self.send_json({"error": "unauthorized", "authed": False})
                return
            if os.path.exists(DATA_FILE):
                self.send_json(json.load(open(DATA_FILE)))
            else:
                self.send_json({"error": "loading"}, 503)
            return

        if path == auth.get_route_paths()["geocode"]:
            if not self._authed():
                self.send_json({"error": "unauthorized"}, 401)
                return
            if not FEATURE_GEOCODE:
                self.send_json(
                    {"error": "geocode_disabled", "message": "地址反查已暫停"},
                    503,
                )
                return
            lat = qs.get("lat", [""])[0]
            lng = qs.get("lng", [""])[0]
            if not lat or not lng:
                self.send_json({"error": "missing lat/lng"}, 400)
                return
            self.send_json(reverse_geocode(lat, lng))
            return

        if path == auth.get_route_paths()["emicKml"]:
            if not self._authed():
                self.send_json({"error": "unauthorized"}, 401)
                return
            region = (qs.get("region", [""])[0] or "").lower()
            kaohsiung = region in ("kaohsiung", "kh", "高雄") or qs.get("kaohsiung", ["0"])[0] in ("1", "true", "yes")
            ntpc = not kaohsiung and qs.get("ntpc", ["0"])[0] not in ("0", "false", "no")
            active = qs.get("active", ["0"])[0] in ("1", "true", "yes")
            ems = qs.get("ems", ["0"])[0] in ("1", "true", "yes")
            try:
                self.send_json(fetch_emic_kml(
                    ntpc_only=ntpc,
                    kaohsiung_only=kaohsiung,
                    active_only=active,
                    ems_only=ems,
                ))
            except Exception as e:
                self.send_json({"error": "emic kml fetch failed", "detail": str(e)}, 502)
            return

        if path == auth.get_route_paths()["case"]:
            if not self._authed():
                self.send_json({"error": "unauthorized", "authed": False})
                return
            rid = qs.get("id", [""])[0]
            if not rid:
                self.send_json({"error": "missing id"}, 400)
                return
            try:
                trend = fetch_json(f"{VITAL}/trendings?recordUuid={rid}&sort=-createdAt&count=50")
                evts = fetch_json(f"{VITAL}/events?recordUuid={rid}&sort=-Timestamp&count=50")
                imgs = fetch_json(f"{VITAL}/ImageData?recordUuid={rid}&sort=-createdAt&count=20")
                ai = fetch_json(f"{VITAL}/extEcg/airesult/{rid}")
                self.send_json({
                    "trendings": trend if isinstance(trend, list) else [],
                    "events": evts if isinstance(evts, list) else [],
                    "images": [{"id": i.get("id"), "fileName": i.get("fileName"),
                                "url": f"{VITAL}/imageData/getFile/{i.get('id')}"}
                               for i in (imgs if isinstance(imgs, list) else [])],
                    "aiEcg": ai if isinstance(ai, list) else [],
                    "streamUrl": f"https://mer2voip.tpf.gov.tw:30080/live?app=rtmp&stream=live{rid}",
                })
            except Exception as e:
                self.send_json({"error": "fetch failed"}, 500)
            return

        if path in STATIC_FILES:
            fpath = STATIC_FILES[path]
            if os.path.isfile(fpath):
                data = open(fpath, "rb").read()
                ctype = "image/png" if path.endswith(".png") else "image/x-icon"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if path in ("/", "", "/index.html"):
            self.send_html(_load_index_html().decode("utf-8"))
            return

        self.send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        pass


def run_monitor():
    import monitor
    os.environ.setdefault("POLL_INTERVAL", "8")
    monitor.main()


if __name__ == "__main__":
    auth.ensure_auth_file()
    threading.Thread(target=run_monitor, daemon=True).start()
    bind = os.environ.get("DASHBOARD_BIND", "127.0.0.1")
    print(f"[*] 私密儀表板 http://{bind}:{PORT}")
    print(f"[*] 無公開 API — 資料通道已隱藏")
    class ReuseServer(socketserver.TCPServer):
        allow_reuse_address = True
    with ReuseServer((bind, PORT), Handler) as httpd:
        httpd.serve_forever()