#!/usr/bin/env python3
"""告警推送：檔案日誌 + 控制台 + Telegram 分流

新北市：只推 telegram_routes.json「新北市」陣列裡的群（預設 3 個：
  三太子 + 最舊兩個 BOT 群），其它新北群不要填進去。
"""
import json, os, re, urllib.request, ssl, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
ALERT_LOG = os.path.join(BASE, "alerts_history.jsonl")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

_routes_cache = None


def _routes_path():
    return os.environ.get(
        "TELEGRAM_ROUTES_FILE", os.path.join(BASE, "telegram_routes.json")
    )


def _load_routes():
    global _routes_cache
    if _routes_cache is not None:
        return _routes_cache
    routes = {}
    path = _routes_path()
    if os.path.exists(path):
        try:
            routes = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            routes = {}
    # 忽略註解鍵
    if isinstance(routes, dict):
        routes = {k: v for k, v in routes.items() if not str(k).startswith("_")}
    else:
        routes = {}
    _routes_cache = routes
    return _routes_cache


def _reload_routes():
    """測試/熱更新用。"""
    global _routes_cache
    _routes_cache = None
    return _load_routes()


def _county_from_alert(alert):
    if alert.get("county"):
        return alert["county"]
    data = alert.get("data") or {}
    if data.get("county"):
        return data["county"]
    # EPCR 地址欄位
    for key in (
        "targetAddress", "sceneAddressText", "geocodedSceneAddress",
        "realAddress", "epcrAddress", "address",
    ):
        addr = str(data.get(key) or "")
        m = re.search(r"(新北市|台北市|臺北市|桃園市|高雄市|臺中市|台中市|臺南市|台南市)", addr)
        if m:
            return m.group(1)
        m = re.match(r"^(.+?[縣市])", addr)
        if m:
            return m.group(1)
    if data.get("isNtpc"):
        return "新北市"
    if data.get("isKaohsiung"):
        return "高雄市"
    # EPCR 現場推播（接案/出發/到達）預設新北
    if alert.get("type") in ("new_case", "status_change"):
        return "新北市"
    return ""


def _normalize_chat_entries(raw):
    """支援:
    - \"-100xxx\"
    - [\"-100a\", \"-100b\"]
    - [{\"name\":\"三太子\",\"chat_id\":\"-100xxx\"}, ...]
    """
    out = []  # list of (name, chat_id)
    if raw is None or raw == "":
        return out
    if isinstance(raw, (int, float)):
        raw = str(int(raw))
    if isinstance(raw, str):
        s = raw.strip()
        if s:
            out.append(("", s))
        return out
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                s = item.strip()
                if s:
                    out.append(("", s))
            elif isinstance(item, dict):
                cid = str(item.get("chat_id") or item.get("id") or "").strip()
                name = str(item.get("name") or item.get("title") or "").strip()
                if cid:
                    out.append((name, cid))
            elif isinstance(item, (int, float)):
                out.append(("", str(int(item))))
        return out
    if isinstance(raw, dict):
        # 單一物件
        cid = str(raw.get("chat_id") or raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        if cid:
            out.append((name, cid))
    return out


def _telegram_chats(alert):
    """回傳要發送的 chat_id 列表。

    新北市：只使用 routes['新北市'] 陣列內的群（設計為三太子+最舊2個）。
    其它縣市：字串或陣列皆可，空則不發。
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return []

    routes = _load_routes()
    county = _county_from_alert(alert)
    chats = []

    # 縣市鍵別名
    keys = []
    if county:
        keys.append(county)
        if county == "台北市":
            keys.append("臺北市")
        if county == "臺北市":
            keys.append("台北市")
        if county == "台中市":
            keys.append("臺中市")
        if county == "臺中市":
            keys.append("台中市")
        if county == "台南市":
            keys.append("臺南市")
        if county == "臺南市":
            keys.append("台南市")

    for k in keys:
        if k in routes:
            for name, cid in _normalize_chat_entries(routes.get(k)):
                chats.append((name, cid))
            break

    if not chats:
        for name, cid in _normalize_chat_entries(routes.get("default")):
            chats.append((name, cid))

    fallback = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if fallback and not any(c for _, c in chats):
        chats.append(("", fallback))

    # 去重保序
    out = []
    seen = set()
    for name, cid in chats:
        if cid and cid not in seen:
            seen.add(cid)
            out.append((name, cid))
    return out


def _send_telegram(token, chat_id, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }).encode()
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}
    )
    urllib.request.urlopen(req, timeout=10, context=CTX)


def push_alert(alert):
    entry = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        **alert,
    }
    with open(ALERT_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    icon = {
        "new_case": "🆕", "new_dispatch": "🚑", "new_vitals": "💓",
        "status_change": "📡", "live_video": "📹", "high_hr": "⚠️",
        "low_spo2": "🫁", "emic_kml": "🚨",
    }.get(alert.get("type"), "🔔")
    county = _county_from_alert(alert)
    print(f"{icon} [{alert.get('type')}] {county} {alert.get('msg')}")

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chats = _telegram_chats(alert)
    if not token:
        return
    if not chats:
        print(
            f"[!] Telegram skip: 未設定 {county or '該縣市'} 的 chat "
            f"（見 telegram_routes.json；新北請填三太子+最舊2群）"
        )
        return

    text = f"{icon} {county}\n{alert.get('msg')}"
    for name, chat in chats:
        label = f"{name}({chat})" if name else chat
        try:
            _send_telegram(token, chat, text)
            print(f"[TG] sent → {label}")
        except Exception as e:
            print(f"[!] Telegram failed chat={label}: {e}")


def push_batch(alerts):
    for a in alerts:
        push_alert(a)
