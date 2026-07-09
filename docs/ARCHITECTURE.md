# 架構簡述

```
Browser ──HTTPS──► Caddy/Nginx
                      │
          ┌───────────┼───────────┐
          ▼                       ▼
   Next.js (web/)          Python (backend/)
   登入 / 地圖 UI           輪詢 EPCR API
          │                       │
          └────── 讀取 JSON ◄─────┘
                dashboard_data.json
```

- **Web**：`/opt/emic-dashboard` 同源程式；Production 常用 bun standalone。
- **Backend**：`monitor.py` 約 8s 輪詢 `epcr.tpf.gov.tw:4000/4001`，寫 `dashboard_data.json`。
- **Telegram**：`alerts.py`；此 VPS 常未設定 token（推播在另一台）。
