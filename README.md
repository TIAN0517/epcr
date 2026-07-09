# EPCR — 智慧雲端動態救護儀表板

新北市消防 **EPCR** 即時救護車追蹤 **Web UI** + 可選 Python 監控後端。

> 本 repo 只含**網站與監控程式碼**。Telegram 群推播在很多環境是**另一台機器**負責；此 VPS 預設可只跑 Web。

## 目錄結構

```
epcr/
├── web/                 # Next.js 儀表板（正式站）
├── backend/             # Python：EPCR 輪詢、告警、舊版 dashboard server
├── deploy/              # systemd unit 範本
└── docs/                # 補充說明
```

| 路徑 | 說明 |
|------|------|
| `web/` | Next.js + Tailwind 全頁地圖 / 派遣 / 影像 |
| `backend/monitor.py` | 輪詢 EPCR API（派遣、GPS、生命徵象） |
| `backend/server.py` | 輕量 HTTP 儀表板 / 與 monitor 同進程 |
| `backend/alerts.py` | 告警寫 log + 可選 Telegram |
| `backend/emic_kml_poll.py` | 可選：378.kml 輪詢（可關） |

## 快速開始（Web）

```bash
cd web
cp .env.example .env
# 編輯 DASHBOARD_PASSWORD 等
bun install   # 或 npm install
bun run build
bun run start # 預設見 package.json / PORT
```

開發：

```bash
cd web && bun run dev
```

## 後端監控（可選）

```bash
cd backend
cp emic_push.env.example emic_push.env
cp emic_features.env.example emic_features.env
# 需要有效 EPCR JWT（token.txt 或 ensure_token.sh）
python3 server.py   # 內建啟動 monitor 執行緒
```

### 推播策略（若啟用 Telegram）

- 只推 **接案 / 出發 / 到達**（StatusId 5→6→7）
- 只推 **新北市** 案件
- 新北只打 `telegram_routes.json` 內 **三個群**（三太子 + 最舊兩個 BOT）；其它新北群不要填

## 部署

參考 `deploy/*.service`，路徑請改成你的 checkout 目錄。

典型拆分：

- `emic-next` → Next.js standalone
- `emic-dashboard` → Python `server.py` + monitor
- `emic-kml-poll` → 可選 378.kml

## 完整推送（本機有 token 時）

```bash
export GITHUB_TOKEN=ghp_xxxx
python3 scripts/push_to_github.py
```

## 安全注意

- **勿提交** `.env`、`token.txt`、Bot token、真實 chat_id
- 儀表板請設強密碼 + 反代 HTTPS
- EPCR JWT 屬敏感憑證，勿進版控

## License

Private / internal use.
