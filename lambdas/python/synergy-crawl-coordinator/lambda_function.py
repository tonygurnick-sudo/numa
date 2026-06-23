"""Synergy KB crawler — coordinator (zip Lambda).

Runs once at the start of a crawl execution and decides what the run covers.

Two modes:

**Manual** (``trigger="manual"``, from the data-connectors "Sync now" route): the
event carries the calling user's identity + vault ``secret_id``. The coordinator
enumerates the jobs THAT USER can see, grants them on each job's
``allowed_users`` (bumping ``acl_rev`` on new grants), and seeds those jobs as
pending. Purely additive — a manual sync never revokes anyone.

**Scheduled** (``trigger="scheduled"``, from EventBridge): no credentials in the
event. The coordinator reads the admin ``CONFIG#crawl`` item (enabled, frequency)
and, if the run is due, performs the AUTHORITATIVE permission pass: it
enumerates the jobs visible to EVERY connected user (each with that user's own
vault PAT), rebuilds each job's ``allowed_users`` from scratch — grants AND
revocations — and seeds all visible jobs pending. Users whose PAT could not be
verified (expired/missing) keep their existing grants; revocation only ever
follows a successful enumeration that no longer includes the job. Jobs no
verified user can see are PURGED from the corpus outright (stale sidecars would
otherwise keep granting access to users who lost the job).

Per-job crawl credential: each seeded ``JOB#`` row stores ``crawl_secret_id`` —
the vault path of a user who provably sees that job — and the Step Function
passes it per-job to the worker. This guarantees every pending job can be
crawled/restamped even when the admin-configured credential can't see it.

The PAT itself NEVER enters Step Functions execution input/history — only vault
``secret_id`` paths do; PATs are read from Secrets Manager here and in the worker
under least-privilege roles.

Event:
    {"trigger": "scheduled"}
    or
    {"run_id": "...", "user_sub": "...", "secret_id": "<client>/vault/users/<sub>",
     "instance_url": "https://...", "scope": {"max_jobs": 0, "job_ids": []},
     "trigger": "manual"}

Returns:
    {"enabled": bool, "reason": str, "run_id": str, "job_count": int,
     "user_sub": str, "secret_id": str, "instance_url": str}
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
STATE_TABLE_NAME = os.getenv("STATE_TABLE_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")
JOB_PAGE_SIZE = int(os.getenv("JOB_PAGE_SIZE", "100"))
DEFAULT_FREQUENCY_HOURS = int(os.getenv("DEFAULT_FREQUENCY_HOURS", "24"))
# The single extraction queue. Every trigger enqueues per-job messages here; the
# worker is the sole consumer. Empty in unit tests / when the crawler is off.
SYNERGY_EXTRACT_QUEUE_URL = os.getenv("SYNERGY_EXTRACT_QUEUE_URL", "")
# Per-run ingestion credit debit (also fired here when reconciling a stalled run
# so its partial work still gets metered exactly once).
SYNERGY_CREDIT_DEBIT_FUNCTION_NAME = os.getenv("SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", "")
# A previous run still "running" past this many hours is treated as stalled (a
# crashed worker / DLQ'd job / interrupted enumeration) and force-closed so its
# RUN# row doesn't hang forever and its debit still fires.
STALE_RUN_HOURS = float(os.getenv("STALE_RUN_HOURS", "6"))
# Stop the scheduled enumeration with at least this much Lambda time left, so a
# slow/large multi-user enumeration aborts cleanly instead of being killed mid-pass
# (which would strand the RUN# row and waste the whole invocation).
SCHED_SAFETY_MS = int(os.getenv("SCHED_SAFETY_MS", "120000"))
# Mirrors the worker's S3_PREFIX — used to delete a purged job's rollup record
# deterministically (job_ids are "N_N", already filename-safe).
SYNERGY_S3_PREFIX = os.getenv("S3_PREFIX", "documents/synergy")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Vault reads (PATs never travel through SFN history)
# --------------------------------------------------------------------------- #
def _read_secret_json(secret_id: str) -> Optional[Dict[str, Any]]:
    try:
        sm = prm_client("secretsmanager", region=REGION)
        raw = sm.get_secret_value(SecretId=secret_id)["SecretString"]
        return json.loads(raw)
    except Exception:  # noqa: BLE001 — missing/garbled secrets are skipped
        return None


def _extract_pat(vault: Optional[Dict[str, Any]]) -> str:
    if not isinstance(vault, dict):
        return ""
    secrets = vault.get("secrets", {}) if isinstance(vault.get("secrets"), dict) else {}
    for key in ("connector-synergy", "oauth-synergy"):
        entry = secrets.get(key)
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if isinstance(fields, dict):
            pat = (fields.get("access_token") or "").strip()
            if pat:
                return pat
    return ""


def _get_pat_or_raise(secret_id: str) -> str:
    pat = _extract_pat(_read_secret_json(secret_id))
    if not pat:
        raise ValueError(f"No connector-synergy access_token in secret {secret_id}")
    return pat


def _get_admin_instance_url() -> str:
    """Admin-configured Synergy server URL from the company vault."""
    company = _read_secret_json(f"{CLIENT_NAME}/vault/company") or {}
    secrets = company.get("secrets", {}) if isinstance(company, dict) else {}
    for key in ("connector-config-synergy", "connector-synergy"):
        entry = secrets.get(key) if isinstance(secrets, dict) else None
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if isinstance(fields, dict):
            url = fields.get("instance_url") or fields.get("server")
            if url:
                return str(url).strip()
    return ""


def _list_connected_users() -> List[Tuple[str, str]]:
    """Return [(user_sub, pat)] for every user vault holding a Synergy PAT."""
    users: List[Tuple[str, str]] = []
    prefix = f"{CLIENT_NAME}/vault/users/"
    sm = prm_client("secretsmanager", region=REGION)
    paginator = sm.get_paginator("list_secrets")
    for page in paginator.paginate(Filters=[{"Key": "name", "Values": [prefix]}]):
        for entry in page.get("SecretList", []):
            name = entry.get("Name", "")
            if not name.startswith(prefix):
                continue
            user_sub = name[len(prefix) :].strip("/")
            if not user_sub or "/" in user_sub:
                continue
            pat = _extract_pat(_read_secret_json(name))
            if pat:
                users.append((user_sub, pat))
    return users


# --------------------------------------------------------------------------- #
# Synergy job enumeration
# --------------------------------------------------------------------------- #
def _normalize_token(token: str) -> str:
    token = (token or "").strip()
    return token if token.lower().startswith("bearer ") else f"Bearer {token}"


def _iter_jobs(base_url: str, token: str, page_size: int) -> Iterator[dict]:
    """Yield every job (incl. sub-jobs) via paginated /jobs/search."""
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    page = 1
    while True:
        body = {
            "Page": page,
            "PageSize": page_size,
            "Name": "",
            "QuickSearchTerm": "",
            # Populate each JobModel's Attributes[] (Job Type/Status/Client/…) in
            # the results so we can stamp them — free at enumeration vs a per-job
            # detail call. Best-effort: if the instance ignores it, _job_attributes
            # just returns {} and we fall back to the always-present fields.
            "RetrieveAttributes": True,
            "Attributes": [
                {
                    "Attribute": {
                        "Name": "TopLevel",
                        "DisplayName": "Restrict to top level?",
                    },
                    "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                    "Value": False,
                    "SearchQueryType": 4,
                    "Operation": 0,
                    "Name": "Restrict to top level?",
                    "OperationName": "=",
                }
            ],
        }
        resp: Optional[httpx.Response] = None
        for attempt in range(4):
            resp = httpx.post(
                f"{base_url.rstrip('/')}/api/v1/jobs/search",
                json=body,
                headers=headers,
                timeout=90,
            )
            if resp.status_code in (401, 403):
                raise PermissionError(f"Synergy auth failed (HTTP {resp.status_code})")
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == 3:
                    resp.raise_for_status()
                time.sleep(2**attempt)
                continue
            resp.raise_for_status()
            break
        assert resp is not None
        data = resp.json()
        rows = data.get("Result") or data.get("Items") or []
        for row in rows:
            yield row
        total_pages = data.get("TotalPages") or 0
        if page >= total_pages or not rows:
            break
        page += 1


def _job_id(job: dict) -> Optional[str]:
    return (job.get("ID") or {}).get("IDString") or job.get("IDString")


def _vault_path(user_sub: str) -> str:
    return f"{CLIENT_NAME}/vault/users/{user_sub}"


# --------------------------------------------------------------------------- #
# State table helpers
# --------------------------------------------------------------------------- #
def _state_table():
    return prm_resource("dynamodb", region=REGION).Table(STATE_TABLE_NAME)


def _get_crawl_config(table) -> Dict[str, Any]:
    resp = table.get_item(Key={"pk": "CONFIG#crawl", "sk": "META"})
    return resp.get("Item") or {}


def _scan_existing_jobs(table) -> Dict[str, Dict[str, Any]]:
    """Return {job_id: {allowed_users: set, acl_rev: int}} for all JOB# rows."""
    existing: Dict[str, Dict[str, Any]] = {}
    scan_kwargs: Dict[str, Any] = {
        "FilterExpression": Attr("pk").begins_with("JOB#"),
        "ProjectionExpression": "pk, allowed_users, acl_rev",
    }
    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            jid = str(item.get("pk", ""))[len("JOB#") :]
            if not jid:
                continue
            users = item.get("allowed_users")
            if isinstance(users, set):
                users = set(str(u) for u in users)
            elif isinstance(users, list):
                users = set(str(u) for u in users)
            else:
                users = set()
            existing[jid] = {
                "allowed_users": users,
                "acl_rev": int(item.get("acl_rev") or 0),
            }
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return existing


def _purge_job_corpus(table, job_id: str) -> int:
    """Delete every indexed artifact of a job: S3 .txt + sidecar, FILE# rows, AND
    the TERM#{token}#{job_id} inverted-index rows.

    Used when NO verified user can see the job anymore — leaving the docs would
    leave stale sidecars whose allowed_users still grant access to users who
    lost the job in Synergy. TERM# rows are not a leak on their own (exact_term_search
    re-reads JOB#/META and drops a candidate whose row is gone), but removing them
    here avoids index bloat instead of waiting out the term TTL. Both FILE# and TERM#
    rows carry job_id, so a single job-index Query returns both. Returns the count of
    DOCUMENTS purged (FILE# rows only), preserving the purged_jobs metric.
    """
    s3 = prm_client("s3", region=REGION)
    deleted = 0
    query_kwargs: Dict[str, Any] = {
        "IndexName": "job-index",
        "KeyConditionExpression": "job_id = :j",
        "FilterExpression": "begins_with(pk, :file) OR begins_with(pk, :term)",
        "ExpressionAttributeValues": {
            ":j": job_id,
            ":file": "FILE#",
            ":term": "TERM#",
        },
    }
    while True:
        resp = table.query(**query_kwargs)
        for item in resp.get("Items", []):
            pk = str(item.get("pk") or "")
            if pk.startswith("FILE#"):
                key = item.get("s3_txt_key")
                if key and DATA_BUCKET_NAME:
                    for obj_key in (key, f"{key}.metadata.json"):
                        try:
                            s3.delete_object(Bucket=DATA_BUCKET_NAME, Key=obj_key)
                        except Exception:  # noqa: BLE001 — best-effort cleanup
                            pass
                deleted += 1  # count documents only
            table.delete_item(Key={"pk": pk, "sk": item.get("sk", "META")})
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    # Also remove the job's cross-job similarity rollup, so a purged job leaves no
    # orphan whose stale allowed_users would still match a "find similar jobs"
    # search. Delete BOTH the stored key (if the worker recorded one) AND the
    # deterministic key — the latter catches a rollup whose state write didn't
    # land (partial failure), which the stored key would miss.
    job_row = (table.get_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})).get(
        "Item"
    ) or {}
    rollup_keys = {f"{SYNERGY_S3_PREFIX}/_rollups/{job_id}.txt"}
    stored = str(job_row.get("rollup_key") or "")
    if stored:
        rollup_keys.add(stored)
    if DATA_BUCKET_NAME:
        for base in rollup_keys:
            for obj_key in (base, f"{base}.metadata.json"):
                try:
                    s3.delete_object(Bucket=DATA_BUCKET_NAME, Key=obj_key)
                except Exception:  # noqa: BLE001 — best-effort cleanup
                    pass
    table.delete_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})
    return deleted


# Bounds for stamped tenant attributes: keep low-cardinality, filterable fields
# only — high-cardinality / free-text values bloat the JOB# row + rollup sidecar
# and blow Bedrock's metadata budget. Discovered values are the agent's filter
# vocabulary (also surfaced via `synergy-schema`).
_ATTR_KEY_MAX = 15
_ATTR_VALUE_MAX = 80


def _attr_key(name: Any) -> str:
    """Normalise a 12d attribute Name → a safe `attr_<snake>` metadata/DDB key."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")
    return f"attr_{slug}" if slug else ""


def _job_attributes(job: dict) -> Dict[str, str]:
    """Tenant-configurable attributes from JobModel.Attributes[] → attr_<snake>
    scalar strings (Job Type / Status / Client / Region / PM …). Bounded in count
    and value length so free-text fields don't bloat the row/sidecar. Returns {}
    if the instance didn't populate Attributes (RetrieveAttributes ignored)."""
    out: Dict[str, str] = {}
    for a in job.get("Attributes") or []:
        if not isinstance(a, dict) or len(out) >= _ATTR_KEY_MAX:
            continue
        meta_raw = a.get("Attribute")
        meta = meta_raw if isinstance(meta_raw, dict) else {}
        val = a.get("Value")
        if val is None or isinstance(val, (dict, list)):
            continue
        key = _attr_key(a.get("Name") or meta.get("Name"))
        sval = str(val).strip()
        if not key or not sval or len(sval) > _ATTR_VALUE_MAX:
            continue
        out[key] = sval
    return out


def _job_structured_attrs(job: dict) -> Dict[str, Any]:
    """JobModel fields → flat scalar metadata for the JOB# row + rollup sidecar
    (P3 structured breadth-search filters).

    Always-present (free, every /jobs/search row): created_date / parent_job_id /
    is_template. Tenant-configurable: attr_<snake> from Attributes[] (needs
    RetrieveAttributes; bounded). The JOB# row is restamped every run, so these
    stay fresh for the structured query layer with no extra bookkeeping.
    """
    out: Dict[str, Any] = {"is_template": bool(job.get("Type") == 1)}
    cd = job.get("CreatedDate")
    if cd:
        out["created_date"] = str(cd)
    parent = job.get("ParentJobID")
    if isinstance(parent, dict) and parent.get("IDString"):
        out["parent_job_id"] = str(parent["IDString"])
    out.update(_job_attributes(job))
    return out


def _structured_set(
    attrs: Dict[str, Any], prefix: str = ":sa_"
) -> Tuple[str, Dict[str, Any]]:
    """Build a `SET` fragment (leading ', ') + values for the structured fields.
    Only present keys are written, so an absent created_date/parent isn't nulled.
    Keys are fixed identifiers (no reserved-word clash), so no name aliases needed.
    """
    if not attrs:
        return "", {}
    frag = ", ".join(f"{k} = {prefix}{k}" for k in attrs)
    vals = {f"{prefix}{k}": v for k, v in attrs.items()}
    return ", " + frag, vals


def _grant_user_on_job(
    table, *, job: dict, run_id: str, user_sub: str, secret_id: str
) -> None:
    """Manual-mode upsert: grant the caller + mark the job pending for this run."""
    jid = _job_id(job)
    if not jid:
        return
    key = {"pk": f"JOB#{jid}", "sk": "META"}
    sa_frag, sa_vals = _structured_set(_job_structured_attrs(job))

    # Conditional grant: add the user + bump acl_rev only when the grant is new.
    try:
        table.update_item(
            Key=key,
            UpdateExpression=(
                "ADD allowed_users :u SET acl_rev = if_not_exists(acl_rev, :z) + :one"
            ),
            ConditionExpression=Attr("allowed_users").not_exists()
            | ~Attr("allowed_users").contains(user_sub),
            ExpressionAttributeValues={":u": {user_sub}, ":z": 0, ":one": 1},
        )
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # user already granted — no acl change

    table.update_item(
        Key=key,
        UpdateExpression=(
            "SET #s = :pending, run_id = :run, job_id = :jid, job_name = :n, "
            "job_path = :p, crawl_secret_id = :sec, last_enumerated_at = :t" + sa_frag
        ),
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":pending": "pending",
            ":run": run_id,
            ":jid": jid,
            ":n": job.get("Name") or jid,
            ":p": job.get("Path") or "",
            ":sec": secret_id,
            ":t": _now(),
            **sa_vals,
        },
    )


def _write_run_row(table, run_id: str, trigger: str, user_sub: str) -> None:
    # Create-once. The manual coordinator is invoked async (InvocationType='Event')
    # with a caller-supplied run_id, so AWS auto-retries can re-enter with the SAME
    # run_id; a blind put_item would reset status/started_at and re-open a run the
    # worker may already have closed. The conditional create leaves an existing row
    # (its status + counters) untouched on retry.
    try:
        table.put_item(
            Item={
                "pk": f"RUN#{run_id}",
                "sk": "META",
                "run_id": run_id,
                "status": "running",
                "trigger": trigger,
                "user_sub": user_sub,
                "started_at": _now(),
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            != "ConditionalCheckFailedException"
        ):
            raise
        logger.info(
            "synergy_run_row_exists_skip_recreate",
            _name="SYNERGY_CRAWL_COORD",
            run_id=run_id,
        )
    # Pointer for the sync-status API (RUN# rows aren't otherwise listable), plus
    # register this run in the bounded open-runs set so a stalled run is always
    # reachable for reconcile even when a later overlapping run overwrites the
    # single last_run_id pointer (the bug last_run_id-only reconcile had). ADD on a
    # set is idempotent, so re-registering on a retry is harmless.
    table.update_item(
        Key={"pk": "CONFIG#crawl", "sk": "META"},
        UpdateExpression=(
            "SET last_run_id = :r, last_run_started_at = :t ADD open_run_ids :one"
        ),
        ExpressionAttributeValues={":r": run_id, ":t": _now(), ":one": {run_id}},
    )


def _seed_scheduled_job(
    table,
    *,
    jid: str,
    run_id: str,
    meta: Dict[str, Any],
    crawl_secret_id: str,
    old: Set[str],
    old_rev: int,
    verified: Dict[str, Set[str]],
    attempts: int = 3,
) -> bool:
    """Seed one job in the scheduled pass with optimistic concurrency.

    Returns True only when the JOB# row was actually written pending for THIS run
    (so the caller counts it toward `remaining`); False if every attempt lost the
    conditional and the row was left under another run — counting that job would
    seed `remaining` above the number of jobs the worker will ever close.

    The allowed_users rebuild is computed from a table snapshot taken minutes
    earlier; a blind SET would (a) erase grants the on-visit hook added in the
    gap, and (b) reuse an acl_rev number an on-visit bump already spent on a
    DIFFERENT user set — after which the worker's rev-equality check would
    never restamp the stale sidecar. The ConditionExpression pins the write to
    the rev we computed against; on conflict we re-read the row, re-run the
    same grant/revocation algebra against the fresh set, and retry.
    """
    sa_frag, sa_vals = _structured_set(meta.get("structured") or {})
    cur_users, cur_rev = old, old_rev
    for _ in range(attempts):
        new = {u for u in cur_users if u not in verified} | {
            u for u, seen in verified.items() if jid in seen
        }
        changed = new != cur_users
        try:
            table.update_item(
                Key={"pk": f"JOB#{jid}", "sk": "META"},
                UpdateExpression=(
                    "SET #s = :pending, run_id = :run, job_id = :jid, job_name = :n, "
                    "job_path = :p, crawl_secret_id = :sec, allowed_users = :au, "
                    "acl_rev = :rev, last_enumerated_at = :t" + sa_frag
                ),
                ConditionExpression=(
                    "attribute_not_exists(acl_rev) OR acl_rev = :oldrev"
                ),
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":pending": "pending",
                    ":run": run_id,
                    ":jid": jid,
                    ":n": meta["name"],
                    ":p": meta["path"],
                    ":sec": crawl_secret_id,
                    ":au": new if new else {"__none__"},  # DDB sets can't be empty
                    ":rev": cur_rev + 1 if changed else cur_rev,
                    ":oldrev": cur_rev,
                    ":t": _now(),
                    **sa_vals,
                },
            )
            return True
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            # Concurrent grant (on-visit hook / manual sync) bumped the row —
            # re-read and re-apply the algebra against the fresh set.
            resp = table.get_item(Key={"pk": f"JOB#{jid}", "sk": "META"})
            item = resp.get("Item") or {}
            raw = item.get("allowed_users")
            if isinstance(raw, (set, list)):
                cur_users = {str(u) for u in raw}
            else:
                cur_users = set()
            cur_rev = int(item.get("acl_rev") or 0)
    logger.warning(
        "synergy_seed_conflict_unresolved", _name="SYNERGY_CRAWL_COORD", job_id=jid
    )
    return False


def _skip(reason: str) -> Dict[str, Any]:
    logger.info("synergy_coordinator_skip", _name="SYNERGY_CRAWL_COORD", reason=reason)
    return {
        "enabled": False,
        "reason": reason,
        "run_id": "",
        "job_count": 0,
        "user_sub": "",
        "secret_id": "",
        "instance_url": "",
    }


# --------------------------------------------------------------------------- #
# Enqueue
# --------------------------------------------------------------------------- #
def _seed_run_counter(table, run_id: str, job_count: int) -> None:
    """Seed the RUN# completion counter BEFORE enqueuing any message.

    The worker decrements ``remaining`` as each job finishes; the one that drives
    it to zero closes the run + fires the credit debit. Seeding must precede the
    first enqueue so a fast worker can never decrement an unset counter. Also
    zeroes the per-run consumption aggregates the debit reads.
    """
    try:
        table.update_item(
            Key={"pk": f"RUN#{run_id}", "sk": "META"},
            UpdateExpression="SET remaining = :c, doc_count = :z, chars_extracted = :z",
            # Idempotent: an async-Lambda retry of the coordinator must not
            # re-seed remaining and clobber decrements a worker already made.
            ConditionExpression="attribute_not_exists(remaining)",
            ExpressionAttributeValues={":c": job_count, ":z": 0},
        )
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            == "ConditionalCheckFailedException"
        ):
            logger.info(
                "synergy_run_counter_already_seeded",
                _name="SYNERGY_CRAWL_COORD",
                run_id=run_id,
            )
            return
        raise


def _enqueue_run(table, run_id: str, instance_url: str, run_user_sub: str) -> int:
    """Send one SQS message per pending job of this run.

    Reads the seeded JOB# rows (run-status-index: run_id + status=pending) — the
    same per-job payload the former Step Function drain consumed. Dedup id is
    run-scoped (``run_id:job_id``) so a job enqueued by a different run/on-visit
    is never collapsed into this run (which would strand the counter). Returns
    the number enqueued.
    """
    if not SYNERGY_EXTRACT_QUEUE_URL:
        logger.warning(
            "synergy_enqueue_skip_no_queue", _name="SYNERGY_CRAWL_COORD", run_id=run_id
        )
        return 0
    sqs = prm_client("sqs", region=REGION)
    sent = 0
    last_key = None
    while True:
        kwargs: Dict[str, Any] = {
            "IndexName": "run-status-index",
            "KeyConditionExpression": Key("run_id").eq(run_id)
            & Key("status").eq("pending"),
        }
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            job_id = item.get("job_id") or ""
            if not job_id:
                continue
            body = {
                "job_id": job_id,
                "job_name": item.get("job_name") or "",
                "job_path": item.get("job_path") or "",
                "run_id": run_id,
                "user_sub": run_user_sub,
                "secret_id": item.get("crawl_secret_id") or "",
                "instance_url": instance_url,
                "cursor": None,
            }
            sqs.send_message(
                QueueUrl=SYNERGY_EXTRACT_QUEUE_URL,
                MessageBody=json.dumps(body),
                MessageGroupId=job_id,
                # leg:0 keeps the dedup scheme consistent with the worker's
                # partial re-enqueues (leg:1, leg:2, …) for this run+job.
                MessageDeduplicationId=f"{run_id}:{job_id}:leg:0",
            )
            sent += 1
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    logger.info(
        "synergy_run_enqueued",
        _name="SYNERGY_CRAWL_COORD",
        run_id=run_id,
        enqueued=sent,
    )
    return sent


def _fire_credit_debit(run_id: str, doc_count: int, chars_extracted: int) -> None:
    """Fire-and-forget the per-run ingestion debit (deterministic id, so a
    re-fire overwrites rather than double-charges). Best-effort."""
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
            "synergy_credit_debit_invoke_failed",
            _name="SYNERGY_CRAWL_COORD",
            run_id=run_id,
            error=str(exc),
        )


def _close_run(table, run_id: str, status: str) -> bool:
    """Conditionally close a run (won't reopen a done run). Returns True if THIS
    call performed the close (so the caller fires the debit exactly once)."""
    try:
        table.update_item(
            Key={"pk": f"RUN#{run_id}", "sk": "META"},
            UpdateExpression="SET #s = :st, completed_at = :t",
            ConditionExpression="#s <> :done AND #s <> :rec",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":st": status,
                ":done": "done",
                ":rec": "reconciled",
                ":t": _now(),
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


def _drop_open_run(table, run_id: str) -> None:
    """Remove a now-terminal run from CONFIG.open_run_ids (best-effort). Deleting
    the last element drops the attribute entirely (DDB sets can't be empty)."""
    try:
        table.update_item(
            Key={"pk": "CONFIG#crawl", "sk": "META"},
            UpdateExpression="DELETE open_run_ids :one",
            ExpressionAttributeValues={":one": {run_id}},
        )
    except Exception as exc:  # noqa: BLE001 — pruning is best-effort
        logger.warning(
            "synergy_open_run_prune_failed",
            _name="SYNERGY_CRAWL_COORD",
            run_id=run_id,
            error=str(exc),
        )


def _reconcile_open_runs(table) -> None:
    """Force-close any OPEN run that stalled (crashed worker / DLQ'd job / a
    never-decremented job from a concurrent re-seed), so its RUN# row doesn't hang
    'running' forever and its partial work still gets metered exactly once.

    Reconciles over CONFIG.open_run_ids — a bounded DynamoDB string set that runs
    are ADDed to on start and pruned from here once terminal. This replaces the old
    single last_run_id pointer, which silently stranded the earlier run whenever a
    manual 'Sync now' overlapped a scheduled run (the later run overwrote the
    pointer, so reconcile could never reach the earlier one). The set holds only
    open + recently-completed runs, so it stays tiny (no scan). Staleness guards a
    legitimately in-flight run from being force-closed mid-crawl.
    """
    cfg = _get_crawl_config(table)
    raw = cfg.get("open_run_ids")
    open_ids = {str(r) for r in raw} if isinstance(raw, (set, list)) else set()
    if not open_ids:
        return
    for run_id in open_ids:
        row = (table.get_item(Key={"pk": f"RUN#{run_id}", "sk": "META"})).get(
            "Item"
        ) or {}
        status = str(row.get("status") or "")
        if not row or status in ("done", "reconciled", "skipped"):
            _drop_open_run(table, run_id)  # terminal/missing — prune the set
            continue
        started = str(row.get("started_at") or "")
        if started:
            try:
                age_h = (
                    datetime.now(timezone.utc) - datetime.fromisoformat(started)
                ).total_seconds() / 3600
                if age_h < STALE_RUN_HOURS:
                    continue  # still plausibly in-flight — leave it alone
            except ValueError:
                pass
        if _close_run(table, run_id, "reconciled"):
            logger.warning(
                "synergy_run_reconciled_stale",
                _name="SYNERGY_CRAWL_COORD",
                run_id=run_id,
                remaining=int(row.get("remaining") or 0),
            )
            _fire_credit_debit(
                run_id,
                int(row.get("doc_count") or 0),
                int(row.get("chars_extracted") or 0),
            )
        _drop_open_run(table, run_id)


# --------------------------------------------------------------------------- #
# Modes
# --------------------------------------------------------------------------- #
def _adjust_remaining_to_enqueued(
    table, run_id: str, job_count: int, enqueued: int
) -> None:
    """Drop `remaining` by any seed/enqueue shortfall so the run counter can still
    reach 0 instead of hanging until reconcile. _enqueue_run fans out by Query'ing
    the eventually-consistent run-status-index GSI right after seeding, so a just-
    written JOB# row can be momentarily invisible and go un-enqueued (enqueued <
    job_count). `remaining` was seeded to job_count; this ADDs the negative shortfall
    atomically (composes with concurrent worker decrements). If the adjustment alone
    drains the counter (e.g. nothing enqueued at all), close + meter once here,
    mirroring the worker's completion path."""
    shortfall = job_count - enqueued
    if shortfall <= 0:
        return
    logger.warning(
        "synergy_enqueue_shortfall",
        _name="SYNERGY_CRAWL_COORD",
        run_id=run_id,
        job_count=job_count,
        enqueued=enqueued,
    )
    resp = table.update_item(
        Key={"pk": f"RUN#{run_id}", "sk": "META"},
        UpdateExpression="ADD remaining :neg",
        ExpressionAttributeValues={":neg": -shortfall},
        ReturnValues="ALL_NEW",
    )
    attrs = resp.get("Attributes") or {}
    if int(attrs.get("remaining") or 0) <= 0 and _close_run(table, run_id, "done"):
        _fire_credit_debit(
            run_id,
            int(attrs.get("doc_count") or 0),
            int(attrs.get("chars_extracted") or 0),
        )


def _run_manual(table, event: Dict[str, Any], context=None) -> Dict[str, Any]:
    run_id = event.get("run_id") or f"run-{int(time.time())}"
    user_sub = event["user_sub"]
    secret_id = event["secret_id"]
    instance_url = event["instance_url"]
    scope = event.get("scope") or {}
    max_jobs = int(scope.get("max_jobs") or 0)
    only_job_ids = set(scope.get("job_ids") or [])

    # Resolve the PAT BEFORE writing the run row so a missing/garbled secret
    # doesn't leave a phantom forever-"running" run in the status API.
    pat = _get_pat_or_raise(secret_id)
    _write_run_row(table, run_id, "manual", user_sub)

    job_count = 0
    for job in _iter_jobs(instance_url, pat, JOB_PAGE_SIZE):
        # Stop enumerating if low on Lambda time, then still seed+enqueue what was
        # granted so far. Manual grants are purely additive (no revocation), so a
        # partial pass is safe — the remainder is picked up by the next sync /
        # scheduled pass. This avoids a mid-loop kill stranding the RUN# row.
        if (
            context is not None
            and context.get_remaining_time_in_millis() < SCHED_SAFETY_MS
        ):
            logger.warning(
                "synergy_manual_time_budget",
                _name="SYNERGY_CRAWL_COORD",
                run_id=run_id,
                granted=job_count,
            )
            break
        jid = _job_id(job)
        if only_job_ids and jid not in only_job_ids:
            continue
        _grant_user_on_job(
            table, job=job, run_id=run_id, user_sub=user_sub, secret_id=secret_id
        )
        job_count += 1
        if max_jobs and job_count >= max_jobs:
            break
        # Scoped index: stop once every requested job has been found, instead of
        # paging the whole portfolio (13k+ jobs on a large instance) to grant one.
        if only_job_ids and job_count >= len(only_job_ids):
            break

    table.update_item(
        Key={"pk": f"RUN#{run_id}", "sk": "META"},
        UpdateExpression="SET job_count = :c, enumerated_at = :t",
        ExpressionAttributeValues={":c": job_count, ":t": _now()},
    )
    # Seed the completion counter BEFORE enqueuing (so a fast worker never
    # decrements an unset counter), then fan the jobs onto the queue. Dedup ids
    # are run-scoped, so every pending job lands one message for this run — but
    # _enqueue_run reads the eventually-consistent GSI, so a just-seeded row can be
    # momentarily invisible and go un-enqueued; _adjust_remaining_to_enqueued drops
    # `remaining` by any shortfall so the counter still reaches zero.
    # A zero-job run has nothing to drain → close it inline (no worker ever would).
    if job_count == 0:
        _close_run(table, run_id, "done")
        enqueued = 0
    else:
        _seed_run_counter(table, run_id, job_count)
        enqueued = _enqueue_run(table, run_id, instance_url, user_sub)
        _adjust_remaining_to_enqueued(table, run_id, job_count, enqueued)
    logger.info(
        "synergy_coordinator_done",
        _name="SYNERGY_CRAWL_COORD",
        mode="manual",
        run_id=run_id,
        job_count=job_count,
        enqueued=enqueued,
    )
    return {
        "enabled": True,
        "reason": "manual",
        "run_id": run_id,
        "job_count": job_count,
        "enqueued": enqueued,
        "user_sub": user_sub,
        "secret_id": secret_id,
        "instance_url": instance_url,
    }


def _run_scheduled(table, context=None) -> Dict[str, Any]:
    config = _get_crawl_config(table)
    if not config.get("enabled"):
        return _skip("disabled")

    frequency_hours = int(config.get("frequency_hours") or DEFAULT_FREQUENCY_HOURS)
    last_started = str(config.get("last_scheduled_run_at") or "")
    if last_started:
        try:
            elapsed_h = (
                datetime.now(timezone.utc) - datetime.fromisoformat(last_started)
            ).total_seconds() / 3600
            if elapsed_h < frequency_hours - 0.5:  # 30-min slack for scheduler jitter
                return _skip("not_due")
        except ValueError:
            pass

    instance_url = _get_admin_instance_url()
    if not instance_url:
        return _skip("no_instance_url")

    run_id = f"sched-{int(time.time())}"
    credential_user = str(config.get("credential_user_sub") or "")

    # NOTE: due-ness (last_scheduled_run_at) is stamped at the END, after the
    # seeding completes. Stamping first would convert any timeout/crash into a
    # silently skipped day: the daily EventBridge schedule's direct async invoke
    # would re-fire next day, read the fresh stamp, and skip as "not_due" — masking
    # the failure as success. Stamping last keeps re-invocation meaningful (the pass
    # is idempotent: grants/seeds are upserts) so a missed day self-heals the next
    # day instead of a revocation pass being silently skipped.
    _write_run_row(table, run_id, "scheduled", credential_user)

    # ---- Authoritative permission pass: enumerate every connected user. ----
    # verified: users whose enumeration SUCCEEDED — only they can be revoked.
    verified: Dict[str, Set[str]] = {}
    job_meta: Dict[str, Dict[str, Any]] = (
        {}
    )  # job_id -> {name, path, seen_by, structured}
    aborted_for_time = False
    for user_sub, pat in _list_connected_users():
        # Stop enumerating if we're low on Lambda time. We MUST abort here —
        # before any seeding/revocation below — because a partial `verified` set
        # would over-revoke jobs we simply didn't reach. last_scheduled_run_at is
        # left unstamped so the next invocation retries the whole (idempotent) pass.
        if (
            context is not None
            and context.get_remaining_time_in_millis() < SCHED_SAFETY_MS
        ):
            aborted_for_time = True
            logger.warning(
                "synergy_scheduled_time_budget",
                _name="SYNERGY_CRAWL_COORD",
                run_id=run_id,
                users_enumerated=len(verified),
            )
            break
        try:
            seen: Set[str] = set()
            for job in _iter_jobs(instance_url, pat, JOB_PAGE_SIZE):
                jid = _job_id(job)
                if not jid:
                    continue
                seen.add(jid)
                if jid not in job_meta:
                    job_meta[jid] = {
                        "name": job.get("Name") or jid,
                        "path": job.get("Path") or "",
                        "seen_by": user_sub,
                        "structured": _job_structured_attrs(job),
                    }
            verified[user_sub] = seen
            logger.info(
                "synergy_user_enumerated",
                _name="SYNERGY_CRAWL_COORD",
                user_sub=user_sub[:8] + "...",
                jobs=len(seen),
            )
        except Exception as exc:  # noqa: BLE001 — expired PAT etc.: keep grants
            logger.warning(
                "synergy_user_enumeration_failed",
                user_sub=user_sub[:8] + "...",
                error=str(exc),
            )

    if aborted_for_time:
        # Ran out of time mid-enumeration. Apply NO grants/revocations (the
        # verified set is incomplete — seeding now would over-revoke). Terminal-
        # status the row so it isn't stranded 'running', leave last_scheduled_run_at
        # unset so the next invocation retries the whole pass, and prune the open set.
        table.update_item(
            Key={"pk": f"RUN#{run_id}", "sk": "META"},
            UpdateExpression="SET #s = :skipped, reason = :r",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":skipped": "skipped", ":r": "time_budget"},
        )
        _drop_open_run(table, run_id)
        return _skip("time_budget")

    if not verified:
        # Terminal-status the run row (it was already created and pointed at by
        # CONFIG.last_run_id) so the admin panel shows the failure instead of a
        # phantom forever-"running" run. This is exactly the state — every PAT
        # expired / nobody connected — an admin most needs to see.
        table.update_item(
            Key={"pk": f"RUN#{run_id}", "sk": "META"},
            UpdateExpression="SET #s = :skipped, reason = :r",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":skipped": "skipped",
                ":r": "no_verified_users",
            },
        )
        return _skip("no_verified_users")

    existing = _scan_existing_jobs(table)
    all_job_ids = set(job_meta) | set(existing)

    job_count = 0
    purged = 0
    for jid in all_job_ids:
        old = existing.get(jid, {}).get("allowed_users", set())
        old_rev = existing.get(jid, {}).get("acl_rev", 0)
        # Users we could not verify keep their grants (fail-safe, not fail-open:
        # their grant came from their own past enumeration).
        kept = {u for u in old if u not in verified}
        new = kept | {u for u, seen in verified.items() if jid in seen}

        if jid not in job_meta:
            # No verified user sees this job anymore.
            if not new:
                purged += _purge_job_corpus(table, jid)
            # else: only unverifiable holders remain — leave as-is; nothing to
            # crawl (no credential can see it) and grants are preserved.
            continue

        meta = job_meta[jid]
        # Prefer the admin-configured credential when it can see the job, so most
        # work runs under the blessed account; fall back to any verified viewer.
        if credential_user in verified and jid in verified[credential_user]:
            crawl_user = credential_user
        else:
            crawl_user = meta["seen_by"]

        if _seed_scheduled_job(
            table,
            jid=jid,
            run_id=run_id,
            meta=meta,
            crawl_secret_id=_vault_path(crawl_user),
            old=old,
            old_rev=old_rev,
            verified=verified,
        ):
            # Only count jobs actually written pending for this run, so `remaining`
            # never exceeds what the worker can close (an unresolved-conflict seed
            # left the row under another run and would otherwise strand the counter).
            job_count += 1

    # Stamp due-ness LAST — only a pass that actually seeded counts as "ran"
    # (see the note above _write_run_row for why stamp-first is wrong).
    table.update_item(
        Key={"pk": "CONFIG#crawl", "sk": "META"},
        UpdateExpression="SET last_scheduled_run_at = :t",
        ExpressionAttributeValues={":t": _now()},
    )
    table.update_item(
        Key={"pk": f"RUN#{run_id}", "sk": "META"},
        UpdateExpression="SET job_count = :c, purged_jobs = :pj, enumerated_at = :t",
        ExpressionAttributeValues={":c": job_count, ":pj": purged, ":t": _now()},
    )
    if job_count == 0:
        _close_run(table, run_id, "done")
        enqueued = 0
    else:
        _seed_run_counter(table, run_id, job_count)
        enqueued = _enqueue_run(table, run_id, instance_url, credential_user)
        _adjust_remaining_to_enqueued(table, run_id, job_count, enqueued)
    logger.info(
        "synergy_coordinator_done",
        _name="SYNERGY_CRAWL_COORD",
        mode="scheduled",
        run_id=run_id,
        job_count=job_count,
        enqueued=enqueued,
        purged_jobs=purged,
        users_verified=len(verified),
    )
    return {
        "enabled": True,
        "reason": "scheduled",
        "run_id": run_id,
        "job_count": job_count,
        "enqueued": enqueued,
        "user_sub": credential_user,
        "secret_id": _vault_path(credential_user) if credential_user else "",
        "instance_url": instance_url,
    }


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    if not STATE_TABLE_NAME or not CLIENT_NAME:
        raise ValueError("STATE_TABLE_NAME / CLIENT_NAME not configured")

    table = _state_table()

    # Heal any stalled OPEN run (reconcile over the bounded open-runs set, so an
    # overlapping manual+scheduled pair can't strand the earlier run). Best-effort
    # — never block a new crawl on reconciliation.
    try:
        _reconcile_open_runs(table)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "synergy_reconcile_failed", _name="SYNERGY_CRAWL_COORD", error=str(exc)
        )

    trigger = event.get("trigger") or (
        "manual" if event.get("secret_id") else "scheduled"
    )

    if trigger == "manual":
        return _run_manual(table, event, context)
    return _run_scheduled(table, context)
