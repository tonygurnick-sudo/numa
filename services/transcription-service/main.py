"""Fargate entrypoint for long-running transcription jobs.

Reads job parameters from environment variables, downloads the source file
from S3, processes it, and writes output back to S3. Updates DynamoDB with
progress and final status throughout.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time

import boto3
import structlog

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ]
)
logger = structlog.get_logger(__name__)

# ─── Configuration from environment ───
JOB_ID = os.environ["JOB_ID"]
USER_SUB = os.environ["USER_SUB"]
FILE_BUCKET = os.environ["FILE_BUCKET"]
FILE_KEY = os.environ["FILE_KEY"]
FILE_NAME = os.environ.get("FILE_NAME", os.path.basename(FILE_KEY))
OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET", FILE_BUCKET)
TABLE_NAME = os.environ["TABLE_NAME"]
CLIENT_NAME = os.environ["CLIENT_NAME"]
REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))
JOB_QUEUE_URL = os.environ.get("JOB_QUEUE_URL", "")
DATA_BUCKET_NAME = os.environ.get("DATA_BUCKET_NAME", OUTPUT_BUCKET)

OUTPUT_KEY = f"transcriptions/{USER_SUB}/{JOB_ID}/output.json"

# ─── AWS clients ───
s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

# ─── Cancellation flag ───
_cancelled = threading.Event()

# ─── Fargate-only format extensions ───
FARGATE_FORMATS = {
    ".epub",
    ".djvu",
    ".parquet",
    ".sqlite",
    ".db",
    ".zip",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".gz",
    ".svg",
}


def update_status(status: str, **extra: object) -> None:
    """Update DynamoDB job record with status and optional extra fields."""
    expr_parts = ["#s = :status", "updatedAt = :now"]
    attr_names = {"#s": "status"}
    attr_values = {":status": status, ":now": int(time.time() * 1000)}

    for key, value in extra.items():
        expr_parts.append(f"{key} = :{key}")
        attr_values[f":{key}"] = value

    table.update_item(
        Key={"userSub": USER_SUB, "jobId": JOB_ID},
        UpdateExpression=f"SET {', '.join(expr_parts)}",
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )


def check_cancelled() -> bool:
    """Poll DynamoDB to see if the job has been cancelled."""
    resp = table.get_item(Key={"userSub": USER_SUB, "jobId": JOB_ID})
    item = resp.get("Item", {})
    if item.get("status") == "CANCEL_REQUESTED":
        _cancelled.set()
        return True
    return False


def cancellation_poller(interval: int = 60) -> None:
    """Background thread that polls for cancellation every N seconds."""
    while not _cancelled.is_set():
        try:
            if check_cancelled():
                logger.info("Cancellation detected by poller")
                return
        except Exception:
            logger.warning("Cancellation poll failed", exc_info=True)
        _cancelled.wait(timeout=interval)


def download_file(local_path: str) -> None:
    """Download the source file from S3."""
    logger.info("Downloading source file", bucket=FILE_BUCKET, key=FILE_KEY)
    s3.download_file(FILE_BUCKET, FILE_KEY, local_path)
    size = os.path.getsize(local_path)
    logger.info("Downloaded", size_mb=round(size / (1024 * 1024), 2))


def get_extension() -> str:
    """Get lowercase file extension from the file key."""
    key_lower = FILE_KEY.lower()
    # Handle compound extensions
    for compound in (".tar.gz",):
        if key_lower.endswith(compound):
            return compound
    _, ext = os.path.splitext(key_lower)
    return ext


def process_file(local_path: str) -> dict:
    """Route file to appropriate handler and return Document dict.

    All formats are handled natively — no Lambda callback needed.
    """
    ext = get_extension()
    logger.info("Processing file", extension=ext, file_name=FILE_NAME)

    pages = _route_to_handler(local_path, ext)

    total_words = sum(p.get("num_words", 0) for p in pages)
    return {
        "name": FILE_NAME,
        "num_pages": len(pages),
        "total_num_words": total_words,
        "pages": pages,
    }


# ─── Format sets ───

_TEXT_EXTS = {
    ".txt",
    ".md",
    ".markdown",
    ".xml",
    ".yaml",
    ".yml",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".py",
    ".sql",
    ".sh",
    ".bash",
    ".log",
    ".adoc",
    ".bib",
    ".rst",
    ".org",
    ".typ",
    ".cfg",
    ".conf",
    ".ini",
    ".tex",
    ".less",
    ".scss",
    ".json",
}

_IMAGE_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".tif",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".heif",
}

_AUDIO_VIDEO_EXTS = {
    ".mp3",
    ".mp4",
    ".wav",
    ".flac",
    ".ogg",
    ".amr",
    ".webm",
    ".m4a",
    ".mov",
    ".avi",
    ".mkv",
    ".aac",
    ".wma",
}

_LIBREOFFICE_EXTS = {
    ".doc",
    ".xls",
    ".ppt",
    ".pptx",
    ".rtf",
    ".odt",
    ".ods",
    ".odp",
    ".pages",
    ".key",
    ".numbers",
}


def _route_to_handler(local_path: str, ext: str) -> list[dict]:
    """Route a file to the correct native handler by extension."""

    # ── Archives ──
    if ext in (".zip", ".tar", ".tar.gz", ".tgz", ".gz"):
        from handlers.archive import extract_and_split_archive

        return extract_and_split_archive(
            local_path,
            user_sub=USER_SUB,
            parent_job_id=JOB_ID,
            client_name=CLIENT_NAME,
            data_bucket=DATA_BUCKET_NAME,
            table_name=TABLE_NAME,
            queue_url=JOB_QUEUE_URL,
            region=REGION,
        )

    # ── PDF ──
    if ext == ".pdf":
        from handlers.pdf import extract_pdf

        return extract_pdf(local_path)

    # ── DOCX ──
    if ext == ".docx":
        from handlers.docx_handler import extract_docx

        return extract_docx(local_path)

    # ── XLSX ──
    if ext == ".xlsx":
        from handlers.xlsx_handler import extract_xlsx

        return extract_xlsx(local_path)

    # ── EPUB ──
    if ext == ".epub":
        from handlers.epub import extract_epub

        return extract_epub(local_path)

    # ── DjVu ──
    if ext == ".djvu":
        return _extract_djvu(local_path)

    # ── Parquet ──
    if ext == ".parquet":
        from handlers.parquet_handler import extract_parquet

        return extract_parquet(local_path)

    # ── SQLite ──
    if ext in (".sqlite", ".db"):
        from handlers.sqlite_handler import extract_sqlite

        return extract_sqlite(local_path)

    # ── SVG ──
    if ext == ".svg":
        return _extract_svg(local_path)

    # ── Email ──
    if ext == ".eml":
        from handlers.email_handler import extract_eml

        return extract_eml(local_path)

    if ext == ".msg":
        from handlers.email_handler import extract_msg

        return extract_msg(local_path)

    # ── Calendar / Contacts ──
    if ext == ".ics":
        from handlers.email_handler import extract_ics

        return extract_ics(local_path)

    if ext == ".vcf":
        from handlers.email_handler import extract_vcf

        return extract_vcf(local_path)

    # ── Jupyter Notebook ──
    if ext == ".ipynb":
        from handlers.notebook_handler import extract_ipynb

        return extract_ipynb(local_path)

    # ── CSV / TSV ──
    if ext == ".csv":
        from handlers.csv_handler import extract_csv

        return extract_csv(local_path, delimiter=",")

    if ext == ".tsv":
        from handlers.csv_handler import extract_csv

        return extract_csv(local_path, delimiter="\t")

    # ── JSONL ──
    if ext == ".jsonl":
        from handlers.csv_handler import extract_jsonl

        return extract_jsonl(local_path)

    # ── Images (Pillow + Bedrock vision) ──
    if ext in _IMAGE_EXTS:
        from handlers.image_handler import extract_image

        return extract_image(local_path, ext)

    # ── Audio / Video (AWS Transcribe) ──
    if ext in _AUDIO_VIDEO_EXTS:
        from handlers.audio_handler import extract_audio

        return extract_audio(local_path, ext, FILE_BUCKET, FILE_KEY)

    # ── LibreOffice-convertible formats ──
    if ext in _LIBREOFFICE_EXTS:
        from handlers.office_handler import extract_via_libreoffice

        return extract_via_libreoffice(local_path, ext)

    # ── Plain text fallback ──
    if ext in _TEXT_EXTS:
        with open(local_path, "r", errors="replace") as f:
            content = f.read()
        return [{"page_number": 1, "num_words": len(content.split()), "text": content}]

    # ── Unknown format ──
    return [{"page_number": 1, "num_words": 0, "text": f"(Unsupported format: {ext})"}]


def _extract_djvu(file_path: str) -> list[dict]:
    """Convert DjVu pages to text via ddjvu CLI."""
    try:
        result = subprocess.run(
            ["ddjvu", "-format=utf8", file_path, "-"],
            capture_output=True,
            timeout=600,
        )
        text = result.stdout.decode("utf-8", errors="replace")
        if not text.strip():
            text = "(DjVu document — text extraction returned empty result)"
    except FileNotFoundError:
        text = "(DjVu extraction unavailable — djvulibre-bin not installed)"
    except subprocess.TimeoutExpired:
        text = "(DjVu extraction timed out)"

    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]


def _extract_svg(file_path: str) -> list[dict]:
    """Convert SVG → PNG via cairosvg, describe as text.

    In production with Bedrock vision access, this would send the PNG to
    the vision model. For now, we extract any embedded text from the SVG XML.
    """
    import re
    from html import unescape

    with open(file_path, "r", errors="replace") as f:
        svg_content = f.read()

    # Extract text content from SVG <text> elements
    text_elements = re.findall(r"<text[^>]*>(.*?)</text>", svg_content, re.DOTALL)
    tag_re = re.compile(r"<[^>]+>")
    texts = [unescape(tag_re.sub("", t)).strip() for t in text_elements if t.strip()]

    if texts:
        text = "# SVG Text Content\n\n" + "\n".join(texts)
    else:
        text = "(SVG image — no extractable text content)"

    return [{"page_number": 1, "num_words": len(text.split()), "text": text}]


def _build_resource_usage(processing_time_ms: int) -> dict:
    """Build resource usage metadata for billing/cost calculation later."""
    return {
        "fargate": {
            "vcpu": 2,
            "memoryGb": 4,
            "arch": "ARM64",
            "durationMs": processing_time_ms,
        },
        "s3": {"reads": 1, "writes": 1},
        "total": 0,
    }


def main() -> None:
    """Main entrypoint for the Fargate task."""
    logger.info(
        "Starting transcription job",
        job_id=JOB_ID,
        user_sub=USER_SUB,
        file_key=FILE_KEY,
        file_name=FILE_NAME,
    )

    # Check for pre-start cancellation
    if check_cancelled():
        update_status("CANCELLED")
        logger.info("Job was cancelled before start")
        return

    # Mark as processing
    update_status("PROCESSING", progress=0)
    start_time = time.time()

    # Start cancellation poller in background
    poller = threading.Thread(target=cancellation_poller, daemon=True)
    poller.start()

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=get_extension()) as tmp:
            local_path = tmp.name

        download_file(local_path)
        update_status("PROCESSING", progress=10)

        if _cancelled.is_set():
            update_status("CANCELLED")
            logger.info("Job cancelled during download")
            return

        # Process the file
        document = process_file(local_path)
        update_status("PROCESSING", progress=80)

        if _cancelled.is_set():
            update_status("CANCELLED")
            logger.info("Job cancelled during processing")
            return

        # Write output to S3
        output_content = json.dumps(document, indent=2).encode("utf-8")
        s3.put_object(
            Body=output_content,
            Bucket=OUTPUT_BUCKET,
            Key=OUTPUT_KEY,
            ContentType="application/json",
        )

        processing_time_ms = int((time.time() - start_time) * 1000)
        costs = _build_resource_usage(processing_time_ms)

        update_status(
            "COMPLETED",
            outputKey=OUTPUT_KEY,
            progress=100,
            processingTimeMs=processing_time_ms,
            costs=costs,
        )
        logger.info(
            "Job completed successfully",
            output_key=OUTPUT_KEY,
            processing_time_ms=processing_time_ms,
            total_cost=costs["total"],
        )

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        error_message = str(e)
        logger.error("Job failed", error=error_message, exc_info=True)
        update_status(
            "FAILED", errorMessage=error_message, processingTimeMs=processing_time_ms
        )
        sys.exit(1)

    finally:
        _cancelled.set()  # Stop the poller
        try:
            os.unlink(local_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
