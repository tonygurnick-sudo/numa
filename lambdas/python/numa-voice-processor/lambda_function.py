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

Phase 2 (TODO below) fires the Post-Call Processor agent via the native Connect
event source (numa.connector.connect → connector-event-dispatcher → runner).
"""

import json
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote_plus, urlparse

import structlog

import aws_transcribe
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

events_client = (
    prm_client("events", region=CLIENT_REGION)
    if CLIENT_REGION
    else prm_client("events")
)
# Outputs + DATA buckets live in the client region; this Lambda runs in ap-southeast-2.
outputs_s3_client = (
    prm_client("s3", region=CLIENT_REGION) if CLIENT_REGION else s3_client
)
data_s3_client = outputs_s3_client

# Amazon Connect records the agent and customer on separate diarised speakers.
MAX_SPEAKERS = 2


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
        max_speakers=MAX_SPEAKERS,
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
        except (
            Exception
        ) as exc:  # noqa: BLE001 — re-delivery may hit an existing job name
            logger.exception(
                "Failed to start transcription",
                _name="VOICE_START_ERROR",
                bucket=bucket,
                key=key,
                error=str(exc),
            )
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
    except Exception:  # noqa: BLE001 — best-effort; degrade gracefully
        job = {}
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
        transcript_text, detected_speakers = (
            aws_transcribe.fetch_transcript_with_speakers(
                recording_bucket, _raw_output_key(job_name)
            )
        )
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
            # SDR's in-UI wrap-up selections (outcome / notes / qualified), if captured.
            "sdr_outcome": sdr_outcome,
            "metadata": {
                "job_name": job_name,
                "duration": job.get("MediaLengthSeconds", 0),
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
        data_s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=kb_s3_key,
            Body=json.dumps(transcript_doc, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
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
        _emit_post_call_event(
            contact_id=contact_id,
            recording_bucket=recording_bucket,
            transcript_kb_file="",
            language_code=language_code,
            sdr_outcome=sdr_outcome,
            transcription_failed=True,
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
    )
    return {"transcript_kb_file": transcript_kb_file, "contact_id": contact_id}


def _emit_post_call_event(
    *,
    contact_id: str,
    recording_bucket: str,
    transcript_kb_file: str,
    language_code: str,
    sdr_outcome: dict[str, Any],
    transcription_failed: bool,
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
        "event_id": contact_id or transcript_kb_file or "voice",
        "client_name": CLIENT_NAME,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload_summary": {
            "transcript_kb_file": transcript_kb_file,
            "kb_id": KB_ID,
            "recording_bucket": recording_bucket,
            "contact_id": contact_id,
            # Prospects join by phone (E.164) — the FE wrap-up never writes a
            # prospect_id, so we don't emit a perpetually-empty one.
            "prospect_phone": str(sdr_outcome.get("prospect_phone") or ""),
            "sdr_outcome": str(sdr_outcome.get("outcome") or ""),
            "sdr_notes": str(sdr_outcome.get("notes") or ""),
            # Preserve the three-state distinction: True / False / None. When the
            # SDR wrap-up never landed, sdr_outcome is {} and qualified is None
            # (serialised as JSON null) — the post-call agent must treat that as
            # "not captured" (do NOT promote, note the gap), NOT as an explicit
            # "No". Collapsing to False here silently dropped qualified prospects.
            "qualified": sdr_outcome.get("qualified"),
            "transcription_failed": transcription_failed,
            "language_code": language_code,
            "dedup_key": contact_id or transcript_kb_file,
        },
    }
    try:
        events_client.put_events(
            Entries=[
                {
                    "Source": "numa.connector.connect",
                    "DetailType": "connector.event",
                    "EventBusName": CONNECTOR_EVENT_BUS_NAME,
                    "Detail": json.dumps(detail),
                }
            ]
        )
        logger.info(
            "Post-call agent event emitted",
            _name="VOICE_POSTCALL_DISPATCHED",
            contact_id=contact_id,
            transcript_kb_file=transcript_kb_file,
            transcription_failed=transcription_failed,
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — don't fail the whole handler on a transient PutEvents error
        logger.exception(
            "Failed to emit post-call event",
            _name="VOICE_POSTCALL_EMIT_ERROR",
            contact_id=contact_id,
            error=str(exc),
        )


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Dispatch on event shape: S3 ObjectCreated → start; Transcribe Job State
    Change → complete."""
    if event.get("Records"):
        return _handle_s3(event)
    if event.get("detail-type") == "Transcribe Job State Change":
        return _handle_completion(event)
    logger.warning(
        "Unrecognised event", _name="VOICE_UNKNOWN_EVENT", keys=list(event.keys())
    )
    return {"ignored": True}
