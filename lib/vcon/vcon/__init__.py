"""Build IETF vCon conversation containers for Numa Voice calls.

A vCon (``draft-ietf-vcon-vcon-overview``) is the canonical, interoperable JSON
container for one conversation: top-level metadata + four arrays —
``parties`` / ``dialog`` / ``analysis`` / ``attachments``. This module produces
the **unsigned form** (a bare JSON object — explicitly permitted by the spec for
internal/trusted pipelines). JWS signing is a later, additive step.

Numa Voice maps a single SDR call onto a vCon like this:

* ``parties``     — [SDR agent (party 0), prospect (party 1)]. Numa-specific
                    fields (company, role tag, connect agent id) live under
                    ``party.meta`` so the object stays spec-clean.
* ``dialog``      — [recording (party 0+1, external ``url`` + ``content_hash``),
                    transcript (external ref)]. ``encoding: "none"`` = referenced,
                    not inlined.
* ``analysis``    — [transcript (with ``body.utterances``)]. Post-call analysis
                    (summary / objections / next_steps / call_quality) is patched
                    in LATER by the post-call agent — the processor and the agent
                    own disjoint sections of the same vCon.
* ``attachments`` — [recording-consent attestation, prospect context,
                    SDR disposition].

Design note: this is deliberately a tiny hand-rolled builder (no ``py-vcon``
runtime dependency). The processor Lambda only needs to *serialize* a fixed
shape; pulling in py-vcon's JWS/JWE crypto + pydantic would bloat the cold start
for a feature that is unsigned today. py-vcon may be used as a *dev-only* test
dependency to assert our output round-trips through their schema.
"""

import hashlib
import os
import time
from typing import Any, Optional

#: vCon syntax version we emit (the draft's current data-syntax version).
VCON_VERSION = "0.0.2"


def new_vcon_uuid() -> str:
    """A time-ordered UUIDv7 (RFC 9562) as a canonical hyphenated string.

    Time-ordered so a chronological listing of ``voice/vcons/{uuid}.json`` sorts
    by call time, and collision-free across calls. Implemented inline because
    ``uuid.uuid7`` only lands in the Python 3.14 stdlib.
    """
    unix_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand = os.urandom(10)
    b = bytearray(16)
    b[0:6] = unix_ms.to_bytes(6, "big")
    b[6] = 0x70 | (rand[0] & 0x0F)  # version 7 in the high nibble
    b[7] = rand[1]
    b[8] = 0x80 | (rand[2] & 0x3F)  # RFC 4122 variant
    b[9:16] = rand[3:10]
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def sha512_of_bytes(data: bytes) -> str:
    """Content hash in the vCon ``content_hash`` form: ``"sha-512:<hexdigest>"``."""
    return "sha-512:" + hashlib.sha512(data).hexdigest()


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop keys whose value is None/"" so the object stays minimal + spec-clean."""
    return {k: v for k, v in d.items() if v not in (None, "")}


def _sdr_party(sdr: Optional[dict[str, Any]]) -> dict[str, Any]:
    """parties[0] — the SDR agent. Always present (role:agent) even when the
    wrap-up never landed, so the parties array shape is stable."""
    sdr = sdr or {}
    meta = _clean(
        {
            "numa_party": "sdr",
            "connect_agent_id": sdr.get("agent_id"),
            "connect_username": sdr.get("connect_username") or sdr.get("agent_id"),
            "sub": sdr.get("sub"),
        }
    )
    return _clean(
        {
            "name": sdr.get("name"),
            "mailto": sdr.get("email"),
            "tel": sdr.get("tel"),
            "role": "agent",
            "meta": meta,
        }
    )


def _prospect_party(prospect: Optional[dict[str, Any]]) -> dict[str, Any]:
    """parties[1] — the prospect. At assembly time often only the phone is known
    (richer context is patched in later by the post-call agent that reads
    master_prospects.json)."""
    prospect = prospect or {}
    meta = _clean(
        {
            "numa_party": "prospect",
            "company_name": prospect.get("company_name"),
            "contact_title": prospect.get("contact_title"),
            "industry": prospect.get("industry"),
        }
    )
    return _clean(
        {
            "tel": prospect.get("phone"),
            "name": prospect.get("name"),
            "mailto": prospect.get("email"),
            "role": "customer",
            "meta": meta,
        }
    )


def build_vcon(
    *,
    uuid: Optional[str] = None,
    created_at: str,
    contact_id: str,
    subject: str = "",
    # recording dialog (external reference)
    recording_url: str,
    recording_filename: str = "",
    recording_content_hash: Optional[str] = None,
    call_start_iso: Optional[str] = None,
    duration_seconds: Optional[float] = None,
    # transcript dialog (external reference)
    transcript_url: str,
    transcript_filename: str = "",
    transcript_content_hash: Optional[str] = None,
    # transcript analysis body
    language_code: str = "",
    diarisation_ok: bool = False,
    detected_speaker_count: int = 0,
    speakers: Optional[dict[str, str]] = None,
    utterances: Optional[list[dict[str, Any]]] = None,
    # parties
    sdr: Optional[dict[str, Any]] = None,
    prospect: Optional[dict[str, Any]] = None,
    # attachments
    sdr_outcome: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Assemble the unsigned vCon for one Numa Voice call.

    Contains parties, dialog, the transcript ``analysis`` entry, and the
    attachments. The four post-call analysis entries (summary / objections /
    next_steps / call_quality) are intentionally NOT added here — they're patched
    in later by the post-call agent (two-writer model on disjoint sections).
    """
    vcon_uuid = uuid or new_vcon_uuid()
    sdr_outcome = sdr_outcome or {}

    recording_dialog = _clean(
        {
            "type": "recording",
            "start": call_start_iso,
            "duration": duration_seconds,
            "parties": [0, 1],
            "mimetype": "audio/wav",
            "filename": recording_filename,
            "url": recording_url,
            "content_hash": recording_content_hash,
            "encoding": "none",
        }
    )
    transcript_dialog = _clean(
        {
            "type": "transcript",
            "start": call_start_iso,
            "duration": duration_seconds,
            "parties": [0, 1],
            "mimetype": "application/json",
            "filename": transcript_filename,
            "url": transcript_url,
            "content_hash": transcript_content_hash,
            "encoding": "none",
        }
    )

    transcript_analysis = {
        "type": "transcript",
        "dialog": [0],
        "vendor": "aws-transcribe",
        "product": "StartTranscriptionJob",
        "mimetype": "application/json",
        "body": _clean(
            {
                "language_code": language_code,
                "diarisation_ok": diarisation_ok,
                "detected_speaker_count": detected_speaker_count,
                "speakers": speakers or {},
                "utterances": utterances or [],
            }
        ),
    }

    attachments: list[dict[str, Any]] = []
    if "recording_disclosed" in sdr_outcome:
        attachments.append(
            {
                "type": "recording_consent_attestation",
                "mimetype": "application/json",
                "party": 0,
                "body": _clean(
                    {
                        "recording_disclosed": sdr_outcome.get("recording_disclosed"),
                        "attested_by": (sdr or {}).get("email")
                        or (sdr or {}).get("agent_id"),
                        "attested_at": sdr_outcome.get("submitted_at"),
                        "source": "sdr_wrapup",
                    }
                ),
            }
        )
    # Prospect context (whatever is known at assembly time — usually just phone;
    # the post-call agent enriches it once it reads master_prospects.json).
    prospect_ctx = _clean(
        {
            "phone": (prospect or {}).get("phone") or sdr_outcome.get("prospect_phone"),
            "company_name": (prospect or {}).get("company_name"),
            "contact_name": (prospect or {}).get("name"),
            "contact_title": (prospect or {}).get("contact_title"),
            "industry": (prospect or {}).get("industry"),
        }
    )
    if prospect_ctx:
        attachments.append(
            {
                "type": "prospect_context",
                "mimetype": "application/json",
                "party": 1,
                "body": prospect_ctx,
            }
        )
    if sdr_outcome:
        attachments.append(
            {
                "type": "sdr_disposition",
                "mimetype": "application/json",
                "party": 0,
                "body": sdr_outcome,
            }
        )

    return {
        "vcon": VCON_VERSION,
        "uuid": vcon_uuid,
        "created_at": created_at,
        "updated_at": created_at,
        "subject": subject,
        "parties": [_sdr_party(sdr), _prospect_party(prospect)],
        "dialog": [recording_dialog, transcript_dialog],
        "analysis": [transcript_analysis],
        "attachments": attachments,
        # Numa-internal join key (the Connect contactId), kept under meta so the
        # top-level object stays spec-shaped.
        "meta": _clean({"numa_contact_id": contact_id}),
    }
