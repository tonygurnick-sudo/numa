import os
import types

# Env must be set before importing the module (read at load time).
os.environ["CREDIT_METERING_ENABLED"] = "true"
os.environ["CREDITS_TABLE_NAME"] = "numa-test-credit-ledger"
os.environ["CLIENT_NAME"] = "testclient"

import lambda_function as lf  # noqa: E402


class FakeTable:
    def __init__(self, config=None, gsi2_items=None):
        self.puts = []
        self._config = config or {}
        # Pre-existing META rows the GSI2 month query should sum on recompute.
        self._gsi2_items = gsi2_items or []

    def get_item(self, Key):  # noqa: N803
        if Key.get("SK") == "CONFIG" and self._config:
            return {"Item": self._config}
        return {}

    def put_item(self, Item):  # noqa: N803
        self.puts.append(Item)
        return {}

    def query(self, **kwargs):
        return {"Items": self._gsi2_items}


def _patch_table(monkeypatch, table):
    monkeypatch.setattr(
        lf,
        "prm_resource",
        lambda *a, **k: types.SimpleNamespace(Table=lambda name: table),
    )


def test_skips_when_metering_disabled(monkeypatch):
    # (1) METERING_ENABLED=false → skipped, no table writes.
    monkeypatch.setattr(lf, "METERING_ENABLED", False)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler({"run_id": "r1", "doc_count": 1000}, None)
    assert res == {"skipped": "metering_disabled"}
    assert table.puts == []


def test_not_configured_without_table_or_client(monkeypatch):
    # (2) missing TABLE_NAME / CLIENT_NAME → not_configured.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    monkeypatch.setattr(lf, "TABLE_NAME", "")
    res = lf.handler({"run_id": "r1", "doc_count": 1000}, None)
    assert res == {"skipped": "not_configured"}

    monkeypatch.setattr(lf, "TABLE_NAME", "numa-test-credit-ledger")
    monkeypatch.setattr(lf, "CLIENT_NAME", "")
    assert lf.handler({"run_id": "r1", "doc_count": 1000}, None)["skipped"] == (
        "not_configured"
    )


def test_skips_without_run_id(monkeypatch):
    # (3) missing run_id → missing_run_id, no table writes.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler({"doc_count": 1000}, None)
    assert res == {"skipped": "missing_run_id"}
    assert table.puts == []


def test_empty_crawl_writes_nothing(monkeypatch):
    # (4) empty crawl (doc_count=0 → usd 0 → credits<=0) → NO put_item / META,
    # NO month recompute, early return.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler({"run_id": "empty-run", "doc_count": 0}, None)
    assert res["run_id"] == "empty-run"
    assert res["credits"] == 0
    assert res["consumption_usd"] == 0.0
    # No META row and no MONTH aggregate were written.
    assert table.puts == []


def test_happy_path_meters_crawl_with_sentinel_user(monkeypatch):
    # (5) happy path → META carries source='synergy', user_sub==SENTINEL when the
    # event omits user_sub, conv_id == 'synergy-<run_id>'.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler({"run_id": "r-123", "doc_count": 1000}, None)
    # 1000 docs * 4000 tok = 4M tok; 4M/1M * 0.02 = 0.08; * 1.10 overhead = 0.088.
    assert res["consumption_usd"] == 0.088
    # floor at low margin (1.1), credit_usd 0.30: ceil(0.088*1.1/0.30*10)/10
    # = ceil(3.2266)/10 = 0.4 credits.
    assert res["credits"] == 0.4
    assert res["run_id"] == "r-123"

    meta = next(p for p in table.puts if p.get("SK") == "META")
    assert meta["PK"] == "CONV#synergy-r-123"
    assert meta["GSI2SK"] == "CONV#synergy-r-123"
    assert meta["source"] == "synergy"
    # No user_sub in the event → tenant sentinel sub.
    assert meta["userSub"] == lf.SENTINEL_USER_SUB
    assert meta["GSI1PK"] == f"USER#{lf.SENTINEL_USER_SUB}"
    assert meta["dominantTier"] == lf.SYNERGY_DOMINANT_TIER
    # _to_dynamo coerces the fractional credit float to Decimal at write time.
    assert float(meta["creditsCharged"]) == 0.4
    assert float(meta["consumptionCostUsd"]) == 0.088
    assert meta["title"] == "Synergy crawl r-123"

    # The MONTH aggregate was recomputed for the tenant.
    assert any(
        str(p.get("SK", "")).startswith("MONTH#") and p.get("PK") == "CLIENT#testclient"
        for p in table.puts
    )


def test_explicit_user_sub_and_title_respected(monkeypatch):
    # A supplied user_sub overrides the sentinel; supplied title is used.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    lf.handler(
        {
            "run_id": "r-x",
            "doc_count": 1000,
            "user_sub": "real-user",
            "title": "Nightly crawl",
        },
        None,
    )
    meta = next(p for p in table.puts if p.get("SK") == "META")
    assert meta["userSub"] == "real-user"
    assert meta["GSI1PK"] == "USER#real-user"
    assert meta["title"] == "Nightly crawl"


def test_query_kind_meters_under_real_user_with_portfolio_pricing(monkeypatch):
    # (7) kind='query' → priced via portfolio_scan_cost_usd (NOT ingest), booked
    # under the REAL user_sub (never the sentinel), conv_id 'synergy-q-<run_id>',
    # source 'synergy', floor applied.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {
            "kind": "query",
            "run_id": "q-7",
            "user_sub": "real-querying-user",
            "scanned_count": 30000,
            "mode": "portfolio",
        },
        None,
    )
    # portfolio_scan_cost_usd(scanned=30000): rcu = 30000/1e6 * 0.25 = 0.0075;
    # (0.0075 + 0.002 fixed) * 1.10 overhead = 0.01045.
    from credit_pricing.synergy_pricing import portfolio_scan_cost_usd

    expected_usd = portfolio_scan_cost_usd(scanned_count=30000)
    assert expected_usd == 0.01045
    assert res["consumption_usd"] == expected_usd
    # floor at low margin (1.1), credit_usd 0.30:
    # ceil(0.01045 * 1.1 / 0.30 * 10) / 10 = ceil(0.38316) / 10 = 0.1 credits.
    assert res["credits"] == 0.1
    assert res["run_id"] == "q-7"

    meta = next(p for p in table.puts if p.get("SK") == "META")
    # Query CONV id is prefixed synergy-q- (distinct from the crawl's synergy-).
    assert meta["PK"] == "CONV#synergy-q-q-7"
    assert meta["GSI2SK"] == "CONV#synergy-q-q-7"
    assert meta["source"] == "synergy"
    # A query IS a user's consumption — booked under the REAL caller, NOT sentinel.
    assert meta["userSub"] == "real-querying-user"
    assert meta["userSub"] != lf.SENTINEL_USER_SUB
    assert meta["GSI1PK"] == "USER#real-querying-user"
    assert meta["dominantTier"] == lf.SYNERGY_DOMINANT_TIER
    assert float(meta["creditsCharged"]) == 0.1
    assert float(meta["consumptionCostUsd"]) == expected_usd
    # Default title carries the query mode.
    assert meta["title"] == "Synergy portfolio query"

    # The MONTH aggregate was recomputed for the tenant.
    assert any(
        str(p.get("SK", "")).startswith("MONTH#") and p.get("PK") == "CLIENT#testclient"
        for p in table.puts
    )


def test_query_kind_without_user_sub_is_skipped(monkeypatch):
    # A query with no user_sub must NOT fall back to the sentinel (a query is a
    # user consumption) — it is skipped with no ledger write.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {"kind": "query", "run_id": "q-no-user", "scanned_count": 30000}, None
    )
    assert res == {"skipped": "missing_user_sub"}
    assert table.puts == []


def test_query_kind_zero_scan_writes_nothing(monkeypatch):
    # A query that scanned nothing → cost ~0 → credits<=0 → early return, no write.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {
            "kind": "query",
            "run_id": "q-empty",
            "user_sub": "real-user",
            "scanned_count": 0,
        },
        None,
    )
    # Fixed overhead alone (0.002 * 1.10 = 0.0022) still floors to 0.1 credit, so
    # a zero-scan query is NOT free — assert it still meters under the real user.
    assert res["run_id"] == "q-empty"
    assert res["credits"] == 0.1
    meta = next(p for p in table.puts if p.get("SK") == "META")
    assert meta["userSub"] == "real-user"
    assert meta["PK"] == "CONV#synergy-q-q-empty"


def test_recompute_month_sums_gsi2_and_self_overrides(monkeypatch):
    # (6) _recompute_month sums GSI2 items but self-overrides the in-flight row
    # (the one whose GSI2SK matches the just-written conversation) with in-hand
    # values, since GSI2 is eventually consistent.
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    # One unrelated existing META row, plus a STALE copy of the in-flight conv
    # that must be ignored in favour of the in-hand credits/cost.
    gsi2 = [
        {
            "GSI2SK": "CONV#synergy-other",
            "creditsCharged": 2.0,
            "consumptionCostUsd": 0.5,
        },
        {
            "GSI2SK": "CONV#synergy-r-9",  # the in-flight conv, stale values
            "creditsCharged": 999.0,
            "consumptionCostUsd": 999.0,
        },
    ]
    table = FakeTable(gsi2_items=gsi2)
    _patch_table(monkeypatch, table)
    res = lf.handler({"run_id": "r-9", "doc_count": 1000}, None)

    this_credits = res["credits"]  # 0.4
    this_cost = res["consumption_usd"]  # 0.088

    agg = next(p for p in table.puts if str(p.get("SK", "")).startswith("MONTH#"))
    # Sum = other row (2.0 / 0.5) + in-hand (0.4 / 0.088); stale 999s excluded.
    assert float(agg["creditsCharged"]) == 2.0 + this_credits
    assert float(agg["consumptionCostUsd"]) == 0.5 + this_cost
    assert agg["PK"] == "CLIENT#testclient"
