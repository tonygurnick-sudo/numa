"""Synergy KB crawl consumption pricing for the Numa Credit System.

Meters the cost of crawling a client's 12d Synergy instance into the Bedrock
knowledge base. The only MATERIAL cost is Bedrock embedding at ingestion (every
crawled document's text is embedded once). Everything else the crawl touches —
S3 PUT/storage of the corpus, the SQS FIFO queue, worker Lambda compute,
DynamoDB — is rounding error (cents), so rather than meter each we fold a small
flat ``overhead_mult`` uplift onto the embedding cost to cover it.

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
    elif chars_extracted is not None and chars_extracted > 0:
        tokens = float(chars_extracted) / max(r.chars_per_token, 1.0)
    elif doc_count and doc_count > 0:
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
