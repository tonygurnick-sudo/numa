"""Numa Dashboard fleet-analytics rollup Lambda.

Entry point. Per-client gather only — aggregates are computed in the browser
from the per-client snapshots (the frontend scans every SNAPSHOT#latest row
and rolls up in JS). That keeps the rollup pipeline single-purpose, sidesteps
the aggregate-row-write race that fan-out produced, and lets the dashboard
add/change filters (nextgen vs non-nextgen, account-id dedup, etc.) without
a Lambda redeploy.

Invocation shapes:
  { "scope": "all" }                                # full fleet (legacy in-process loop)
  { "scope": "client", "clientName": "nd-labs" }    # single-client refresh
  { "scope": "list" }                               # list-only; returns clients[]
                                                    # used by the SFN orchestrator
                                                    # to fan out per-client work

Response:
  {
    "ok": bool,
    "scope": "all"|"client"|"list",
    "client": str | null,
    "duration_ms": int,
    "per_client": [ {"clientName": str, "ok": bool, "duration_ms": int, "error": str | null} ],
  }
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import boto3
import structlog

from numa_fleet_analytics_rollup.gather import gather_client_snapshot
from numa_fleet_analytics_rollup.persist import (
    list_client_names,
    write_snapshot,
)

logger = structlog.get_logger()

CLIENT_CONFIG_TABLE = os.environ["CLIENT_CONFIG_TABLE_NAME"]
FLEET_TABLE = os.environ["FLEET_ANALYTICS_TABLE_NAME"]
# Optional: when set, the rollup joins each client to its accountOrg
# (nextgen|arcanum|standalone) from numa-client-metadata. The frontend uses
# this to filter standalone customers' non-Numa AWS workloads out of the
# Cost composition donut. Missing → snapshots carry account_org=None.
CLIENT_METADATA_TABLE = os.environ.get("CLIENT_METADATA_TABLE_NAME")
ROLE_NAME = os.environ.get("ARCANUM_AI_ACCESS_ROLE_NAME", "ArcanumAIAccess")
PER_CLIENT_CONCURRENCY = int(os.environ.get("PER_CLIENT_CONCURRENCY", "8"))
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "90"))
SNAPSHOT_TTL_DAYS = int(os.environ.get("SNAPSHOT_TTL_DAYS", "180"))


def _assume_role(account_id: str) -> boto3.Session:
    """Assume ArcanumAIAccess in the target client account.

    Returns a fresh boto3.Session bound to the temporary credentials.
    """
    sts = boto3.client("sts")
    resp = sts.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{ROLE_NAME}",
        RoleSessionName="numa-fleet-analytics-rollup",
        DurationSeconds=3600,
    )
    creds = resp["Credentials"]
    return boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def _process_client(client_name: str, client_config: dict) -> dict:
    """Gather one client's snapshot and persist it. Returns a per-client status."""
    started = time.time()
    log = logger.bind(client_name=client_name)
    try:
        account_id = client_config.get("client_account_id")
        if not account_id:
            return {
                "clientName": client_name,
                "ok": False,
                "duration_ms": 0,
                "error": "missing clientAccountId in client config",
            }
        session = _assume_role(account_id)
        snapshot = gather_client_snapshot(
            session=session,
            client_name=client_name,
            client_config=client_config,
            window_days=WINDOW_DAYS,
        )
        write_snapshot(
            fleet_table=FLEET_TABLE,
            client_name=client_name,
            snapshot=snapshot,
            snapshot_ttl_days=SNAPSHOT_TTL_DAYS,
        )
        log.info(
            "client snapshot complete",
            _name="ROLLUP_CLIENT_DONE",
            duration_ms=int((time.time() - started) * 1000),
        )
        return {
            "clientName": client_name,
            "ok": True,
            "duration_ms": int((time.time() - started) * 1000),
            "error": None,
        }
    except Exception as e:
        log.error(
            "client snapshot failed",
            _name="ROLLUP_CLIENT_ERROR",
            error=str(e),
            exc_info=True,
        )
        return {
            "clientName": client_name,
            "ok": False,
            "duration_ms": int((time.time() - started) * 1000),
            "error": repr(e),
        }


def handler(event: dict, context: Any) -> dict:
    started = time.time()
    scope = (event or {}).get("scope") or "all"
    target_client = (event or {}).get("clientName")
    log = logger.bind(scope=scope, target_client=target_client)
    log.info("rollup invoked", _name="ROLLUP_START")

    if scope == "list":
        clients = list_client_names(
            CLIENT_CONFIG_TABLE, client_metadata_table=CLIENT_METADATA_TABLE
        )
        log.info("clients listed", _name="ROLLUP_LIST", count=len(clients))
        return {
            "ok": True,
            "scope": scope,
            "clients": clients,
            "count": len(clients),
            "duration_ms": int((time.time() - started) * 1000),
        }

    # Resolve client list
    if scope == "client":
        if not target_client:
            return {"ok": False, "scope": scope, "error": "clientName required"}
        clients = list_client_names(
            CLIENT_CONFIG_TABLE,
            only_name=target_client,
            client_metadata_table=CLIENT_METADATA_TABLE,
        )
    else:
        clients = list_client_names(
            CLIENT_CONFIG_TABLE, client_metadata_table=CLIENT_METADATA_TABLE
        )

    log.info("clients to process", _name="ROLLUP_CLIENTS", count=len(clients))

    # Fan out per-client work. No aggregate pass: the frontend rolls up from
    # per-client snapshots (see fleetAnalyticsService.fetchAllSnapshots()).
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=PER_CLIENT_CONCURRENCY) as pool:
        futs = {pool.submit(_process_client, c["clientName"], c): c for c in clients}
        for fut in as_completed(futs):
            results.append(fut.result())

    return {
        "ok": all(r["ok"] for r in results),
        "scope": scope,
        "client": target_client,
        "duration_ms": int((time.time() - started) * 1000),
        "per_client": results,
    }
