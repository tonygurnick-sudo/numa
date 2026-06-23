"""Synergy KB crawl consumption pricing for the Numa Credit System.

Meters the cost of crawling a client's 12d Synergy instance into the Bedrock
knowledge base. The only MATERIAL cost is Bedrock embedding at ingestion (every
crawled document's text is embedded once). Everything else the crawl touches —
S3 PUT/storage of the corpus, the SQS FIFO queue, worker Lambda compute, and the
small DynamoDB write traffic (state rows + the exact-term inverted index) — is
sub-cent for typical jobs, so rather than meter each we fold a small flat
``overhead_mult`` uplift onto the embedding cost as acceptable rounding. NOTE the
exact-term index issues one write per (term, job): for a rare term-DENSE job the
term-write WCU can exceed the flat uplift, so that cost is knowingly slightly
under-recovered — see ``synergy-metering-and-scale-plan.md`` for the explicit
``terms_written`` meter we'd add if precise recovery is ever wanted.

Rates are WORKING ANCHORS — provisional USD; confirm with Asa before they harden
into customer-facing pricing (same posture as ``credits.py`` / ``voice_pricing``).
All overridable per-client (CONFIG row ``synergyRates``) + env. No FX (all USD).

The charged credits for a crawl are the cost-recovery FLOOR over this USD cost
(``credits.floor_credits``): the crawl has no value-tier — its worth is its
measured (estimated) cost, and the floor guarantees the charge always at least
recovers that cost at the configured price-per-credit.

NOTE: the embedding bill is structurally invisible to the crawler (Bedrock
ingests asynchronously after we drop files in S3), so this is an ESTIMATE from
the extracted text size, not a measured cost.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

# Provisional anchors. CONFIRM WITH ASA.
# Bedrock Titan Text Embeddings V2 list price is ~$0.02 / 1M input tokens; a
# pricier embedding model (e.g. Cohere) would raise this. ~4 chars/token is the
# usual English approximation; AVG_TOKENS_PER_DOC is the fallback when the worker
# didn't report extracted chars. OVERHEAD_MULT (>1) covers the non-Bedrock cents.
SYNERGY_EMBED_USD_PER_MTOKEN: float = 0.02
SYNERGY_CHARS_PER_TOKEN: float = 4.0
SYNERGY_AVG_TOKENS_PER_DOC: float = 4000.0
SYNERGY_OVERHEAD_MULT: float = 1.10


@dataclass(frozen=True)
class SynergyRates:
    embed_usd_per_mtoken: float = SYNERGY_EMBED_USD_PER_MTOKEN
    chars_per_token: float = SYNERGY_CHARS_PER_TOKEN
    avg_tokens_per_doc: float = SYNERGY_AVG_TOKENS_PER_DOC
    overhead_mult: float = SYNERGY_OVERHEAD_MULT


def synergy_ingest_cost_usd(
    *,
    doc_count: int,
    chars_extracted: Optional[int] = None,
    est_tokens: Optional[float] = None,
    rates: Optional[SynergyRates] = None,
) -> float:
    """USD consumption cost of one Synergy crawl run's ingestion (embedding).

    Token estimate precedence: explicit ``est_tokens`` → from ``chars_extracted``
    (``chars / chars_per_token``) → ``doc_count * avg_tokens_per_doc``. The
    ``overhead_mult`` uplift (applied to the USD basis, like ``AGENTCORE_MULT`` in
    ``processing.py``) folds in the negligible S3/SQS/Lambda costs. Returns 0.0
    when nothing was ingested (an empty/skipped crawl costs nothing to meter).
    """
    r = rates or SynergyRates()
    if est_tokens is not None:
        tokens = float(est_tokens)
    elif chars_extracted is not None:
        # A MEASURED char count — including a measured zero. A crawl that visited
        # docs but extracted no text (all images / unparseable) embeds nothing, so
        # it must meter ~0 and must NOT fall through to the doc_count estimate. The
        # ``tokens <= 0`` guard below turns chars==0 into a 0.0 charge. (Production
        # always sends an explicit int; the doc_count branch is the None fallback.)
        tokens = float(chars_extracted) / max(r.chars_per_token, 1.0)
    elif doc_count and doc_count > 0:
        # chars truly UNMEASURED (None) — estimate from doc count.
        tokens = float(doc_count) * r.avg_tokens_per_doc
    else:
        return 0.0
    if tokens <= 0:
        return 0.0
    usd = (tokens / 1_000_000.0) * r.embed_usd_per_mtoken
    return round(usd * r.overhead_mult, 6)


def rates_from_config(config: Optional[dict]) -> SynergyRates:
    """Build SynergyRates from a per-client CONFIG row's ``synergyRates`` map,
    falling back to env then the provisional anchors for any unset rate. Keeps
    Synergy pricing tunable per tenant exactly like creditUsd/margin/voiceRates."""
    sr = (config or {}).get("synergyRates") or {}

    def _f(key: str, env: str, default: float) -> float:
        try:
            v = sr.get(key)
            if v is not None:
                return float(v)
        except (TypeError, ValueError):
            pass
        try:
            ev = os.getenv(env)
            return float(ev) if ev is not None else default
        except (TypeError, ValueError):
            return default

    return SynergyRates(
        embed_usd_per_mtoken=_f(
            "embedUsdPerMtoken",
            "SYNERGY_EMBED_USD_PER_MTOKEN",
            SYNERGY_EMBED_USD_PER_MTOKEN,
        ),
        chars_per_token=_f(
            "charsPerToken", "SYNERGY_CHARS_PER_TOKEN", SYNERGY_CHARS_PER_TOKEN
        ),
        avg_tokens_per_doc=_f(
            "avgTokensPerDoc", "SYNERGY_AVG_TOKENS_PER_DOC", SYNERGY_AVG_TOKENS_PER_DOC
        ),
        overhead_mult=_f(
            "overheadMult", "SYNERGY_OVERHEAD_MULT", SYNERGY_OVERHEAD_MULT
        ),
    )


# ── Structured-layer ops metering (portfolio queries + nightly aggregates) ──────
#
# ⚠️ STAGED FOUNDATION — NOT YET WIRED. The functions below are intentionally
# defined ahead of their consumers: today only the crawl (``synergy_ingest_cost_usd``)
# is metered. The portfolio-query debit and the nightly-aggregate job are a planned
# later slice (see documentation/connectors/synergy-metering-and-scale-plan.md) and
# need Asa to confirm the rates before they go live. They are pure + side-effect-free,
# so they ship safely unused — do NOT treat "no callers" as a bug to delete, and do
# NOT wire them onto the live query path without the rate sign-off.
#
# The crawl's embedding is the big cost (above). The structured backbone adds two
# smaller, recurring costs that should still be credit-accounted so a tenant's
# Synergy footprint is fully attributed:
#   - portfolio queries  → a bounded DynamoDB scan (read-capacity)
#   - nightly aggregates → a whole-portfolio scan + a little Lambda compute
# Both are metered the same way as the crawl: USD estimate → cost-recovery floor
# at the configured price, source="synergy". Embedding TIERING needs no new meter —
# it changes how many chars get embedded, which the existing ingest cost already
# reflects (fewer chars ⇒ lower charge).
#
# WORKING ANCHORS — confirm with Asa. The internal RCU rate is deliberately below
# the AWS on-demand list (~$1.25 / 1M RCU) since the crawl runs provisioned/cheap.
SYNERGY_RCU_USD_PER_MILLION: float = 0.25
SYNERGY_QUERY_FIXED_OVERHEAD_USD: float = 0.002
SYNERGY_NIGHTLY_FIXED_USD: float = 0.01


@dataclass(frozen=True)
class SynergyQueryRates:
    rcu_usd_per_million: float = SYNERGY_RCU_USD_PER_MILLION
    fixed_overhead_usd: float = SYNERGY_QUERY_FIXED_OVERHEAD_USD
    overhead_mult: float = SYNERGY_OVERHEAD_MULT


@dataclass(frozen=True)
class SynergyNightlyRates:
    fixed_usd_per_run: float = SYNERGY_NIGHTLY_FIXED_USD
    rcu_usd_per_million: float = SYNERGY_RCU_USD_PER_MILLION
    overhead_mult: float = SYNERGY_OVERHEAD_MULT


def portfolio_scan_cost_usd(
    *, scanned_count: int, rates: Optional[SynergyQueryRates] = None
) -> float:
    """USD cost of one portfolio query — a fixed per-query overhead plus the
    read-capacity of the rows the scan touched (``scanned_count``, NOT the rows
    returned). Returns the overhead-uplifted USD; 0.0 for a no-op."""
    r = rates or SynergyQueryRates()
    if scanned_count is None or scanned_count <= 0:
        scanned_count = 0
    rcu_usd = (float(scanned_count) / 1_000_000.0) * r.rcu_usd_per_million
    usd = (rcu_usd + r.fixed_overhead_usd) * r.overhead_mult
    return round(usd, 6) if usd > 0 else 0.0


def nightly_aggregate_cost_usd(
    *, scanned_count: int, rates: Optional[SynergyNightlyRates] = None
) -> float:
    """USD cost of one nightly aggregate run — a fixed per-run cost (Lambda
    compute + EventBridge) plus the read-capacity of the full-portfolio scan."""
    r = rates or SynergyNightlyRates()
    scanned = max(int(scanned_count or 0), 0)
    rcu_usd = (float(scanned) / 1_000_000.0) * r.rcu_usd_per_million
    return round((r.fixed_usd_per_run + rcu_usd) * r.overhead_mult, 6)


def _rate_reader(sr: dict):
    def _f(key: str, env: str, default: float) -> float:
        try:
            v = sr.get(key)
            if v is not None:
                return float(v)
        except (TypeError, ValueError):
            pass
        try:
            ev = os.getenv(env)
            return float(ev) if ev is not None else default
        except (TypeError, ValueError):
            return default

    return _f


def query_rates_from_config(config: Optional[dict]) -> SynergyQueryRates:
    """Per-client portfolio-query rates from CONFIG ``synergyQueryRates`` → env → anchors."""
    _f = _rate_reader((config or {}).get("synergyQueryRates") or {})
    return SynergyQueryRates(
        rcu_usd_per_million=_f(
            "rcuUsdPerMillion",
            "SYNERGY_RCU_USD_PER_MILLION",
            SYNERGY_RCU_USD_PER_MILLION,
        ),
        fixed_overhead_usd=_f(
            "fixedOverheadUsd",
            "SYNERGY_QUERY_FIXED_OVERHEAD_USD",
            SYNERGY_QUERY_FIXED_OVERHEAD_USD,
        ),
        overhead_mult=_f(
            "overheadMult", "SYNERGY_OVERHEAD_MULT", SYNERGY_OVERHEAD_MULT
        ),
    )


def nightly_rates_from_config(config: Optional[dict]) -> SynergyNightlyRates:
    """Per-client nightly-aggregate rates from CONFIG ``synergyNightlyRates`` → env → anchors."""
    _f = _rate_reader((config or {}).get("synergyNightlyRates") or {})
    return SynergyNightlyRates(
        fixed_usd_per_run=_f(
            "fixedUsdPerRun", "SYNERGY_NIGHTLY_FIXED_USD", SYNERGY_NIGHTLY_FIXED_USD
        ),
        rcu_usd_per_million=_f(
            "rcuUsdPerMillion",
            "SYNERGY_RCU_USD_PER_MILLION",
            SYNERGY_RCU_USD_PER_MILLION,
        ),
        overhead_mult=_f(
            "overheadMult", "SYNERGY_OVERHEAD_MULT", SYNERGY_OVERHEAD_MULT
        ),
    )
