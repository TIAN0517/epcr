"use client";

import { useEffect, useState } from "react";
import { LoginScreen } from "@/components/emic/login-screen";
import { Dashboard } from "@/components/emic/dashboard";

type AuthState = "loading" | "authed" | "guest";

export default function Page() {
  const [auth, setAuth] = useState<AuthState>("loading");

  async function probe() {
    try {
      const r = await fetch("/api/emic/session", { credentials: "same-origin" });
      if (!r.ok) {
        setAuth("guest");
        return;
      }
      const d = (await r.json()) as { authed?: boolean };
      setAuth(d.authed ? "authed" : "guest");
    } catch {
      setAuth("guest");
    }
  }

  useEffect(() => {
    // async session probe on mount; setState happens after await (not sync)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    probe();
  }, []);

  if (auth === "loading") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#060a10",
          color: "#8a9bb5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: '"Microsoft JhengHei","Segoe UI",system-ui,sans-serif',
          fontSize: 14,
          gap: 10,
        }}
      >
        <img src="/bird50.png" alt="" style={{ width: 32, height: 32, opacity: 0.8 }} />
        連線至 EMIC 救護儀表板…
      </div>
    );
  }

  if (auth === "guest") {
    return <LoginScreen onLoggedIn={() => setAuth("authed")} />;
  }

  return <Dashboard onLoggedOut={() => setAuth("guest")} />;
}
