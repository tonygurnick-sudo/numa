"""Tests for the vCon builder — shape, party/dialog/analysis/attachment mapping,
and the degraded (no-outcome) path."""

import re

import vcon


def test_new_vcon_uuid_is_v7_and_time_ordered() -> None:
    a = vcon.new_vcon_uuid()
    b = vcon.new_vcon_uuid()
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", a
    )
    # Time-ordered: the first 48 bits encode the ms timestamp, so a <= b.
    assert a[:13] <= b[:13]
    assert a != b


def test_sha512_form() -> None:
    h = vcon.sha512_of_bytes(b"hello")
    assert h.startswith("sha-512:")
    assert len(h) == len("sha-512:") + 128


def _full_kwargs() -> dict:
    return dict(
        created_at="2026-06-12T02:14:51.022Z",
        contact_id="abc123",
        subject="SDR call — Acme",
        recording_url="s3://numa-acme-connect-recordings/recordings/abc123_20260612.wav",
        recording_filename="abc123_20260612.wav",
        recording_content_hash=vcon.sha512_of_bytes(b"wav"),
        call_start_iso="2026-06-12T02:13:40.000Z",
        duration_seconds=88.0,
        transcript_url="s3://numa-acme-data/documents/company/voice/transcripts/abc123.json",
        transcript_filename="voice/transcripts/abc123.json",
        transcript_content_hash=vcon.sha512_of_bytes(b"transcript"),
        language_code="en-NZ",
        diarisation_ok=True,
        detected_speaker_count=2,
        speakers={"spk_0": "sdr", "spk_1": "prospect"},
        utterances=[
            {"party": 0, "speaker": "spk_0", "start": 0.84, "end": 6.12, "text": "Hi"},
            {
                "party": 1,
                "speaker": "spk_1",
                "start": 6.40,
                "end": 9.05,
                "text": "Hello",
            },
        ],
        sdr={
            "name": "Tony Gurnick",
            "email": "tony@x.nz",
            "agent_id": "tony@x.nz",
            "sub": "sub-1",
        },
        prospect={
            "phone": "+6421234567",
            "company_name": "Acme",
            "contact_title": "Ops",
            "industry": "construction",
        },
        sdr_outcome={
            "contactId": "abc123",
            "outcome": "callback",
            "notes": "keen",
            "qualified": False,
            "prospect_phone": "+6421234567",
            "recording_disclosed": True,
            "submitted_at": "2026-06-12T02:15:05.000Z",
        },
    )


def test_build_vcon_full_shape() -> None:
    v = vcon.build_vcon(**_full_kwargs())

    assert v["vcon"] == vcon.VCON_VERSION
    assert re.fullmatch(r"[0-9a-f-]{36}", v["uuid"])
    assert v["created_at"] == v["updated_at"] == "2026-06-12T02:14:51.022Z"
    assert v["meta"]["numa_contact_id"] == "abc123"

    # parties: SDR (0) + prospect (1)
    assert len(v["parties"]) == 2
    sdr, prospect = v["parties"]
    assert sdr["role"] == "agent" and sdr["mailto"] == "tony@x.nz"
    assert (
        sdr["meta"]["numa_party"] == "sdr"
        and sdr["meta"]["connect_agent_id"] == "tony@x.nz"
    )
    assert prospect["role"] == "customer" and prospect["tel"] == "+6421234567"
    assert prospect["meta"]["company_name"] == "Acme"

    # dialog: recording (external ref) + transcript
    assert [d["type"] for d in v["dialog"]] == ["recording", "transcript"]
    rec = v["dialog"][0]
    assert rec["url"].endswith(".wav") and rec["encoding"] == "none"
    assert rec["content_hash"].startswith("sha-512:") and rec["parties"] == [0, 1]
    assert rec["duration"] == 88.0 and rec["start"] == "2026-06-12T02:13:40.000Z"

    # analysis: only the transcript entry at build time (post-call analysis patched later)
    assert [a["type"] for a in v["analysis"]] == ["transcript"]
    body = v["analysis"][0]["body"]
    assert body["diarisation_ok"] is True and body["detected_speaker_count"] == 2
    assert len(body["utterances"]) == 2 and body["utterances"][0]["start"] == 0.84

    # attachments: consent + prospect_context + disposition
    types = [a["type"] for a in v["attachments"]]
    assert types == [
        "recording_consent_attestation",
        "prospect_context",
        "sdr_disposition",
    ]
    assert v["attachments"][0]["body"]["recording_disclosed"] is True
    assert v["attachments"][2]["body"]["outcome"] == "callback"


def test_build_vcon_degraded_no_outcome() -> None:
    """No SDR wrap-up: parties array shape is still valid; no consent/disposition
    attachments; prospect party is bare."""
    kw = _full_kwargs()
    kw["sdr"] = None
    kw["prospect"] = None
    kw["sdr_outcome"] = None
    v = vcon.build_vcon(**kw)

    assert len(v["parties"]) == 2
    assert v["parties"][0]["role"] == "agent"  # always present
    assert v["parties"][1]["role"] == "customer"
    # No consent / disposition / prospect_context (nothing known).
    assert v["attachments"] == []
    # Transcript analysis still present.
    assert v["analysis"][0]["type"] == "transcript"


def test_prospect_context_falls_back_to_outcome_phone() -> None:
    kw = _full_kwargs()
    kw["prospect"] = None  # no enriched prospect, but outcome has the phone
    v = vcon.build_vcon(**kw)
    ctx = next(a for a in v["attachments"] if a["type"] == "prospect_context")
    assert ctx["body"]["phone"] == "+6421234567"
