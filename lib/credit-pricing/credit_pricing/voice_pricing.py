"""Voice consumption pricing for the Numa Credit System.

Meters the **non-LLM** cost of a Numa Voice call — Connect telephony + Amazon
Transcribe (+ Contact Lens when enabled) — in USD. The LLM post-call analysis is
metered separately via the normal agent path (the post-call agent runs on the
workspace agent → ``maybe_emit_credit_event``), so it is deliberately NOT included
here — including it would double-count.

Rates are WORKING ANCHORS — provisional per-minute USD; confirm with Asa before
they harden into customer-facing pricing (same posture as ``credits.py``). All
overridable per-client (CONFIG row) + env. No FX anywhere (everything USD).

The charged credits for a call are the cost-recovery FLOOR over this USD cost
(``credits.floor_credits``): a call has no value-tier classification — its worth
is its measured cost.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Provisional per-minute USD anchors for AU/NZ outbound SDR dialing. CONFIRM WITH ASA.
# Telephony = Connect outbound + service-usage, all-in (AU/NZ DID). Transcribe = batch,
# standard tier. Contact Lens billed only when the per-tenant liveAssist path is on.
TELEPHONY_USD_PER_MIN: float = 0.040
TRANSCRIBE_USD_PER_MIN: float = 0.024
CONTACT_LENS_USD_PER_MIN: float = 0.015


@dataclass(frozen=True)
class VoiceRates:
    telephony_per_min: float = TELEPHONY_USD_PER_MIN
    transcribe_per_min: float = TRANSCRIBE_USD_PER_MIN
    contact_lens_per_min: float = CONTACT_LENS_USD_PER_MIN


def voice_call_cost_usd(
    duration_seconds: Optional[float],
    *,
    transcribed: bool = True,
    contact_lens: bool = False,
    rates: Optional[VoiceRates] = None,
) -> float:
    """USD consumption cost of one voice call: telephony + transcribe [+ contact lens].

    Transcribe + Contact Lens bill per audio-minute (~= the call duration); telephony
    per connected minute. Fractional minutes are used (the anchors are provisional, so
    per-minute rounding is below the noise floor). Returns 0.0 for a zero/None duration
    (e.g. a no-answer call costs nothing to meter)."""
    if not duration_seconds or duration_seconds <= 0:
        return 0.0
    r = rates or VoiceRates()
    minutes = float(duration_seconds) / 60.0
    cost = minutes * r.telephony_per_min
    if transcribed:
        cost += minutes * r.transcribe_per_min
    if contact_lens:
        cost += minutes * r.contact_lens_per_min
    return round(cost, 6)


def rates_from_config(config: Optional[dict]) -> VoiceRates:
    """Build a VoiceRates from a per-client CONFIG row's ``voiceRates`` map, falling
    back to the provisional anchors for any unset rate. Keeps voice pricing tunable
    per tenant exactly like creditUsd/margin/valueTiers."""
    vr = (config or {}).get("voiceRates") or {}

    def _f(key: str, default: float) -> float:
        try:
            v = vr.get(key)
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    return VoiceRates(
        telephony_per_min=_f("telephonyPerMin", TELEPHONY_USD_PER_MIN),
        transcribe_per_min=_f("transcribePerMin", TRANSCRIBE_USD_PER_MIN),
        contact_lens_per_min=_f("contactLensPerMin", CONTACT_LENS_USD_PER_MIN),
    )
