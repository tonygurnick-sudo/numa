#!/usr/bin/env python3
"""One-off recovery for a Google Drive file corrupted by the proxy_request bug.

A file's head revision was overwritten with a tiny JSON blob (proxy_request sent
`json=body` to Drive's multipart upload endpoint instead of the real bytes; see
fix/pipedream-proxy-binary-corruption). The good content survives as an older
revision. This script downloads that last-good revision *binary-safe* and
re-uploads it as a new head revision via the safe `google_drive-update-file`
action — restoring both the bytes and the correct mimeType.

It talks to Pipedream Connect directly (reusing the proxy lambda's credentials
and the binary-safe `proxy_request`), so it does NOT depend on the prod proxy
deploy. The re-upload uses the *action* path (server-side multipart), which is
the path that worked correctly before the incident.

Default target: TabPhilly "Dane Coaching Session Notes.docx".

--------------------------------------------------------------------------------
PREREQS
  Run inside the pipedream-proxy lambda's poetry env (gives you `requests`,
  `boto3`, `structlog`, `prm`, and the binary-safe `proxy_request`):

    cd lambdas/python/pipedream-proxy
    AWS_PROFILE=<pipedream-proxy-account> \
    PIPEDREAM_SECRET_ARN=<arn-of-pipedream-creds-secret> \
    BINARY_CACHE_BUCKET=<a-bucket-in-that-account-for-staging> \
        poetry run python ../../../tools/recover-drive-file.py            # dry run
        poetry run python ../../../tools/recover-drive-file.py --execute  # restore

  AWS creds must reach the Pipedream proxy account (where the secret + staging
  bucket live). `BINARY_CACHE_BUCKET` is only needed for --execute (it stages
  the recovered bytes so the update-file action can fetch them via a presigned
  URL); it can be any bucket in that account.

SAFETY
  * Dry run by default: lists revisions, downloads + validates the good revision
    locally (writes a local ./<name>.recovered copy), performs NO writes to Drive.
  * --execute performs exactly two Drive writes: pin the good revision
    (keepForever) so it can't be auto-purged, then re-upload it as the new head.
    Re-downloads and validates the head afterwards.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import uuid
from pathlib import Path

# Reuse the (fixed, binary-safe) proxy operations for creds + downloads.
_LAMBDA_DIR = (
    Path(__file__).resolve().parents[1] / "lambdas" / "python" / "pipedream-proxy"
)
sys.path.insert(0, str(_LAMBDA_DIR))

import requests  # noqa: E402  (provided by the pipedream-proxy env)

from pipedream_operations import PipedreamOperations  # noqa: E402

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Incident defaults — override with CLI flags to reuse for another file.
DEFAULTS = {
    "client": "tabphilly",
    "user_sub": "b458d4e8-60b1-70c8-ddfe-7364bf662533",
    "file_id": "17u5s9SQ4VSXqR92oLQnKnBBYhZz4zZhm",
    "file_name": "Dane Coaching Session Notes.docx",
    "mime": DOCX_MIME,
    "app_slug": "google_drive",
}

GOOGLE = "https://www.googleapis.com"


def log(msg: str) -> None:
    print(f"[recover] {msg}", flush=True)


def fail(msg: str) -> "None":
    print(f"[recover] ERROR: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def find_account_id(ops: PipedreamOperations, external_user_id: str, app_slug: str):
    """Return (account_id, label) for the user's connected app, or exit."""
    creds = ops.get_credentials()
    token = ops.get_access_token()
    resp = requests.get(
        f"https://api.pipedream.com/v1/connect/{creds['project_id']}/accounts",
        headers={
            "Authorization": f"Bearer {token}",
            "x-pd-environment": creds["environment"],
        },
        params={
            "external_user_id": external_user_id,
            "include_credentials": "false",
            "limit": 100,
        },
        timeout=15,
    )
    resp.raise_for_status()
    accounts = resp.json().get("data", [])
    matches = []
    for a in accounts:
        app = a.get("app") or {}
        slug = app.get("name_slug") or app.get("slug") or ""
        if slug == app_slug or app_slug in json.dumps(app).lower():
            matches.append(a)
    if not matches:
        fail(
            f"No '{app_slug}' connection for external_user_id={external_user_id}. "
            f"Found apps: {sorted({(a.get('app') or {}).get('name_slug') for a in accounts})}"
        )
    if len(matches) > 1:
        log("Multiple matching connections — pass --account-id to disambiguate:")
        for a in matches:
            log(f"  id={a.get('id')}  name={a.get('name')}  healthy={a.get('healthy')}")
        fail("Ambiguous account; re-run with --account-id.")
    acc = matches[0]
    return acc["id"], f"{acc.get('name')} (healthy={acc.get('healthy')})"


def proxy_get_json(ops, euid, acc, url):
    res = ops.proxy_request(euid, acc, "GET", url)
    if isinstance(res, dict) and "text" in res and "revisions" not in res:
        # A JSON endpoint should parse; bail if we somehow got raw text.
        fail(f"Expected JSON from {url[:80]}..., got text. Proxy not returning JSON.")
    return res


def proxy_get_bytes(ops, euid, acc, url) -> bytes:
    res = ops.proxy_request(euid, acc, "GET", url)
    if not isinstance(res, dict):
        fail(f"Unexpected proxy response type: {type(res)}")
    if res.get("base64_body"):
        return base64.b64decode(res["base64_body"])
    if res.get("presigned_url"):
        r = requests.get(res["presigned_url"], timeout=120)
        r.raise_for_status()
        return r.content
    if "text" in res:
        fail(
            "Proxy returned the binary as TEXT — this env still has the unfixed "
            "proxy_request. Run inside the fix/pipedream-proxy-binary-corruption "
            "working tree so the download is binary-safe."
        )
    fail(f"Could not extract bytes from proxy response keys={list(res.keys())}")
    return b""  # unreachable


def pick_good_revision(revisions, explicit_id):
    """Choose the last-good revision: explicit, else newest non-JSON by size."""
    if explicit_id:
        for r in revisions:
            if r.get("id") == explicit_id:
                return r
        fail(f"Revision {explicit_id} not found in current revision list.")
    candidates = [
        r
        for r in revisions
        if r.get("mimeType") != "application/json" and int(r.get("size") or 0) > 1024
    ]
    if not candidates:
        fail("No good (non-JSON, >1KB) revision found — nothing to restore from.")
    # Newest good revision wins.
    candidates.sort(key=lambda r: r.get("modifiedTime", ""))
    return candidates[-1]


def main() -> None:
    p = argparse.ArgumentParser(description="Recover a proxy-corrupted Drive file.")
    p.add_argument(
        "--execute", action="store_true", help="perform the writes (default: dry run)"
    )
    p.add_argument("--client", default=DEFAULTS["client"])
    p.add_argument("--user-sub", default=DEFAULTS["user_sub"])
    p.add_argument("--file-id", default=DEFAULTS["file_id"])
    p.add_argument("--file-name", default=DEFAULTS["file_name"])
    p.add_argument("--mime", default=DEFAULTS["mime"])
    p.add_argument("--app-slug", default=DEFAULTS["app_slug"])
    p.add_argument(
        "--account-id",
        default=None,
        help="skip discovery; use this Pipedream account id",
    )
    p.add_argument(
        "--revision-id", default=None, help="explicit good revision id (else auto-pick)"
    )
    p.add_argument(
        "--staging-bucket",
        default=None,
        help="S3 bucket for the presigned upload source (default: $BINARY_CACHE_BUCKET)",
    )
    args = p.parse_args()

    external_user_id = f"{args.client}_{args.user_sub}"
    log(f"target file_id={args.file_id}  external_user_id={external_user_id}")
    log(
        f"mode: {'EXECUTE (will write to Drive)' if args.execute else 'DRY RUN (no writes)'}"
    )

    try:
        ops = PipedreamOperations()
    except Exception as e:  # noqa: BLE001
        fail(
            f"Could not init PipedreamOperations (set PIPEDREAM_SECRET_ARN + AWS creds): {e}"
        )

    account_id = args.account_id
    if not account_id:
        account_id, label = find_account_id(ops, external_user_id, args.app_slug)
        log(f"resolved {args.app_slug} account: {account_id}  [{label}]")
    else:
        log(f"using provided account_id: {account_id}")

    # 1) List revisions and confirm the good one survives.
    rev_url = (
        f"{GOOGLE}/drive/v3/files/{args.file_id}/revisions"
        "?fields=revisions(id,modifiedTime,mimeType,size,keepForever)&pageSize=100"
    )
    revs = proxy_get_json(ops, external_user_id, account_id, rev_url).get(
        "revisions", []
    )
    if not revs:
        fail("No revisions returned — wrong file id / account, or revisions purged.")
    log(f"{len(revs)} revisions:")
    for r in revs:
        log(
            f"  id={r.get('id')}  {r.get('modifiedTime')}  "
            f"size={r.get('size')}  mime={r.get('mimeType')}  keep={r.get('keepForever')}"
        )
    good = pick_good_revision(revs, args.revision_id)
    log(
        f"chosen good revision: id={good['id']}  size={good.get('size')}  "
        f"mime={good.get('mimeType')}  modified={good.get('modifiedTime')}"
    )

    # 2) Download + validate the good bytes (read-only).
    data = proxy_get_bytes(
        ops,
        external_user_id,
        account_id,
        f"{GOOGLE}/drive/v3/files/{args.file_id}/revisions/{good['id']}?alt=media",
    )
    if data[:2] != b"PK":
        fail(f"Downloaded bytes are not a ZIP/OOXML doc (head={data[:8]!r}); aborting.")
    log(f"downloaded good revision OK: {len(data)} bytes, valid OOXML (PK header)")
    local = Path.cwd() / f"{args.file_name}.recovered"
    local.write_bytes(data)
    log(f"local backup written: {local}")

    if not args.execute:
        log("DRY RUN complete — file is recoverable. Re-run with --execute to restore.")
        return

    # 3) Pin the good revision so it cannot be auto-purged.
    log("pinning good revision (keepForever=true) ...")
    ops.proxy_request(
        external_user_id,
        account_id,
        "PATCH",
        f"{GOOGLE}/drive/v3/files/{args.file_id}/revisions/{good['id']}",
        body={"keepForever": True},
    )
    log("pinned.")

    # 4) Stage bytes to S3 + presign, then re-upload via the safe update-file action.
    import os

    bucket = args.staging_bucket or os.environ.get("BINARY_CACHE_BUCKET")
    if not bucket:
        fail("--staging-bucket or $BINARY_CACHE_BUCKET required for --execute.")
    s3 = ops._get_s3_client()  # noqa: SLF001  (prm-wrapped client, proxy account)
    key = f"numa-recovery/{uuid.uuid4().hex}/{args.file_name}"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=args.mime,
        ServerSideEncryption="AES256",
    )
    src_url = s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=900
    )
    log(f"staged recovered bytes to s3://{bucket}/{key} (presigned 15m)")

    log("re-uploading as new head via google_drive-update-file action ...")
    result = ops.run_action(
        external_user_id,
        f"{args.app_slug}-update-file",
        {
            "googleDrive": {"authProvisionId": account_id},
            "fileId": args.file_id,
            "filePath": src_url,
        },
    )
    log(f"update-file action returned: {json.dumps(result)[:300]}")

    # 5) Verify the new head.
    time.sleep(3)
    head = proxy_get_bytes(
        ops,
        external_user_id,
        account_id,
        f"{GOOGLE}/drive/v3/files/{args.file_id}?alt=media",
    )
    if head[:2] != b"PK":
        fail(f"Post-restore head is still not OOXML (head={head[:8]!r}). Investigate.")
    log(f"VERIFIED: head is now {len(head)} bytes, valid OOXML. Recovery complete.")
    # Best-effort cleanup of the staging object.
    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001
        log(
            f"(note: could not delete staging object s3://{bucket}/{key}; clean up manually)"
        )


if __name__ == "__main__":
    main()
