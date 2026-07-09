#!/usr/bin/env python3
"""Push local /root/epcr to GitHub using GITHUB_TOKEN or GH_TOKEN."""
import json, os, sys, base64, urllib.request, ssl
from pathlib import Path

TOKEN=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
if not TOKEN:
    print("Set GITHUB_TOKEN or GH_TOKEN", file=sys.stderr)
    sys.exit(1)
OWNER,REPO,BRANCH="TIAN0517","epcr","main"
CTX=ssl.create_default_context()
ROOT=Path("/root/epcr")

def api(method, url, data=None):
    req=urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "epcr-push",
    })
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read().decode())

# get latest commit on main
ref=api("GET", f"https://api.github.com/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
commit_sha=ref["object"]["sha"]
commit=api("GET", f"https://api.github.com/repos/{OWNER}/{REPO}/git/commits/{commit_sha}")
base_tree=commit["tree"]["sha"]

# collect blobs
tree=[]
skip_ext={".png",".ico",".jpg",".jpeg",".gif",".webp"}
for p in sorted(ROOT.rglob("*")):
    if not p.is_file() or ".git" in p.parts: continue
    if p.name=="bun.lock": continue
    rel=str(p.relative_to(ROOT)).replace("\\","/")
    if p.suffix.lower() in skip_ext:
        content=base64.b64encode(p.read_bytes()).decode()
        enc="base64"
    else:
        try:
            content=p.read_text(encoding="utf-8")
            enc="utf-8"
        except UnicodeDecodeError:
            content=base64.b64encode(p.read_bytes()).decode()
            enc="base64"
    blob=api("POST", f"https://api.github.com/repos/{OWNER}/{REPO}/git/blobs",
             json.dumps({"content":content,"encoding":enc}).encode())
    tree.append({"path":rel,"mode":"100644","type":"blob","sha":blob["sha"]})
    print("blob", rel)

new_tree=api("POST", f"https://api.github.com/repos/{OWNER}/{REPO}/git/trees",
             json.dumps({"base_tree":base_tree,"tree":tree}).encode())
new_commit=api("POST", f"https://api.github.com/repos/{OWNER}/{REPO}/git/commits",
    json.dumps({
        "message":"Add EPCR web UI and Python monitor backend\n\nOrganized Next.js dashboard (web/) and EPCR polling backend (backend/) with deploy templates. Secrets and runtime data excluded.",
        "tree":new_tree["sha"],
        "parents":[commit_sha],
    }).encode())
api("PATCH", f"https://api.github.com/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
    json.dumps({"sha":new_commit["sha"],"force":False}).encode())
print("OK", new_commit["sha"], "files", len(tree))
