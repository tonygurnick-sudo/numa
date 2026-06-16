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
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

import httpx
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3.dynamodb.conditions import Attr

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
STATE_TABLE_NAME = os.getenv("STATE_TABLE_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")
JOB_PAGE_SIZE = int(os.getenv("JOB_PAGE_SIZE", "100"))
DEFAULT_FREQUENCY_HOURS = int(os.getenv("DEFAULT_FREQUENCY_HOURS", "24"))


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
    """Delete every indexed document of a job (S3 .txt + sidecar + FILE# rows).

    Used when NO verified user can see the job anymore — leaving the docs would
    leave stale sidecars whose allowed_users still grant access to users who
    lost the job in Synergy.
    """
    s3 = prm_client("s3", region=REGION)
    deleted = 0
    query_kwargs: Dict[str, Any] = {
        "IndexName": "job-index",
        "KeyConditionExpression": "job_id = :j",
        "FilterExpression": "begins_with(pk, :f)",
        "ExpressionAttributeValues": {":j": job_id, ":f": "FILE#"},
    }
    while True:
        resp = table.query(**query_kwargs)
        for item in resp.get("Items", []):
            key = item.get("s3_txt_key")
            if key and DATA_BUCKET_NAME:
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
    table.delete_item(Key={"pk": f"JOB#{job_id}", "sk": "META"})
    return deleted


def _grant_user_on_job(
    table, *, job: dict, run_id: str, user_sub: str, secret_id: str
) -> None:
    """Manual-mode upsert: grant the caller + mark the job pending for this run."""
    jid = _job_id(job)
    if not jid:
        return
    key = {"pk": f"JOB#{jid}", "sk": "META"}

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
            "job_path = :p, crawl_secret_id = :sec, last_enumerated_at = :t"
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
        },
    )


def _write_run_row(table, run_id: str, trigger: str, user_sub: str) -> None:
    table.put_item(
        Item={
            "pk": f"RUN#{run_id}",
            "sk": "META",
            "run_id": run_id,
            "status": "running",
            "trigger": trigger,
            "user_sub": user_sub,
            "started_at": _now(),
        }
    )
    # Pointer for the sync-status API (RUN# rows aren't otherwise listable).
    table.update_item(
        Key={"pk": "CONFIG#crawl", "sk": "META"},
        UpdateExpression="SET last_run_id = :r, last_run_started_at = :t",
        ExpressionAttributeValues={":r": run_id, ":t": _now()},
    )


def _seed_scheduled_job(
    table,
    *,
    jid: str,
    run_id: str,
    meta: Dict[str, str],
    crawl_secret_id: str,
    old: Set[str],
    old_rev: int,
    verified: Dict[str, Set[str]],
    attempts: int = 3,
) -> None:
    """Seed one job in the scheduled pass with optimistic concurrency.

    The allowed_users rebuild is computed from a table snapshot taken minutes
    earlier; a blind SET would (a) erase grants the on-visit hook added in the
    gap, and (b) reuse an acl_rev number an on-visit bump already spent on a
    DIFFERENT user set — after which the worker's rev-equality check would
    never restamp the stale sidecar. The ConditionExpression pins the write to
    the rev we computed against; on conflict we re-read the row, re-run the
    same grant/revocation algebra against the fresh set, and retry.
    """
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
                    "acl_rev = :rev, last_enumerated_at = :t"
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
                },
            )
            return
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
# Modes
# --------------------------------------------------------------------------- #
def _run_manual(table, event: Dict[str, Any]) -> Dict[str, Any]:
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
        jid = _job_id(job)
        if only_job_ids and jid not in only_job_ids:
            continue
        _grant_user_on_job(
            table, job=job, run_id=run_id, user_sub=user_sub, secret_id=secret_id
        )
        job_count += 1
        if max_jobs and job_count >= max_jobs:
            break

    table.update_item(
        Key={"pk": f"RUN#{run_id}", "sk": "META"},
        UpdateExpression="SET job_count = :c, enumerated_at = :t",
        ExpressionAttributeValues={":c": job_count, ":t": _now()},
    )
    logger.info(
        "synergy_coordinator_done",
        _name="SYNERGY_CRAWL_COORD",
        mode="manual",
        run_id=run_id,
        job_count=job_count,
    )
    return {
        "enabled": True,
        "reason": "manual",
        "run_id": run_id,
        "job_count": job_count,
        "user_sub": user_sub,
        "secret_id": secret_id,
        "instance_url": instance_url,
    }


def _run_scheduled(table) -> Dict[str, Any]:
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
    # silently skipped day: the Step Function's Retry on RunCoordinator would
    # re-invoke, read the fresh stamp, and skip as "not_due" — masking the
    # failure as success. Stamping last keeps the retry meaningful (the pass is
    # idempotent: grants/seeds are upserts) and a hard double-failure surfaces
    # as a FAILED execution instead of a skipped revocation pass.
    _write_run_row(table, run_id, "scheduled", credential_user)

    # ---- Authoritative permission pass: enumerate every connected user. ----
    # verified: users whose enumeration SUCCEEDED — only they can be revoked.
    verified: Dict[str, Set[str]] = {}
    job_meta: Dict[str, Dict[str, str]] = {}  # job_id -> {name, path, seen_by}
    for user_sub, pat in _list_connected_users():
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

        _seed_scheduled_job(
            table,
            jid=jid,
            run_id=run_id,
            meta=meta,
            crawl_secret_id=_vault_path(crawl_user),
            old=old,
            old_rev=old_rev,
            verified=verified,
        )
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
    logger.info(
        "synergy_coordinator_done",
        _name="SYNERGY_CRAWL_COORD",
        mode="scheduled",
        run_id=run_id,
        job_count=job_count,
        purged_jobs=purged,
        users_verified=len(verified),
    )
    return {
        "enabled": True,
        "reason": "scheduled",
        "run_id": run_id,
        "job_count": job_count,
        "user_sub": credential_user,
        "secret_id": _vault_path(credential_user) if credential_user else "",
        "instance_url": instance_url,
    }


def handler(event: Dict[str, Any], _: LambdaContext) -> Dict[str, Any]:
    if not STATE_TABLE_NAME or not CLIENT_NAME:
        raise ValueError("STATE_TABLE_NAME / CLIENT_NAME not configured")

    table = _state_table()
    trigger = event.get("trigger") or (
        "manual" if event.get("secret_id") else "scheduled"
    )

    if trigger == "manual":
        return _run_manual(table, event)
    return _run_scheduled(table)
