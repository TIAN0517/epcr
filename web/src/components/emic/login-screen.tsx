"use client";

import { useState } from "react";

export function LoginScreen({
  onLoggedIn,
}: {
  onLoggedIn: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function doLogin() {
    setErr("");
    if (!pwd.trim()) {
      setErr("請輸入密碼");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/emic/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        onLoggedIn();
      } else {
        setErr(d.error || "密碼錯誤");
      }
    } catch {
      setErr("連線失敗，請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="emic-login">
      <div className="emic-login-topbar" />
      <div className="login-wrap">
        <div className="login-left">
          <div className="login-brand">
            <img src="/bird50.png" alt="新北市消防局" />
            <div>
              <div className="org">新北市消防局</div>
              <div className="sub">智慧雲端動態救護系統</div>
            </div>
          </div>

          <div className="login-card">
            <h2>智慧雲端動態救護系統</h2>
            <div className="desc">
              授權人員請輸入密碼登入
            </div>
            <label htmlFor="pwd">登入密碼</label>
            <input
              id="pwd"
              type="password"
              autoComplete="current-password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doLogin();
              }}
              placeholder="請輸入密碼"
              autoFocus
            />
            <button
              className="login-btn"
              onClick={doLogin}
              disabled={busy}
              type="button"
            >
              {busy ? "登入中…" : "登入"}
            </button>
            <div className="login-err">{err}</div>
          </div>

          <div className="login-foot">
            本系統僅供授權人員使用，未經許可禁止存取。
          </div>
        </div>
      </div>
    </div>
  );
}
