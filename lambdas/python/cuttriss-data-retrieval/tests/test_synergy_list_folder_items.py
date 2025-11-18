#!/usr/bin/env python3
import json
import os
import sys

import boto3
import requests
from requests.adapters import HTTPAdapter, Retry


def get_pat(secret_name, region):
    sm = boto3.client("secretsmanager", region_name=region)
    val = sm.get_secret_value(SecretId=secret_name)["SecretString"]
    try:
        return json.loads(val).get("token") or val
    except Exception:
        return val


def session():
    s = requests.Session()
    r = Retry(
        total=4,
        backoff_factor=0.3,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=r))
    s.mount("http://", HTTPAdapter(max_retries=r))
    return s


def preflight(sess, base, headers):
    url = f"{base}/api/v1/jobs/?name=test&page=1&page_size=1"
    try:
        r = sess.get(url, headers=headers, timeout=30)
        return (r.status_code in (200, 204)), f"preflight status {r.status_code}"
    except requests.RequestException as e:
        return False, f"preflight error: {e}"


def idstring_from_folder_obj(sf: dict) -> str:
    """
    Normalize Synergy's folder ID shape:
      - sometimes 'IDString' at top level
      - sometimes nested under 'ID': {'IDString': '61409_1', '_id': 61409, '_server_id': 1}
      - sometimes other alias fields
    """
    if sf.get("IDString"):
        return sf["IDString"]
    idobj = sf.get("ID") or sf.get("FolderID") or {}
    if isinstance(idobj, dict):
        if idobj.get("IDString"):
            return idobj["IDString"]
        # Fallback compose if present
        _id = idobj.get("_id")
        _sid = idobj.get("_server_id")
        if _id is not None and _sid is not None:
            return f"{_id}_{_sid}"
    # last-ditch: some payloads use 'IDStr' or 'FolderIDString'
    for k in ("FolderIDString", "IDStr"):
        if sf.get(k):
            return sf[k]
    return "(unknown)"


def list_items(sess, base, headers, folder_id):
    url = f"{base}/api/v1/folders/{folder_id}/items"
    r = sess.get(url, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    subs = data.get("SubFolders", []) or []
    files = (data.get("Files") or {}).get("Result", []) or []
    return subs, files


def main():
    region = os.getenv("AWS_REGION", "us-east-1")
    secret = os.getenv("SECRET_NAME", "synergy/pat")
    base = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
    start_folder = os.getenv("START_FOLDER_ID")
    drill = os.getenv("DRILL_SUBFOLDER")  # optional: name OR IDString to drill into

    if not base or not start_folder:
        print("Set SYNERGY_BASE_URL and START_FOLDER_ID", file=sys.stderr)
        sys.exit(2)

    pat = get_pat(secret, region)
    headers = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}
    sess = session()

    ok, note = preflight(sess, base, headers)
    if not ok:
        print(f"[WARN] Preflight not 200/204 ({note}) — continuing anyway.")

    # List the starting folder
    print(f"[INFO] GET {base}/api/v1/folders/{start_folder}/items")
    subs, files = list_items(sess, base, headers, start_folder)
    print(f"[OK] Subfolders: {len(subs)}  Files: {len(files)}")

    # Pretty print subfolders with normalized IDs
    if subs:
        print("\nSubfolders:")
        for sf in subs:
            name = sf.get("Name")
            fid = idstring_from_folder_obj(sf)
            ftype = sf.get("FolderType")
            nsubs = sf.get("NoOfSubFolders")
            inherits = sf.get("InheritsFileAttributes")
            print(
                f"  - Name: {name!r}  ID: {fid}  Type: {ftype}  Subfolders: {nsubs}  InheritsAttrs: {inherits}"
            )

    if files:
        print("\nExample files (up to 5):")
        for f in files[:5]:
            print(
                f"  - {f.get('Name')}  ID={f.get('IDString')}  v={f.get('LatestVersion')}"
            )

    # Optional drill-down (by name OR IDString)
    if drill:
        print(f"\n[INFO] Drill requested: {drill!r}")
        # find by exact ID match first
        match = next((sf for sf in subs if idstring_from_folder_obj(sf) == drill), None)
        if not match:
            # then try by name
            match = next((sf for sf in subs if (sf.get("Name") or "") == drill), None)
        if not match:
            print("[ERR] Drill target not found among subfolders.", file=sys.stderr)
            sys.exit(3)
        child_id = idstring_from_folder_obj(match)
        print(f"[INFO] Drilling into {match.get('Name')!r} (ID {child_id})")
        csubs, cfiles = list_items(sess, base, headers, child_id)
        print(f"[OK] Subfolders: {len(csubs)}  Files: {len(cfiles)} inside {child_id}")
        if csubs:
            print("  Child subfolders:")
            for sf in csubs[:10]:
                print(f"    - {sf.get('Name')!r}  ID: {idstring_from_folder_obj(sf)}")
        if cfiles:
            print("  Child example files:")
            for f in cfiles[:10]:
                print(
                    f"    - {f.get('Name')}  ID={f.get('IDString')}  v={f.get('LatestVersion')}"
                )


if __name__ == "__main__":
    main()
