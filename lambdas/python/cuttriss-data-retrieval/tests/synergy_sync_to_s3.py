#!/usr/bin/env python3
import argparse
import io
import json
import math
import os
import random
import sys
import time
import typing as t
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import requests
from botocore.exceptions import ClientError
from requests.adapters import HTTPAdapter, Retry


# ---------- HTTP session with retries ----------
def make_session(timeout: int, max_retries: int, backoff: float) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "synergy-sync-to-s3/0.3"})
    r = Retry(
        total=max_retries,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    s.mount("https://", HTTPAdapter(max_retries=r))
    s.mount("http://", HTTPAdapter(max_retries=r))

    orig = s.request

    def _req(method, url, **kw):
        kw.setdefault("timeout", timeout)
        return orig(method, url, **kw)

    s.request = _req  # type: ignore
    return s


# ---------- helpers ----------
def idstring_from(obj: dict) -> t.Optional[str]:
    if not isinstance(obj, dict):
        return None
    v = obj.get("IDString") or obj.get("IdString")
    if v:
        return v
    d = obj.get("ID") or obj.get("Id") or {}
    _id, sid = d.get("_id"), d.get("_server_id")
    if _id is not None and sid is not None:
        return f"{_id}_{sid}"
    return None


def folder_items(
    session: requests.Session, base: str, pat: str, folder_id: str
) -> t.Optional[dict]:
    try:
        r = session.get(
            f"{base}/api/v1/folders/{folder_id}/items",
            headers={"Authorization": f"Bearer {pat}"},
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[ERR] GET items {folder_id}: {e}", flush=True)
        return None


def folder_files_all_pages(
    session: requests.Session, base: str, pat: str, folder_id: str, page_size: int
) -> t.List[dict]:
    out: t.List[dict] = []
    page = 1
    while True:
        try:
            r = session.get(
                f"{base}/api/v1/folders/{folder_id}/files",
                headers={"Authorization": f"Bearer {pat}"},
                params={
                    "page": str(page),
                    "page_size": str(page_size),
                    "retrieve_attributes": "false",
                },
            )
            if r.status_code == 404:
                break
            r.raise_for_status()
            data = r.json()
            arr = (
                data.get("Result")
                or (data.get("Files") or {}).get("Result")
                or (data.get("Files") if isinstance(data.get("Files"), list) else [])
                or []
            )
            if not arr:
                # stop if explicitly no results or we've passed TotalRows
                total_rows = (
                    data.get("TotalRows")
                    or (data.get("Files") or {}).get("TotalRows")
                    or 0
                )
                if total_rows and len(out) >= total_rows:
                    break
                if page > 1:
                    break
                else:
                    break
            out.extend(arr)
            total_rows = (
                data.get("TotalRows")
                or (data.get("Files") or {}).get("TotalRows")
                or None
            )
            if total_rows is not None and len(out) >= int(total_rows):
                break
            if len(arr) < page_size:
                break
            page += 1
        except Exception as e:
            print(f"[WARN] files page fail {folder_id} p{page}: {e}", flush=True)
            break
    return out


def pick_name(f: dict) -> str:
    return (
        f.get("Name")
        or f.get("DisplayName")
        or f.get("FileName")
        or os.path.basename((f.get("Path") or "").replace("\\", "/"))
        or "no-name"
    )


def sanitize_component(s: str) -> str:
    s = s.strip().replace("\\", "/").strip("/")
    return "".join(ch if (ch.isalnum() or ch in "._- ") else "_" for ch in s)


def s3_key(prefix: str, folder_id: str, file_id: str, filename: str) -> str:
    return "/".join([p for p in [prefix.strip("/"), folder_id, file_id, filename] if p])


def download_file(
    session: requests.Session,
    base: str,
    pat: str,
    file_obj: dict,
    with_refs: bool,
    timeout: int = 300,
) -> bytes:
    fid = idstring_from(file_obj)
    if not fid:
        raise RuntimeError("file missing IDString")
    ver = file_obj.get("LatestVersion") or 1
    params = {"version": str(ver), "with_references": "true" if with_refs else "false"}
    url = f"{base}/api/v1/files/{fid}/download"
    r = session.post(
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
        raise RuntimeError(f"404 for file {fid} v{ver}")
    r.raise_for_status()
    buf = io.BytesIO()
    for chunk in r.iter_content(chunk_size=512 * 1024):
        if chunk:
            buf.write(chunk)
    return buf.getvalue()


# ---------- main ----------
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
    ap.add_argument("--with-refs", action="store_true")
    ap.add_argument("--req-timeout", type=int, default=8)
    ap.add_argument("--max-retries", type=int, default=5)
    ap.add_argument("--retry-backoff", type=float, default=0.6)
    ap.add_argument("--download-workers", type=int, default=6)
    ap.add_argument("--aws-region", default=os.getenv("AWS_REGION", "us-east-1"))
    ap.add_argument("--s3-bucket", required=True)
    ap.add_argument("--s3-prefix", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--print-files", action="store_true")
    args = ap.parse_args()

    if not args.base_url or not args.pat:
        print("[ERR] Provide --base-url and --pat (or env).", file=sys.stderr)
        sys.exit(2)

    # parse probe range
    import re

    m = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", args.probe_range)
    if not m:
        print("[ERR] bad --probe-range", file=sys.stderr)
        sys.exit(2)
    lo, hi = int(m.group(1)), int(m.group(2))
    if lo > hi:
        lo, hi = hi, lo

    print("[START] synergy_sync_to_s3 v0.3", flush=True)
    print(
        f"[BOOT] base={args.base_url} server_id={args.server_id} probe={lo}-{hi} "
        f"probe_workers={args.probe_workers} page_size={args.page_size} "
        f"dry={args.dry_run} with_refs={args.with_refs}",
        flush=True,
    )

    session = make_session(args.req_timeout, args.max_retries, args.retry_backoff)

    # sanity ping
    ping = folder_items(session, args.base_url, args.pat, f"8_{args.server_id}")
    print(
        f"[PING] GET /folders/8_{args.server_id}/items -> {200 if ping else 'ERR'}",
        flush=True,
    )

    # 1) PROBE
    parents: t.Set[str] = set()
    children: t.Set[str] = set()
    edges: t.Dict[str, t.List[str]] = {}

    def probe(i: int):
        fid = f"{i}_{args.server_id}"
        data = folder_items(session, args.base_url, args.pat, fid)
        if not data:
            return
        subs = data.get("SubFolders") or []
        sub_ids: t.List[str] = []
        for sf in subs:
            sid = idstring_from(sf)
            if sid:
                sub_ids.append(sid)
                children.add(sid)
        edges[fid] = sub_ids
        parents.add(fid)
        print(f"[FOUND] {fid}  subs={len(sub_ids)}", flush=True)

    with ThreadPoolExecutor(max_workers=args.probe_workers) as ex:
        futs = [ex.submit(probe, i) for i in range(lo, hi + 1)]
        for _ in as_completed(futs):
            pass

    if not parents:
        print("[RESULT] No folders discovered in probe range.", flush=True)
        return

    roots = sorted(
        [p for p in parents if p not in children], key=lambda s: int(s.split("_")[0])
    )
    if not roots:
        roots = sorted(parents, key=lambda s: int(s.split("_")[0]))
    print(f"[RESULT] discovered={len(parents)} roots={len(roots)}", flush=True)

    # 2) WALK & COLLECT FILE JOBS
    walk_order: t.List[str] = []
    seen: t.Set[str] = set()

    def dfs(fid: str):
        if fid in seen:
            return
        seen.add(fid)
        walk_order.append(fid)
        for c in edges.get(fid, []):
            dfs(c)

    for r in roots:
        dfs(r)
    print(f"[WALK] queued {len(walk_order)} folders", flush=True)

    # S3 client
    s3 = boto3.client("s3", region_name=args.aws_region)

    # 3) LIST FILES per folder & enqueue downloads
    download_jobs: t.List[t.Tuple[str, dict]] = []
    for idx, fid in enumerate(walk_order, 1):
        files = folder_files_all_pages(
            session, args.base_url, args.pat, fid, args.page_size
        )
        print(f"[WALK] {idx}/{len(walk_order)} {fid} files={len(files)}", flush=True)
        if args.print_files:
            for f in files:
                fidstr = idstring_from(f) or "unknown_id"
                print(f"        [FILE] {fidstr}\t{pick_name(f)}", flush=True)
        for f in files:
            download_jobs.append((fid, f))

    if args.dry_run:
        print(f"[DRY] planned downloads: {len(download_jobs)}", flush=True)
        return

    # 4) DOWNLOAD + PUT (threaded)
    def do_one(job: t.Tuple[str, dict]):
        folder_id, fobj = job
        fid = idstring_from(fobj) or "unknown_id"
        name = sanitize_component(pick_name(fobj)) or f"{fid}.bin"
        key = s3_key(args.s3_prefix, folder_id, fid, name)
        try:
            print(f"[GET]  /files/{fid}/download  refs={args.with_refs}", flush=True)
            content = download_file(
                session, args.base_url, args.pat, fobj, args.with_refs
            )
            print(
                f"[PUT]  s3://{args.s3_bucket}/{key}  bytes={len(content)}", flush=True
            )
            s3.put_object(
                Bucket=args.s3_bucket,
                Key=key,
                Body=content,
                ContentType="application/octet-stream",
            )
            return ("ok", key)
        except Exception as e:
            return ("err", f"{fid}@{folder_id}: {e}")

    ok = err = 0
    with ThreadPoolExecutor(max_workers=args.download_workers) as ex:
        futs = [ex.submit(do_one, j) for j in download_jobs]
        for f in as_completed(futs):
            status, msg = f.result()
            if status == "ok":
                ok += 1
            else:
                err += 1
                print(f"[ERR] {msg}", flush=True)

    print(f"[DONE] uploaded={ok} errors={err}", flush=True)


if __name__ == "__main__":
    # unbuffered logs
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore
    except Exception:
        pass
    main()
