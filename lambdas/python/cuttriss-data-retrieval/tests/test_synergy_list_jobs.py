#!/usr/bin/env python3
"""
List 12d Synergy jobs by name filter.

USAGE
  export SYNERGY_BASE_URL="https://synergy.cuttriss.co.nz"
  export SECRET_NAME="Greg_Synergy12D_PAT"
  export AWS_REGION="us-east-1"
  export AWS_PROFILE="q-demo"
  # optional filters:
  export JOB_NAME_FILTER="Trimble"   # substring match server-side (or leave blank to list first page)
  export PAGE=1
  export PAGE_SIZE=50

  poetry run python -u tests/test_synergy_list_jobs.py
"""
import json
import os
import sys

import boto3
import requests
from requests.adapters import HTTPAdapter, Retry


def pat(secret, region):
    val = boto3.client("secretsmanager", region_name=region).get_secret_value(
        SecretId=secret
    )["SecretString"]
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


def main():
    base = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
    if not base:
        print("Set SYNERGY_BASE_URL", file=sys.stderr)
        sys.exit(1)
    region = os.getenv("AWS_REGION", "us-east-1")
    secret = os.getenv("SECRET_NAME", "synergy/pat")
    name = os.getenv("JOB_NAME_FILTER", "").strip()
    page = int(os.getenv("PAGE", "1"))
    page_size = int(os.getenv("PAGE_SIZE", "50"))

    token = pat(secret, region)
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    s = sess()

    url = f"{base}/api/v1/jobs/?name={requests.utils.quote(name)}&page={page}&page_size={page_size}"
    print(f"[INFO] GET {url}")
    r = s.get(url, headers=hdrs, timeout=60)
    print("[INFO] Status:", r.status_code)
    r.raise_for_status()
    data = r.json()

    jobs = data.get("Result") or data
    if isinstance(jobs, dict) and "Result" in jobs:
        jobs = jobs["Result"]
    if not isinstance(jobs, list):
        print("[ERR] Unexpected jobs payload:", str(data)[:400], file=sys.stderr)
        sys.exit(2)

    print(f"[OK] Jobs returned: {len(jobs)}")
    for j in jobs:
        jid = j.get("IDString") or j.get("ID") or j.get("Id")
        name = j.get("Name") or j.get("JobName")
        root = (
            j.get("RootFolderIDString")
            or j.get("RootFolderIdString")
            or j.get("RootFolder", {}).get("IDString")
        )
        print(f"  - Job: {name!r}  ID:{jid}  RootFolder:{root}")


if __name__ == "__main__":
    main()
