#!/usr/bin/env python3
"""Backfill Numa's required filterable metadata onto the Synergy corpus sidecars.

Numa scopes every Bedrock KB retrieval with a HARD metadata filter
(workspace-chat-tools/tools/knowledge_base.py):

    andAll: [ equals(tenant_id == CLIENT_NAME), equals(kb_id == <folder>) ]

Docs whose `.metadata.json` lack `tenant_id` + `kb_id` match nothing — so chat
returns "No results" even though they're vectorised. This rewrites each sidecar
under the prefix to include Numa's schema (tenant_id, kb_id, uploader_id,
uploaded_at) while preserving job_id / file_name for cross-project attribution.

After running, trigger a KB ingestion so the new metadata becomes filterable.

Usage (run where AWS creds can write the data bucket):
    python3 synergy_fix_metadata.py \
        --bucket numa-cuttriss-data --region ap-southeast-2 \
        --prefix documents/synergy/ --tenant-id cuttriss --kb-id synergy
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import boto3

UPLOADED_AT = "2026-06-08T00:00:00+00:00"  # fixed stamp; backfill, not real upload time


def job_id_from_stem(filename: str) -> str:
    """Our stems are `{job_id}__{name}` — recover the job id."""
    return filename.split("__", 1)[0] if "__" in filename else ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--region", default="ap-southeast-2")
    ap.add_argument("--prefix", default="documents/synergy/")
    ap.add_argument("--tenant-id", required=True)
    ap.add_argument("--kb-id", required=True)
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--max", type=int, default=0, help="stop after N (test)")
    args = ap.parse_args()

    s3 = boto3.client("s3", region_name=args.region)

    def fix(txt_key: str) -> str:
        fname = txt_key.rsplit("/", 1)[-1]
        # strip the .txt we appended so file_name reflects the original doc
        orig = fname[:-4] if fname.endswith(".txt") else fname
        meta = {
            "metadataAttributes": {
                "tenant_id": args.tenant_id,
                "kb_id": args.kb_id,
                "uploader_id": "system",
                "uploaded_at": UPLOADED_AT,
                "job_id": job_id_from_stem(fname),
                "file_name": orig,
            }
        }
        s3.put_object(
            Bucket=args.bucket,
            Key=txt_key + ".metadata.json",
            Body=json.dumps(meta, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        return txt_key

    def items():
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=args.bucket, Prefix=args.prefix):
            for obj in page.get("Contents", []) or []:
                k = obj["Key"]
                if k.endswith(".txt"):  # the doc; we (re)write its sidecar
                    yield k

    it = items()
    pending: set = set()
    pool = ThreadPoolExecutor(max_workers=args.workers)
    n = err = 0

    def fill() -> None:
        while len(pending) < args.workers:
            try:
                pending.add(pool.submit(fix, next(it)))
            except StopIteration:
                return

    fill()
    while pending:
        finished, _ = wait(pending, return_when=FIRST_COMPLETED)
        pending.difference_update(finished)
        for fut in finished:
            try:
                fut.result()
                n += 1
            except Exception as exc:  # noqa: BLE001
                err += 1
                sys.stderr.write(f"  ! {exc}\n")
            if n % 2000 == 0 and n:
                print(f"  fixed={n} err={err}", flush=True)
        if args.max and n >= args.max:
            break
        fill()
    pool.shutdown(wait=False, cancel_futures=True)
    print(f"DONE fixed={n} err={err}")


if __name__ == "__main__":
    main()
