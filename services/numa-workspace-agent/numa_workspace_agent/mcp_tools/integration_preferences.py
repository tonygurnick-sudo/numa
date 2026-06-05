"""
Integration preference lookups — per-service `preferred_method` enforcement.

When a service exists as both a Pipedream integration and a native connector
(e.g. Gmail), admins pick one method via the unified Integrations admin UI.
This module reads that choice from the `{client}-global-integration-settings`
DynamoDB table and exposes a small API the MCP tools call to refuse work on
the non-preferred method.

We deliberately keep the cache scoped to the *process* lifetime with a short
TTL: agent containers stay warm across requests, but we want admin changes to
propagate within a few minutes without forcing a deploy.
"""

from __future__ import annotations

import os
import time
from typing import Literal, Optional

import structlog

logger = structlog.get_logger()

Method = Literal["native", "pipedream"]

# Pipedream slug -> native connector slug.
#
# IMPORTANT: This map MUST stay in sync with the canonical source of truth at
# ``infra/config/connectors.ts`` (CONNECTOR_TO_PIPEDREAM). It is duplicated
# here because the agent container can't import TypeScript and we deliberately
# don't pull a connectors-config Lambda just to read a constant. If you add
# or rename an overlap mapping in the TS file, MIRROR IT HERE in the same
# commit — there is no test that catches drift, and a missing entry silently
# disables ``preferred_method`` enforcement for that service.
#
# Used to map an integration tool's slug back to the canonical service when
# the settings table only has the Pipedream slug as its primary key.
_PIPEDREAM_TO_CONNECTOR: dict[str, str] = {
    "gmail": "gmail",
    "google_drive": "googledrive",
    "dropbox": "dropbox",
    "xero_accounting_api": "xero",
    "quickbooks": "quickbooks",
    "podio": "podio",
    "jobber": "getjobber",
    "zoho_crm": "zoho-crm",
}

_CONNECTOR_TO_PIPEDREAM: dict[str, str] = {
    v: k for k, v in _PIPEDREAM_TO_CONNECTOR.items()
}


def slug_aliases(slug: str) -> set[str]:
    """Return a slug plus its cross-method counterpart (Pipedream <-> native).

    The same external service can be enabled via Pipedream or a native
    connector under different slugs (e.g. ``google_drive`` vs ``googledrive``).
    Callers that need to match a slug against an enabled set regardless of
    method should compare alias sets, so an ``integration:google_drive`` memory
    still activates when only the native ``googledrive`` connector is on (and
    vice versa). Services with a single shared slug (e.g. ``gmail``) just
    return ``{slug}``.
    """
    aliases = {slug}
    if slug in _PIPEDREAM_TO_CONNECTOR:
        aliases.add(_PIPEDREAM_TO_CONNECTOR[slug])
    if slug in _CONNECTOR_TO_PIPEDREAM:
        aliases.add(_CONNECTOR_TO_PIPEDREAM[slug])
    return aliases


_CACHE_TTL_SECONDS = 120
_cache: dict[str, Optional[Method]] = {}
_cache_loaded_at: float = 0.0


class _LoadError(Exception):
    """Raised when the DDB scan fails so the caller can avoid stamping the
    cache timestamp (otherwise a transient outage freezes us into a 120s
    fail-open window where both methods are allowed)."""


def _load_preferences() -> dict[str, Optional[Method]]:
    """Scan the global integration settings table and return slug -> preferred_method.

    Raises ``_LoadError`` on DDB failure so the cache refresh path can tell
    "empty by config" apart from "empty because the scan blew up". The empty
    case is legitimate (no admin has set a preferred_method yet); the failure
    case should retry on the next call rather than be cached.
    """
    table_name = os.environ.get("GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME", "")
    if not table_name:
        return {}

    import boto3

    session = boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    ddb = session.resource("dynamodb")
    table = ddb.Table(table_name)

    out: dict[str, Optional[Method]] = {}
    try:
        response = table.scan()
        for item in response.get("Items", []):
            slug = item.get("integration")
            preferred = item.get("preferred_method")
            if slug and preferred in ("native", "pipedream"):
                out[slug] = preferred
    except Exception as exc:  # pragma: no cover — DDB failures must not break tools
        logger.warning(
            "Failed to load integration preferences",
            _name="INTEGRATION_PREFERENCES_LOAD_FAILED",
            phase="sdk",
            error=str(exc),
        )
        raise _LoadError(str(exc)) from exc
    return out


def _refresh_if_stale() -> None:
    """Repopulate the cache when the TTL window has elapsed.

    On DDB failure we keep whatever we last had (which may be ``{}`` on a
    cold container) and DO NOT update ``_cache_loaded_at`` — that way the
    next call retries immediately instead of locking us into 120s of
    fail-open behaviour after a transient DDB outage.
    """
    global _cache, _cache_loaded_at
    if (
        time.monotonic() - _cache_loaded_at < _CACHE_TTL_SECONDS
        and _cache_loaded_at > 0
    ):
        return
    try:
        _cache = _load_preferences()
        _cache_loaded_at = time.monotonic()
    except _LoadError:
        # Don't stamp the load time — leave _cache as-is and force a retry on
        # the next call. The warning is already logged in _load_preferences.
        return


def get_preferred_method(pipedream_slug: str) -> Optional[Method]:
    """
    Return the admin's chosen method for the service that owns this Pipedream slug,
    or None if the admin hasn't picked (or the service has no native counterpart).
    """
    if not pipedream_slug:
        return None
    _refresh_if_stale()
    return _cache.get(pipedream_slug)


def is_pipedream_allowed(pipedream_slug: str) -> bool:
    """True unless the admin has explicitly chosen the native method for this service."""
    return get_preferred_method(pipedream_slug) != "native"


def is_native_allowed(connector_slug: str) -> bool:
    """True unless the admin has explicitly chosen Pipedream for this service."""
    pipedream_slug = _CONNECTOR_TO_PIPEDREAM.get(connector_slug)
    if not pipedream_slug:
        return True  # connector has no Pipedream counterpart, nothing to override
    return get_preferred_method(pipedream_slug) != "pipedream"
