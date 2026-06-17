import json
import re
import time
from dataclasses import dataclass
from typing import Any, Optional

import boto3
import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger(__name__)
s3_client = prm_client("s3")
transcribe_client = prm_client("transcribe")


class TranscriptionError(Exception):
    pass


@dataclass
class TranscriptionResponse:
    text: str
    metadata: dict


def start_transcription_job(
    job_name: str,
    media_uri: str,
    max_speakers: int,
    language_code: str,
    output_bucket: str,
    output_key: str,
) -> None:
    """Start a diarised batch transcription job and return immediately.

    Use this (rather than ``transcribe()``) for event-driven, scale-to-zero
    pipelines: start the job here, then react to the Amazon Transcribe
    "Transcribe Job State Change" EventBridge event and call ``fetch_transcript``.
    """
    try:
        logger.info(f"Starting transcription job: {job_name}")

        params = {
            "TranscriptionJobName": job_name,
            "Media": {"MediaFileUri": media_uri},
            "LanguageCode": language_code,
            "OutputBucketName": output_bucket,
            "OutputKey": output_key,
            "Settings": {
                "ShowSpeakerLabels": True,
                "MaxSpeakerLabels": max_speakers,
                "ChannelIdentification": False,
            },
        }

        transcribe_client.start_transcription_job(**params)
    except ClientError as e:
        logger.exception("Failed to start transcription job")
        raise TranscriptionError("Failed to start transcription") from e


def __wait_for_completion(job_name: str, timeout: int = 900) -> dict:
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            result = transcribe_client.get_transcription_job(
                TranscriptionJobName=job_name
            )
        except ClientError as e:
            logger.exception("Failed to get transcription job status")
            raise TranscriptionError("Failed to get job status") from e

        job = result["TranscriptionJob"]
        status = job["TranscriptionJobStatus"]

        if status == "COMPLETED":
            logger.info(f"Transcription job completed: {job_name}")
            return job

        if status == "FAILED":
            reason = job.get("FailureReason", "Unknown reason")
            logger.error(f"Transcription job failed: {reason}")
            raise TranscriptionError(f"Transcription failed: {reason}")

        time.sleep(10)

    raise TranscriptionError("Transcription timed out")


def _format_transcript(items: list, speaker_segments: dict) -> str:
    """Simple formatting: new line per speaker change with speaker label."""
    current_speaker = None
    transcript = []
    current_text = []

    for item in items:
        content = item.get("alternatives", [{}])[0].get("content", "")
        start_time = item.get("start_time")

        if item.get("type") == "punctuation":
            current_text.append(content)
            continue

        if start_time in speaker_segments:
            speaker = speaker_segments[start_time]
            if speaker != current_speaker:
                if current_text:
                    transcript.append(" ".join(current_text))
                current_speaker = speaker
                current_text = [f"\n{speaker}: {content}"]
            else:
                current_text.append(content)
        else:
            current_text.append(content)

    if current_text:
        transcript.append(" ".join(current_text))

    return "".join(transcript).strip()


def fetch_transcript_with_speakers(bucket: str, key: str) -> tuple[str, list[str]]:
    """
    Read a completed Transcribe output JSON from S3 and return BOTH the
    speaker-labelled transcript string AND the sorted list of distinct speaker
    labels Transcribe actually detected — so callers can validate diarisation
    (e.g. assert exactly 2 speakers before trusting an agent/prospect mapping).
    """
    try:
        logger.info(f"Getting transcript from bucket: {bucket}, key: {key}")

        response = s3_client.get_object(Bucket=bucket, Key=key)
        transcript_json = json.loads(response["Body"].read().decode("utf-8"))

        results = transcript_json.get("results", {})
        segments = results.get("speaker_labels", {}).get("segments", [])
        items = results.get("items", [])

        speaker_segments = {}
        speakers: set[str] = set()
        for segment in segments:
            label = segment.get("speaker_label")
            if label:
                speakers.add(label)
            for item in segment.get("items", []):
                speaker_segments[item["start_time"]] = segment["speaker_label"]

        return _format_transcript(items, speaker_segments), sorted(speakers)

    except Exception as e:
        logger.exception(
            "Failed to get transcript",
            bucket=bucket,
            key=key,
        )
        raise TranscriptionError("Failed to get transcript") from e


_PUNCT_RE = re.compile(r"^[.,!?;:]")


def _party_for_speaker(label: str) -> Optional[int]:
    """Map a Transcribe speaker label (``spk_0`` / ``spk_1``) to a vCon party
    index. For Numa Voice spk_0=SDR=party 0, spk_1=prospect=party 1. Returns None
    for an unmappable label (only trusted when diarisation_ok upstream)."""
    try:
        return int(label.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return None


def _join_words(words: list[str]) -> str:
    """Join word/punctuation tokens into readable text (no space before punctuation)."""
    text = ""
    for w in words:
        if not w:
            continue
        if _PUNCT_RE.match(w) or w.startswith("'"):
            text += w
        else:
            text = f"{text} {w}" if text else w
    return text.strip()


def _build_utterances(items: list, speaker_segments: dict) -> list[dict[str, Any]]:
    """Group diarised items into per-speaker turns with start/end times.

    Each utterance: ``{party, speaker, text, start, end}``. These per-utterance
    timestamps are present in the raw Transcribe items but discarded by
    ``_format_transcript`` — this preserves them for the vCon transcript analysis.
    """
    utterances: list[dict[str, Any]] = []
    current: Optional[dict[str, Any]] = None

    def _flush() -> None:
        if current is not None:
            utterances.append(
                {
                    "party": _party_for_speaker(current["speaker"]),
                    "speaker": current["speaker"],
                    "text": _join_words(current["words"]),
                    "start": current["start"],
                    "end": current["end"],
                }
            )

    for item in items:
        content = item.get("alternatives", [{}])[0].get("content", "")
        if item.get("type") == "punctuation":
            if current is not None:
                current["words"].append(content)
            continue
        start_time = item.get("start_time")
        speaker = speaker_segments.get(start_time)
        if speaker is None:
            if current is not None:
                current["words"].append(content)
            continue
        end_time = item.get("end_time")
        if current is None or current["speaker"] != speaker:
            _flush()
            current = {
                "speaker": speaker,
                "words": [content],
                "start": float(start_time) if start_time else None,
                "end": float(end_time) if end_time else None,
            }
        else:
            current["words"].append(content)
            if end_time:
                current["end"] = float(end_time)
    _flush()
    return utterances


def fetch_utterances_with_speakers(
    bucket: str, key: str
) -> tuple[str, list[str], list[dict[str, Any]]]:
    """Like ``fetch_transcript_with_speakers`` but ALSO returns the per-utterance
    array (``[{party, speaker, text, start, end}]``) with timestamps — the input
    to the vCon transcript analysis. Returns ``(text, speakers, utterances)``."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        transcript_json = json.loads(response["Body"].read().decode("utf-8"))

        results = transcript_json.get("results", {})
        segments = results.get("speaker_labels", {}).get("segments", [])
        items = results.get("items", [])

        speaker_segments: dict = {}
        speakers: set[str] = set()
        for segment in segments:
            label = segment.get("speaker_label")
            if label:
                speakers.add(label)
            for item in segment.get("items", []):
                speaker_segments[item["start_time"]] = segment["speaker_label"]

        text = _format_transcript(items, speaker_segments)
        utterances = _build_utterances(items, speaker_segments)
        return text, sorted(speakers), utterances
    except Exception as e:
        logger.exception("Failed to get utterances", bucket=bucket, key=key)
        raise TranscriptionError("Failed to get utterances") from e


def fetch_transcript(bucket: str, key: str) -> str:
    """
    Read a completed Transcribe output JSON from S3 and format it into a
    speaker-labelled transcript string. Safe to call from a completion handler.
    (Text only; see ``fetch_transcript_with_speakers`` for diarisation detail.)
    """
    text, _speakers = fetch_transcript_with_speakers(bucket, key)
    return text


def transcribe(
    input_bucket: str,
    input_key: str,
    output_bucket: str,
    output_key: str,
    job_name: str,
    language_code: str = "en-US",
    name_for_logging: str = "",
    max_speakers: int = 10,
) -> TranscriptionResponse:
    """
    Transcribe an audio file from S3 and return the transcribed text.
    """
    if name_for_logging:
        logger.info(f"Starting transcription for {name_for_logging}")

    start_transcription_job(
        job_name=job_name,
        media_uri=f"s3://{input_bucket}/{input_key}",
        max_speakers=max_speakers,
        language_code=language_code,
        output_bucket=output_bucket,
        output_key=output_key,
    )

    job_info = __wait_for_completion(job_name)
    logger.info("Job completed, getting transcript")

    transcript_data = fetch_transcript(output_bucket, output_key)

    metadata = {
        "job_name": job_name,
        "duration": job_info.get("MediaLengthSeconds", 0),
        "file_format": job_info.get("MediaFormat"),
        "sample_rate": job_info.get("MediaSampleRateHertz"),
        "language_code": job_info.get("LanguageCode"),
        "output_location": f"s3://{output_bucket}/{output_key}",
    }

    if name_for_logging:
        logger.info(f"Completed transcription for {name_for_logging}", **metadata)

    return TranscriptionResponse(transcript_data, metadata)
