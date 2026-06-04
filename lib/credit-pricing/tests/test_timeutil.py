"""Tests for the NZ billing-calendar helpers (single billing TZ for all clients)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from credit_pricing import timeutil  # noqa: E402


def test_bucket_uses_nz_not_utc_at_the_boundary() -> None:
    """A timestamp just after NZ-midnight on the 1st is the NEW month, even though it's still the
    prior month in UTC (NZ is ahead by 12-13h). This is the bug the NZ calendar fixes.
    """
    # 2026-02-28T12:30Z = 2026-03-01T01:30 NZDT (+13, summer) -> March on the NZ calendar.
    assert timeutil.billing_month_of("2026-02-28T12:30:00Z") == "2026-03"
    # 2026-02-28T10:30Z = 2026-02-28T23:30 NZDT -> still February.
    assert timeutil.billing_month_of("2026-02-28T10:30:00Z") == "2026-02"


def test_dst_offset_is_not_hardcoded() -> None:
    """June is NZST (+12); January is NZDT (+13) — handled by zoneinfo, not a fixed offset."""
    # 2026-06-30T12:30Z = 2026-07-01T00:30 NZST (+12) -> July.
    assert timeutil.billing_month_of("2026-06-30T12:30:00Z") == "2026-07"
    # 2026-06-30T11:30Z = 2026-06-30T23:30 NZST -> still June.
    assert timeutil.billing_month_of("2026-06-30T11:30:00Z") == "2026-06"


def test_naive_timestamp_treated_as_utc() -> None:
    assert timeutil.billing_month_of("2026-02-28T12:30:00") == "2026-03"


def test_previous_billing_month_wraps_year() -> None:
    assert timeutil.previous_billing_month("2026-03") == "2026-02"
    assert timeutil.previous_billing_month("2026-01") == "2025-12"


if __name__ == "__main__":
    test_bucket_uses_nz_not_utc_at_the_boundary()
    test_dst_offset_is_not_hardcoded()
    test_naive_timestamp_treated_as_utc()
    test_previous_billing_month_wraps_year()
    print("timeutil tests OK")
