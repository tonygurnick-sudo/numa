#!/usr/bin/env python3
"""
Probe each job's IDString as a folder to find which ones actually have subfolders/files.

USAGE
  export SYNERGY_BASE_URL="https://synergy.cuttriss.co.nz"
  export SECRET_NAME="Greg_Synergy12D_PAT"
  export AWS_REGION="us-east-1"
  export AWS_PROFILE="q-demo"

  # Optional pagination/filter:
  export JOB_NAME_FILTER=""   # substring (leave empty for all)
  export PAGE=1
  export PAGE_SIZE=200        # bump to see more in one go

  poetry run python -u tests/test_synergy_probe_job_roots.py
"""
import json
import os
import sys

import boto3
import requests
from requests.adapters import HTTPAdapter, Retry


def get_pat(secret, region):
    val = boto3.client("secretsmanager", region_name=region).get_secret_value(
        SecretId=secret
    )["SecretString"]
    try:
        return json.loads(val).get("token") or val
    except Exception:
        return val


def make_sess():
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


def list_jobs(s, base, hdrs, name, page, page_size):
    url = f"{base}/api/v1/jobs/?name={requests.utils.quote(name)}&page={page}&page_size={page_size}"
    print(f"[INFO] GET {url}")
    r = s.get(url, headers=hdrs, timeout=60)
    print("[INFO] Status:", r.status_code)
    r.raise_for_status()
    data = r.json()
    jobs = data.get("Result") or data
    return jobs if isinstance(jobs, list) else []


def probe_folder(s, base, hdrs, folder_id):
    url = f"{base}/api/v1/folders/{folder_id}/items"
    r = s.get(url, headers=hdrs, timeout=60)
    if r.status_code == 404:
        return None  # not a folder
    r.raise_for_status()
    j = r.json()
    subs = j.get("SubFolders", []) or []
    files = (j.get("Files") or {}).get("Result", []) or []
    return {"subs": len(subs), "files": len(files)}


def main():
    base = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
    if not base:
        print("Set SYNERGY_BASE_URL", file=sys.stderr)
        sys.exit(1)
    region = os.getenv("AWS_REGION", "us-east-1")
    secret = os.getenv("SECRET_NAME", "synergy/pat")
    name = os.getenv("JOB_NAME_FILTER", "")
    page = int(os.getenv("PAGE", "1"))
    page_size = int(os.getenv("PAGE_SIZE", "200"))

    token = get_pat(secret, region)
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    s = make_sess()

    print(f"[INFO] Listing jobs page={page} size={page_size} filter={name!r}")
    jobs = list_jobs(s, base, hdrs, name, page, page_size)
    print(f"[OK] Jobs: {len(jobs)}")

    results = []
    for j in jobs:
        jname = j.get("Name") or j.get("JobName")
        # Extract IDString robustly
        jid = None
        if isinstance(j.get("ID"), dict):
            jid = (
                j["ID"].get("IDString")
                or f"{j['ID'].get('_id')}_{j['ID'].get('_server_id')}"
            )
        jid = jid or j.get("IDString") or j.get("Id")
        if not jid:
            print(f"[SKIP] Job without IDString: {jname!r}")
            continue

        try:
            probed = probe_folder(s, base, hdrs, jid)
        except requests.HTTPError as e:
            print(f"[ERR] Probe {jid} failed: {e}")
            probed = None

        if probed is None:
            print(f"  - {jname!r} [{jid}]  -> not a folder (404)")
        else:
            print(
                f"  - {jname!r} [{jid}]  -> subs={probed['subs']} files={probed['files']}"
            )
            results.append((jname, jid, probed["subs"], probed["files"]))

    print("\n[SUMMARY] Candidates with content:")
    for jname, jid, subs, files in results:
        if subs > 0 or files > 0:
            print(f"  * {jname!r}  root={jid}  subs={subs} files={files}")


if __name__ == "__main__":
    main()
