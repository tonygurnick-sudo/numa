#!/usr/bin/env python3
import io
import json
import os
import re
import sys
import typing as t
from urllib.parse import unquote

import boto3
import requests
from botocore.exceptions import ClientError
from requests.adapters import HTTPAdapter, Retry

# -----------------------------
# Env / config
# -----------------------------
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
SECRET_NAME = os.getenv("SECRET_NAME", "synergy/pat")
BASE_URL = (os.getenv("SYNERGY_BASE_URL") or "").rstrip("/")
START_ID = os.getenv("START_FOLDER_ID")  # e.g. "8_1"
S3_BUCKET = os.getenv("S3_BUCKET")
# strip leading/trailing slashes so joins are clean
S3_PREFIX = (os.getenv("S3_PREFIX", "") or "").strip("/")
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "200"))
RECURSE = os.getenv("RECURSE", "true").lower() in ("1", "true", "yes")
WITH_REFS = os.getenv("WITH_REFERENCES", "false").lower() in ("1", "true", "yes")
DRY_RUN = os.getenv("DRY_RUN", "false").lower() in ("1", "true", "yes")
MAX_UPLOADS = int(os.getenv("MAX_UPLOADS", "0"))  # 0 = no cap

if not BASE_URL or not START_ID or not S3_BUCKET:
    print("[ERR] Set SYNERGY_BASE_URL, START_FOLDER_ID, S3_BUCKET", file=sys.stderr)
    sys.exit(2)


# -----------------------------
# Helpers
# -----------------------------
def sm_client():
    return boto3.client("secretsmanager", region_name=AWS_REGION)


def s3_client():
    return boto3.client("s3", region_name=AWS_REGION)


def get_pat(secret_name: str) -> str:
    try:
        resp = sm_client().get_secret_value(SecretId=secret_name)
    except ClientError as e:
        print(f"[ERR] secretsmanager.get_secret_value failed: {e}", file=sys.stderr)
        sys.exit(3)
    val = resp.get("SecretString") or ""
    try:
        data = json.loads(val)
        return data.get("token") or data.get("PAT") or data.get("pat") or val
    except Exception:
        return val


def session() -> requests.Session:
    s = requests.Session()
    r = Retry(
        total=4,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
    )
    s.mount("https://", HTTPAdapter(max_retries=r))
    s.mount("http://", HTTPAdapter(max_retries=r))
    return s


def idstring_from_file_obj(f: dict) -> t.Optional[str]:
    """
    Prefer f['IDString'].
    Fallback: compose from f['ID'] dict if present.
    """
    if f.get("IDString"):
        return f["IDString"]
    id_obj = f.get("ID") or f.get("Id")
    if isinstance(id_obj, dict):
        _id = id_obj.get("_id")
        _sid = id_obj.get("_server_id")
        if _id is not None and _sid is not None:
            return f"{_id}_{_sid}"
    return None


_SANITIZE_RE = re.compile(r"[^A-Za-z0-9._\-/ ]+")


def _basename(path_like: str) -> str:
    # handle Synergy-like "Path" or "SynergyPath" that may contain backslashes
    s = (path_like or "").strip()
    if not s:
        return ""
    s = s.replace("\\", "/")
    s = s.rstrip("/")
    return s.split("/")[-1] if s else ""


def pick_filename(f: dict, id_str: str) -> str:
    """
    Choose a stable, readable filename:
      1) Name (if present)
      2) FileName
      3) basename(Path) / basename(SynergyPath)
      4) <id_str>.bin
    Sanitize to be S3-friendly; keep slashes only for subdirs (we don't want them here).
    """
    candidates = [
        f.get("Name"),
        f.get("FileName"),
        _basename(f.get("Path", "")),
        _basename(f.get("SynergyPath", "")),
    ]
    for c in candidates:
        c = (c or "").strip()
        if not c:
            continue
        c = unquote(c)
        # Remove any path separators inside the *file* name
        c = c.replace("\\", "/")
        c = _basename(c)
        # sanitize unsafe chars
        c = _SANITIZE_RE.sub("_", c)
        c = c.strip("/ ").strip()
        if c:
            return c
    return f"{id_str}.bin"


def list_folder_items(
    sess: requests.Session, base: str, hdrs: dict, folder_id: str
) -> dict:
    url = f"{base}/api/v1/folders/{folder_id}/items"
    r = sess.get(url, headers=hdrs, timeout=60)
    r.raise_for_status()
    return r.json()


def list_folder_files(
    sess: requests.Session, base: str, hdrs: dict, folder_id: str, page_size: int
) -> t.List[dict]:
    url = f"{base}/api/v1/folders/{folder_id}/files"
    params = {
        "retrieve_attributes": "false",
        "page": "1",
        "page_size": str(page_size),
        "show_deleted_files": "false",
        "filter": "",
    }
    r = sess.get(url, headers=hdrs, params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    # API responses vary across versions
    return data.get("Result") or (data.get("Files") or {}).get("Result") or []


def s3_key_for(folder_id: str, id_str: str, filename: str) -> str:
    """
    Stable path: <prefix>/<folder_id>/<id_str>/<filename>
    Using id_str in the path prevents collisions when many files share the same (or blank) name.
    """
    safe_file = (filename or "").replace("\\", "/").strip("/")
    parts = [p for p in [S3_PREFIX, folder_id, id_str, safe_file] if p]
    return "/".join(parts)


def download_file(
    sess: requests.Session, base: str, hdrs: dict, file_obj: dict, with_refs: bool
) -> bytes:
    """
    Streams the file bytes for given file object; returns raw bytes.
    Must use file IDString and the 'LatestVersion'.
    """
    id_str = idstring_from_file_obj(file_obj)
    if not id_str:
        raise RuntimeError("Missing IDString for file")
    version = file_obj.get("LatestVersion") or 1
    url = f"{base}/api/v1/files/{id_str}/download"
    params = {
        "version": str(version),
        "with_references": "true" if with_refs else "false",
    }
    # Per docs: POST with empty body and 'application/octet-stream'
    r = sess.post(
        url,
        headers={**hdrs, "Content-Type": "application/octet-stream"},
        params=params,
        data=b"",
        timeout=180,
        stream=True,
    )
    if r.status_code == 404:
        raise RuntimeError(f"404 Not Found for {id_str} v{version}")
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(chunk_size=1024 * 512):
        if chunk:
            buf.write(chunk)
    return buf.getvalue()


# -----------------------------
# Main
# -----------------------------
def main():
    print(
        f"[BOOT] BASE={BASE_URL} START={START_ID} BUCKET={S3_BUCKET} RECURSE={RECURSE} DRY_RUN={DRY_RUN} WITH_REFS={WITH_REFS}"
    )
    pat = get_pat(SECRET_NAME)
    hdrs = {"Authorization": f"Bearer {pat}"}

    sess = session()
    s3 = s3_client()

    to_visit = [START_ID]
    scanned = uploaded = skipped = errors = 0
    cap_left = MAX_UPLOADS if MAX_UPLOADS > 0 else None

    while to_visit:
        folder_id = to_visit.pop(0)
        # Files in this folder
        try:
            files = list_folder_files(sess, BASE_URL, hdrs, folder_id, PAGE_SIZE)
        except Exception as e:
            print(f"[ERR] listing files for {folder_id}: {e}", file=sys.stderr)
            errors += 1
            files = []

        print(f"[FOLDER] {folder_id} -> files={len(files)}")
        for f in files:
            scanned += 1
            id_str = idstring_from_file_obj(f)
            if not id_str:
                # Without an ID we can't download — skip safely.
                print(f"[WARN] file missing IDString; skipping")
                skipped += 1
                continue

            version = f.get("LatestVersion") or 1
            filename = pick_filename(f, id_str)
            key = s3_key_for(folder_id, id_str, filename)

            print(
                f"[PLAN] UPLOAD s3://{S3_BUCKET}/{key}  (id={id_str} name={filename} v={version})"
            )

            if DRY_RUN:
                continue

            # Stop if we've hit MAX_UPLOADS
            if cap_left is not None and cap_left <= 0:
                print("[INFO] MAX_UPLOADS reached, stopping.")
                break

            try:
                content = download_file(sess, BASE_URL, hdrs, f, WITH_REFS)
            except Exception as e:
                print(
                    f"[ERR] download failed for {id_str} v{version}: {e}",
                    file=sys.stderr,
                )
                errors += 1
                continue

            try:
                s3.put_object(
                    Bucket=S3_BUCKET,
                    Key=key,
                    Body=content,
                    ContentType="application/octet-stream",
                )
                uploaded += 1
                if cap_left is not None:
                    cap_left -= 1
                print(f"[OK] uploaded -> s3://{S3_BUCKET}/{key}")
            except ClientError as e:
                print(f"[ERR] s3 put_object failed for {key}: {e}", file=sys.stderr)
                errors += 1

        if cap_left is not None and cap_left <= 0:
            break

        # Recurse subfolders?
        if RECURSE:
            try:
                items = list_folder_items(sess, BASE_URL, hdrs, folder_id)
                subs = items.get("SubFolders") or []
                for sf in subs:
                    sf_id = sf.get("IDString")
                    if sf_id:
                        to_visit.append(sf_id)
            except Exception as e:
                print(
                    f"[WARN] listing items for {folder_id} (to recurse) failed: {e}",
                    file=sys.stderr,
                )

    print(
        f"\n[SUMMARY] scanned={scanned} uploaded={uploaded} skipped={skipped} recurse={RECURSE} refs={WITH_REFS} dry={DRY_RUN} errors={errors}"
    )


if __name__ == "__main__":
    main()
