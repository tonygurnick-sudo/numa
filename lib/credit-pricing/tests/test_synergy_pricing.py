"""Tests for Synergy crawl ingestion pricing + its cost-recovery floor integration."""

from credit_pricing.credits import CREDIT_USD, MARGINS_BY_TIER, floor_credits
from credit_pricing.synergy_pricing import (
    SYNERGY_AVG_TOKENS_PER_DOC,
    SYNERGY_EMBED_USD_PER_MTOKEN,
    SYNERGY_NIGHTLY_FIXED_USD,
    SYNERGY_OVERHEAD_MULT,
    SYNERGY_QUERY_FIXED_OVERHEAD_USD,
    SYNERGY_RCU_USD_PER_MILLION,
    SynergyNightlyRates,
    SynergyQueryRates,
    SynergyRates,
    nightly_aggregate_cost_usd,
    nightly_rates_from_config,
    portfolio_scan_cost_usd,
    query_rates_from_config,
    rates_from_config,
    synergy_ingest_cost_usd,
)


def test_doc_count_estimate_with_overhead():
    # 1000 docs * 4000 tok = 4M tok; 4M/1M * 0.02 = 0.08; * 1.10 overhead = 0.088
    usd = synergy_ingest_cost_usd(doc_count=1000)
    assert usd == round(
        (1000 * SYNERGY_AVG_TOKENS_PER_DOC / 1_000_000)
        * SYNERGY_EMBED_USD_PER_MTOKEN
        * SYNERGY_OVERHEAD_MULT,
        6,
    )


def test_chars_take_precedence_over_doc_count():
    # 4M chars / 4 = 1M tokens → 0.02 * 1.10 = 0.022, regardless of doc_count.
    usd = synergy_ingest_cost_usd(doc_count=999999, chars_extracted=4_000_000)
    assert usd == round(0.02 * SYNERGY_OVERHEAD_MULT, 6)


def test_explicit_tokens_take_precedence():
    usd = synergy_ingest_cost_usd(doc_count=0, est_tokens=1_000_000)
    assert usd == round(0.02 * SYNERGY_OVERHEAD_MULT, 6)


def test_empty_crawl_costs_nothing():
    assert synergy_ingest_cost_usd(doc_count=0) == 0.0
    assert synergy_ingest_cost_usd(doc_count=0, chars_extracted=0) == 0.0


def test_measured_zero_chars_bills_nothing_even_with_docs():
    # A crawl that VISITED docs but extracted no text (all images/unparseable)
    # embeds nothing → a measured chars_extracted=0 must meter 0.0, NOT fall
    # through to the doc_count*avg_tokens estimate. The doc_count estimate is
    # reserved for chars_extracted is None (truly unmeasured).
    assert synergy_ingest_cost_usd(doc_count=50, chars_extracted=0) == 0.0
    assert synergy_ingest_cost_usd(doc_count=50) > 0.0  # None → doc-count fallback


def test_overhead_strictly_above_raw_embed_cost():
    # The uplift means we always charge a little more than the bare embed cost,
    # covering the non-Bedrock cents.
    rates = SynergyRates(overhead_mult=1.0)
    bare = synergy_ingest_cost_usd(doc_count=1000, rates=rates)
    with_overhead = synergy_ingest_cost_usd(doc_count=1000)
    assert with_overhead > bare


def test_floor_recovers_cost():
    # The charged credits, valued back to USD, must cover the consumption cost
    # (that's the floor's contract — this is the "must at minimum cover" rule).
    usd = synergy_ingest_cost_usd(doc_count=100_000)
    credits = floor_credits(usd, margin=MARGINS_BY_TIER["low"], credit_usd=CREDIT_USD)
    assert credits * CREDIT_USD >= usd


def test_config_override():
    cfg = {"synergyRates": {"embedUsdPerMtoken": 0.10, "overheadMult": 1.25}}
    r = rates_from_config(cfg)
    assert r.embed_usd_per_mtoken == 0.10
    assert r.overhead_mult == 1.25
    # Unset keys fall back to anchors.
    assert r.avg_tokens_per_doc == SYNERGY_AVG_TOKENS_PER_DOC


def test_config_none_uses_anchors():
    r = rates_from_config(None)
    assert r.embed_usd_per_mtoken == SYNERGY_EMBED_USD_PER_MTOKEN
    assert r.overhead_mult == SYNERGY_OVERHEAD_MULT


# ── Structured-layer ops metering (portfolio queries + nightly aggregates) ──────


def test_portfolio_scan_cost_overhead_only_for_tiny_scan():
    # A small scan ≈ just the fixed overhead, uplifted.
    usd = portfolio_scan_cost_usd(scanned_count=10)
    expected = (
        (10 / 1_000_000) * SYNERGY_RCU_USD_PER_MILLION
        + SYNERGY_QUERY_FIXED_OVERHEAD_USD
    ) * SYNERGY_OVERHEAD_MULT
    assert usd == round(expected, 6)


def test_portfolio_scan_cost_scales_with_scanned_rows():
    small = portfolio_scan_cost_usd(scanned_count=100)
    big = portfolio_scan_cost_usd(scanned_count=5_000_000)
    assert big > small  # read-capacity component dominates at scale


def test_portfolio_scan_zero_is_overhead_floor():
    # Even a zero-row scan charges the fixed per-query overhead (uplifted), > 0.
    assert portfolio_scan_cost_usd(scanned_count=0) == round(
        SYNERGY_QUERY_FIXED_OVERHEAD_USD * SYNERGY_OVERHEAD_MULT, 6
    )


def test_nightly_cost_is_fixed_plus_scan():
    usd = nightly_aggregate_cost_usd(scanned_count=1_000_000)
    expected = (
        SYNERGY_NIGHTLY_FIXED_USD
        + (1_000_000 / 1_000_000) * SYNERGY_RCU_USD_PER_MILLION
    ) * SYNERGY_OVERHEAD_MULT
    assert usd == round(expected, 6)


def test_nightly_floor_recovers_cost():
    usd = nightly_aggregate_cost_usd(scanned_count=200_000)
    credits = floor_credits(usd, margin=MARGINS_BY_TIER["low"], credit_usd=CREDIT_USD)
    assert credits * CREDIT_USD >= usd


def test_query_and_nightly_config_overrides():
    qcfg = {"synergyQueryRates": {"rcuUsdPerMillion": 1.25, "fixedOverheadUsd": 0.0}}
    qr = query_rates_from_config(qcfg)
    assert qr.rcu_usd_per_million == 1.25
    assert qr.fixed_overhead_usd == 0.0
    assert qr.overhead_mult == SYNERGY_OVERHEAD_MULT  # unset → anchor

    ncfg = {"synergyNightlyRates": {"fixedUsdPerRun": 0.05}}
    nr = nightly_rates_from_config(ncfg)
    assert nr.fixed_usd_per_run == 0.05
    assert isinstance(nr, SynergyNightlyRates)

    assert isinstance(query_rates_from_config(None), SynergyQueryRates)
