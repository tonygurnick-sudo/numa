"""Billing-calendar time helpers for the Numa Credit System.

The credit system bills on a SINGLE calendar — New Zealand (``Pacific/Auckland``) — for ALL clients,
regardless of the client's own AWS region. This keeps month bucketing and month-close settlement
consistent fleet-wide: a conversation just after NZ-midnight on the 1st counts in the new month, and
months settle on the NZ boundary (not ~13h late on the UTC boundary).

DST is handled automatically by ``zoneinfo`` (NZDT = UTC+13 ~late-Sep→early-Apr, NZST = UTC+12
otherwise) — never hardcode the offset. USD throughout: the timezone only affects WHEN a month
boundary falls, never any monetary value (there is no FX in the billing engine).

Runtime note: ``zoneinfo`` needs the IANA tz database. On AWS Lambda add the ``tzdata`` package to the
function's deps so ``ZoneInfo("Pacific/Auckland")`` resolves without relying on system tz files.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# The one billing calendar for every client (Arcanum is NZ-based and bills in NZD).
BILLING_TZ = ZoneInfo("Pacific/Auckland")


def _parse_iso(iso_ts: str) -> datetime:
    """Parse an ISO-8601 timestamp; treat a naive (no-offset) value as UTC."""
    dt = datetime.fromisoformat(iso_ts.strip().replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def billing_month_of(iso_ts: str) -> str:
    """The ``YYYY-MM`` billing month an ISO-8601 timestamp falls in, on the NZ calendar."""
    return _parse_iso(iso_ts).astimezone(BILLING_TZ).strftime("%Y-%m")


def billing_now() -> datetime:
    """``now`` in the NZ billing calendar (for month-rollover / settlement decisions)."""
    return datetime.now(BILLING_TZ)


def billing_month_now() -> str:
    """The current ``YYYY-MM`` billing month on the NZ calendar."""
    return billing_now().strftime("%Y-%m")


def previous_billing_month(month: str) -> str:
    """The ``YYYY-MM`` immediately before ``month`` (e.g. ``2026-01`` -> ``2025-12``)."""
    year, mon = (int(p) for p in month.split("-"))
    return f"{year - 1}-12" if mon == 1 else f"{year}-{mon - 1:02d}"
