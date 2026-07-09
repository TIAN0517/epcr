# epcr

新北 EPCR（epcr.tpf.gov.tw）即時 GPS／派遣整合 — 供 service119 推播「已出發／已到達（往現場）」。

## 重點

- GPS：`GET /DispatchRecords/listDispatchDevicesCoords`（Bearer JWT）
- 軌跡：官方只給當下點，需 5–10s 輪詢自行累積
- 派遣：`StatusId` 5–8 + `departedAt` / `arrivedAt`
- **不推**往醫院（`leftAt` 送醫）

## 設定 Token

```bash
cp epcr_secrets.env.example epcr_secrets.env
# 編輯填入 EPCR_TOKEN=eyJ...
bash scripts/epcr_check_token.sh
```

## 檔案

| 檔案 | 說明 |
|------|------|
| `epcr_client.py` | API 客戶端 |
| `epcr_tracker.py` | 輪詢 + 推播邏輯（可掛 service119） |
| `scripts/epcr_check_token.sh` | 驗證 JWT |
| `tests/test_epcr_tracker.py` | 單元測試 |

## 注意

- 勿把 `epcr_secrets.env` / JWT 提交進 git
- 推完後請將 GitHub repo 設為 **private**
