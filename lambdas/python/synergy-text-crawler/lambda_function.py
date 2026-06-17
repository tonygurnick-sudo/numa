"""Synergy KB crawler — per-job worker (container Lambda).

Processes ONE 12d job per invocation: enumerates the job's text-bearing files,
downloads + extracts each, and writes a ``.txt`` + Bedrock ``.metadata.json``
sidecar into the client data bucket so the bucket-wide Bedrock ingestion picks
them up for cross-job chat search. Per-file watermarks make re-runs cheap.

Security / ACL model (see the feature plan):
- The sidecar carries ``tenant_id`` + ``kb_id="synergy"`` (without which Bedrock
  retrieval is fail-closed and the doc is invisible) and an ``allowed_users``
  list — the set of Numa user subs allowed to retrieve this job's content. Chat
  retrieval filters ``listContains(allowed_users, <caller>)``.
- ``allowed_users`` + ``acl_rev`` are owned by the coordinator (which unions a
  user's sub in only after that user's own PAT proved they can see the job).
  This worker just stamps the current set. When the set grows (acl_rev bumps)
  but a file's version is unchanged, we rewrite ONLY the sidecar — no
  re-download / re-extract. That is the "indexed once, access is cheap" model.

Credentials never traverse Step Functions execution history: the event carries
``secret_id`` (the vault path) and the worker reads the PAT from Secrets Manager
under its own least-privilege role.

Event:
    {
      "job_id": "8_1", "job_name": "...", "job_path": "...",
      "run_id": "...", "user_sub": "...",
      "secret_id": "<client>/vault/users/<sub>",
      "instance_url": "https://synergy.example.com",
      "cursor": {"page": 1} | null,
      "force_full": false
    }

Returns:
    {"job_status": "done"|"partial", "cursor": {...}|null, "job_id": "...",
     "counts": {...}}
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import structlog

from extract import LEGACY_EXTS, TEXT_EXTS, SkipType, extract_text, file_ext
from prm import client as prm_client
from prm import resource as prm_resource
from synergy_client import JobPageError, Synergy, SynergyAuthError

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")
STATE_TABLE_NAME = os.getenv("STATE_TABLE_NAME", "")
KB_ID = os.getenv("KB_ID", "synergy")
S3_PREFIX = os.getenv("S3_PREFIX", "documents/synergy")
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "100"))
MAX_FILE_BYTES = int(float(os.getenv("MAX_FILE_MB", "75")) * 1024 * 1024)
# Stop pulling new pages when fewer than this many ms remain so we can checkpoint
# and return a partial cursor before the Lambda is killed.
SAFETY_MS = int(os.getenv("SAFETY_MS", "90000"))
# Bedrock caps .metadata.json size; cap the allowed_users list we stamp.
ALLOWED_USERS_CAP = int(os.getenv("ALLOWED_USERS_CAP", "200"))


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _get(d: dict, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return default


def _id_string(obj: dict) -> Optional[str]:
    return (obj.get("ID") or {}).get("IDString") or obj.get("IDString")


def _safe(name: str, limit: int = 120) -> str:
    name = re.sub(r"[^\w.\-]+", "_", name or "").strip("_.")
    return (name or "file")[:limit]


def _attr_value(attributes: Any, *names: str) -> Optional[str]:
    """Read a 12d custom attribute (Revision, Document Status) by name.

    12d attributes carry BOTH a snake_case ``name`` ("document_status") and a
    human ``display_name`` ("Document Status"); instances vary in which is
    populated. Check both, normalizing underscores to spaces, so either shape
    matches.
    """
    if not isinstance(attributes, list):
        return None
    wanted = {n.strip().lower().replace("_", " ") for n in names}
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        candidates = (attr.get("name"), attr.get("display_name"))
        normalized = {str(c).strip().lower().replace("_", " ") for c in candidates if c}
        if normalized & wanted:
            value = attr.get("value")
            if isinstance(value, dict):
                value = value.get("_value")
            return str(value) if value not in (None, "") else None
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Vault credential read (PAT never travels through SFN history)
# --------------------------------------------------------------------------- #
def _get_pat(secret_id: str) -> str:
    """Read the Synergy PAT from a user vault secret.

    Mirrors the coordinator/gate readers exactly: both the current
    `connector-synergy` key and the legacy pre-split `oauth-synergy` key, with
    a `fields` sub-dict or fields-at-top-level. A narrower reader here would
    let the sync-now gate admit users whose jobs this worker can't crawl.
    """
    sm = prm_client("secretsmanager", region=REGION)
    raw = sm.get_secret_value(SecretId=secret_id)["SecretString"]
    sec = json.loads(raw)
    secrets = sec.get("secrets", {}) if isinstance(sec, dict) else {}
    for key in ("connector-synergy", "oauth-synergy"):
        entry = secrets.get(key) if isinstance(secrets, dict) else None
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if isinstance(fields, dict):
            pat = (fields.get("access_token") or "").strip()
            if pat:
                return pat
    raise ValueError(f"No Synergy access_token in secret {secret_id}")


# --------------------------------------------------------------------------- #
# Watermark / ACL state (numa-{client}-synergy-crawl-state)
# --------------------------------------------------------------------------- #
def _state_table():
    return prm_resource("dynamodb", region=REGION).Table(STATE_TABLE_NAME)


def _read_job_row(table, job_id: str) -> Tuple[List[str], int, str, str]:
    """Return (allowed_users, acl_rev, job_name, job_path) for a job.

    The coordinator owns allowed_users/acl_rev. name/path are returned so
    invocations that don't carry them (the on-visit hook) don't degrade the
    sidecar attribution down to the raw job id.
    """
    resp = table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})
    item = resp.get("Item") or {}
    users = item.get("allowed_users")
    if isinstance(users, set):
        users = sorted(users)
    elif not isinstance(users, list):
        users = []
    acl_rev = int(item.get("acl_rev") or 0)
    return (
        list(users)[:ALLOWED_USERS_CAP],
        acl_rev,
        str(item.get("job_name") or ""),
        str(item.get("job_path") or ""),
    )


def _read_file_state(table, file_id: str) -> Dict[str, Any]:
    resp = table.get_item(Key={"pk": f"FILE#{file_id}", "sk": "META"})
    return resp.get("Item") or {}


def _put_file_state(
    table,
    *,
    file_id: str,
    job_id: str,
    version: str,
    acl_rev: int,
    content_sha: str,
    s3_txt_key: str,
    run_id: str,
    weblink: str = "",
) -> bool:
    """Write a FILE# watermark row, guarded against ACL rollback.

    The ConditionExpression rejects the write when the existing row already
    carries a NEWER acl_rev — i.e. a concurrent worker stamped a fresher
    allowed_users set; overwriting it would re-grant revoked users (or drop
    fresh grants). Returns False on that conflict so the caller can re-read
    the JOB row and restamp with the fresher set.
    """
    try:
        table.put_item(
            Item={
                "pk": f"FILE#{file_id}",
                "sk": "META",
                "file_id": file_id,
                "job_id": job_id,
                "indexed_version": str(version),
                "acl_rev": acl_rev,
                "content_sha": content_sha,
                "s3_txt_key": s3_txt_key,
                "weblink": weblink,
                "state": "indexed",
                "last_seen_run": run_id,
                "last_seen_at": _now(),
                "updated_at": _now(),
            },
            ConditionExpression="attribute_not_exists(acl_rev) OR acl_rev <= :rev",
            ExpressionAttributeValues={":rev": acl_rev},
        )
        return True
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        return False


def _touch_file_seen(table, file_id: str, run_id: str) -> None:
    """Record that an already-current file was seen now (deletion sweep)."""
    table.update_item(
        Key={"pk": f"FILE#{file_id}", "sk": "META"},
        UpdateExpression="SET last_seen_run = :r, last_seen_at = :t",
        ExpressionAttributeValues={":r": run_id, ":t": _now()},
    )


def _sweep_deleted_files(table, s3, *, job_id: str, cutoff_iso: str) -> int:
    """Remove indexed docs that vanished from the job in 12d.

    Only called after the job's file listing was FULLY enumerated this run.
    The predicate is MONOTONIC (last_seen_at < this run's start time), not
    run-id equality: concurrent workers (SFN drain, on-visit hook, a second
    manual sync) re-stamp files with their own run ids, and an equality sweep
    would purge documents another run just re-confirmed. A timestamp older
    than our start means NO walker has seen the file since before we began —
    it is genuinely gone from Synergy. Rows missing last_seen_at are kept
    (fail-safe; they gain the stamp on their next touch).
    """
    deleted = 0
    query_kwargs: Dict[str, Any] = {
        "IndexName": "job-index",
        "KeyConditionExpression": "job_id = :j",
        "FilterExpression": "begins_with(pk, :f) AND last_seen_at < :cutoff",
        "ExpressionAttributeValues": {
            ":j": job_id,
            ":f": "FILE#",
            ":cutoff": cutoff_iso,
        },
    }
    while True:
        resp = table.query(**query_kwargs)
        for item in resp.get("Items", []):
            key = item.get("s3_txt_key")
            if key:
                for obj_key in (key, f"{key}.metadata.json"):
                    try:
                        s3.delete_object(Bucket=DATA_BUCKET_NAME, Key=obj_key)
                    except Exception:  # noqa: BLE001 — best-effort cleanup
                        pass
            table.delete_item(Key={"pk": item["pk"], "sk": item.get("sk", "META")})
            deleted += 1
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    return deleted


# --------------------------------------------------------------------------- #
# S3 corpus writes
# --------------------------------------------------------------------------- #
def _s3():
    return prm_client("s3", region=REGION)


def _write_doc(
    s3,
    *,
    job_id: str,
    file_id: str,
    file_name: str,
    text: str,
    sidecar: Dict[str, Any],
) -> str:
    stem = f"{S3_PREFIX}/{job_id}/{file_id}__{_safe(file_name)}.txt"
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=stem,
        Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=f"{stem}.metadata.json",
        Body=json.dumps(sidecar, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    return stem


def _write_sidecar_only(s3, s3_txt_key: str, sidecar: Dict[str, Any]) -> None:
    """Rewrite just the sidecar (ACL grew, content unchanged)."""
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=f"{s3_txt_key}.metadata.json",
        Body=json.dumps(sidecar, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )


def _build_sidecar(
    *,
    allowed_users: List[str],
    job_id: str,
    job_name: str,
    job_path: str,
    file_obj: dict,
    file_id: str,
    file_name: str,
    version: str,
    weblink: str = "",
) -> Dict[str, Any]:
    attrs = file_obj.get("Attributes")
    return {
        "metadataAttributes": {
            "tenant_id": CLIENT_NAME,
            "kb_id": KB_ID,
            "allowed_users": allowed_users,
            "job_id": job_id,
            "job_name": job_name,
            "job_path": job_path,
            "file_id": file_id,
            "file_name": file_name,
            "file_path": _get(file_obj, "Path", default=""),
            "version": str(version),
            "revision": _attr_value(attrs, "Revision") or "",
            "document_status": _attr_value(
                attrs, "Document Status", "Status", "Drawing Status"
            )
            or "",
            "source": "synergy-crawler",
            "source_weblink": weblink,
            "indexed_at": _now(),
        }
    }


# --------------------------------------------------------------------------- #
# Handler
# --------------------------------------------------------------------------- #
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    job_id = event["job_id"]
    run_id = event.get("run_id") or "adhoc"
    secret_id = event["secret_id"]
    instance_url = event["instance_url"]
    cursor = event.get("cursor") or {}
    # Sweep cutoff: the time THIS job's walk first started. Carried through
    # partial-cursor continuations so a resumed invocation never sweeps files
    # its own earlier leg already stamped.
    run_started_at = str(cursor.get("run_started_at") or "") or _now()
    force_full = bool(event.get("force_full"))

    for required, val in (
        ("DATA_BUCKET_NAME", DATA_BUCKET_NAME),
        ("STATE_TABLE_NAME", STATE_TABLE_NAME),
    ):
        if not val:
            raise ValueError(f"{required} not configured")

    table = _state_table()
    s3 = _s3()
    allowed_users, job_acl_rev, row_job_name, row_job_path = _read_job_row(
        table, job_id
    )
    # Prefer event attribution, fall back to the JOB row (on-visit invocations
    # don't carry name/path), then the raw id.
    job_name = event.get("job_name") or row_job_name or job_id
    job_path = event.get("job_path") or row_job_path or ""

    pat = _get_pat(secret_id)
    syn = Synergy(instance_url, pat)

    counts = {
        "extracted": 0,
        "restamped": 0,
        "unchanged": 0,
        "deleted": 0,
        "skipped_type": 0,
        "skipped_legacy": 0,
        "skipped_big": 0,
        "skipped_empty": 0,
        "errors": 0,
    }

    logger.info(
        "synergy_worker_start",
        _name="SYNERGY_CRAWL_JOB",
        job_id=job_id,
        run_id=run_id,
        run_started_at=run_started_at,
        acl_rev=job_acl_rev,
        allowed_users=len(allowed_users),
        force_full=force_full,
    )

    # Enumeration ALWAYS restarts at page 1: 12d's offset pagination has no
    # stable sort, so resuming at a stored page index would skip files that
    # shifted pages after a concurrent Synergy-side deletion — and the sweep
    # would then purge them. Re-listing is cheap (already-indexed files are
    # watermark-skipped); the cursor only carries the run's sweep cutoff.
    page = 1
    job_status = "done"
    next_cursor: Optional[Dict[str, Any]] = None
    enumeration_complete = False
    out_of_time = False

    def _low_on_time() -> bool:
        return (
            context is not None and context.get_remaining_time_in_millis() < SAFETY_MS
        )

    try:
        while True:
            # Checkpoint before we run out of time.
            if _low_on_time():
                out_of_time = True
                break

            rows, total_pages = syn.list_job_files_page(job_id, page, PAGE_SIZE)
            for f in rows:
                # A single page can hold up to PAGE_SIZE heavy downloads —
                # check mid-page too, not just at page boundaries.
                if _low_on_time():
                    out_of_time = True
                    break
                _process_file(
                    syn,
                    s3,
                    table,
                    file_obj=f,
                    job_id=job_id,
                    job_name=job_name,
                    job_path=job_path,
                    run_id=run_id,
                    allowed_users=allowed_users,
                    job_acl_rev=job_acl_rev,
                    force_full=force_full,
                    counts=counts,
                )
            if out_of_time:
                break

            if total_pages and page < total_pages:
                page += 1
                continue
            enumeration_complete = True
            break

        if out_of_time:
            job_status = "partial"
            next_cursor = {"run_started_at": run_started_at}

        if enumeration_complete:
            # Every still-existing file has a last_seen_at newer than this
            # run's start (stamped by us or any concurrent walker). Anything
            # older was deleted in 12d.
            counts["deleted"] = _sweep_deleted_files(
                table, s3, job_id=job_id, cutoff_iso=run_started_at
            )
    except SynergyAuthError:
        logger.error("synergy_worker_auth_failed", job_id=job_id, secret_id=secret_id)
        raise
    except JobPageError as exc:
        # Listing failed — NOT the same as an empty job. No sweep; the job
        # gets re-pended by the next coordinator pass.
        job_status = "error_listing"
        counts["errors"] += 1
        logger.warning("synergy_job_listing_failed", job_id=job_id, error=str(exc))
    finally:
        syn.close()

    logger.info(
        "synergy_worker_done",
        _name="SYNERGY_CRAWL_JOB",
        job_id=job_id,
        run_id=run_id,
        job_status=job_status,
        **counts,
    )
    return {
        "job_status": job_status,
        "cursor": next_cursor,
        "job_id": job_id,
        "counts": counts,
    }


def _process_file(
    syn: Synergy,
    s3,
    table,
    *,
    file_obj: dict,
    job_id: str,
    job_name: str,
    job_path: str,
    run_id: str,
    allowed_users: List[str],
    job_acl_rev: int,
    force_full: bool,
    counts: Dict[str, int],
) -> None:
    file_id = _id_string(file_obj)
    file_name = str(_get(file_obj, "FileName", "Name", default="") or "")
    if not file_id:
        return
    ext = file_ext(file_name)
    if ext in LEGACY_EXTS:
        counts["skipped_legacy"] += 1
        return
    if ext not in TEXT_EXTS:
        counts["skipped_type"] += 1
        return
    size = _get(file_obj, "FileSize", "Size", default=0) or 0
    try:
        if int(size) > MAX_FILE_BYTES:
            counts["skipped_big"] += 1
            return
    except (TypeError, ValueError):
        pass

    version_raw = _get(file_obj, "LatestVersion", "Version", default=1) or 1
    try:
        version_num = int(version_raw)
    except (TypeError, ValueError):
        version_num = 1
    version = str(version_raw)
    state = _read_file_state(table, file_id)
    indexed_version = str(state.get("indexed_version") or "")
    file_acl_rev = int(state.get("acl_rev") or 0)
    s3_txt_key = state.get("s3_txt_key") or ""

    current = (not force_full) and indexed_version == version and bool(s3_txt_key)

    if current and file_acl_rev >= job_acl_rev:
        # Up to date — or stamped by a FRESHER walker than our snapshot
        # (file_acl_rev > job_acl_rev). Either way, do NOT touch the sidecar:
        # rewriting it from our older snapshot would roll back a newer
        # allowed_users set (re-granting revoked users). Just record we saw it.
        _touch_file_seen(table, file_id, run_id)
        counts["unchanged"] += 1
        return

    if current and file_acl_rev < job_acl_rev:
        # ACL changed but the document is unchanged → rewrite ONLY the sidecar
        # (weblink reused from the watermark row — no extra API call).
        weblink = str(state.get("weblink") or "")
        _stamp_file(
            s3,
            table,
            file_obj=file_obj,
            job_id=job_id,
            job_name=job_name,
            job_path=job_path,
            file_id=file_id,
            file_name=file_name,
            version=version,
            weblink=weblink,
            allowed_users=allowed_users,
            acl_rev=job_acl_rev,
            content_sha=str(state.get("content_sha") or ""),
            s3_txt_key=s3_txt_key,
            run_id=run_id,
        )
        counts["restamped"] += 1
        return

    # New or changed file → download, extract, write.
    try:
        data = syn.download(file_id, version_num)
        text = (extract_text(data, ext) or "").strip()
    except SkipType:
        counts["skipped_type"] += 1
        return
    except SynergyAuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — one bad file must not kill the job
        counts["errors"] += 1
        if s3_txt_key:
            # The PREVIOUS indexed version is still live in Synergy — protect
            # it from the deletion sweep so a transient failure on the new
            # version doesn't purge the existing document.
            _touch_file_seen(table, file_id, run_id)
        logger.warning(
            "synergy_file_error", job_id=job_id, file_id=file_id, error=str(exc)
        )
        return

    if not text:
        counts["skipped_empty"] += 1
        return

    # Best-effort citation weblink (only on new/changed files — one extra call).
    weblink = syn.get_weblink(file_id)
    content_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    sidecar = _build_sidecar(
        allowed_users=allowed_users,
        job_id=job_id,
        job_name=job_name,
        job_path=job_path,
        file_obj=file_obj,
        file_id=file_id,
        file_name=file_name,
        version=version,
        weblink=weblink,
    )
    new_key = _write_doc(
        s3,
        job_id=job_id,
        file_id=file_id,
        file_name=file_name,
        text=text,
        sidecar=sidecar,
    )
    if not _put_file_state(
        table,
        file_id=file_id,
        job_id=job_id,
        version=version,
        acl_rev=job_acl_rev,
        content_sha=content_sha,
        s3_txt_key=new_key,
        run_id=run_id,
        weblink=weblink,
    ):
        # A concurrent walker stamped a fresher ACL while we extracted —
        # re-read the JOB row and restamp the sidecar with the fresher set.
        _restamp_with_fresh_acl(
            s3,
            table,
            file_obj=file_obj,
            job_id=job_id,
            job_name=job_name,
            job_path=job_path,
            file_id=file_id,
            file_name=file_name,
            version=version,
            weblink=weblink,
            content_sha=content_sha,
            s3_txt_key=new_key,
            run_id=run_id,
        )
    counts["extracted"] += 1


def _stamp_file(
    s3,
    table,
    *,
    file_obj: dict,
    job_id: str,
    job_name: str,
    job_path: str,
    file_id: str,
    file_name: str,
    version: str,
    weblink: str,
    allowed_users: List[str],
    acl_rev: int,
    content_sha: str,
    s3_txt_key: str,
    run_id: str,
) -> None:
    """Sidecar rewrite + watermark put, retrying once with a fresh ACL on conflict."""
    sidecar = _build_sidecar(
        allowed_users=allowed_users,
        job_id=job_id,
        job_name=job_name,
        job_path=job_path,
        file_obj=file_obj,
        file_id=file_id,
        file_name=file_name,
        version=version,
        weblink=weblink,
    )
    _write_sidecar_only(s3, s3_txt_key, sidecar)
    if not _put_file_state(
        table,
        file_id=file_id,
        job_id=job_id,
        version=version,
        acl_rev=acl_rev,
        content_sha=content_sha,
        s3_txt_key=s3_txt_key,
        run_id=run_id,
        weblink=weblink,
    ):
        _restamp_with_fresh_acl(
            s3,
            table,
            file_obj=file_obj,
            job_id=job_id,
            job_name=job_name,
            job_path=job_path,
            file_id=file_id,
            file_name=file_name,
            version=version,
            weblink=weblink,
            content_sha=content_sha,
            s3_txt_key=s3_txt_key,
            run_id=run_id,
        )


def _restamp_with_fresh_acl(
    s3,
    table,
    *,
    file_obj: dict,
    job_id: str,
    job_name: str,
    job_path: str,
    file_id: str,
    file_name: str,
    version: str,
    weblink: str,
    content_sha: str,
    s3_txt_key: str,
    run_id: str,
) -> None:
    """Conflict path: a fresher acl_rev exists — restamp from the current JOB row.

    Our sidecar write may have clobbered the fresher walker's sidecar, so we
    rewrite it from the freshest ACL we can read. The state put is conditional
    again; a second conflict means an even fresher writer won — leave theirs.
    """
    fresh_users, fresh_rev, _name_unused, _path_unused = _read_job_row(table, job_id)
    sidecar = _build_sidecar(
        allowed_users=fresh_users,
        job_id=job_id,
        job_name=job_name,
        job_path=job_path,
        file_obj=file_obj,
        file_id=file_id,
        file_name=file_name,
        version=version,
        weblink=weblink,
    )
    _write_sidecar_only(s3, s3_txt_key, sidecar)
    _put_file_state(
        table,
        file_id=file_id,
        job_id=job_id,
        version=version,
        acl_rev=fresh_rev,
        content_sha=content_sha,
        s3_txt_key=s3_txt_key,
        run_id=run_id,
        weblink=weblink,
    )
