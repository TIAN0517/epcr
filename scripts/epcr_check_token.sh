#!/bin/bash
# 驗證 EPCR JWT 是否可用
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH=.
if [[ -f data/epcr_secrets.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source data/epcr_secrets.env
  set +a
fi
if [[ -f epcr_secrets.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source epcr_secrets.env
  set +a
fi
python3 - <<'PY'
import epcr_client as c
tok = c.get_token()
print("token:", "有" if tok else "無", f"({len(tok)} chars)" if tok else "")
ok, msg = c.token_ok()
print("token_ok:", ok, msg)
if ok:
    code, rows = c.list_dispatch_devices_coords()
    print("coords:", code, "n=", len(rows))
    code2, active = c.list_active_dispatches()
    print("active dispatches:", code2, "n=", len(active))
    pts = c.merge_gps_points(rows, c.list_devices()[1])
    print("merged gps cars:", len(pts))
    for i, (k, v) in enumerate(list(pts.items())[:5]):
        print(f"  {k}: {v['lat']:.5f},{v['lng']:.5f} src={v['source']}")
PY
