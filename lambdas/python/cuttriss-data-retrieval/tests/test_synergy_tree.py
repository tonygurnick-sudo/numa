#!/usr/bin/env python3
"""
Show a small 12d Synergy folder tree starting at START_FOLDER_ID (depth-limited).

USAGE
  export SYNERGY_BASE_URL="https://synergy.cuttriss.co.nz"
  export START_FOLDER_ID="3_1"
  export SECRET_NAME="Greg_Synergy12D_PAT"
  export AWS_REGION="us-east-1"
  export AWS_PROFILE="q-demo"
  export MAX_DEPTH=3
  export MAX_SUBS_PER_LEVEL=30

  poetry run python -u tests/test_synergy_tree.py
"""
import json
import os
import sys
import traceback

import boto3
import requests
from requests.adapters import HTTPAdapter, Retry


def pat(secret, region):
    sm = boto3.client("secretsmanager", region_name=region)
    val = sm.get_secret_value(SecretId=secret)["SecretString"]
    try:
        return json.loads(val).get("token") or val
    except Exception:
        return val


def sess():
    s = requests.Session()
    r = Retry(
        total=4,
        backoff_factor=0.3,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=r))
    s.mount("http://", HTTPAdapter(max_retries=r))
    return s


def idstring_from(sf: dict) -> str:
    if sf.get("IDString"):
        return sf["IDString"]
    idobj = sf.get("ID") or sf.get("FolderID") or {}
    if isinstance(idobj, dict):
        if idobj.get("IDString"):
            return idobj["IDString"]
        _id, _sid = idobj.get("_id"), idobj.get("_server_id")
        if _id is not None and _sid is not None:
            return f"{_id}_{_sid}"
    for k in ("FolderIDString", "IDStr"):
        if sf.get(k):
            return sf[k]
    return "(unknown)"


def get_items(s, base, hdrs, folder_id):
    url = f"{base}/api/v1/folders/{folder_id}/items"
    print(f"[HTTP] GET {url}")
    r = s.get(url, headers=hdrs, timeout=60)
    print(f"[HTTP] Status {r.status_code}")
    r.raise_for_status()
    j = r.json()
    subs = j.get("SubFolders", []) or []
    files = (j.get("Files") or {}).get("Result", []) or []
    return subs, files


def show(s, base, hdrs, fid, depth, max_depth, max_subs, pad=""):
    subs, files = get_items(s, base, hdrs, fid)
    print(f"{pad}📂 {fid}  (subs={len(subs)}, files={len(files)})")
    if depth >= max_depth:
        return
    for sf in subs[:max_subs]:
        name = sf.get("Name")
        cid = idstring_from(sf)
        print(f"{pad}  ├─ {name!r}  [{cid}]")
        show(s, base, hdrs, cid, depth + 1, max_depth, max_subs, pad + "  │  ")


def main():
    print("[BOOT] Starting test_synergy_tree.py")
    region = os.getenv("AWS_REGION", "us-east-1")
    secret = os.getenv("SECRET_NAME", "synergy/pat")
    base = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
    start = os.getenv("START_FOLDER_ID")
    max_depth = int(os.getenv("MAX_DEPTH", "3"))
    max_subs = int(os.getenv("MAX_SUBS_PER_LEVEL", "30"))

    print(f"[ENV] Base={base!r}")
    print(f"[ENV] Start={start!r}")
    print(f"[ENV] Secret={secret!r}  Region={region!r}")

    if not base or not start:
        print("[ERR] SYNERGY_BASE_URL or START_FOLDER_ID not set.", file=sys.stderr)
        sys.exit(2)

    try:
        ident = boto3.client("sts", region_name=region).get_caller_identity()
        print(f"[STS] Caller ARN={ident['Arn']}  Account={ident['Account']}")
    except Exception as e:
        print(f"[WARN] STS identity failed: {e}")

    token = pat(secret, region)
    print(f"[OK] Retrieved PAT (len={len(token)})")
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    s = sess()

    print(f"[INFO] Walking tree from {start} (depth={max_depth})")
    show(s, base, hdrs, start, 0, max_depth, max_subs)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        print("[FATAL] Unhandled exception:")
        traceback.print_exc()
        sys.exit(1)
