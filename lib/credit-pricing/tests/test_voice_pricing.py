"""Tests for voice consumption pricing + its cost-recovery floor integration."""

import math

from credit_pricing.credits import FLOOR_STEPS_PER_CREDIT, floor_credits
from credit_pricing.voice_pricing import (
    VoiceRates,
    rates_from_config,
    voice_call_cost_usd,
)


def test_telephony_plus_transcribe():
    # 60s = 1 min → 0.040 (telephony) + 0.024 (transcribe) = 0.064
    assert voice_call_cost_usd(60, transcribed=True) == 0.064


def test_zero_and_none_duration_cost_nothing():
    assert voice_call_cost_usd(0) == 0.0
    assert voice_call_cost_usd(None) == 0.0
    assert voice_call_cost_usd(-5) == 0.0


def test_transcribe_optional():
    # telephony only (failed transcription) = 0.040/min
    assert voice_call_cost_usd(120, transcribed=False) == round(2 * 0.040, 6)


def test_contact_lens_adds_a_line():
    base = voice_call_cost_usd(60, transcribed=True, contact_lens=False)
    withcl = voice_call_cost_usd(60, transcribed=True, contact_lens=True)
    assert round(withcl - base, 6) == 0.015


def test_floor_credits_over_voice_cost():
    # A short call: cost 0.064 → cost-recovery floor at the 'low' margin (1.15),
    # credit_usd 0.30, rounded UP to the nearest tenth-credit (FLOOR_STEPS_PER_CREDIT).
    usd = voice_call_cost_usd(60, transcribed=True)
    credits = floor_credits(usd, margin=1.15, credit_usd=0.30)
    expected = (
        math.ceil(usd * 1.15 / 0.30 * FLOOR_STEPS_PER_CREDIT) / FLOOR_STEPS_PER_CREDIT
    )
    assert credits == expected
    assert credits > 0  # the floor always recovers a positive cost
    # Margin floor holds: the charged value never dips below consumption x margin.
    assert credits * 0.30 >= usd * 1.15


def test_rates_from_config_override():
    r = rates_from_config({"voiceRates": {"telephonyPerMin": 0.10}})
    assert isinstance(r, VoiceRates)
    assert r.telephony_per_min == 0.10
    # unset rates fall back to anchors
    assert r.transcribe_per_min == 0.024
