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
        allowed_methods=frozenset(["GET"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=r))
    s.mount("http://", HTTPAdapter(max_retries=r))
    return s


def main():
    region = os.getenv("AWS_REGION", "us-east-1")
    secret = os.getenv("SECRET_NAME", "synergy/pat")
    base = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
    folder = os.getenv("START_FOLDER_ID")
    page_size = int(os.getenv("PAGE_SIZE", "100"))

    if not base or not folder:
        print("Set SYNERGY_BASE_URL and START_FOLDER_ID", file=sys.stderr)
        sys.exit(2)

    pat = get_pat(secret, region)
    hdrs = {"Authorization": f"Bearer {pat}", "Content-Type": "application/json"}

    url = f"{base}/api/v1/folders/{folder}/files?retrieve_attributes=false&page=1&page_size={page_size}&show_deleted_files=false"
    print(f"[INFO] GET {url}")
    r = session().get(url, headers=hdrs, timeout=60)
    print("[INFO] Status:", r.status_code)
    if r.status_code == 401:
        print("[ERR] 401 Unauthorized – PAT / user perms.", file=sys.stderr)
        sys.exit(3)
    if r.status_code == 403:
        print("[ERR] 403 Forbidden – IP allowlist / perms.", file=sys.stderr)
        sys.exit(3)
    if r.status_code == 404:
        print("[ERR] 404 Not Found – folder ID likely wrong.", file=sys.stderr)
        sys.exit(3)
    r.raise_for_status()

    try:
        data = r.json()
    except ValueError:
        print("[ERR] Non-JSON body:", r.text[:500], file=sys.stderr)
        sys.exit(4)

    files = data.get("Result") or (data.get("Files") or {}).get("Result") or []
    print(f"[OK] Files: {len(files)}")
    for f in files[:20]:
        print(
            "  ID:",
            f.get("IDString"),
            "Name:",
            f.get("Name"),
            "LatestVersion:",
            f.get("LatestVersion"),
            "State:",
            f.get("State"),
        )


if __name__ == "__main__":
    main()
