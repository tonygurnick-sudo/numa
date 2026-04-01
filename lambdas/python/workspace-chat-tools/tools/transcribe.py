"""
Audio/video transcription using Amazon Transcribe.

Two-tier pipeline:
- Fast path (< 2 MB): Single Transcribe job, 1s polling. Optimized for voice input.
- Parallel path (>= 2 MB): ffmpeg silence-based split into ~2-minute chunks,
  parallel Transcribe jobs, stitched transcript with optional speaker diarization.
  Handles meeting recordings up to 3 hours / 1 GB.

Modes:
- "voice": Plain text output (default). Used by voice input preprocessing.
- "meeting": Speaker-diarized output ([Speaker 1]: text). Used by extract_content
  routing for uploaded audio/video files.

Security:
- Validates file_path is within allowed workspace directories
- Rejects files over 1 GB or 3 hours
- User isolation via user_sub in S3 paths
"""

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict

import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
OUTPUTS_BUCKET_NAME = os.getenv("OUTPUTS_BUCKET_NAME", "")

S3_PREFIX = "numa-chat/workspace"
WORKSPACE_ROOT = "/workdir"

# ── Limits ──────────────────────────────────────────────────────────────────

# Below this threshold, use the fast single-job path
FAST_PATH_THRESHOLD_BYTES = 2 * 1024 * 1024  # 2 MB

# Hard limits for the parallel pipeline
MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB
MAX_DURATION_SECONDS = 3 * 60 * 60  # 3 hours

# ── Parallel pipeline config ───────────────────────────────────────────────

# Target chunk duration for splitting (seconds)
TARGET_CHUNK_SECONDS = 120  # 2 minutes

# Overlap at chunk boundaries to avoid cutting mid-word
CHUNK_OVERLAP_SECONDS = 0.5

# Max concurrent Transcribe jobs per request (leaves headroom for other users)
MAX_PARALLEL_JOBS = 15

# Retry config for Transcribe rate limiting
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds, doubles each retry

# Silence detection parameters for ffmpeg
SILENCE_THRESHOLD_DB = -30
MIN_SILENCE_DURATION = 0.3  # seconds

# ── Shared config ──────────────────────────────────────────────────────────

POLL_INTERVAL_SECONDS = 1
TRANSCRIBE_TIMEOUT_SECONDS = 120  # Per-job timeout (2 min covers most chunks)

# Supported audio/video extensions
AUDIO_EXTENSIONS = {
    ".ogg",
    ".webm",
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".amr",
    ".m4a",
}
VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
}
SUPPORTED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

# ffmpeg binary paths (Lambda layer mounts to /opt)
FFMPEG = "/opt/bin/ffmpeg"
FFPROBE = "/opt/bin/ffprobe"

# Fall back to system PATH if not in Lambda layer (local dev)
if not os.path.exists(FFMPEG):
    FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
if not os.path.exists(FFPROBE):
    FFPROBE = shutil.which("ffprobe") or "ffprobe"

s3_client = prm_client("s3")
transcribe_client = prm_client(
    "transcribe",
    config=Config(max_pool_connections=MAX_PARALLEL_JOBS + 5),
)


# ═══════════════════════════════════════════════════════════════════════════
# Public handler
# ═══════════════════════════════════════════════════════════════════════════


def handle_transcribe(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transcribe an audio/video file from the workspace to text.

    Parameters:
        file_path (str): Workspace path to file (e.g., /workdir/uploads/recording.ogg)
        mode (str): "voice" (plain text) or "meeting" (speaker diarization). Default: "voice"
        __user_sub (str): User's Cognito sub (injected by router)
        __conversation_id (str): Conversation ID (injected by router)

    Returns:
        Dict with text, language, and duration_seconds
    """
    file_path = params.get("file_path", "")
    user_sub = params.get("__user_sub", "")
    conversation_id = params.get("__conversation_id", "")
    mode = params.get("mode", "voice")

    if not file_path:
        raise ValueError("Missing required parameter: file_path")
    if not user_sub or not conversation_id:
        raise ValueError("Missing user context (user_sub or conversation_id)")
    if not OUTPUTS_BUCKET_NAME:
        raise ValueError("OUTPUTS_BUCKET_NAME not configured")

    ext = Path(file_path).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported format: {ext}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    # Build S3 key
    rel_path = file_path
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        rel_path = file_path[len(WORKSPACE_ROOT) + 1 :]
    audio_s3_key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"

    # Check file size
    try:
        head = s3_client.head_object(Bucket=OUTPUTS_BUCKET_NAME, Key=audio_s3_key)
        file_size = head["ContentLength"]
    except ClientError:
        raise ValueError(f"Audio file not found in S3: {file_path}")

    if file_size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"File too large: {file_size / 1024 / 1024:.0f} MB "
            f"(max {MAX_FILE_SIZE_BYTES / 1024 / 1024 / 1024:.0f} GB)"
        )

    logger.info(
        "Starting transcription",
        file_path=file_path,
        file_size=file_size,
        format=ext,
        mode=mode,
        pipeline="fast" if file_size < FAST_PATH_THRESHOLD_BYTES else "parallel",
        user_sub=user_sub[:8] + "...",
    )

    if file_size < FAST_PATH_THRESHOLD_BYTES:
        return _transcribe_fast(audio_s3_key, ext, file_path)
    else:
        return _transcribe_parallel(audio_s3_key, ext, file_path, mode)


# ═══════════════════════════════════════════════════════════════════════════
# Fast path (single Transcribe job, < 2 MB)
# ═══════════════════════════════════════════════════════════════════════════


def _transcribe_fast(audio_s3_key: str, ext: str, file_path: str) -> Dict[str, Any]:
    """Single Transcribe job for short clips. Original fast path."""
    job_id = uuid.uuid4().hex[:12]
    job_name = f"numa-transcribe-{job_id}"
    output_s3_key = f"temp-transcribe/{job_id}.json"

    try:
        transcribe_client.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": f"s3://{OUTPUTS_BUCKET_NAME}/{audio_s3_key}"},
            OutputBucketName=OUTPUTS_BUCKET_NAME,
            OutputKey=output_s3_key,
            IdentifyLanguage=True,
        )

        text, language, duration = _poll_and_extract(job_name, output_s3_key)

        logger.info(
            "Fast transcription complete",
            job_name=job_name,
            text_length=len(text),
            language=language,
            duration_seconds=duration,
        )

        return {
            "text": text,
            "language": language,
            "duration_seconds": duration,
        }

    except Exception:
        logger.error("Fast transcription failed", job_name=job_name, exc_info=True)
        raise

    finally:
        _cleanup_s3(output_s3_key)


# ═══════════════════════════════════════════════════════════════════════════
# Parallel path (ffmpeg split + concurrent Transcribe jobs)
# ═══════════════════════════════════════════════════════════════════════════


def _transcribe_parallel(
    audio_s3_key: str, ext: str, file_path: str, mode: str
) -> Dict[str, Any]:
    """
    Parallel transcription pipeline for large files.

    1. Download from S3 to /tmp
    2. Extract audio from video (if needed)
    3. Check duration (reject > 3 hours)
    4. Split on silence boundaries into ~2-min chunks
    5. Upload chunks to S3
    6. Fan out Transcribe jobs (max 15 concurrent)
    7. Stitch results
    8. Clean up
    """
    pipeline_start = time.monotonic()
    job_id = uuid.uuid4().hex[:12]
    tmp_dir = f"/tmp/transcribe-{job_id}"
    os.makedirs(tmp_dir, exist_ok=True)
    temp_s3_keys: list[str] = []

    try:
        # Step 1: Download from S3
        step_start = time.monotonic()
        local_input = f"{tmp_dir}/input{ext}"
        logger.info("Step 1/7: Downloading audio from S3", s3_key=audio_s3_key)
        s3_client.download_file(OUTPUTS_BUCKET_NAME, audio_s3_key, local_input)
        download_s = round(time.monotonic() - step_start, 1)
        logger.info("Step 1/7: Download complete", seconds=download_s)

        # Step 2: Extract audio from video if needed
        extract_s = 0.0
        if ext in VIDEO_EXTENSIONS:
            step_start = time.monotonic()
            local_audio = f"{tmp_dir}/audio.wav"
            logger.info("Step 2/7: Extracting audio from video")
            _extract_audio_track(local_input, local_audio)
            os.remove(local_input)  # Free /tmp space
            local_input = local_audio
            extract_s = round(time.monotonic() - step_start, 1)
            logger.info("Step 2/7: Audio extraction complete", seconds=extract_s)

        # Step 3: Get duration and validate
        duration = _get_audio_duration(local_input)
        if duration > MAX_DURATION_SECONDS:
            raise ValueError(
                f"Recording too long: {duration / 3600:.1f} hours "
                f"(max {MAX_DURATION_SECONDS / 3600:.0f} hours)"
            )

        logger.info(
            "Audio ready for splitting",
            duration_seconds=round(duration, 1),
            duration_minutes=round(duration / 60, 1),
        )

        # Step 4: Split on silence boundaries
        step_start = time.monotonic()
        chunk_paths = _split_on_silence(local_input, tmp_dir, duration)
        split_s = round(time.monotonic() - step_start, 1)
        logger.info(
            "Step 4/7: Split complete",
            num_chunks=len(chunk_paths),
            seconds=split_s,
        )

        # Free the full input file now that chunks exist
        if os.path.exists(local_input) and local_input not in chunk_paths:
            os.remove(local_input)

        # Step 5: Upload chunks to S3
        step_start = time.monotonic()
        chunk_s3_keys = []
        for i, chunk_path in enumerate(chunk_paths):
            chunk_key = f"temp-transcribe/{job_id}/chunk_{i:04d}.wav"
            s3_client.upload_file(chunk_path, OUTPUTS_BUCKET_NAME, chunk_key)
            chunk_s3_keys.append(chunk_key)
            temp_s3_keys.append(chunk_key)
            os.remove(chunk_path)  # Free /tmp space after upload
        upload_s = round(time.monotonic() - step_start, 1)
        logger.info(
            "Step 5/7: Chunks uploaded to S3",
            num_chunks=len(chunk_s3_keys),
            seconds=upload_s,
        )

        # Step 6: Fan out Transcribe jobs
        step_start = time.monotonic()
        use_speakers = mode == "meeting"
        logger.info(
            "Step 6/7: Starting Transcribe fan-out",
            num_chunks=len(chunk_s3_keys),
            max_parallel=MAX_PARALLEL_JOBS,
            speaker_diarization=use_speakers,
        )
        chunk_results = _fan_out_transcribe(
            chunk_s3_keys, job_id, use_speakers, temp_s3_keys
        )
        transcribe_s = round(time.monotonic() - step_start, 1)
        logger.info(
            "Step 6/7: Transcribe fan-out complete",
            num_chunks=len(chunk_results),
            seconds=transcribe_s,
        )

        # Step 7: Stitch results
        step_start = time.monotonic()
        if use_speakers:
            text = _stitch_speaker_transcripts(chunk_results)
        else:
            text = _stitch_plain_transcripts(chunk_results)
        stitch_s = round(time.monotonic() - step_start, 1)

        # Detect language from first completed chunk
        language = "unknown"
        for cr in chunk_results:
            if cr.get("language") and cr["language"] != "unknown":
                language = cr["language"]
                break

        pipeline_dur = time.monotonic() - pipeline_start
        logger.info(
            "Parallel transcription complete",
            num_chunks=len(chunk_paths),
            text_length=len(text),
            language=language,
            audio_duration_seconds=round(duration, 1),
            pipeline_total_seconds=round(pipeline_dur, 1),
            step_download_s=download_s,
            step_video_extract_s=extract_s,
            step_split_s=split_s,
            step_upload_s=upload_s,
            step_transcribe_s=transcribe_s,
            step_stitch_s=stitch_s,
            mode=mode,
        )

        return {
            "text": text,
            "language": language,
            "duration_seconds": round(duration, 1),
        }

    finally:
        # Clean up /tmp
        shutil.rmtree(tmp_dir, ignore_errors=True)
        # Clean up S3 temp files
        for key in temp_s3_keys:
            _cleanup_s3(key)


# ═══════════════════════════════════════════════════════════════════════════
# ffmpeg helpers
# ═══════════════════════════════════════════════════════════════════════════


def _get_audio_duration(file_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    result = subprocess.run(
        [
            FFPROBE,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            file_path,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise ValueError(f"ffprobe failed: {result.stderr[:200]}")

    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def _extract_audio_track(video_path: str, output_path: str) -> None:
    """Extract audio from video container as WAV (fast, no re-encoding for PCM)."""
    logger.info("Extracting audio from video", video_path=video_path)
    result = subprocess.run(
        [
            FFMPEG,
            "-i",
            video_path,
            "-vn",  # Strip video
            "-acodec",
            "pcm_s16le",  # 16-bit PCM WAV (Transcribe handles it well)
            "-ar",
            "16000",  # 16 kHz sample rate (optimal for speech)
            "-ac",
            "1",  # Mono
            "-y",  # Overwrite
            output_path,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise ValueError(f"Audio extraction failed: {result.stderr[:200]}")


def _detect_silence_boundaries(file_path: str) -> list[float]:
    """
    Detect silence midpoints in audio using ffmpeg silencedetect.

    Returns list of timestamps (seconds) at the midpoint of each silence gap.
    """
    result = subprocess.run(
        [
            FFMPEG,
            "-i",
            file_path,
            "-af",
            f"silencedetect=noise={SILENCE_THRESHOLD_DB}dB:d={MIN_SILENCE_DURATION}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )

    # Parse silence_start and silence_end from stderr
    silence_starts = re.findall(r"silence_start: ([\d.]+)", result.stderr)
    silence_ends = re.findall(r"silence_end: ([\d.]+)", result.stderr)

    midpoints = []
    for start_str, end_str in zip(silence_starts, silence_ends):
        start = float(start_str)
        end = float(end_str)
        midpoints.append((start + end) / 2)

    return midpoints


def _split_on_silence(
    file_path: str, output_dir: str, total_duration: float
) -> list[str]:
    """
    Split audio into ~2-minute chunks at silence boundaries.

    Falls back to fixed 120-second splits if no suitable silence boundaries found.
    """
    # For very short files, don't split
    if total_duration <= TARGET_CHUNK_SECONDS * 1.5:
        return [file_path]

    # Detect silence boundaries
    silences = _detect_silence_boundaries(file_path)

    # Build split points: find the best silence boundary near each target point
    split_points: list[float] = []
    target = TARGET_CHUNK_SECONDS

    while target < total_duration - TARGET_CHUNK_SECONDS * 0.3:
        # Find the closest silence midpoint to the target
        best = None
        best_dist = float("inf")
        # Look within +/- 30 seconds of target for a silence boundary
        for s in silences:
            dist = abs(s - target)
            if dist < 30 and dist < best_dist:
                best = s
                best_dist = dist

        if best is not None:
            split_points.append(best)
            target = best + TARGET_CHUNK_SECONDS
        else:
            # No silence found near target, use fixed split
            split_points.append(target)
            target += TARGET_CHUNK_SECONDS

    if not split_points:
        # Fallback: fixed splits
        t = TARGET_CHUNK_SECONDS
        while t < total_duration - TARGET_CHUNK_SECONDS * 0.3:
            split_points.append(t)
            t += TARGET_CHUNK_SECONDS

    # Generate chunk files using ffmpeg
    chunk_paths = []
    boundaries = [0.0] + split_points + [total_duration]

    for i in range(len(boundaries) - 1):
        start = max(0, boundaries[i] - CHUNK_OVERLAP_SECONDS) if i > 0 else 0
        end = (
            min(total_duration, boundaries[i + 1] + CHUNK_OVERLAP_SECONDS)
            if i < len(boundaries) - 2
            else total_duration
        )

        chunk_path = f"{output_dir}/chunk_{i:04d}.wav"
        result = subprocess.run(
            [
                FFMPEG,
                "-i",
                file_path,
                "-ss",
                str(start),
                "-to",
                str(end),
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-y",
                chunk_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            logger.warning(
                f"Chunk {i} split failed, skipping",
                stderr=result.stderr[:200],
            )
            continue

        chunk_paths.append(chunk_path)

    if not chunk_paths:
        raise ValueError("Failed to split audio into chunks")

    return chunk_paths


# ═══════════════════════════════════════════════════════════════════════════
# Transcribe fan-out
# ═══════════════════════════════════════════════════════════════════════════


def _fan_out_transcribe(
    chunk_s3_keys: list[str],
    job_id: str,
    use_speakers: bool,
    temp_s3_keys: list[str],
) -> list[dict]:
    """
    Start Transcribe jobs for all chunks in parallel (max 15 concurrent),
    poll until all complete, return ordered results.
    """
    # Prepare job specs
    jobs: list[dict] = []
    for i, chunk_key in enumerate(chunk_s3_keys):
        output_key = f"temp-transcribe/{job_id}/result_{i:04d}.json"
        temp_s3_keys.append(output_key)
        jobs.append(
            {
                "index": i,
                "chunk_key": chunk_key,
                "job_name": f"numa-par-{job_id}-{i:04d}",
                "output_key": output_key,
            }
        )

    results: list[dict] = [{}] * len(jobs)

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_JOBS) as executor:
        futures = {}
        for job in jobs:
            future = executor.submit(
                _run_single_transcribe_job,
                job["job_name"],
                job["chunk_key"],
                job["output_key"],
                use_speakers,
            )
            futures[future] = job

        errors = []
        for future in as_completed(futures):
            job = futures[future]
            try:
                result = future.result()
                results[job["index"]] = result
            except Exception as e:
                errors.append((job["index"], job["job_name"], e))
                logger.error(
                    "Chunk transcription failed",
                    chunk_index=job["index"],
                    job_name=job["job_name"],
                    error=str(e),
                )

    if errors:
        failed_indices = [e[0] for e in errors]
        raise ValueError(
            f"Transcription failed for {len(errors)} of {len(jobs)} chunks "
            f"(indices: {failed_indices}). First error: {errors[0][2]}"
        )

    return results


def _run_single_transcribe_job(
    job_name: str,
    chunk_s3_key: str,
    output_s3_key: str,
    use_speakers: bool,
) -> dict:
    """Start a single Transcribe job with retry, poll until complete, return result."""
    settings: Dict[str, Any] = {}
    if use_speakers:
        settings["ShowSpeakerLabels"] = True
        settings["MaxSpeakerLabels"] = 10

    # Start job with retry for rate limiting
    for attempt in range(MAX_RETRIES + 1):
        try:
            start_kwargs: Dict[str, Any] = {
                "TranscriptionJobName": job_name,
                "Media": {"MediaFileUri": f"s3://{OUTPUTS_BUCKET_NAME}/{chunk_s3_key}"},
                "OutputBucketName": OUTPUTS_BUCKET_NAME,
                "OutputKey": output_s3_key,
                "IdentifyLanguage": True,
            }
            if settings:
                start_kwargs["Settings"] = settings

            transcribe_client.start_transcription_job(**start_kwargs)
            break
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "LimitExceededException" and attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY * (2**attempt)
                logger.warning(
                    "Transcribe rate limited, retrying",
                    job_name=job_name,
                    attempt=attempt + 1,
                    delay=delay,
                )
                time.sleep(delay)
            else:
                raise

    # Poll until complete
    text, language, duration = _poll_and_extract(job_name, output_s3_key)

    # For speaker mode, also extract speaker segments
    speaker_segments = []
    if use_speakers:
        speaker_segments = _read_speaker_segments(output_s3_key)

    return {
        "text": text,
        "language": language,
        "duration": duration,
        "speaker_segments": speaker_segments,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Transcript reading and stitching
# ═══════════════════════════════════════════════════════════════════════════


def _poll_and_extract(job_name: str, output_s3_key: str) -> tuple[str, str, float]:
    """Poll Transcribe job and extract transcript text."""
    start_time = time.time()

    while time.time() - start_time < TRANSCRIBE_TIMEOUT_SECONDS:
        try:
            result = transcribe_client.get_transcription_job(
                TranscriptionJobName=job_name
            )
        except ClientError as e:
            raise ValueError(f"Failed to check transcription status: {e}")

        job = result["TranscriptionJob"]
        status = job["TranscriptionJobStatus"]

        if status == "COMPLETED":
            language = job.get("LanguageCode", "unknown")
            duration = job.get("MediaLengthSeconds", 0.0)
            text = _read_transcript(output_s3_key)
            return text, language, duration

        if status == "FAILED":
            reason = job.get("FailureReason", "Unknown reason")
            raise ValueError(f"Transcription failed: {reason}")

        time.sleep(POLL_INTERVAL_SECONDS)

    raise ValueError(f"Transcription timed out after {TRANSCRIBE_TIMEOUT_SECONDS}s")


def _read_transcript(output_s3_key: str) -> str:
    """Read plain text from Transcribe output JSON."""
    try:
        response = s3_client.get_object(Bucket=OUTPUTS_BUCKET_NAME, Key=output_s3_key)
        transcript_json = json.loads(response["Body"].read().decode("utf-8"))

        transcripts = transcript_json.get("results", {}).get("transcripts", [])
        if not transcripts:
            return ""

        return transcripts[0].get("transcript", "").strip()

    except ClientError as e:
        raise ValueError(f"Failed to read transcript from S3: {e}")


def _read_speaker_segments(output_s3_key: str) -> list[dict]:
    """
    Read speaker-labeled segments from Transcribe output JSON.

    Returns list of {"speaker": "spk_0", "text": "..."} dicts in order.
    """
    try:
        response = s3_client.get_object(Bucket=OUTPUTS_BUCKET_NAME, Key=output_s3_key)
        transcript_json = json.loads(response["Body"].read().decode("utf-8"))

        speaker_labels = transcript_json.get("results", {}).get("speaker_labels", {})
        segments = speaker_labels.get("segments", [])

        result = []
        for segment in segments:
            speaker = segment.get("speaker_label", "unknown")
            items = segment.get("items", [])
            words = []
            for item in items:
                content = item.get("alternatives", [{}])[0].get("content", "")
                if content:
                    words.append(content)
            if words:
                result.append({"speaker": speaker, "text": " ".join(words)})

        return result

    except ClientError:
        logger.warning(
            "Failed to read speaker segments, falling back to plain text",
            key=output_s3_key,
        )
        return []


def _stitch_plain_transcripts(chunk_results: list[dict]) -> str:
    """
    Stitch plain text transcripts from multiple chunks.

    Uses overlap deduplication: finds matching words at chunk boundaries
    and removes the duplicate overlap.
    """
    if not chunk_results:
        return ""

    full_text = chunk_results[0].get("text", "")

    for i in range(1, len(chunk_results)):
        chunk_text = chunk_results[i].get("text", "")
        if not chunk_text:
            continue

        if not full_text:
            full_text = chunk_text
            continue

        # Try to find overlap between end of previous and start of current
        prev_words = full_text.split()
        curr_words = chunk_text.split()

        overlap_idx = _find_overlap(prev_words[-8:], curr_words)
        if overlap_idx > 0:
            full_text += " " + " ".join(curr_words[overlap_idx:])
        else:
            full_text += " " + chunk_text

    return full_text.strip()


def _find_overlap(tail_words: list[str], next_words: list[str]) -> int:
    """
    Find where the overlap region ends in next_words.

    Looks for the longest matching sequence between the tail of the previous
    chunk and the start of the next chunk.

    Returns the index in next_words where non-overlapping content begins.
    """
    if not tail_words or not next_words:
        return 0

    # Normalize for comparison
    tail_lower = [w.lower().strip(".,!?;:") for w in tail_words]
    next_lower = [w.lower().strip(".,!?;:") for w in next_words]

    best_match = 0

    # Try matching sequences of decreasing length
    for start in range(len(tail_lower)):
        seq = tail_lower[start:]
        seq_len = len(seq)

        if seq_len > len(next_lower):
            continue

        # Check if this sequence matches the start of next_words
        if next_lower[:seq_len] == seq:
            best_match = max(best_match, seq_len)

    return best_match


def _stitch_speaker_transcripts(chunk_results: list[dict]) -> str:
    """
    Stitch speaker-diarized transcripts from multiple chunks.

    Merges consecutive segments from the same speaker across chunk boundaries.
    Output format: [Speaker 1]: text\n[Speaker 2]: text\n...
    """
    if not chunk_results:
        return ""

    # Collect all segments in order, renumbering speakers globally
    all_segments: list[dict] = []
    for cr in chunk_results:
        segments = cr.get("speaker_segments", [])
        if segments:
            all_segments.extend(segments)
        elif cr.get("text"):
            # Fallback if no speaker segments available for this chunk
            all_segments.append({"speaker": "spk_0", "text": cr["text"]})

    if not all_segments:
        # Ultimate fallback: plain text concatenation
        return _stitch_plain_transcripts(chunk_results)

    # Merge consecutive same-speaker segments
    merged: list[dict] = []
    for seg in all_segments:
        if merged and merged[-1]["speaker"] == seg["speaker"]:
            merged[-1]["text"] += " " + seg["text"]
        else:
            merged.append({"speaker": seg["speaker"], "text": seg["text"]})

    # Build speaker number mapping (spk_0 -> Speaker 1, etc.)
    speaker_map: dict[str, str] = {}
    speaker_counter = 0
    for seg in merged:
        if seg["speaker"] not in speaker_map:
            speaker_counter += 1
            speaker_map[seg["speaker"]] = f"Speaker {speaker_counter}"

    # Format output
    lines = []
    for seg in merged:
        label = speaker_map.get(seg["speaker"], seg["speaker"])
        lines.append(f"[{label}]: {seg['text']}")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════════════════


def _cleanup_s3(key: str) -> None:
    """Best-effort cleanup of temp S3 files."""
    try:
        s3_client.delete_object(Bucket=OUTPUTS_BUCKET_NAME, Key=key)
    except Exception:
        logger.warning(
            "Failed to clean up temp S3 file",
            key=key,
            exc_info=True,
        )
