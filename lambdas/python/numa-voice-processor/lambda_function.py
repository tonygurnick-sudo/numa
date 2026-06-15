"""numa-voice-processor — Numa Voice call-recording pipeline (FEAT-159).

Event-driven and scale-to-zero — nothing polls and no Lambda is ever held open
waiting on Transcribe:

  1. S3 ObjectCreated (`.wav`) on the per-tenant call-recordings bucket
     (`numa-{client}-connect-recordings`, ap-southeast-2) → START a diarised
     Amazon Transcribe batch job and return immediately (sub-second).
  2. Amazon Transcribe emits a "Transcribe Job State Change" EventBridge event
     when the job finishes → COMPLETE branch fetches + formats the transcript
     (spk_0 = SDR / spk_1 = prospect) and writes a normalised transcript JSON
     under `transcripts/`.

Both branches are short invocations; between calls the function idles at zero.

The completion branch fires the Post-Call Processor agent via the native Connect
event source (numa.connector.connect → connector-event-dispatcher → runner),
folding in the SDR's wrap-up outcome from the OUTPUTS bucket when present.
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import unquote_plus, urlparse

import structlog

import aws_transcribe
import vcon
from prm import client as prm_client

logger = structlog.get_logger(__name__)

s3_client = prm_client("s3")
transcribe_client = prm_client("transcribe")
# CloudWatch lives in this Lambda's region (ap-southeast-2) — used to emit a
# custom metric on transcription failure so the silent failure can be alarmed.
cloudwatch_client = prm_client("cloudwatch")

VOICE_METRIC_NAMESPACE = os.environ.get("VOICE_METRIC_NAMESPACE", "NumaVoice")

TRANSCRIPTS_PREFIX = os.environ.get("TRANSCRIPTS_PREFIX", "transcripts/")
LANGUAGE_CODE = os.environ.get("NUMA_VOICE_LANGUAGE", "en-NZ")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")
# The connector-events bus + agent pipeline live in the CLIENT region, while
# this Lambda runs in ap-southeast-2 — so PutEvents targets the client region.
CONNECTOR_EVENT_BUS_NAME = os.environ.get("CONNECTOR_EVENT_BUS_NAME", "")
CLIENT_REGION = os.environ.get("CLIENT_REGION", "")
# Outputs bucket (CLIENT region) — the FE wrap-up panel writes the SDR's outcome
# to voice/outcomes/{contactId}.json; we fold it into the post-call event.
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET", "")
# DATA bucket (CLIENT region) — we write the normalised transcript into the
# company KB here so the post-call agent (client region) can read it via
# numa_files. The agents' file tools are client-region only; they cannot read
# the ap-southeast-2 recordings bucket.
DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
KB_ID = "company"
KB_TRANSCRIPTS_S3_PREFIX = os.environ.get(
    "KB_TRANSCRIPTS_S3_PREFIX", "documents/company/voice/transcripts/"
)
KB_TRANSCRIPTS_FILE_PREFIX = os.environ.get(
    "KB_TRANSCRIPTS_FILE_PREFIX", "voice/transcripts/"
)
# Canonical per-call vCon (IETF draft-ietf-vcon-vcon-overview), written alongside
# the transcript into the company KB (CLIENT region). KB_VCONS_S3_PREFIX is the S3
# key prefix; KB_VCONS_FILE_PREFIX is the numa_files path the post-call agent reads.
KB_VCONS_S3_PREFIX = os.environ.get(
    "KB_VCONS_S3_PREFIX", "documents/company/voice/vcons/"
)
KB_VCONS_FILE_PREFIX = os.environ.get("KB_VCONS_FILE_PREFIX", "voice/vcons/")
# Credit metering: after a call, meter its telephony+transcribe consumption into the
# Numa Credit ledger via the (client-region) numa-voice-credit-debit lambda. Same gate
# as the rest of the credit system; no-op unless both are set.
CREDIT_DEBIT_VOICE_LAMBDA_NAME = os.environ.get("CREDIT_DEBIT_VOICE_LAMBDA_NAME", "")
CREDIT_METERING_ENABLED = os.environ.get(
    "CREDIT_METERING_ENABLED", ""
).strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# FEAT-168: when Contact Lens analytics is enabled on the instance (liveAssist), its
# per-minute cost must be metered into credits too. The rate + math already exist
# (voice_pricing.contact_lens); this flag just tells the meter to count those minutes.
CONTACT_LENS_ENABLED = os.environ.get("CONTACT_LENS_ENABLED", "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

events_client = (
    prm_client("events", region=CLIENT_REGION)
    if CLIENT_REGION
    else prm_client("events")
)
# The credit-debit lambda runs in the CLIENT region (alongside the credit ledger).
lambda_client = (
    prm_client("lambda", region=CLIENT_REGION)
    if CLIENT_REGION
    else prm_client("lambda")
)
# Outputs + DATA buckets live in the client region; this Lambda runs in ap-southeast-2.
outputs_s3_client = (
    prm_client("s3", region=CLIENT_REGION) if CLIENT_REGION else s3_client
)
data_s3_client = outputs_s3_client

# Amazon Connect records the agent and customer on separate diarised speakers, so
# we EXPECT exactly 2 (spk_0=SDR, spk_1=prospect).
MAX_SPEAKERS = 2
# But we let Transcribe LABEL up to this many so a 3-way/multi-party call surfaces
# as >2 labels and trips the diarisation check below — capping the job at 2 would
# force-merge a third participant into spk_0/spk_1 and record it as diarisation_ok
# (the silent mis-attribution the check is meant to catch). Transcribe range: 2–10.
TRANSCRIBE_MAX_SPEAKER_LABELS = 10


def _job_name(key: str) -> str:
    """Deterministic, Transcribe-safe job name (^[0-9a-zA-Z._-]+, <=200 chars).

    The `numa-voice-{client}-` prefix is what the EventBridge rule filters on, so
    the completion handler only ever sees this feature's jobs (not, e.g., the
    unrelated jobs started by extract-content-from-file in the same account).
    """
    safe = re.sub(r"[^0-9a-zA-Z._-]", "-", key)
    return f"numa-voice-{CLIENT_NAME}-{safe}"[:200]


def _raw_output_key(job_name: str) -> str:
    """Where Transcribe writes its raw output JSON (derivable from the job name
    alone, so the completion handler needs no extra state)."""
    return f"{TRANSCRIPTS_PREFIX}{job_name}.transcribe.json"


def _contact_id(key: str) -> str:
    """Best-effort Amazon Connect contactId from the recording key
    (`.../​<contactId>_<ts>.wav`). Empty if not parseable."""
    base = re.sub(r"\.[^.]+$", "", key.rsplit("/", 1)[-1])
    return base.split("_", 1)[0] if base else ""


def _load_sdr_outcome(contact_id: str) -> dict[str, Any]:
    """Best-effort read of the SDR wrap-up outcome the FE wrote to the OUTPUTS
    bucket (voice/outcomes/{contactId}.json, client region). Empty dict if absent
    (the wrap-up is optional / may not have landed yet)."""
    if not contact_id or not OUTPUTS_BUCKET:
        return {}
    try:
        resp = outputs_s3_client.get_object(
            Bucket=OUTPUTS_BUCKET, Key=f"voice/outcomes/{contact_id}.json"
        )
        return json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:  # noqa: BLE001 — outcome is optional context, never block on it
        return {}


# ── Branch 1: S3 ObjectCreated → start the job (fire-and-forget) ───────────────


def _start(bucket: str, key: str) -> dict[str, Any]:
    job_name = _job_name(key)
    aws_transcribe.start_transcription_job(
        job_name=job_name,
        media_uri=f"s3://{bucket}/{key}",
        max_speakers=TRANSCRIBE_MAX_SPEAKER_LABELS,
        language_code=LANGUAGE_CODE,
        output_bucket=bucket,
        output_key=_raw_output_key(job_name),
    )
    logger.info(
        "Transcription job started",
        _name="VOICE_TRANSCRIBE_START",
        bucket=bucket,
        key=key,
        job_name=job_name,
        contact_id=_contact_id(key),
        language_code=LANGUAGE_CODE,
    )
    return {"job_name": job_name}


def _is_job_name_conflict(exc: Exception) -> bool:
    """True when the failure is Transcribe's ConflictException (a job with this
    name already exists) — the idempotent re-delivery case. aws_transcribe wraps
    the boto3 ClientError in TranscriptionError, so the code lives on __cause__."""
    cause = exc.__cause__ if exc.__cause__ is not None else exc
    response = getattr(cause, "response", None) or {}
    return response.get("Error", {}).get("Code", "") == "ConflictException"


def _handle_s3(event: dict[str, Any]) -> dict[str, Any]:
    started: list[dict[str, Any]] = []
    for record in event.get("Records", []):
        s3 = record.get("s3", {})
        bucket = s3.get("bucket", {}).get("name", "")
        key = unquote_plus(s3.get("object", {}).get("key", ""))
        if not key.lower().endswith(".wav") or key.startswith(TRANSCRIPTS_PREFIX):
            logger.info("Skipping object", _name="VOICE_SKIP", key=key)
            continue
        try:
            started.append(_start(bucket, key))
        except Exception as exc:
            # Only ConflictException (job name already exists) is idempotent
            # success — an S3 re-delivery hit a job we already started. Anything
            # else (throttling, service unavailable, bad params) must propagate
            # so Lambda's automatic retries + DLQ handle it; swallowing it here
            # would mean the recording is never transcribed and the post-call
            # agent never fires.
            if _is_job_name_conflict(exc):
                logger.info(
                    "Transcription job already started (idempotent re-delivery)",
                    _name="VOICE_START_CONFLICT",
                    bucket=bucket,
                    key=key,
                    job_name=_job_name(key),
                )
                started.append({"job_name": _job_name(key), "conflict": True})
            else:
                logger.exception(
                    "Failed to start transcription",
                    _name="VOICE_START_ERROR",
                    bucket=bucket,
                    key=key,
                    error=str(exc),
                )
                raise
    return {"started": len(started), "jobs": started}


# ── Branch 2: Transcribe Job State Change → fetch + write transcript ───────────


def _emit_transcription_failed_metric() -> None:
    """Publish a CloudWatch custom metric so a failed transcription is alarmable
    rather than a silent failure. Best-effort — wrapped so a metric/IAM error
    can never mask the original failure handling (degraded post-call dispatch)."""
    try:
        cloudwatch_client.put_metric_data(
            Namespace=VOICE_METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "TranscriptionFailed",
                    "Dimensions": [{"Name": "ClientName", "Value": CLIENT_NAME}],
                    "Value": 1,
                    "Unit": "Count",
                }
            ],
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — metric is observability-only, never block on it
        logger.warning(
            "Failed to emit TranscriptionFailed metric",
            _name="VOICE_METRIC_EMIT_ERROR",
            client_name=CLIENT_NAME,
            error=str(exc),
        )


def _emit_diarisation_metric() -> None:
    """Publish a CloudWatch metric when Transcribe did not return exactly 2
    speakers, so a corrupted SDR/prospect mapping is alarmable. Best-effort."""
    try:
        cloudwatch_client.put_metric_data(
            Namespace=VOICE_METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "DiarisationUnexpected",
                    "Dimensions": [{"Name": "ClientName", "Value": CLIENT_NAME}],
                    "Value": 1,
                    "Unit": "Count",
                }
            ],
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — metric is observability-only, never block on it
        logger.warning(
            "Failed to emit DiarisationUnexpected metric",
            _name="VOICE_METRIC_EMIT_ERROR",
            client_name=CLIENT_NAME,
            error=str(exc),
        )


def _call_times(
    job: dict[str, Any],
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """Derive absolute call start/end + duration from the Transcribe job.

    Connect writes the recording right after the call ends and we start the
    Transcribe job on that S3 event, so the job CreationTime ≈ call end, and
    start = end − duration. Exact per-call timing arrives later with the Phase-3
    contact-events pipeline; this is a reliable approximation in the meantime."""
    duration = job.get("MediaLengthSeconds")
    # `is not None` — a voicemail / no-answer call has duration 0, which is REAL,
    # not "unknown". The old `if duration` dropped it (0 is falsy), which then left
    # start_iso None and made the call invisible to the analytics date filter.
    duration_f = float(duration) if duration is not None else None
    creation = job.get("CreationTime")  # boto3 returns a datetime
    end_iso = creation.isoformat() if isinstance(creation, datetime) else None
    start_iso = None
    if isinstance(creation, datetime):
        # start = end − duration; for a 0/None-duration call start == the recording
        # timestamp, so it is ALWAYS set when the job has a CreationTime.
        start_iso = (creation - timedelta(seconds=duration_f or 0.0)).isoformat()
    return start_iso, end_iso, duration_f


def _write_vcon(
    *,
    contact_id: str,
    recording_bucket: str,
    recording_key: str,
    transcript_s3_key: str,
    transcript_kb_file: str,
    transcript_bytes: bytes,
    language_code: str,
    diarisation_ok: bool,
    detected_speaker_count: int,
    utterances: list[dict[str, Any]],
    call_start_iso: Optional[str],
    duration_seconds: Optional[float],
    sdr_outcome: dict[str, Any],
) -> tuple[str, str]:
    """Assemble + write the canonical vCon (+ contactId→uuid index pointer) into
    the company KB. Additive: any failure degrades to no-vCon and NEVER breaks the
    transcript / post-call pipeline. Returns (vcon_uuid, vcon_kb_file) or ("","")."""
    if not DATA_BUCKET:
        return "", ""
    try:
        vcon_uuid = vcon.new_vcon_uuid()
        outcome = str(sdr_outcome.get("outcome") or "")
        subject = f"SDR call {contact_id}".strip()
        if outcome:
            subject = f"{subject} ({outcome})"
        vcon_obj = vcon.build_vcon(
            uuid=vcon_uuid,
            created_at=datetime.now(timezone.utc).isoformat(),
            contact_id=contact_id,
            subject=subject,
            recording_url=f"s3://{recording_bucket}/{recording_key}",
            recording_filename=recording_key.rsplit("/", 1)[-1],
            call_start_iso=call_start_iso,
            duration_seconds=duration_seconds,
            transcript_url=f"s3://{DATA_BUCKET}/{transcript_s3_key}",
            transcript_filename=transcript_kb_file,
            transcript_content_hash=vcon.sha512_of_bytes(transcript_bytes),
            language_code=language_code,
            diarisation_ok=diarisation_ok,
            detected_speaker_count=detected_speaker_count,
            speakers={"spk_0": "sdr", "spk_1": "prospect"},
            utterances=utterances,
            # The FE wrap-up (step 7) writes the SDR's identity into the outcome;
            # absent on legacy calls, build_vcon degrades the party gracefully.
            sdr={
                "agent_id": sdr_outcome.get("agent_id"),
                "email": sdr_outcome.get("agent_email"),
                "name": sdr_outcome.get("agent_name"),
                "sub": sdr_outcome.get("sdr_sub"),
            },
            # company_name / contact name come from the FE outcome (or the pre-wrap-up
            # stub) so the call log's Company / contact columns populate even when the
            # SDR skipped the wrap-up. build_vcon maps them into parties[1].
            prospect={
                "phone": sdr_outcome.get("prospect_phone"),
                "company_name": sdr_outcome.get("company_name"),
                "name": sdr_outcome.get("contact_name"),
            },
            sdr_outcome=sdr_outcome,
        )
        vcon_s3_key = f"{KB_VCONS_S3_PREFIX}{vcon_uuid}.json"
        vcon_kb_file = f"{KB_VCONS_FILE_PREFIX}{vcon_uuid}.json"
        data_s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=vcon_s3_key,
            Body=json.dumps(vcon_obj, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        # contactId → uuid pointer so the late-outcome re-assembly + any consumer
        # resolves a vCon from the Connect contactId without a list/scan.
        if contact_id:
            data_s3_client.put_object(
                Bucket=DATA_BUCKET,
                Key=f"{KB_VCONS_S3_PREFIX}index/{contact_id}.json",
                Body=json.dumps(
                    {
                        "vcon_uuid": vcon_uuid,
                        "vcon_key": vcon_s3_key,
                        "vcon_kb_file": vcon_kb_file,
                        "updated_at": vcon_obj["updated_at"],
                    }
                ).encode("utf-8"),
                ContentType="application/json",
            )
        logger.info(
            "vCon written",
            _name="VOICE_VCON_WRITTEN",
            contact_id=contact_id,
            vcon_uuid=vcon_uuid,
            vcon_key=vcon_s3_key,
        )
        return vcon_uuid, vcon_kb_file
    except (
        Exception
    ) as exc:  # noqa: BLE001 — vCon is additive; never break the pipeline
        logger.exception(
            "Failed to assemble/write vCon (continuing without it)",
            _name="VOICE_VCON_ERROR",
            contact_id=contact_id,
            error=str(exc),
        )
        return "", ""


def _read_vcon_index(contact_id: str) -> Optional[dict[str, Any]]:
    """Resolve the vCon for a Connect contactId via the pointer the assembler wrote.
    None when the vCon hasn't been assembled yet (transcript not done)."""
    if not (contact_id and DATA_BUCKET):
        return None
    try:
        resp = data_s3_client.get_object(
            Bucket=DATA_BUCKET, Key=f"{KB_VCONS_S3_PREFIX}index/{contact_id}.json"
        )
        return json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:  # noqa: BLE001 — absent index = not assembled yet
        return None


def _patch_vcon_with_outcome(contact_id: str, outcome: dict[str, Any]) -> bool:
    """Patch an already-written vCon with a late-arriving SDR wrap-up: the SDR
    party identity, the prospect tel, and the disposition + consent attachments.

    Idempotent (full-object overwrite by stable uuid). Touches only the sections
    the processor owns — it never disturbs the post-call agent's analysis entries
    (two-writer model). Returns True when patched, False when there's no vCon yet
    (the eventual transcript completion will fold the outcome in instead)."""
    idx = _read_vcon_index(contact_id)
    if not idx or not idx.get("vcon_key"):
        return False
    vcon_key = idx["vcon_key"]
    try:
        resp = data_s3_client.get_object(Bucket=DATA_BUCKET, Key=vcon_key)
        v = json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to read vCon for late-outcome patch",
            _name="VOICE_VCON_PATCH_READ_ERROR",
            contact_id=contact_id,
            vcon_key=vcon_key,
        )
        return False

    parties = v.get("parties") or []
    if parties and isinstance(parties[0], dict):  # SDR party (0)
        if outcome.get("agent_email") and not parties[0].get("mailto"):
            parties[0]["mailto"] = outcome["agent_email"]
        if outcome.get("agent_name") and not parties[0].get("name"):
            parties[0]["name"] = outcome["agent_name"]
        meta = parties[0].setdefault("meta", {})
        if outcome.get("agent_id"):
            meta.setdefault("connect_agent_id", outcome["agent_id"])
        if outcome.get("sdr_sub"):
            meta.setdefault("sub", outcome["sdr_sub"])
    if len(parties) > 1 and isinstance(parties[1], dict):  # prospect party (1)
        if outcome.get("prospect_phone") and not parties[1].get("tel"):
            parties[1]["tel"] = outcome["prospect_phone"]
        if outcome.get("contact_name") and not parties[1].get("name"):
            parties[1]["name"] = outcome["contact_name"]
        p_meta = parties[1].setdefault("meta", {})
        if outcome.get("company_name"):
            p_meta.setdefault("company_name", outcome["company_name"])
    v["parties"] = parties

    # Replace the processor-owned attachments (disposition + consent); leave any
    # others (e.g. prospect_context) untouched.
    atts = [
        a
        for a in (v.get("attachments") or [])
        if a.get("type") not in ("sdr_disposition", "recording_consent_attestation")
    ]
    atts.append(
        {
            "type": "sdr_disposition",
            "mimetype": "application/json",
            "party": 0,
            "body": outcome,
        }
    )
    if "recording_disclosed" in outcome:
        atts.append(
            {
                "type": "recording_consent_attestation",
                "mimetype": "application/json",
                "party": 0,
                "body": {
                    "recording_disclosed": outcome.get("recording_disclosed"),
                    "attested_by": outcome.get("agent_email")
                    or outcome.get("agent_id"),
                    "attested_at": outcome.get("submitted_at"),
                    "source": "sdr_wrapup",
                },
            }
        )
    v["attachments"] = atts
    v["updated_at"] = datetime.now(timezone.utc).isoformat()

    data_s3_client.put_object(
        Bucket=DATA_BUCKET,
        Key=vcon_key,
        Body=json.dumps(v, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    data_s3_client.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{KB_VCONS_S3_PREFIX}index/{contact_id}.json",
        Body=json.dumps({**idx, "updated_at": v["updated_at"]}).encode("utf-8"),
        ContentType="application/json",
    )
    logger.info(
        "vCon patched with late SDR outcome",
        _name="VOICE_VCON_PATCHED",
        contact_id=contact_id,
        vcon_key=vcon_key,
    )
    return True


def _handle_outcome(event: dict[str, Any]) -> dict[str, Any]:
    """S3 ObjectCreated on the OUTPUTS bucket voice/outcomes/ prefix: a late SDR
    wrap-up landed after the vCon was assembled — patch the canonical record."""
    patched = 0
    for record in event.get("Records", []):
        key = unquote_plus(record.get("s3", {}).get("object", {}).get("key", ""))
        match = re.match(r"voice/outcomes/(.+)\.json$", key)
        if not match:
            continue
        contact_id = match.group(1)
        outcome = _load_sdr_outcome(contact_id)
        if outcome and _patch_vcon_with_outcome(contact_id, outcome):
            patched += 1
    return {"patched": patched}


def _emit_voice_credit_event(
    contact_id: str,
    sdr_outcome: dict[str, Any],
    duration_seconds: Optional[float],
    *,
    transcribed: bool,
) -> None:
    """Meter the call's telephony+transcribe consumption into the Numa Credit ledger
    (fire-and-forget async invoke of numa-voice-credit-debit, CLIENT region).

    Gated by CREDIT_METERING_ENABLED. Best-effort — metering must NEVER affect the
    voice pipeline. Needs the SDR identity (sdr_sub, captured in the wrap-up) and a
    non-zero duration; a no-answer / unattributed call meters nothing."""
    if not (CREDIT_METERING_ENABLED and CREDIT_DEBIT_VOICE_LAMBDA_NAME):
        return
    user_sub = str(sdr_outcome.get("sdr_sub") or "")
    if not (contact_id and user_sub and duration_seconds and duration_seconds > 0):
        return
    try:
        lambda_client.invoke(
            FunctionName=CREDIT_DEBIT_VOICE_LAMBDA_NAME,
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "contact_id": contact_id,
                    "user_sub": user_sub,
                    "duration_seconds": duration_seconds,
                    "transcribed": transcribed,
                    "contact_lens": CONTACT_LENS_ENABLED,
                }
            ).encode("utf-8"),
        )
        logger.info(
            "Voice credit metering emitted",
            _name="VOICE_CREDIT_EMIT",
            contact_id=contact_id,
            duration_seconds=duration_seconds,
        )
    except Exception as exc:  # noqa: BLE001 — metering must never affect the pipeline
        logger.warning(
            "Voice credit emit failed",
            _name="VOICE_CREDIT_EMIT_FAIL",
            contact_id=contact_id,
            error=str(exc),
        )


def _handle_completion(event: dict[str, Any]) -> dict[str, Any]:
    detail = event.get("detail", {})
    job_name = detail.get("TranscriptionJobName", "")
    status = detail.get("TranscriptionJobStatus", "")

    # Resolve the recording + contact from the job (needed for both COMPLETED and
    # FAILED so the degraded path can still fold in the SDR's manual outcome).
    try:
        job = transcribe_client.get_transcription_job(TranscriptionJobName=job_name)[
            "TranscriptionJob"
        ]
    except Exception:  # noqa: BLE001
        # get_transcription_job is the ONLY source of the recording URI → contact_id
        # for BOTH branches (the EventBridge detail carries only the job name +
        # status). Swallowing it and continuing with job={} loses contact_id, so even
        # the FAILED branch's degraded path would fire with an empty prospect_phone /
        # sdr_outcome — silently dropping a prospect the SDR already qualified. A
        # failure here is almost always transient (the job demonstrably exists — that
        # is why the event fired; Transcribe retains FAILED jobs ~90 days), so always
        # re-raise to trigger Lambda's retries + the DLQ rather than degrade blind.
        logger.exception(
            "get_transcription_job failed; retrying so the contact can be recovered",
            _name="VOICE_GET_JOB_ERROR",
            job_name=job_name,
            status=status,
        )
        raise
    parsed = urlparse(job.get("Media", {}).get("MediaFileUri", ""))
    recording_bucket = parsed.netloc
    recording_key = parsed.path.lstrip("/")
    contact_id = _contact_id(recording_key)
    sdr_outcome = _load_sdr_outcome(contact_id)
    language_code = job.get("LanguageCode", LANGUAGE_CODE)

    if status != "COMPLETED":
        # Degraded path: a failed transcription still fires the post-call/promoter
        # agents with the SDR's already-captured wrap-up outcome, so a qualified
        # prospect is not silently dropped. No transcript_kb_file.
        logger.error(
            "Transcription job did not complete",
            _name="VOICE_TRANSCRIBE_FAILED",
            job_name=job_name,
            status=status,
            contact_id=contact_id,
            failure_reason=job.get("FailureReason"),
        )
        # Emit a CloudWatch metric so this otherwise-silent failure can be alarmed.
        # Best-effort: it must never mask the degraded post-call dispatch below.
        _emit_transcription_failed_metric()
        _emit_post_call_event(
            contact_id=contact_id,
            recording_bucket=recording_bucket,
            transcript_kb_file="",
            language_code=language_code,
            sdr_outcome=sdr_outcome,
            transcription_failed=True,
            job_name=job_name,
        )
        return {"status": status, "job_name": job_name, "contact_id": contact_id}

    # Fetch + persist the transcript. If EITHER step fails, fall back to the
    # degraded path (emit with no transcript_kb_file) so the SDR's already-captured
    # wrap-up outcome still drives the post-call/promoter agents — a transient
    # fetch/write failure must not silently drop a qualified prospect.
    stem = contact_id or job_name
    kb_s3_key = f"{KB_TRANSCRIPTS_S3_PREFIX}{stem}.json"
    transcript_kb_file = f"{KB_TRANSCRIPTS_FILE_PREFIX}{stem}.json"
    try:
        transcript_text, detected_speakers, utterances = (
            aws_transcribe.fetch_utterances_with_speakers(
                recording_bucket, _raw_output_key(job_name)
            )
        )
        call_start_iso, call_end_iso, duration_seconds = _call_times(job)
        # Transcribe's MediaLengthSeconds comes back 0/absent on real connected calls
        # (not just voicemails). Without a real duration the credit meter's `duration > 0`
        # guard silently drops the call AND the call log shows no Duration. Fall back to
        # the transcript's last utterance end time — a reliable call length whenever there
        # was any speech (a pure no-answer has no utterances and legitimately meters nothing).
        if not duration_seconds:
            _ends = [
                end
                for u in utterances
                if isinstance((end := u.get("end")), (int, float))
            ]
            if _ends:
                duration_seconds = max(_ends)
        # Diarisation validation: the static spk_0=SDR / spk_1=prospect mapping is
        # only valid when Transcribe produced EXACTLY 2 speakers. A voicemail (1) or
        # a 3-way call (3+) would silently corrupt the mapping — flag it on the
        # record and alarm via a metric instead of asserting a false truth. We still
        # write the transcript (it remains useful), just marked as unverified.
        diarisation_ok = len(detected_speakers) == MAX_SPEAKERS
        if not diarisation_ok:
            logger.warning(
                "Unexpected speaker count from Transcribe diarisation",
                _name="VOICE_DIARISATION_UNEXPECTED",
                job_name=job_name,
                contact_id=contact_id,
                expected=MAX_SPEAKERS,
                detected=len(detected_speakers),
                speakers=detected_speakers,
            )
            _emit_diarisation_metric()
        transcript_doc = {
            "_name": "VOICE_TRANSCRIPT",
            "client": CLIENT_NAME,
            "recording_bucket": recording_bucket,
            "recording_key": recording_key,
            "contact_id": contact_id,
            "language_code": language_code,
            "speakers": {"spk_0": "sdr", "spk_1": "prospect"},
            "detected_speaker_count": len(detected_speakers),
            "diarisation_ok": diarisation_ok,
            "transcript": transcript_text,
            # Per-utterance turns with timestamps (additive) — also feed the vCon.
            "utterances": utterances,
            # SDR's in-UI wrap-up selections (outcome / notes / qualified), if captured.
            "sdr_outcome": sdr_outcome,
            "started_at": call_start_iso,
            "ended_at": call_end_iso,
            "metadata": {
                "job_name": job_name,
                # Use the resolved duration (with the utterance-end fallback) so the call
                # log's Duration column populates even when MediaLengthSeconds is 0.
                "duration": duration_seconds or 0,
                "file_format": job.get("MediaFormat"),
                "language_code": language_code,
            },
            "transcribed_at": datetime.now(timezone.utc).isoformat(),
        }
        if not DATA_BUCKET:
            raise RuntimeError(
                "DATA_BUCKET not configured; cannot write transcript to KB"
            )
        # Write into the company KB in the CLIENT region so the post-call agent can
        # read it by exact path via numa_files (strongly consistent — no index lag).
        transcript_bytes = json.dumps(transcript_doc, ensure_ascii=False).encode(
            "utf-8"
        )
        data_s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=kb_s3_key,
            Body=transcript_bytes,
            ContentType="application/json",
        )
        # Assemble the canonical vCon (additive — never breaks the pipeline).
        vcon_uuid, vcon_kb_file = _write_vcon(
            contact_id=contact_id,
            recording_bucket=recording_bucket,
            recording_key=recording_key,
            transcript_s3_key=kb_s3_key,
            transcript_kb_file=transcript_kb_file,
            transcript_bytes=transcript_bytes,
            language_code=language_code,
            diarisation_ok=diarisation_ok,
            detected_speaker_count=len(detected_speakers),
            utterances=utterances,
            call_start_iso=call_start_iso,
            duration_seconds=duration_seconds,
            sdr_outcome=sdr_outcome,
        )
        # Meter the call's telephony + transcribe consumption into the credit ledger
        # (fire-and-forget; gated + best-effort). The LLM post-call summary is metered
        # separately via the agent path, so it is NOT included here.
        _emit_voice_credit_event(
            contact_id, sdr_outcome, duration_seconds, transcribed=True
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — degrade, don't drop the qualified prospect
        logger.exception(
            "Failed to fetch/write transcript; emitting degraded post-call event",
            _name="VOICE_TRANSCRIPT_ERROR",
            job_name=job_name,
            contact_id=contact_id,
            error=str(exc),
        )
        # A COMPLETED-but-unwritable transcript degrades every call identically to a
        # FAILED job (post-call agent runs with no transcript). Without this metric it
        # is the ONLY transcript-loss path with zero alarm coverage — a systematic
        # cause (DATA_BUCKET/KMS/IAM/prefix misconfig) would be wholly silent. Emit the
        # same alarmable signal as the FAILED branch. Best-effort (never masks dispatch).
        _emit_transcription_failed_metric()
        _emit_post_call_event(
            contact_id=contact_id,
            recording_bucket=recording_bucket,
            transcript_kb_file="",
            language_code=language_code,
            sdr_outcome=sdr_outcome,
            transcription_failed=True,
            job_name=job_name,
        )
        return {
            "status": "TRANSCRIPT_ERROR",
            "job_name": job_name,
            "contact_id": contact_id,
        }

    logger.info(
        "Transcript written to KB",
        _name="VOICE_TRANSCRIBE_COMPLETE",
        data_bucket=DATA_BUCKET,
        kb_s3_key=kb_s3_key,
        contact_id=contact_id,
        duration=transcript_doc["metadata"]["duration"],
    )

    _emit_post_call_event(
        contact_id=contact_id,
        recording_bucket=recording_bucket,
        transcript_kb_file=transcript_kb_file,
        language_code=language_code,
        sdr_outcome=sdr_outcome,
        transcription_failed=False,
        job_name=job_name,
        vcon_uuid=vcon_uuid,
        vcon_kb_file=vcon_kb_file,
    )
    return {
        "transcript_kb_file": transcript_kb_file,
        "vcon_kb_file": vcon_kb_file,
        "contact_id": contact_id,
    }


def _emit_post_call_event(
    *,
    contact_id: str,
    recording_bucket: str,
    transcript_kb_file: str,
    language_code: str,
    sdr_outcome: dict[str, Any],
    transcription_failed: bool,
    job_name: str,
    vcon_uuid: str = "",
    vcon_kb_file: str = "",
) -> None:
    """Fire the Post-Call Processor (+ Qualification Promoter) agents via the
    native Connect event source.

    Emits a `numa.connector.connect` / `connector.event` to the connector-events
    bus (client region). The existing `numa.connector.*` EventBridge rule routes
    it to connector-event-dispatcher, whose `connect` branch resolves the bound
    `call.completed` schedules and invokes the runner. payload_summary fields
    become `{{ event.* }}` in the agent prompts. The post-call agent reads the
    transcript from Numa Files at transcript_kb_file (kb_id). prospect_phone (from
    the SDR wrap-up) is the join key to master_prospects.json.
    """
    if not CONNECTOR_EVENT_BUS_NAME:
        logger.warning(
            "Connector event bus not configured; skipping post-call dispatch",
            _name="VOICE_POSTCALL_SKIP",
            contact_id=contact_id,
        )
        return

    detail = {
        "connector_id": "connect",
        "event_type": "call.completed",
        # job_name is unique per recording, so two failed calls with unparseable
        # contact IDs never collide on event_id/dedup_key (a bare "voice"
        # constant would dedup them against each other and silently drop one).
        "event_id": contact_id or transcript_kb_file or job_name or "voice",
        "client_name": CLIENT_NAME,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload_summary": {
            "transcript_kb_file": transcript_kb_file,
            # Canonical vCon for this call (empty on the degraded/no-transcript
            # paths). The post-call agent prefers this and falls back to the
            # transcript file when absent.
            "vcon_kb_file": vcon_kb_file,
            "vcon_uuid": vcon_uuid,
            "kb_id": KB_ID,
            "recording_bucket": recording_bucket,
            "contact_id": contact_id,
            # Prospects join by phone (E.164) — the FE wrap-up never writes a
            # prospect_id, so we don't emit a perpetually-empty one.
            "prospect_phone": str(sdr_outcome.get("prospect_phone") or ""),
            "sdr_outcome": str(sdr_outcome.get("outcome") or ""),
            "sdr_notes": str(sdr_outcome.get("notes") or ""),
            # SDR (Connect agent) identity from the wrap-up — lets the runner route
            # the "summary ready" notification to the SDR who placed the call.
            "sdr_sub": str(sdr_outcome.get("sdr_sub") or ""),
            "sdr_email": str(sdr_outcome.get("agent_email") or ""),
            "sdr_name": str(sdr_outcome.get("agent_name") or ""),
            # AE picked by the SDR in the wrap-up (Phase 2 hand-off) — the runner
            # sets the CRM customer owner + routes the "qualified prospect handed to
            # you" notification to this AE. Empty when the SDR didn't assign one.
            "assigned_ae_sub": str(sdr_outcome.get("assigned_ae_sub") or ""),
            "assigned_ae_email": str(sdr_outcome.get("assigned_ae_email") or ""),
            "assigned_ae_name": str(sdr_outcome.get("assigned_ae_name") or ""),
            # Preserve the three-state distinction: True / False / None. When the
            # SDR wrap-up never landed, sdr_outcome is {} and qualified is None
            # (serialised as JSON null) — the post-call agent must treat that as
            # "not captured" (do NOT promote, note the gap), NOT as an explicit
            # "No". Collapsing to False here silently dropped qualified prospects.
            "qualified": sdr_outcome.get("qualified"),
            "transcription_failed": transcription_failed,
            "language_code": language_code,
            "dedup_key": contact_id or transcript_kb_file or job_name or "voice",
        },
    }
    try:
        response = events_client.put_events(
            Entries=[
                {
                    "Source": "numa.connector.connect",
                    "DetailType": "connector.event",
                    "EventBusName": CONNECTOR_EVENT_BUS_NAME,
                    "Detail": json.dumps(detail),
                }
            ]
        )
        # put_events reports per-entry failures in the RESPONSE, not as an
        # exception — an unchecked FailedEntryCount means the post-call agent
        # silently never fires.
        if response.get("FailedEntryCount", 0) > 0:
            entry = (response.get("Entries") or [{}])[0]
            raise RuntimeError(
                "PutEvents entry failed: "
                f"{entry.get('ErrorCode', 'Unknown')} — {entry.get('ErrorMessage', '')}"
            )
        logger.info(
            "Post-call agent event emitted",
            _name="VOICE_POSTCALL_DISPATCHED",
            contact_id=contact_id,
            transcript_kb_file=transcript_kb_file,
            transcription_failed=transcription_failed,
        )
    except Exception as exc:
        # Propagate: this handler is invoked async by EventBridge, so raising
        # triggers the automatic retries + DLQ. The whole completion path is
        # idempotent (transcript put_object overwrites; downstream dedups on
        # dedup_key), so a re-run is safe — swallowing the error here would
        # silently drop the post-call agent run instead.
        logger.exception(
            "Failed to emit post-call event",
            _name="VOICE_POSTCALL_EMIT_ERROR",
            contact_id=contact_id,
            error=str(exc),
        )
        raise


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Dispatch on event shape: S3 ObjectCreated → start; Transcribe Job State
    Change → complete."""
    if event.get("Records"):
        # Outcome writes (OUTPUTS bucket, voice/outcomes/*.json) re-patch the vCon;
        # recording writes (.wav) start a transcription job. _handle_s3 already
        # safely skips non-.wav, so this routing is correctness + clarity.
        keys = [
            unquote_plus(r.get("s3", {}).get("object", {}).get("key", ""))
            for r in event["Records"]
        ]
        if keys and all(k.startswith("voice/outcomes/") for k in keys):
            return _handle_outcome(event)
        return _handle_s3(event)
    if event.get("detail-type") == "Transcribe Job State Change":
        return _handle_completion(event)
    logger.warning(
        "Unrecognised event", _name="VOICE_UNKNOWN_EVENT", keys=list(event.keys())
    )
    return {"ignored": True}
