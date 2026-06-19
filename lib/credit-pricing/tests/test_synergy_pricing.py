"""Tests for Synergy crawl ingestion pricing + its cost-recovery floor integration."""

from credit_pricing.credits import CREDIT_USD, MARGINS_BY_TIER, floor_credits
from credit_pricing.synergy_pricing import (
    SYNERGY_AVG_TOKENS_PER_DOC,
    SYNERGY_EMBED_USD_PER_MTOKEN,
    SYNERGY_OVERHEAD_MULT,
    SynergyRates,
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
