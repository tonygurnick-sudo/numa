"""Audio/video transcription via AWS Transcribe."""

import json
import os
import time
import uuid

import boto3
import structlog

logger = structlog.get_logger(__name__)

REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))

# Map file extensions to AWS Transcribe media formats
MEDIA_FORMAT_MAP = {
    ".mp3": "mp3",
    ".mp4": "mp4",
    ".wav": "wav",
    ".flac": "flac",
    ".ogg": "ogg",
    ".amr": "amr",
    ".webm": "webm",
    ".m4a": "mp4",
    ".mov": "mp4",
    ".avi": "mp4",
    ".mkv": "mp4",
    ".aac": "mp4",
    ".wma": "mp3",
}


def extract_audio(file_path: str, ext: str, s3_bucket: str, s3_key: str) -> list[dict]:
    """Transcribe audio/video using AWS Transcribe.

    The file must already be in S3 (which it is — downloaded by main.py then
    we use the original S3 location for Transcribe).
    """
    media_format = MEDIA_FORMAT_MAP.get(ext, "mp4")
    job_name = f"numa-transcription-{uuid.uuid4().hex[:12]}"
    s3_uri = f"s3://{s3_bucket}/{s3_key}"

    transcribe = boto3.client("transcribe", region_name=REGION)

    logger.info(
        "Starting AWS Transcribe job", job_name=job_name, media_format=media_format
    )

    try:
        transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": s3_uri},
            MediaFormat=media_format,
            IdentifyLanguage=True,
            OutputBucketName=s3_bucket,
            OutputKey=f"temp-transcribe/{job_name}.json",
        )
    except Exception as e:
        logger.error("Failed to start Transcribe job", error=str(e))
        return [
            {
                "page_number": 1,
                "num_words": 0,
                "text": f"(Failed to start transcription: {e})",
            }
        ]

    # Poll for completion
    max_wait = 3600  # 1 hour max
    poll_interval = 15
    elapsed = 0

    while elapsed < max_wait:
        try:
            resp = transcribe.get_transcription_job(TranscriptionJobName=job_name)
            status = resp["TranscriptionJob"]["TranscriptionJobStatus"]

            if status == "COMPLETED":
                break
            elif status == "FAILED":
                reason = resp["TranscriptionJob"].get("FailureReason", "Unknown")
                logger.error("Transcribe job failed", reason=reason)
                return [
                    {
                        "page_number": 1,
                        "num_words": 0,
                        "text": f"(Transcription failed: {reason})",
                    }
                ]
        except Exception as e:
            logger.warning("Transcribe poll error", error=str(e))

        time.sleep(poll_interval)
        elapsed += poll_interval

    if elapsed >= max_wait:
        return [
            {
                "page_number": 1,
                "num_words": 0,
                "text": "(Transcription timed out after 1 hour)",
            }
        ]

    # Read the transcript from S3
    try:
        s3 = boto3.client("s3", region_name=REGION)
        obj = s3.get_object(Bucket=s3_bucket, Key=f"temp-transcribe/{job_name}.json")
        transcript_data = json.loads(obj["Body"].read())
        text = (
            transcript_data.get("results", {})
            .get("transcripts", [{}])[0]
            .get("transcript", "")
        )

        if not text:
            text = "(No speech detected in audio/video)"

        # Clean up temp transcript
        try:
            s3.delete_object(Bucket=s3_bucket, Key=f"temp-transcribe/{job_name}.json")
        except Exception:
            pass

        duration_seconds = 0
        items = transcript_data.get("results", {}).get("items", [])
        if items:
            last_item = items[-1]
            duration_seconds = float(last_item.get("end_time", 0))

        logger.info(
            "Audio transcription complete",
            duration_seconds=duration_seconds,
            words=len(text.split()),
        )
        return [{"page_number": 1, "num_words": len(text.split()), "text": text}]

    except Exception as e:
        logger.error("Failed to read transcript", error=str(e))
        return [
            {
                "page_number": 1,
                "num_words": 0,
                "text": f"(Failed to read transcript result: {e})",
            }
        ]
