#!/usr/bin/env python3
"""儀表板存取控制 — 不對外暴露 API"""
import hashlib, hmac, os, secrets, time

AUTH_FILE = os.path.join(os.path.dirname(__file__), "..", ".dashboard_auth")
SESSION_MAX_AGE = 86400 * 7  # 7 天
_sign_key = None


def _load_sign_key():
    global _sign_key
    if _sign_key:
        return _sign_key
    if os.path.exists(AUTH_FILE):
        for line in open(AUTH_FILE):
            if line.startswith("sign_key="):
                _sign_key = line.strip().split("=", 1)[1]
                return _sign_key
    _sign_key = secrets.token_hex(32)
    return _sign_key


def ensure_auth_file():
    if os.path.exists(AUTH_FILE):
        _load_sign_key()
        return
    pwd = os.environ.get("DASHBOARD_PASSWORD", secrets.token_urlsafe(12))
    sign_key = secrets.token_hex(32)
    pw_hash = hashlib.sha256(pwd.encode()).hexdigest()
    with open(AUTH_FILE, "w") as f:
        f.write(f"password_hash={pw_hash}\n")
        f.write(f"sign_key={sign_key}\n")
    os.chmod(AUTH_FILE, 0o600)
    print(f"[*] 儀表板密碼已產生，請查看: {AUTH_FILE}")
    print(f"[*] 或設定環境變數 DASHBOARD_PASSWORD")


def get_password_hash():
    ensure_auth_file()
    for line in open(AUTH_FILE):
        if line.startswith("password_hash="):
            return line.strip().split("=", 1)[1]
    return None


def verify_password(password):
    h = hashlib.sha256(password.encode()).hexdigest()
    return hmac.compare_digest(h, get_password_hash() or "")


def make_session():
    ts = str(int(time.time()))
    sig = hmac.new(_load_sign_key().encode(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


def verify_session(cookie_val):
    if not cookie_val or "." not in cookie_val:
        return False
    ts, sig = cookie_val.rsplit(".", 1)
    try:
        age = int(time.time()) - int(ts)
        if age < 0 or age > SESSION_MAX_AGE:
            return False
    except ValueError:
        return False
    expected = hmac.new(_load_sign_key().encode(), ts.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def get_cookie_from_headers(headers):
    raw = headers.get("Cookie") or headers.get("cookie") or ""
    for part in raw.split(";"):
        part = part.strip()
        if part.startswith("emic_sid="):
            return part.split("=", 1)[1]
    return None


def get_route_paths():
    """依部署密鑰產生不透明路徑，避免在原始碼暴露固定接口。"""
    key = _load_sign_key()

    def _path(salt):
        return "/" + hashlib.sha256(f"emic:{salt}:{key}".encode()).hexdigest()[:20]

    return {
        "sync": _path("sync"),
        "login": _path("login"),
        "logout": _path("logout"),
        "case": _path("case"),
        "session": _path("session"),
        "geocode": _path("geocode"),
        "emicKml": _path("emicKml"),
    }