#!/usr/bin/env python3
"""
Synergy → S3 full dump (discover roots, recurse all subfolders, download files, upload to S3).

Design goals
- Single file, no project scaffolding.
- Works with flaky servers (429/5xx), with retries + backoff.
- Two phases:
  1) Discovery: probe folder IDs in a numeric range to find existing folders and edges.
  2) Walk: for each discovered root, DFS over SubFolders and stream files to S3.
- Safe defaults, visible progress, and --dry-run / --print-files switches.

Endpoints handled:
- GET  /api/v1/folders/{id}/items → { SubFolders: [...], Files: { Result: [...] } }  (fallback file source)
- GET  /api/v1/folders/{id}/files → { TotalRows: N, Result: [ ... ] }                (preferred file source)
- POST /api/v1/files/{IDString}/download?version=X&with_references=true|false → bytes

Usage example at bottom of file.
"""
import argparse
import io
import json
import mimetypes
import os
import re
import sys
import typing as t
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote

import requests
from requests.adapters import HTTPAdapter, Retry

try:
    import boto3
    from botocore.exceptions import ClientError
except Exception:
    boto3 = None

# ----------------------------
# Helpers
# ----------------------------
SANITIZE_RE = re.compile(r"[^A-Za-z0-9._\-/ ]+")


class Log:
    @staticmethod
    def info(*a):
        print(*a, flush=True)

    @staticmethod
    def warn(*a):
        print("[WARN]", *a, flush=True)

    @staticmethod
    def err(*a):
        print("[ERR]", *a, file=sys.stderr, flush=True)


def parse_range(s: str) -> t.Tuple[int, int]:
    m = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", s)
    if not m:
        raise ValueError(f"bad --probe-range: {s}")
    a, b = int(m.group(1)), int(m.group(2))
    if a > b:
        a, b = b, a
    return a, b


def make_session(
    req_timeout: int, max_retries: int, retry_backoff: float
) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=max_retries,
        backoff_factor=retry_backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))

    orig = s.request

    def wrapped(method, url, **kw):
        kw.setdefault("timeout", req_timeout)
        return orig(method, url, **kw)

    s.request = wrapped  # type: ignore
    return s


# ----------------------------
# API helpers
# ----------------------------


def get_items(
    sess: requests.Session, base: str, pat: str, fid: str
) -> t.Optional[dict]:
    url = f"{base}/api/v1/folders/{fid}/items"
    r = sess.get(url, headers={"Authorization": f"Bearer {pat}"})
    if r.status_code == 401:
        Log.err(f"GET items {fid}: 401 Unauthorized (check PAT)")
        return None
    if r.status_code == 404:
        return None
    if r.status_code >= 500:
        Log.err(f"GET items {fid}: {r.status_code} server error")
        return None
    try:
        r.raise_for_status()
        return r.json()
    except Exception as e:
        Log.err(f"GET items {fid} failed: {e}")
        return None


def _extract_files_from_response(data: dict) -> list[dict]:
    """
    Normalize Synergy variants:
      - { "Result": [ ... ] }
      - { "Files": { "Result": [ ... ], "TotalRows": N } }
      - { "Files": [ ... ] }
    """
    if not isinstance(data, dict):
        return []
    if isinstance(data.get("Result"), list):
        return data["Result"]
    files_obj = data.get("Files")
    if isinstance(files_obj, dict) and isinstance(files_obj.get("Result"), list):
        return files_obj["Result"]
    if isinstance(files_obj, list):
        return files_obj
    return []


def _total_rows_hint(data: dict) -> t.Optional[int]:
    if not isinstance(data, dict):
        return None
    if isinstance(data.get("TotalRows"), int):
        return data["TotalRows"]
    files_obj = data.get("Files")
    if isinstance(files_obj, dict) and isinstance(files_obj.get("TotalRows"), int):
        return files_obj["TotalRows"]
    return None


def fetch_file_details(
    sess: requests.Session,
    base: str,
    pat: str,
    file_id: str,
    include_attrs: bool = True,
) -> t.Optional[dict]:
    params = "?retrieve_attributes=true" if include_attrs else ""
    url = f"{base}/api/v1/files/{file_id}{params}"
    r = sess.get(
        url,
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    if r.status_code in (401, 404):
        Log.err(f"[META] {file_id} -> {r.status_code}")
        return None
    try:
        r.raise_for_status()
        return r.json()
    except Exception as e:
        Log.err(f"[META] fetch {file_id} failed: {e}")
        return None


def guess_content_type(
    file_name: t.Optional[str], file_type_hint: t.Optional[str]
) -> str:
    if file_name:
        ctype, _ = mimetypes.guess_type(file_name, strict=False)
        if ctype:
            return ctype
    if file_type_hint:
        hint = file_type_hint.lower()
        mapping = {
            "pdf": "application/pdf",
            "dwg": "image/vnd.dwg",
            "dxf": "image/vnd.dxf",
            "txt": "text/plain",
            "csv": "text/csv",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "jpeg": "image/jpeg",
            "jpg": "image/jpeg",
            "png": "image/png",
        }
        for needle, mime in mapping.items():
            if needle in hint:
                return mime
    return "application/octet-stream"


def _sanitize_attr_key(name: str) -> t.Optional[str]:
    if not name:
        return None
    slug = re.sub(r"[^a-z0-9\-]+", "-", name.lower()).strip("-")
    return slug or None


def extract_attribute_metadata(file_obj: dict) -> dict[str, str]:
    attrs = file_obj.get("Attributes")
    if not isinstance(attrs, list):
        return {}
    metadata: dict[str, str] = {}
    for attr in attrs:
        key = _sanitize_attr_key(attr.get("name") or attr.get("display_name"))
        if not key:
            continue
        val = attr.get("value") or attr.get("Value")
        resolved = None
        if isinstance(val, dict):
            resolved = val.get("_value") or val.get("value")
            coord = val.get("_coordinate")
            if resolved is None and coord:
                resolved = f"{coord.get('x')},{coord.get('y')}"
        elif val not in (None, "", []):
            resolved = str(val)
        if resolved is None:
            continue
        metadata[f"attr-{key}"] = str(resolved)[:1024]
    return metadata


def yield_files_via_files(
    sess: requests.Session, base: str, pat: str, fid: str, page_size: int
) -> list[dict]:
    files: list[dict] = []
    page = 1
    while True:
        url = f"{base}/api/v1/folders/{fid}/files"
        r = sess.get(
            url,
            headers={"Authorization": f"Bearer {pat}"},
            params={
                "page": str(page),
                "page_size": str(page_size),
                "retrieve_attributes": "false",
                "show_deleted_files": "false",
            },
        )
        if r.status_code in (401, 404):
            return files
        if r.status_code >= 500:
            Log.err(f"GET files {fid}: {r.status_code} server error (skipping)")
            return files
        try:
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            Log.err(f"GET files {fid} page {page} failed: {e}")
            return files

        chunk = _extract_files_from_response(data)
        if not chunk:
            return files
        files.extend(chunk)

        total_rows = _total_rows_hint(data)
        if total_rows is not None:
            if len(files) >= total_rows:
                return files
        else:
            if len(chunk) < page_size:
                return files
        page += 1


def yield_files_via_items(
    sess: requests.Session, base: str, pat: str, fid: str, page_size: int
) -> list[dict]:
    files: list[dict] = []
    page = 1
    while True:
        url = f"{base}/api/v1/folders/{fid}/items"
        r = sess.get(
            url,
            headers={"Authorization": f"Bearer {pat}"},
            params={"page": str(page), "page_size": str(page_size)},
        )
        if r.status_code in (401, 404):
            return files
        if r.status_code >= 500:
            Log.err(f"GET items (files) {fid}: {r.status_code} server error (skipping)")
            return files
        try:
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            Log.err(f"GET items {fid} page {page} failed: {e}")
            return files

        chunk = _extract_files_from_response(data)
        if chunk:
            files.extend(chunk)

        total_rows = _total_rows_hint(data)
        if total_rows is not None:
            if len(files) >= total_rows:
                return files
        else:
            if not chunk or len(chunk) < page_size:
                return files
        page += 1


def list_folder_files(
    sess: requests.Session, base: str, pat: str, folder_id: str, page_size: int
) -> list[dict]:
    """
    Robust file listing:
      1) Try /folders/{id}/files with pagination.
      2) If empty, fallback to /folders/{id}/items and read Files.Result with pagination.
    """
    via_files = yield_files_via_files(sess, base, pat, folder_id, page_size)
    if via_files:
        return via_files
    return yield_files_via_items(sess, base, pat, folder_id, page_size)


# ----------------------------
# File helpers
# ----------------------------


def idstring_from(obj: dict) -> t.Optional[str]:
    if not isinstance(obj, dict):
        return None
    v = obj.get("IDString") or obj.get("IdString")
    if v:
        return str(v)
    idd = obj.get("ID") or obj.get("Id")
    if isinstance(idd, dict):
        _id = idd.get("_id")
        _sid = idd.get("_server_id")
        if _id is not None and _sid is not None:
            return f"{_id}_{_sid}"
    return None


def choose_name(f: dict, fallback: str) -> str:
    candidates = [
        f.get("Name"),
        f.get("DisplayName"),
        f.get("FileName"),
        f.get("Title"),
        f.get("Path"),
        f.get("SynergyPath"),
    ]
    for c in candidates:
        if not c:
            continue
        c = str(c).strip()
        if not c:
            continue
        c = unquote(c).replace("\\", "/")
        c = c.split("/")[-1]
        c = SANITIZE_RE.sub("_", c).strip("/ ")
        if c:
            return c
    return fallback


def s3_key(prefix: str, folder_id: str, file_id: str, name: str) -> str:
    safe = name.replace("\\", "/").strip("/")
    parts = [p for p in [prefix.strip("/"), folder_id, file_id, safe] if p]
    return "/".join(parts)


# ----------------------------
# Download + upload worker
# ----------------------------


def download_file(
    sess: requests.Session,
    base: str,
    pat: str,
    file_obj: dict,
    with_refs: bool,
    timeout: int,
) -> bytes:
    fid = idstring_from(file_obj)
    if not fid:
        raise RuntimeError("file missing IDString")
    version = int(file_obj.get("LatestVersion") or 1)
    url = f"{base}/api/v1/files/{fid}/download"
    params = {
        "version": str(version),
        "with_references": "true" if with_refs else "false",
    }
    r = sess.post(
        url,
        headers={
            "Authorization": f"Bearer {pat}",
            "Content-Type": "application/octet-stream",
        },
        params=params,
        data=b"",
        stream=True,
        timeout=timeout,
    )
    if r.status_code == 404:
        raise RuntimeError(f"404 Not Found for {fid} v{version}")
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(chunk_size=1024 * 512):
        if chunk:
            buf.write(chunk)
    return buf.getvalue()


# ----------------------------
# Main
# ----------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("SYNERGY_BASE_URL", "").rstrip("/"))
    ap.add_argument("--pat", default=os.getenv("SYNERGY_PAT", ""))
    ap.add_argument(
        "--server-id", type=int, default=int(os.getenv("SYNERGY_SERVER_ID", "1"))
    )
    ap.add_argument("--probe-range", required=True, help='e.g. "1-1500"')
    ap.add_argument("--probe-workers", type=int, default=16)
    ap.add_argument("--page-size", type=int, default=200)
    ap.add_argument("--req-timeout", type=int, default=8)
    ap.add_argument("--max-retries", type=int, default=6)
    ap.add_argument("--retry-backoff", type=float, default=0.8)

    ap.add_argument("--s3-bucket", default=os.getenv("S3_BUCKET", ""))
    ap.add_argument("--s3-prefix", default=os.getenv("S3_PREFIX", ""))
    ap.add_argument("--aws-region", default=os.getenv("AWS_REGION", "us-east-1"))
    ap.add_argument("--download-workers", type=int, default=6)

    ap.add_argument("--with-refs", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--print-files",
        action="store_true",
        help="print file lines as we discover them",
    )

    args = ap.parse_args()

    if not args.base_url or not args.pat:
        Log.err("Provide --base-url and --pat, or set SYNERGY_BASE_URL / SYNERGY_PAT.")
        sys.exit(2)

    if not args.dry_run and (not args.s3_bucket or boto3 is None):
        Log.err("Non-dry run requires boto3 and --s3-bucket.")
        sys.exit(2)

    Log.info("[START] synergy_dump_all_to_s3 v1.1")
    Log.info(
        f"[BOOT] base={args.base_url} server_id={args.server_id} probe={args.probe_range} probe_workers={args.probe_workers} page_size={args.page_size} dry={args.dry_run} with_refs={args.with_refs}"
    )

    sess = make_session(args.req_timeout, args.max_retries, args.retry_backoff)

    # quick ping to a known-ish folder (8_1) just to verify auth path
    ping = sess.get(
        f"{args.base_url}/api/v1/folders/8_{args.server_id}/items",
        headers={"Authorization": f"Bearer {args.pat}"},
    )
    Log.info(f"[PING] GET /folders/8_{args.server_id}/items -> {ping.status_code}")

    lo, hi = parse_range(args.probe_range)

    parents: t.Set[str] = set()
    children: t.Set[str] = set()
    edges: t.Dict[str, t.List[str]] = {}

    def probe(i: int):
        fid = f"{i}_{args.server_id}"
        data = get_items(sess, args.base_url, args.pat, fid)
        if not data:
            return None
        subs = data.get("SubFolders") or []
        sub_ids: list[str] = []
        for sf in subs:
            sid = idstring_from(sf)
            if sid:
                sub_ids.append(sid)
                children.add(sid)
        edges[fid] = sub_ids
        parents.add(fid)
        Log.info(f"[FOUND] {fid}  subs={len(sub_ids)}")
        return True

    # Phase 1: discovery
    with ThreadPoolExecutor(max_workers=args.probe_workers) as ex:
        futs = [ex.submit(probe, i) for i in range(lo, hi + 1)]
        for _ in as_completed(futs):
            pass

    if not parents:
        Log.info("[RESULT] No folders discovered in probe range.")
        return

    roots = sorted(
        [p for p in parents if p not in children], key=lambda s: int(s.split("_")[0])
    )
    if not roots:  # degenerate graph—treat all as roots
        roots = sorted(parents, key=lambda s: int(s.split("_")[0]))

    Log.info(f"[RESULT] discovered={len(parents)} roots={len(roots)}")

    s3 = None
    if not args.dry_run and args.s3_bucket:
        s3 = boto3.client("s3", region_name=args.aws_region)

    # Phase 2: walk
    seen: t.Set[str] = set()
    download_queue: list[tuple[str, dict]] = []  # (folder_id, file_obj)

    def walk(fid: str, depth: int = 0):
        if fid in seen:
            return
        seen.add(fid)
        Log.info(f"[WALK] {fid}")

        # list files in this folder (robust path: /files then fallback to /items)
        flist = list_folder_files(sess, args.base_url, args.pat, fid, args.page_size)
        Log.info(f"   [FILES] found={len(flist)} in {fid}")
        for f in flist:
            f_id = idstring_from(f) or "unknown_id"
            name = choose_name(f, f"{f_id}.bin")
            if args.print_files:
                Log.info(f"     - {f_id}\t{name}")
            download_queue.append((fid, f))

        # traverse children
        for child in edges.get(fid) or []:
            walk(child, depth + 1)

    for r in roots:
        walk(r)

    Log.info(f"[PLAN] files_to_fetch={len(download_queue)}")

    if args.dry_run:
        Log.info("[DRY] Skipping downloads/uploads.")
        return

    # Phase 3: download + upload
    def transfer_one(pair: tuple[str, dict]):
        folder_id, fobj = pair
        file_id = idstring_from(fobj) or "unknown_id"
        detailed = fetch_file_details(sess, args.base_url, args.pat, file_id)
        merged = {**fobj, **(detailed or {})}
        name = choose_name(merged, f"{file_id}.bin")
        key = s3_key(args.s3_prefix, folder_id, file_id, name)
        metadata = extract_attribute_metadata(merged)
        content_type = guess_content_type(name, merged.get("FileType"))
        try:
            blob = download_file(
                sess, args.base_url, args.pat, merged, args.with_refs, args.req_timeout
            )
        except Exception as e:
            Log.err(f"[DL-ERR] {file_id} {name}: {e}")
            return (file_id, name, False)
        try:
            assert s3 is not None
            put_args = {
                "Bucket": args.s3_bucket,
                "Key": key,
                "Body": blob,
                "ContentType": content_type,
            }
            if metadata:
                put_args["Metadata"] = metadata
            s3.put_object(**put_args)
            Log.info(f"[UPLOAD] s3://{args.s3_bucket}/{key}")
            return (file_id, name, True)
        except ClientError as e:
            Log.err(f"[S3-ERR] {file_id} {name}: {e}")
            return (file_id, name, False)

    ok = 0
    with ThreadPoolExecutor(max_workers=args.download_workers) as ex:
        futs = [ex.submit(transfer_one, pair) for pair in download_queue]
        for fut in as_completed(futs):
            fid, name, success = fut.result()
            ok += 1 if success else 0
    Log.info(f"[DONE] uploaded={ok}/{len(download_queue)} files")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    main()

"""
Run examples

# Narrow test on one known folder tree (fast, no uploads):
PYTHONWARNINGS="ignore:NotOpenSSLWarning" PYTHONUNBUFFERED=1 \
poetry run python -u synergy_dump_all_to_s3.py \
  --base-url "https://synergy.cuttriss.co.nz" \
  --pat "$SYNERGY_PAT" \
  --probe-range "8-8" \
  --server-id 1 \
  --page-size 200 \
  --with-refs \
  --dry-run \
  --print-files

# Full pass (discovery + download + upload):
PYTHONWARNINGS="ignore:NotOpenSSLWarning" PYTHONUNBUFFERED=1 \
poetry run python -u synergy_dump_all_to_s3.py \
  --base-url "https://synergy.cuttriss.co.nz" \
  --pat "$SYNERGY_PAT" \
  --probe-range "1-1500" \
  --server-id 1 \
  --probe-workers 16 \
  --page-size 200 \
  --with-refs \
  --aws-region "us-east-1" \
  --s3-bucket "greg-synergy12d-allfiles" \
  --s3-prefix "cuttriss/22153" \
  --download-workers 6 \
  --print-files
"""
