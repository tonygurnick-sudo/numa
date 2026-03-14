"""Archive (ZIP, TAR) extraction — recursive unpack into child transcription jobs."""

import json
import os
import tarfile
import tempfile
import time
import uuid
import zipfile

import boto3
import structlog

logger = structlog.get_logger(__name__)

MAX_DEPTH = 5
MAX_FILES = 500
MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB
ARCHIVE_EXTENSIONS = {".zip", ".tar", ".tar.gz", ".tgz", ".gz"}
# 90 days TTL for child jobs (same as parent)
TTL_SECONDS = 90 * 24 * 60 * 60


def _is_archive(path: str) -> bool:
    lower = path.lower()
    for ext in ARCHIVE_EXTENSIONS:
        if lower.endswith(ext):
            return True
    return False


def _get_extension(path: str) -> str:
    lower = path.lower()
    for compound in (".tar.gz",):
        if lower.endswith(compound):
            return compound
    _, ext = os.path.splitext(lower)
    return ext


def _safe_filename(name: str) -> str:
    """Sanitize a filename for use as an S3 key segment."""
    return name.replace("\x00", "").replace("..", "_").strip("/")


def _extract_to_dir(archive_path: str, dest_dir: str) -> None:
    """Extract an archive to a destination directory."""
    ext = _get_extension(archive_path)
    if ext == ".zip":
        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(dest_dir)
    elif ext in (".tar", ".tar.gz", ".tgz"):
        with tarfile.open(archive_path, "r:*") as tf:
            tf.extractall(dest_dir, filter="data")
    elif ext == ".gz":
        import gzip
        import shutil

        out_name = os.path.basename(archive_path)
        if out_name.endswith(".gz"):
            out_name = out_name[:-3]
        out_path = os.path.join(dest_dir, out_name or "decompressed")
        with gzip.open(archive_path, "rb") as gz_in:
            with open(out_path, "wb") as f_out:
                shutil.copyfileobj(gz_in, f_out)


def _walk_recursive(
    archive_path: str, dest_dir: str, depth: int = 0
) -> list[tuple[str, str]]:
    """Recursively extract archives and return list of (abs_path, relative_name) for leaf files."""
    if depth > MAX_DEPTH:
        logger.warning("Max archive depth reached", depth=depth)
        return []

    _extract_to_dir(archive_path, dest_dir)

    results: list[tuple[str, str]] = []
    for root, _dirs, files in os.walk(dest_dir):
        for fname in files:
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, dest_dir)

            if _is_archive(fname):
                # Recursively extract nested archives
                nested_dir = tempfile.mkdtemp(prefix="nested_")
                try:
                    nested = _walk_recursive(abs_path, nested_dir, depth + 1)
                    # Prefix nested results with the archive name
                    archive_prefix = rel_path.rsplit(".", 1)[0]
                    for nested_abs, nested_rel in nested:
                        results.append((nested_abs, f"{archive_prefix}/{nested_rel}"))
                except Exception as e:
                    logger.warning(
                        "Failed to extract nested archive",
                        archive=rel_path,
                        error=str(e),
                    )
            else:
                results.append((abs_path, rel_path))

    return results


def extract_and_split_archive(
    file_path: str,
    user_sub: str,
    parent_job_id: str,
    client_name: str,
    data_bucket: str,
    table_name: str,
    queue_url: str,
    region: str,
) -> list[dict]:
    """Extract archive recursively. Upload each file to S3 and create child transcription jobs.

    Returns a pages list summarising what was extracted (for the parent job output).
    """
    s3 = boto3.client("s3", region_name=region)
    dynamodb = boto3.resource("dynamodb", region_name=region)
    sqs = boto3.client("sqs", region_name=region)
    table = dynamodb.Table(table_name)

    extract_dir = tempfile.mkdtemp(prefix="archive_")
    now_ms = int(time.time() * 1000)
    expires_at = int(time.time()) + TTL_SECONDS

    try:
        leaf_files = _walk_recursive(file_path, extract_dir)
    except Exception as e:
        logger.error("Archive extraction failed", error=str(e))
        return [
            {
                "page_number": 1,
                "num_words": 0,
                "text": f"Archive extraction failed: {e}",
            }
        ]

    # Apply limits
    total_size = 0
    truncated = False
    limited_files: list[tuple[str, str]] = []
    for abs_path, rel_path in leaf_files:
        if len(limited_files) >= MAX_FILES:
            truncated = True
            break
        fsize = os.path.getsize(abs_path)
        total_size += fsize
        if total_size > MAX_TOTAL_SIZE:
            truncated = True
            break
        limited_files.append((abs_path, rel_path))

    # Create child jobs
    child_summaries: list[str] = []
    child_count = 0

    for abs_path, rel_path in limited_files:
        safe_rel = _safe_filename(rel_path)
        file_size = os.path.getsize(abs_path)
        ext = _get_extension(rel_path)
        child_job_id = f"arc-{uuid.uuid4().hex[:12]}"
        child_file_key = f"transcriptions/uploads/{user_sub}/{parent_job_id}/{safe_rel}"

        try:
            # Upload extracted file to S3 (data bucket)
            s3.upload_file(abs_path, data_bucket, child_file_key)

            # Create DynamoDB record for child job
            table.put_item(
                Item={
                    "userSub": user_sub,
                    "jobId": child_job_id,
                    "fileName": os.path.basename(rel_path),
                    "fileKey": child_file_key,
                    "fileSize": file_size,
                    "fileExtension": ext,
                    "status": "QUEUED",
                    "clientName": client_name,
                    "dataBucket": data_bucket,
                    "parentJobId": parent_job_id,
                    "createdAt": now_ms,
                    "updatedAt": now_ms,
                    "expiresAt": expires_at,
                }
            )

            # Enqueue child job for processing
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps(
                    {
                        "jobId": child_job_id,
                        "userSub": user_sub,
                        "fileName": os.path.basename(rel_path),
                        "fileKey": child_file_key,
                        "fileExtension": ext,
                        "fileSize": file_size,
                        "dataBucket": data_bucket,
                        "clientName": client_name,
                    }
                ),
            )

            child_count += 1
            size_kb = file_size / 1024
            child_summaries.append(
                f"- `{rel_path}` ({size_kb:.1f} KB) → job `{child_job_id}`"
            )
            logger.info(
                "Created child job",
                child_job_id=child_job_id,
                file=rel_path,
                size=file_size,
            )

        except Exception as e:
            logger.error("Failed to create child job", file=rel_path, error=str(e))
            child_summaries.append(f"- `{rel_path}` — **FAILED**: {e}")

    # Build parent job output summary
    lines = [
        f"# Archive Extraction Summary\n",
        f"**Files extracted**: {child_count}",
        f"**Total size**: {total_size / (1024 * 1024):.1f} MB",
    ]
    if truncated:
        lines.append(
            f"\n**(Limits reached — max {MAX_FILES} files / {MAX_TOTAL_SIZE // (1024**3)} GB)**"
        )
    lines.append(f"\n## Child Jobs\n")
    lines.extend(child_summaries)

    text = "\n".join(lines)
    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]
