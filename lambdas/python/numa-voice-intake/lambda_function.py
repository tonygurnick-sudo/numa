"""numa-voice-intake — Numa Voice prospect-list intake emitter (FEAT-159 Phase 2).

Event-driven and scale-to-zero. An SDR (or an upstream automation) drops a
prospect spreadsheet (`.xlsx` / `.xls`) into the per-tenant intake bucket. S3
emits an ObjectCreated notification that invokes this Lambda, which:

  1. Copies the spreadsheet from the intake bucket into the company knowledge
     base intake path on the tenant DATA bucket (so numa_files / KB tooling can
     read it at a stable `voice/intake/<file>` location), and
  2. Emits a `numa.connector.connect` / `connector.event` to the connector-events
     bus so the existing `numa.connector.*` EventBridge rule routes it to
     connector-event-dispatcher. Its `connect` branch resolves every active
     connect-bound schedule whose `trigger.event == 'prospects.uploaded'` and
     fires the runner — i.e. the seeded **Prospect Ingest** agent. The
     `payload_summary` fields become `{{ event.* }}` in that agent's prompt.

Unlike numa-voice-processor (which runs in the Connect/Transcribe region and
PutEvents cross-region into the client region), this Lambda runs in the CLIENT
region — the DATA bucket and the connector-events bus are both local — so the
boto3 clients use default region resolution (no region kwarg).
"""

import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote_plus

import structlog

from prm import client as prm_client

logger = structlog.get_logger(__name__)

# Same-region (client region): DATA bucket + connector-events bus are local, so
# default boto3 region resolution is correct — no region kwarg.
s3_client = prm_client("s3")
events_client = prm_client("events")

DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
# Where the spreadsheet is copied on the DATA bucket (full S3 key prefix).
KB_INTAKE_S3_PREFIX = os.environ.get(
    "KB_INTAKE_S3_PREFIX", "documents/company/voice/intake/"
)
# numa_files-relative prefix the agent sees (KB id 'company' is the root, so the
# file resolves at `<KB_INTAKE_FILE_PREFIX><filename>` inside numa_files).
KB_INTAKE_FILE_PREFIX = os.environ.get("KB_INTAKE_FILE_PREFIX", "voice/intake/")
CONNECTOR_EVENT_BUS_NAME = os.environ.get("CONNECTOR_EVENT_BUS_NAME", "")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")

# Knowledge base the company prospect lists live under.
KB_ID = "company"
# Spreadsheet extensions we treat as a prospect list.
INTAKE_EXTENSIONS = (".xlsx", ".xls")


def _filename(key: str) -> str:
    """Bare filename from an S3 key (`a/b/prospects.xlsx` -> `prospects.xlsx`)."""
    return key.rsplit("/", 1)[-1]


def _kb_s3_key(filename: str) -> str:
    """Destination key on the DATA bucket (company KB intake path)."""
    return f"{KB_INTAKE_S3_PREFIX}{filename}"


def _intake_file(filename: str) -> str:
    """numa_files-relative path the agent reads (e.g. `voice/intake/<file>`)."""
    return f"{KB_INTAKE_FILE_PREFIX}{filename}"


def _copy_to_kb(source_bucket: str, source_key: str, filename: str) -> str:
    """Copy the spreadsheet into the company-KB intake path on the DATA bucket.

    Idempotent: re-delivery of the same object just overwrites the same key.
    """
    dest_key = _kb_s3_key(filename)
    s3_client.copy_object(
        Bucket=DATA_BUCKET,
        Key=dest_key,
        CopySource={"Bucket": source_bucket, "Key": source_key},
    )
    logger.info(
        "Prospect list copied to KB intake path",
        _name="VOICE_INTAKE_COPIED",
        source_bucket=source_bucket,
        source_key=source_key,
        data_bucket=DATA_BUCKET,
        dest_key=dest_key,
        filename=filename,
    )
    return dest_key


def _emit_prospect_event(filename: str, timestamp: str, etag: str) -> None:
    """Fire the Prospect Ingest agent via the native Connect event source.

    Emits a `numa.connector.connect` / `connector.event` to the connector-events
    bus (client region). connector-event-dispatcher's `connect` branch matches
    active schedules with `trigger.event == 'prospects.uploaded'` and invokes the
    runner. `payload_summary` fields become `{{ event.* }}` in the agent prompt.
    """
    if not CONNECTOR_EVENT_BUS_NAME:
        logger.warning(
            "Connector event bus not configured; skipping prospect ingest dispatch",
            _name="VOICE_INTAKE_SKIP",
            filename=filename,
        )
        return

    intake_file = _intake_file(filename)
    # dedup_key combines the file path + the S3 ETag (content hash) so a true S3
    # re-delivery of the SAME object is deduped, but re-uploading an UPDATED
    # spreadsheet under the same filename (new ETag) is processed again.
    dedup_key = f"{intake_file}:{etag.strip(chr(34))}" if etag else intake_file
    detail = {
        "connector_id": "connect",
        "event_type": "prospects.uploaded",
        "event_id": f"{filename}:{etag.strip(chr(34))}" if etag else filename,
        "client_name": CLIENT_NAME,
        "timestamp": timestamp,
        "payload_summary": {
            "intake_file": intake_file,
            "kb_id": KB_ID,
            "filename": filename,
            "dedup_key": dedup_key,
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
            "Prospect ingest event emitted",
            _name="VOICE_INTAKE_DISPATCHED",
            filename=filename,
            intake_file=intake_file,
            kb_id=KB_ID,
        )
    except (
        Exception
    ) as exc:  # noqa: BLE001 — file is already copied to the KB; log, don't raise
        logger.exception(
            "Failed to emit prospect ingest event (file copied to KB but agent not fired)",
            _name="VOICE_INTAKE_EMIT_ERROR",
            filename=filename,
            error=str(exc),
        )


def _handle_record(
    source_bucket: str, source_key: str, etag: str
) -> dict[str, Any] | None:
    """Copy one spreadsheet into the KB and emit its ingest event."""
    filename = _filename(source_key)
    timestamp = datetime.now(timezone.utc).isoformat()
    dest_key = _copy_to_kb(source_bucket, source_key, filename)
    _emit_prospect_event(filename, timestamp, etag)
    return {
        "filename": filename,
        "dest_key": dest_key,
        "intake_file": _intake_file(filename),
    }


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """S3 ObjectCreated handler — copy each prospect spreadsheet into the company
    KB intake path and emit a `prospects.uploaded` connector event per file."""
    processed: list[dict[str, Any]] = []
    for record in event.get("Records", []):
        s3 = record.get("s3", {})
        source_bucket = s3.get("bucket", {}).get("name", "")
        source_key = unquote_plus(s3.get("object", {}).get("key", ""))
        etag = s3.get("object", {}).get("eTag", "")
        if not source_key.lower().endswith(INTAKE_EXTENSIONS):
            logger.info(
                "Skipping non-spreadsheet object",
                _name="VOICE_INTAKE_SKIP_OBJECT",
                key=source_key,
            )
            continue
        try:
            result = _handle_record(source_bucket, source_key, etag)
            if result is not None:
                processed.append(result)
        except Exception as exc:  # noqa: BLE001 — re-delivery must not poison the batch
            logger.exception(
                "Failed to process prospect intake object",
                _name="VOICE_INTAKE_ERROR",
                bucket=source_bucket,
                key=source_key,
                error=str(exc),
            )
    return {"processed": len(processed), "files": processed}
