"""Synergy KB crawler — per-job worker (zip Lambda).

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
from botocore.exceptions import ClientError

from extract import LEGACY_EXTS, TEXT_EXTS, SkipType, extract_text, file_ext
from prm import client as prm_client
from prm import resource as prm_resource
from synergy_client import JobPageError, Synergy, SynergyAuthError
from synergy_tokenize import tokenize_for_index

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")
STATE_TABLE_NAME = os.getenv("STATE_TABLE_NAME", "")
KB_ID = os.getenv("KB_ID", "synergy")
S3_PREFIX = os.getenv("S3_PREFIX", "documents/synergy")
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "100"))
# Per-type pre-download size caps. We decide PURELY from the listing metadata —
# a file is never downloaded just to discover it's junk (at 8TB that defeats the
# point). PDFs are capped tight because a large 12d PDF is almost always embedded
# CAD/raster graphics with little extractable text (that's where the terabytes
# are); a genuine text PDF is small. Other text types are small by nature, so the
# default cap is generous. Better to skip a rare huge text doc than pull GBs of
# graphics. All env-tunable per client.
DEFAULT_MAX_BYTES = int(float(os.getenv("MAX_FILE_MB", "25")) * 1024 * 1024)
PDF_MAX_BYTES = int(float(os.getenv("MAX_PDF_MB", "10")) * 1024 * 1024)


# Binary container formats whose listing size we must TRUST before downloading:
# a missing/zero size on these is untrustworthy (a huge PDF is embedded CAD/raster
# graphics — where the terabytes are; the modern Office formats are zip
# containers that can hold embedded images/objects; .msg/.eml can carry large
# attachments). For these we refuse to download on a size-less listing (OOM
# risk). Plain-text types (txt/csv/md/xml/json/html/rtf/log/tsv) are small by
# nature and stream cheaply, so a size-less listing of those keeps downloading.
TIGHT_CAPPED_EXTS = {"pdf", "docx", "xlsx", "xlsm", "pptx", "eml", "msg"}


def _max_bytes_for(ext: str) -> int:
    return PDF_MAX_BYTES if ext == "pdf" else DEFAULT_MAX_BYTES


# Per-job "rollup" record (cross-job similarity / "find similar jobs"): one small
# doc per job = its metadata + document names + a capped text sample, embedded by
# the same Bedrock ingestion under doc_type="job_rollup". Cheap, sha-gated.
ROLLUP_SAMPLE_FILES = int(os.getenv("ROLLUP_SAMPLE_FILES", "15"))
ROLLUP_SAMPLE_CHARS = int(os.getenv("ROLLUP_SAMPLE_CHARS", "800"))
ROLLUP_MAX_CHARS = int(os.getenv("ROLLUP_MAX_CHARS", "12000"))
# The single extraction queue we consume from + re-enqueue partial continuations
# onto, and the per-run ingestion credit debit fired when a run drains.
SYNERGY_EXTRACT_QUEUE_URL = os.getenv("SYNERGY_EXTRACT_QUEUE_URL", "")
SYNERGY_CREDIT_DEBIT_FUNCTION_NAME = os.getenv("SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", "")
# Stop pulling new pages / starting new files when fewer than this many ms remain,
# so we can checkpoint and return a partial cursor before the Lambda is killed.
# Must exceed a single 12d call's httpx timeout (120s) — otherwise a download
# started right at the margin can outlive the Lambda envelope and be killed
# ungracefully mid-write. 150s = one 120s download attempt + ~30s to checkpoint
# (worker Lambda timeout is 900s, so this still leaves ~750s of work per leg).
SAFETY_MS = int(os.getenv("SAFETY_MS", "150000"))
# Exact-term inverted index (4th search mode). ON by default wherever the crawl
# runs (set synergyTermIndex:false per tenant to opt out); the small write cost is
# captured by the crawl's credit debit. When on, the worker accumulates each leg's
# freshly-extracted terms in memory (deduped
# per job — write once per (term, job), NOT per file; that's what keeps the first
# crawl ~$200 not ~$10K) and flushes them as TERM#{token}#{job_id} rows. Unchanged
# (watermark-skipped) files are already indexed, so they cost nothing on re-crawl.
TERM_INDEX_ENABLED = os.getenv("SYNERGY_TERM_INDEX_ENABLED", "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
TERM_TTL_DAYS = int(os.getenv("SYNERGY_TERM_TTL_DAYS", "365"))
# The synergy KB ingests through Bedrock-on-S3-Vectors, which caps FILTERABLE
# metadata per vector at 2 KB. Every key the crawler writes is filterable (the index
# marks only AMAZON_BEDROCK_* non-filterable), so the BINDING limit is the serialized
# metadataAttributes size — NOT the ~40 KB whole-sidecar total. If filterable metadata
# overflows, PutVectors returns 400 and Bedrock drops the doc, stripping
# tenant_id/kb_id/allowed_users and making it invisible to EVERYONE — strictly worse
# than truncating a few users from a very wide ACL. So we byte-budget the filterable
# map conservatively under 2 KB (headroom for Bedrock-internal keys + the published
# ~1 KB Bedrock-on-S3Vectors custom-metadata guidance) and truncate at build time.
# DURABLE follow-up (now built, gated): the long display-only keys are moved into the
# index's nonFilterableMetadataKeys (see lambdas/node/s3-vectors-manager/index.ts) so they
# no longer count against the 2 KB filterable budget — freeing it for the allowed_users
# ACL. nonFilterableMetadataKeys is IMMUTABLE, so this only applies to an index created
# AFTER that change (= full re-embed). The crawler must therefore STAY conservative against
# an OLD index (display keys still filterable) and only stop counting them once the
# re-embedded index is live. That switch is the SYNERGY_DISPLAY_NONFILTERABLE flag below.
SIDECAR_FILTERABLE_MAX_BYTES = int(os.getenv("SIDECAR_FILTERABLE_MAX_BYTES", "1500"))
# Deploy-coupled flag: flip to ON only AFTER the re-embedded index with the wider
# nonFilterableMetadataKeys (job_name/job_path/file_name/file_path/source_weblink) is
# live. The flag + the index recreation MUST deploy together — turning this ON against an
# OLD index would UNDER-count the filterable footprint (those keys are still filterable
# there) and let an oversized map through, which Bedrock 400-rejects, dropping the doc and
# its tenant_id/kb_id/allowed_users entirely. Default OFF = conservative (measure the whole
# attrs map, as before). When ON, _fit_sidecar excludes the display keys from the
# filterable-size measurement, so the freed budget goes to allowed_users.
SYNERGY_DISPLAY_NONFILTERABLE = os.getenv(
    "SYNERGY_DISPLAY_NONFILTERABLE", ""
).strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Display-only keys the index marks NON-filterable (when the flag is ON). MUST match
# nonFilterableMetadataKeys in lambdas/node/s3-vectors-manager/index.ts exactly — a drift
# here either over-counts (needless ACL truncation) or under-counts (oversized map → doc
# dropped). HONESTY: even with these 5 keys removed from the filterable map, allowed_users
# inside 2 KB of filterable metadata still tops out around 45-50 subs/doc. The
# truncation+SIDECAR_ACL_TRUNCATED/SIDECAR_STILL_OVER_CAP safety net keeps wider shares
# searchable + ACL-correct (it just drops the overflow users from THIS metadata path); the
# only thing that removes the per-doc ceiling entirely is a non-metadata / group-based ACL,
# which is explicitly out of scope here.
_NONFILTERABLE_DISPLAY_KEYS = (
    "job_name",
    "job_path",
    "file_name",
    "file_path",
    "source_weblink",
)
# Display-only sidecar fields safe to clamp when over the filterable budget. NONE of
# these are query-filter keys (only tenant_id/kb_id/doc_type/allowed_users + the
# structured attrs are filtered in _query_bedrock), so trimming them is lossless for
# retrieval and frees budget BEFORE we ever drop an authorized user from the ACL — a
# deep folder path or long weblink must never cost a user their access.
_SIDECAR_CLAMP_KEYS = (
    "job_name",
    "job_path",
    "file_name",
    "file_path",
    "source_weblink",
    "revision",
    "document_status",
)
_SIDECAR_FIELD_MAX_CHARS = int(os.getenv("SIDECAR_FIELD_MAX_CHARS", "256"))


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
        # Full list — _build_sidecar byte-budgets it against the metadata cap.
        list(users),
        acl_rev,
        str(item.get("job_name") or ""),
        str(item.get("job_path") or ""),
    )


def _write_files_total(
    table, job_id: str, files_total: int, files_indexed: int
) -> None:
    """Best-effort: record the job's coverage numbers on the JOB# META row.

    Also writes ``files_indexed`` (= extracted + unchanged this leg) as the
    AUTHORITATIVE per-job indexed count. The index-overview endpoint prefers it
    over its bounded FILE#-row scan, which silently under-counts on a fully-crawled
    large instance once the scan hits its row cap. Written here because this leg
    re-walked the WHOLE job, so the count is complete.


    `files_total` is the count of TEXT-BEARING files enumerated for the job (those
    that pass the LEGACY_EXTS + TEXT_EXTS type filter and would be indexed — NOT
    CAD/legacy/other skips). The index-overview endpoint reads it as the per-job
    coverage denominator (coverage % = indexed_files / files_total, computed
    client-side). Written ONLY when the job's file listing was fully enumerated
    this leg, so it's the authoritative whole-job total (resumable legs re-walk
    from page 1, so recompute/overwrite is correct).

    Additive plain UpdateItem — it must never fail the crawl, so any error is
    swallowed (the value just stays at its previous reading, i.e. 0/unknown).
    """
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "META"},
            UpdateExpression="SET files_total = :n, files_indexed = :i",
            ExpressionAttributeValues={
                ":n": int(files_total),
                ":i": int(files_indexed),
            },
        )
    except Exception as exc:  # noqa: BLE001 — coverage metric is best-effort
        logger.warning(
            "synergy_files_total_write_failed",
            _name="SYNERGY_CRAWL_JOB",
            job_id=job_id,
            files_total=files_total,
            error=str(exc),
        )


def _read_file_state(table, file_id: str) -> Dict[str, Any]:
    resp = table.get_item(Key={"pk": f"FILE#{file_id}", "sk": "META"})
    return resp.get("Item") or {}


def _put_file_state(
    table,
    *,
    file_id: str,
    job_id: str,
    file_name: str,
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
                "file_name": file_name,
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


def rollup_key(job_id: str) -> str:
    """S3 key of a job's rollup record (single, deterministic per job)."""
    return f"{S3_PREFIX}/_rollups/{_safe(job_id)}.txt"


def _rebuild_job_rollup(
    table,
    s3,
    *,
    job_id: str,
    job_name: str,
    job_path: str,
    allowed_users: List[str],
    job_acl_rev: int,
) -> bool:
    """(Re)write the job's rollup record for cross-job similarity.

    One small embedded doc per job — name/path + document names + a capped text
    sample — so jobs cluster by content and "find similar jobs" (which 12d can't
    do) works. Gated on BOTH the sampled text AND the job's acl_rev: a content
    change re-embeds; an ACL change alone is handled by the cheaper
    _refresh_rollup_acl (sidecar-only, no re-embed). Best-effort; never fails the
    crawl. Returns True if (re)written.
    """
    names: List[str] = []
    keys: List[str] = []
    ext_mix: Dict[str, int] = {}  # indexed-document type histogram → richer context
    qk: Dict[str, Any] = {
        "IndexName": "job-index",
        "KeyConditionExpression": "job_id = :j",
        "FilterExpression": "begins_with(pk, :f)",
        "ExpressionAttributeValues": {":j": job_id, ":f": "FILE#"},
    }
    while True:
        resp = table.query(**qk)
        for it in resp.get("Items", []):
            nm = str(it.get("file_name") or "")
            if nm:
                names.append(nm)
                e = file_ext(nm) or "(none)"
                ext_mix[e] = ext_mix.get(e, 0) + 1
            k = it.get("s3_txt_key")
            if k and len(keys) < ROLLUP_SAMPLE_FILES:
                keys.append(k)
        lk = resp.get("LastEvaluatedKey")
        if not lk:
            break
        qk["ExclusiveStartKey"] = lk

    # Document-type mix over the indexed docs — gives the rollup "what kind of job
    # is this" signal (and improves clustering). Reflects extracted/indexed files
    # only (non-text e.g. CAD are skipped at extraction); the text says so.
    type_summary = ", ".join(
        f"{e}×{c}" for e, c in sorted(ext_mix.items(), key=lambda kv: -kv[1])[:12]
    )

    parts = [f"Job: {job_name}", f"Path: {job_path}"]
    if type_summary:
        parts.append(f"Indexed document types: {type_summary}")
    parts.append(f"Documents ({len(names)}):")
    parts.extend(f"- {n}" for n in names[:200])
    parts.append("")
    for k in keys:
        try:
            body = s3.get_object(Bucket=DATA_BUCKET_NAME, Key=k)["Body"]
            parts.append(
                body.read(ROLLUP_SAMPLE_CHARS).decode("utf-8", errors="replace")
            )
        except Exception:  # noqa: BLE001 — best-effort sampling
            pass
    text = "\n".join(parts)[:ROLLUP_MAX_CHARS]

    text_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    job_row = (table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})).get(
        "Item"
    ) or {}
    _raw_rev = job_row.get(
        "rollup_acl_rev"
    )  # 0 is a valid rev — distinguish from missing
    _stored_rev = int(_raw_rev) if _raw_rev is not None else -1
    if (
        str(job_row.get("rollup_text_sha") or "") == text_sha
        and _stored_rev == job_acl_rev
    ):
        return False  # neither content nor ACL changed — no re-embed

    stem = rollup_key(job_id)
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=stem,
        Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=f"{stem}.metadata.json",
        Body=json.dumps(
            _rollup_sidecar(
                job_id,
                job_name,
                job_path,
                allowed_users,
                structured=_structured_from_job_row(job_row),
            ),
            ensure_ascii=False,
        ).encode("utf-8"),
        ContentType="application/json",
    )
    _stamp_rollup_state(table, job_id, text_sha=text_sha, acl_rev=job_acl_rev, key=stem)
    return True


def _structured_from_job_row(job_row: Dict[str, Any]) -> Dict[str, Any]:
    """Structured filter fields the coordinator stamped on the JOB# row
    (created_date / parent_job_id / is_template) → for the rollup sidecar so KB
    breadth search can filter on them.

    created_date / parent_job_id are omitted when absent (a date-range or parent
    filter legitimately shouldn't match a job with no such value). is_template is
    ALWAYS emitted — as a "true"/"false" STRING — so `--exclude-templates` never
    silently drops a job whose row predates the field, and so Bedrock `equals`
    matches the stored type unambiguously."""
    out: Dict[str, Any] = {
        "is_template": "true" if job_row.get("is_template") else "false",
    }
    for k in ("created_date", "parent_job_id"):
        v = job_row.get(k)
        if v not in (None, ""):
            out[k] = str(v)
    # Tenant attributes the coordinator stamped (attr_<snake>: Job Type/Status/…).
    # Already bounded in count + length at stamp time, so a straight pass-through.
    for k, v in job_row.items():
        if k.startswith("attr_") and v not in (None, ""):
            out[k] = str(v)
    return out


def _rollup_sidecar(
    job_id: str,
    job_name: str,
    job_path: str,
    allowed_users: List[str],
    structured: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {
        "tenant_id": CLIENT_NAME,
        "kb_id": KB_ID,
        "doc_type": "job_rollup",
        "allowed_users": list(allowed_users),
        "job_id": job_id,
        "job_name": job_name,
        "job_path": job_path,
        "source": "synergy-crawler-rollup",
        "indexed_at": _now(),
    }
    if structured:
        attrs.update(structured)  # created_date / parent_job_id / is_template
    return _fit_sidecar(
        {"metadataAttributes": attrs},
        job_id=job_id,
        file_id="rollup",
    )


def _stamp_rollup_state(
    table, job_id: str, *, text_sha: str, acl_rev: int, key: str
) -> None:
    # Guard against a slower concurrent leg with an older ACL snapshot clobbering
    # a fresher rollup (mirrors the FILE# last_seen watermark).
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "META"},
            UpdateExpression="SET rollup_text_sha = :s, rollup_acl_rev = :r, rollup_key = :k",
            ConditionExpression="attribute_not_exists(rollup_acl_rev) OR rollup_acl_rev <= :r",
            ExpressionAttributeValues={":s": text_sha, ":r": acl_rev, ":k": key},
        )
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            != "ConditionalCheckFailedException"
        ):
            raise


def _refresh_rollup_acl(
    table,
    s3,
    *,
    job_id: str,
    job_name: str,
    job_path: str,
    allowed_users: List[str],
    job_acl_rev: int,
) -> bool:
    """ACL-only refresh of an existing rollup: rewrite ONLY its sidecar with the
    current allowed_users — no S3 body reads, no .txt rewrite, no re-embed — so a
    revoked user stops matching it in 'find similar jobs'. No-op if no rollup
    exists yet (nothing to leak) or it's already fresh. Rollback-guarded."""
    job_row = (table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})).get(
        "Item"
    ) or {}
    stem = str(job_row.get("rollup_key") or "")
    if not stem:
        return False
    _raw_rev = job_row.get(
        "rollup_acl_rev"
    )  # 0 is a valid rev — distinguish from missing
    _stored_rev = int(_raw_rev) if _raw_rev is not None else -1
    if _stored_rev >= job_acl_rev:
        return False
    s3.put_object(
        Bucket=DATA_BUCKET_NAME,
        Key=f"{stem}.metadata.json",
        Body=json.dumps(
            _rollup_sidecar(
                job_id,
                job_name,
                job_path,
                allowed_users,
                structured=_structured_from_job_row(job_row),
            ),
            ensure_ascii=False,
        ).encode("utf-8"),
        ContentType="application/json",
    )
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "META"},
            UpdateExpression="SET rollup_acl_rev = :r",
            ConditionExpression="attribute_not_exists(rollup_acl_rev) OR rollup_acl_rev < :r",
            ExpressionAttributeValues={":r": job_acl_rev},
        )
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            != "ConditionalCheckFailedException"
        ):
            raise
    return True


def _fit_sidecar(
    sidecar: Dict[str, Any], *, job_id: str, file_id: str
) -> Dict[str, Any]:
    """Trim FILTERABLE metadata so the sidecar stays under the S3 Vectors cap.

    Every metadataAttributes key is filterable, so an oversized map is rejected
    wholesale by ingestion (PutVectors 400), which strips tenant_id/kb_id/allowed_users
    and makes the doc invisible to EVERYONE — strictly worse than dropping a few users
    from a very wide ACL or a few display attrs. Budget the serialized metadataAttributes
    map (the filterable footprint): (1) binary-search the largest allowed_users prefix
    that fits — the only unbounded field; (2) if a rollup's attr_* keys still push it
    over, shed them deterministically. Log loudly on any drop so it is observable,
    never silent.
    """
    attrs = sidecar.get("metadataAttributes", {})
    users = list(attrs.get("allowed_users") or [])

    def _filterable_size() -> int:
        # The S3 Vectors filterable-metadata footprint. No AMAZON_BEDROCK_* keys live in
        # our sidecar, so against an OLD index every key here is filterable and we measure
        # the whole map. Against a NEW index (SYNERGY_DISPLAY_NONFILTERABLE ON) the long
        # display-only keys are non-filterable, so they must be EXCLUDED from this
        # measurement — otherwise we over-count and needlessly truncate allowed_users.
        # Flag + index recreation deploy together (see the flag's definition above).
        if SYNERGY_DISPLAY_NONFILTERABLE:
            measured = {
                k: v for k, v in attrs.items() if k not in _NONFILTERABLE_DISPLAY_KEYS
            }
        else:
            measured = attrs
        return len(json.dumps(measured, ensure_ascii=False).encode("utf-8"))

    if _filterable_size() <= SIDECAR_FILTERABLE_MAX_BYTES:
        return sidecar

    # 1) Clamp long DISPLAY-only free-text keys first (none are query filters, so
    # this is lossless for retrieval). A deep folder path or long weblink should free
    # budget before we ever drop an authorized user from the ACL.
    clamped = 0
    for k in _SIDECAR_CLAMP_KEYS:
        v = attrs.get(k)
        if isinstance(v, str) and len(v) > _SIDECAR_FIELD_MAX_CHARS:
            attrs[k] = v[:_SIDECAR_FIELD_MAX_CHARS]
            clamped += 1
    if clamped:
        logger.warning(
            "Sidecar over filterable cap — clamped long display fields",
            _name="SIDECAR_FIELDS_CLAMPED",
            job_id=job_id,
            file_id=file_id,
            clamped=clamped,
            limit_bytes=SIDECAR_FILTERABLE_MAX_BYTES,
        )

    # 2) Still over? Truncate the only unbounded field — the per-user ACL.
    if _filterable_size() > SIDECAR_FILTERABLE_MAX_BYTES:
        lo, hi = 0, len(users)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            attrs["allowed_users"] = users[:mid]
            if _filterable_size() <= SIDECAR_FILTERABLE_MAX_BYTES:
                lo = mid
            else:
                hi = mid - 1
        attrs["allowed_users"] = users[:lo]
        if lo < len(users):
            logger.warning(
                "Sidecar over S3 Vectors filterable cap — truncated allowed_users",
                _name="SIDECAR_ACL_TRUNCATED",
                job_id=job_id,
                file_id=file_id,
                kept=lo,
                dropped=len(users) - lo,
                limit_bytes=SIDECAR_FILTERABLE_MAX_BYTES,
            )

    # 3) Still over (e.g. a rollup with many attr_* keys)? Shed attr_* keys
    # deterministically so the doc still ingests — degrades structured filtering for
    # this one record, but it stays searchable + ACL-correct instead of vanishing.
    if _filterable_size() > SIDECAR_FILTERABLE_MAX_BYTES:
        dropped_attrs = 0
        for k in sorted(key for key in attrs if key.startswith("attr_")):
            if _filterable_size() <= SIDECAR_FILTERABLE_MAX_BYTES:
                break
            del attrs[k]
            dropped_attrs += 1
        if dropped_attrs:
            logger.warning(
                "Sidecar still over filterable cap — shed attr_* keys",
                _name="SIDECAR_ATTRS_TRUNCATED",
                job_id=job_id,
                file_id=file_id,
                dropped_attrs=dropped_attrs,
                limit_bytes=SIDECAR_FILTERABLE_MAX_BYTES,
            )

    # 4) Terminal backstop: if STILL over after every lever (fixed keys alone exceed
    # the budget — e.g. an extreme path), the doc WILL be 400-rejected by ingestion
    # and dropped. Make that loud + alertable, never silent (the contract this fit
    # logic exists to honour).
    if _filterable_size() > SIDECAR_FILTERABLE_MAX_BYTES:
        logger.warning(
            "Sidecar STILL over filterable cap after all reductions — Bedrock will "
            "reject and drop this doc",
            _name="SIDECAR_STILL_OVER_CAP",
            job_id=job_id,
            file_id=file_id,
            final_bytes=_filterable_size(),
            limit_bytes=SIDECAR_FILTERABLE_MAX_BYTES,
            allowed_users_kept=len(attrs.get("allowed_users") or []),
        )
    return sidecar


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
    sidecar = {
        "metadataAttributes": {
            "tenant_id": CLIENT_NAME,
            "kb_id": KB_ID,
            # Distinguishes per-document records from the per-job "rollup" records
            # used for cross-job similarity, so each is queried separately.
            "doc_type": "document",
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
    return _fit_sidecar(sidecar, job_id=job_id, file_id=file_id)


# --------------------------------------------------------------------------- #
# Handler
# --------------------------------------------------------------------------- #
def _process_job(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Crawl one job (one SQS message). Returns {job_status, cursor, job_id, counts}.
    job_status is 'done' | 'partial' (ran out of time, continue from a new leg) |
    'error_listing' (listing failed — caller re-queues/DLQs)."""
    job_id = event["job_id"]
    run_id = event.get("run_id") or "adhoc"
    secret_id = event["secret_id"]
    instance_url = event["instance_url"]
    cursor = event.get("cursor") or {}
    # Sweep cutoff: the time THIS job's walk first started. Carried through
    # partial-cursor continuations so a resumed invocation never sweeps files
    # its own earlier leg already stamped.
    run_started_at = str(cursor.get("run_started_at") or "") or _now()
    # Monotonic continuation counter — uniquifies the FIFO dedup id of each
    # re-enqueued partial leg (a fixed id would be silently dropped as a dup).
    leg = int(cursor.get("leg") or 0)
    # Cumulative consumption carried across legs of a multi-leg job. Each partial
    # cursor accumulates the running total so the terminal 'done' leg can meter
    # the WHOLE job (not just the final leg). Stored in the cursor — NOT added
    # per-leg into RUN# — so an SQS redelivery of any leg can't double-count.
    acc_extracted = int(cursor.get("acc_extracted") or 0)
    acc_chars = int(cursor.get("acc_chars") or 0)
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
        "chars": 0,  # total extracted chars this leg → drives the embedding-cost estimate
        "restamped": 0,
        "unchanged": 0,
        "deleted": 0,
        "skipped_type": 0,
        "skipped_legacy": 0,
        "skipped_big": 0,
        "skipped_empty": 0,
        "errors": 0,
        "terms_indexed": 0,
        # Coverage denominator: every TEXT-BEARING file enumerated this leg (passed
        # the LEGACY_EXTS + TEXT_EXTS type filter — the ones that would be indexed,
        # NOT CAD/legacy/other skips). A resumable leg re-walks from page 1, so when
        # a leg reaches enumeration_complete this is the authoritative whole-job total
        # and is written to the JOB# META row as files_total (best-effort).
        "text_bearing": 0,
    }
    # Per-job term accumulator (exact-term index): a plain SET of distinct
    # tokens. None when the feature is off → zero behaviour change. We no longer
    # carry per-token file_id sets — the write path stores only (term, job_id),
    # so the file_ids were pure dead memory (a job's text can hold tens of
    # thousands of distinct tokens × every file id). Deduped in memory; flushed
    # once per token at leg end.
    term_acc: Optional[set] = set() if TERM_INDEX_ENABLED else None

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
                    term_acc=term_acc,
                )
            if out_of_time:
                break

            if total_pages and page < total_pages:
                page += 1
                continue
            enumeration_complete = True
            break

        # Flush this leg's accumulated terms — one write per (term, job), deduped
        # in memory across the leg's files. Runs for partial AND complete legs
        # (the next leg re-walks from page 1 and watermark-skips these files, so
        # it won't re-index them). Best-effort; never fails the crawl.
        if term_acc:
            counts["terms_indexed"] = _flush_job_terms(table, job_id, term_acc)

        if out_of_time:
            job_status = "partial"
            next_cursor = {
                "run_started_at": run_started_at,
                "leg": leg + 1,
                # Carry the running job total forward so the terminal leg meters
                # the whole job. Prior acc + this leg's fresh counts.
                "acc_extracted": acc_extracted + int(counts["extracted"]),
                "acc_chars": acc_chars + int(counts["chars"]),
            }

        if enumeration_complete:
            # Authoritative coverage denominator: this leg re-walked the WHOLE job
            # from page 1, so counts["text_bearing"] is the full count of
            # text-bearing (would-be-indexed) files. Stamp it on the JOB# META row
            # for the index-overview endpoint. Best-effort — never fails the crawl.
            _write_files_total(
                table,
                job_id,
                counts["text_bearing"],
                # Files left in the index = extracted (new/changed) + unchanged +
                # ACL-restamped. All three keep a FILE# row; skipped/errored/swept
                # files do not. Matches what the overview's FILE# scan counts
                # (restamped is common — every new user's crawl re-stamps existing
                # jobs' files, so omitting it would under-count after any ACL change).
                int(counts["extracted"])
                + int(counts["unchanged"])
                + int(counts["restamped"]),
            )
            # Every still-existing file has a last_seen_at newer than this
            # run's start (stamped by us or any concurrent walker). Anything
            # older was deleted in 12d.
            counts["deleted"] = _sweep_deleted_files(
                table, s3, job_id=job_id, cutoff_iso=run_started_at
            )
            # Keep the cross-job similarity rollup in sync. Content change →
            # full rebuild (re-embed). ACL-only change (docs restamped, no new
            # content) → cheap sidecar-only refresh so revoked users stop
            # matching the rollup. Both gated/guarded inside; best-effort.
            try:
                # Gate on the WHOLE-job cumulative, not just this leg's local
                # counts. The terminal leg re-walks from page 1 and watermark-
                # skips already-indexed files, so its own extracted can be 0 even
                # when prior legs indexed hundreds of docs. acc_extracted is the
                # prior-legs total (from the cursor); counts["extracted"] is this
                # final leg's fresh count — no double-count. Without this a fully
                # indexed multi-leg job whose final leg adds nothing would never
                # build a rollup and stay invisible to 'find similar jobs'.
                if (acc_extracted + counts["extracted"]) or counts["deleted"]:
                    _rebuild_job_rollup(
                        table,
                        s3,
                        job_id=job_id,
                        job_name=job_name,
                        job_path=job_path,
                        allowed_users=allowed_users,
                        job_acl_rev=job_acl_rev,
                    )
                else:
                    # No content change this run → refresh the rollup's ACL
                    # unconditionally (not just when this leg's `restamped`>0). On a
                    # multi-leg pure-ACL change the terminal leg can see restamped==0
                    # even though the job's acl_rev advanced (prior legs / a
                    # concurrent on-visit restamped the files), which previously left
                    # the rollup's allowed_users stale so a revoked user kept matching
                    # 'find similar jobs'. _refresh_rollup_acl is a guarded no-op when
                    # the rollup is absent or already at job_acl_rev, so this costs at
                    # most one get_item when nothing changed.
                    _refresh_rollup_acl(
                        table,
                        s3,
                        job_id=job_id,
                        job_name=job_name,
                        job_path=job_path,
                        allowed_users=allowed_users,
                        job_acl_rev=job_acl_rev,
                    )
            except (
                Exception
            ) as exc:  # noqa: BLE001 — never fail the crawl on the rollup
                logger.warning(
                    "synergy_rollup_failed",
                    _name="SYNERGY_CRAWL_JOB",
                    job_id=job_id,
                    error=str(exc),
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
        # Whole-job metering total (prior legs' accumulators + this leg's fresh
        # counts). Only the terminal 'done' leg's value is booked into RUN#, so
        # multi-leg jobs meter every leg exactly once. On a single-leg job the
        # accumulators are 0 and this equals counts.
        "meter_counts": {
            "extracted": acc_extracted + int(counts["extracted"]),
            "chars": acc_chars + int(counts["chars"]),
        },
    }


# --------------------------------------------------------------------------- #
# Queue consumer: finalize a job + drive run completion
# --------------------------------------------------------------------------- #
def _reenqueue_continuation(
    payload: Dict[str, Any], cursor: Optional[Dict[str, Any]]
) -> None:
    """Re-queue a partial job's next leg onto the SAME FIFO group (ordering) with
    a per-leg dedup id (a fixed id would be dropped as a duplicate)."""
    if not SYNERGY_EXTRACT_QUEUE_URL:
        logger.warning("synergy_reenqueue_skip_no_queue", job_id=payload.get("job_id"))
        return
    job_id = payload["job_id"]
    run_id = payload.get("run_id") or "adhoc"
    leg = int((cursor or {}).get("leg") or 0)
    prm_client("sqs", region=REGION).send_message(
        QueueUrl=SYNERGY_EXTRACT_QUEUE_URL,
        MessageBody=json.dumps({**payload, "cursor": cursor}),
        MessageGroupId=job_id,
        MessageDeduplicationId=f"{run_id}:{job_id}:leg:{leg}",
    )


def _mark_job_done(table, job_id: str, run_id: str) -> bool:
    """Transition JOB#<id> pending->done for THIS run. Returns True only for the
    update that WON the transition — SQS is at-least-once, so a redelivered
    message must not decrement the run counter twice. A concurrent newer run that
    re-pended the job (run_id mismatch) also fails the condition: this (older)
    run leaves it for that run, exactly as the former Step Function did."""
    try:
        table.update_item(
            Key={"pk": f"JOB#{job_id}", "sk": "META"},
            UpdateExpression="SET #s = :done",
            ConditionExpression="#s = :pending AND run_id = :run",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":done": "done",
                ":pending": "pending",
                ":run": run_id,
            },
        )
        return True
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            == "ConditionalCheckFailedException"
        ):
            return False
        raise


def _fire_credit_debit(run_id: str, doc_count: int, chars_extracted: int) -> None:
    """Fire-and-forget the per-run ingestion debit. Best-effort — metering must
    never block or fail the crawl."""
    if not SYNERGY_CREDIT_DEBIT_FUNCTION_NAME:
        return
    try:
        prm_client("lambda", region=REGION).invoke(
            FunctionName=SYNERGY_CREDIT_DEBIT_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "run_id": run_id,
                    "doc_count": doc_count,
                    "chars_extracted": chars_extracted,
                    "title": f"Synergy crawl {run_id}",
                }
            ).encode("utf-8"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "synergy_credit_debit_invoke_failed", run_id=run_id, error=str(exc)
        )


def _account_and_maybe_complete(table, run_id: str, counts: Dict[str, int]) -> None:
    """Atomically decrement the run counter + accumulate consumption. The message
    that drives `remaining` to 0 closes the run (once, conditionally) and fires
    the credit debit."""
    resp = table.update_item(
        Key={"pk": f"RUN#{run_id}", "sk": "META"},
        UpdateExpression="ADD remaining :neg1, doc_count :d, chars_extracted :c",
        ExpressionAttributeValues={
            ":neg1": -1,
            ":d": int(counts.get("extracted") or 0),
            ":c": int(counts.get("chars") or 0),
        },
        ReturnValues="UPDATED_NEW",
    )
    attrs = resp.get("Attributes") or {}
    if int(attrs.get("remaining") or 0) > 0:
        return
    # Drained. Close exactly once — a racing decrement-to-(<=0) loses the
    # conditional and skips the debit, so we never double-charge.
    try:
        table.update_item(
            Key={"pk": f"RUN#{run_id}", "sk": "META"},
            UpdateExpression="SET #s = :done, completed_at = :t",
            ConditionExpression="attribute_not_exists(#s) OR #s <> :done",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":done": "done", ":t": _now()},
        )
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            == "ConditionalCheckFailedException"
        ):
            return
        raise
    _fire_credit_debit(
        run_id,
        int(attrs.get("doc_count") or 0),
        int(attrs.get("chars_extracted") or 0),
    )


def _finalize_job(table, payload: Dict[str, Any], result: Dict[str, Any]) -> None:
    """Post-process one job's result: re-queue partials, raise on listing errors
    (SQS retry/DLQ), and on completion decrement the run counter + maybe debit."""
    job_id = result["job_id"]
    status = result["job_status"]
    run_id = payload.get("run_id") or "adhoc"

    if status == "error_listing":
        # Listing failed (NOT an empty job). Raise so SQS retries then DLQs; the
        # run's `remaining` is untouched and a later coordinator pass reconciles.
        raise RuntimeError(f"synergy listing failed for job {job_id}")

    if status == "partial":
        _reenqueue_continuation(payload, result.get("cursor"))
        return

    # status == "done". On-visit refreshes (run_id="adhoc") aren't part of a
    # counted run — nothing to decrement or debit.
    if run_id == "adhoc":
        return
    if _mark_job_done(table, job_id, run_id):
        # Book the WHOLE job (all legs), not just the final leg's counts. The
        # single ADD stays gated by _mark_job_done winning, so it books once.
        _account_and_maybe_complete(
            table, run_id, result.get("meter_counts") or result.get("counts") or {}
        )


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """SQS consumer entrypoint. One message = one job (batchSize 1). Reports
    per-message failures so a failed job is retried/DLQ'd, not silently dropped.
    Also accepts a direct (non-SQS) job payload for local/ad-hoc invocation."""
    for required, val in (
        ("DATA_BUCKET_NAME", DATA_BUCKET_NAME),
        ("STATE_TABLE_NAME", STATE_TABLE_NAME),
    ):
        if not val:
            raise ValueError(f"{required} not configured")

    records = event.get("Records") if isinstance(event, dict) else None
    if not records:
        # Direct invocation (tests / ad-hoc single job).
        result = _process_job(event, context)
        _finalize_job(_state_table(), event, result)
        return result

    table = _state_table()
    failures: List[Dict[str, str]] = []
    for record in records:
        message_id = record.get("messageId", "")
        try:
            payload = json.loads(record["body"])
            result = _process_job(payload, context)
            _finalize_job(table, payload, result)
        except Exception as exc:  # noqa: BLE001 — isolate one bad message
            logger.warning(
                "synergy_record_failed",
                _name="SYNERGY_CRAWL_JOB",
                message_id=message_id,
                error=str(exc),
            )
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}


def _flush_job_terms(table, job_id: str, term_acc) -> int:
    """Write a leg's accumulated terms as `TERM#{token}#{job_id}` rows — ONE write
    per term (the per-job dedup that bounds the write cost), not per file. Only
    `term` + `job_id` are stored — exactly the keys the KEYS_ONLY `term-job-index`
    GSI needs. We deliberately do NOT store any per-term file_ids: they're never
    projected or read by any query path, and an unbounded `ADD` would grow the
    item toward the 400KB limit across re-crawls until the term silently stopped
    indexing. `term_acc` is therefore just the distinct token set (iterating it —
    a set or a dict's keys — yields the tokens). TTL backstops orphans.
    Best-effort: a failed term write never fails the crawl."""
    if not term_acc:
        return 0
    ttl = int(datetime.now(timezone.utc).timestamp()) + TERM_TTL_DAYS * 86400
    written = 0
    for tok in term_acc:
        try:
            table.update_item(
                Key={"pk": f"TERM#{tok}#{job_id}", "sk": "META"},
                UpdateExpression="SET term = :t, job_id = :j, #ttl = :ttl",
                ExpressionAttributeNames={"#ttl": "ttl"},
                ExpressionAttributeValues={
                    ":t": tok,
                    ":j": job_id,
                    ":ttl": ttl,
                },
            )
            written += 1
        except Exception as exc:  # noqa: BLE001 — index is best-effort
            logger.warning(
                "synergy_term_write_failed",
                _name="SYNERGY_TERM_INDEX",
                token=tok,
                job_id=job_id,
                error=str(exc),
            )
    return written


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
    term_acc: Optional[set] = None,
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
    # Text-bearing by type — this is a coverage-denominator file (would be
    # indexed). Count it BEFORE the size/empty gates so files_total reflects the
    # full text-bearing population, not just the subset that survived to extract.
    counts["text_bearing"] += 1
    size = _get(file_obj, "FileSize", "Size", default=0) or 0
    try:
        size_int = int(size)
    except (TypeError, ValueError):
        size_int = 0
    if size_int > _max_bytes_for(ext):
        counts["skipped_big"] += 1
        return
    # A missing/zero size is untrustworthy for binary container types: a
    # size-less huge file (a PDF of embedded CAD/raster graphics, or a zip-based
    # Office doc / email with large embedded objects — where the terabytes are)
    # would otherwise bypass the cap and be fully downloaded (OOM risk). Skip it
    # as skipped_big rather than gamble. Plain-text types are small by nature, so
    # a size-less listing of those keeps current behaviour and still downloads.
    if size_int <= 0 and ext in TIGHT_CAPPED_EXTS:
        counts["skipped_big"] += 1
        return

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
        file_name=file_name,
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
    counts["chars"] += len(text)

    # Exact-term index: accumulate THIS file's distinct tokens into the per-job
    # set (deduped in memory; flushed once per token at leg end). Only fresh
    # extractions reach here — unchanged/watermarked files are already indexed.
    if term_acc is not None:
        term_acc.update(tokenize_for_index(text))


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
        file_name=file_name,
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
        file_name=file_name,
        version=version,
        acl_rev=fresh_rev,
        content_sha=content_sha,
        s3_txt_key=s3_txt_key,
        run_id=run_id,
        weblink=weblink,
    )
