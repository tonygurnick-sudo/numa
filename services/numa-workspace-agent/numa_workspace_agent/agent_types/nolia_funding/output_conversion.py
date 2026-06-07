"""Output conversion helpers — Markdown → PDF and DOCX.

Used by the orchestrators (assess + compare) after the render phase writes
a Markdown document to ``/workdir/outputs/``. Invokes the existing
``document-converter`` Lambda for both conversions so we reuse the same
LibreOffice plumbing that handles ingest conversions elsewhere.

The Lambda expects to read from S3, so we upload the MD to the run's
outputs prefix first, then invoke the converter, then download the
converted artefacts back to ``/workdir/outputs/``. S3 cleanup of the
intermediate upload isn't necessary — the MD belongs in outputs anyway
and will sync up at the end.
"""

import json
import os
from pathlib import Path
from typing import Optional

import boto3
import structlog
from botocore.config import Config

logger = structlog.get_logger()

OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DOCUMENT_CONVERTER_LAMBDA = os.environ.get("DOCUMENT_CONVERTER_LAMBDA_NAME", "")


async def convert_md_to_pdf_and_docx(
    md_path: Path,
    s3_prefix: str,
) -> dict[str, Optional[Path]]:
    """Convert a Markdown file to PDF and DOCX alongside.

    Args:
        md_path: Local path to the MD file (e.g. /workdir/outputs/Assessment_X.md).
        s3_prefix: S3 prefix for this run (e.g. v2-apps/nolia-funding/{user}/{conv}).
            Used to upload the MD for the converter to read.

    Returns:
        Dict with keys "pdf" and "docx" mapping to the local Paths of the
        converted files, or None if conversion failed for that format. The
        MD file is untouched.
    """
    if not md_path.exists():
        logger.warning(
            "MD file not found — cannot convert",
            _name="NOLIA_FUNDING_CONVERT_NO_MD",
            path=str(md_path),
        )
        return {"pdf": None, "docx": None}

    if not DOCUMENT_CONVERTER_LAMBDA or not OUTPUTS_BUCKET:
        logger.warning(
            "Converter not configured — skipping PDF/DOCX generation",
            _name="NOLIA_FUNDING_CONVERT_NO_CONFIG",
            has_lambda=bool(DOCUMENT_CONVERTER_LAMBDA),
            has_bucket=bool(OUTPUTS_BUCKET),
        )
        return {"pdf": None, "docx": None}

    # Upload MD to S3 so the Lambda can read it.
    s3 = boto3.client("s3", region_name=AWS_REGION)
    md_s3_key = f"{s3_prefix}/outputs/{md_path.name}"
    try:
        s3.upload_file(
            str(md_path),
            OUTPUTS_BUCKET,
            md_s3_key,
            ExtraArgs={"ContentType": "text/markdown"},
        )
    except Exception as e:
        logger.error(
            "Failed to upload MD for conversion",
            _name="NOLIA_FUNDING_CONVERT_UPLOAD_FAIL",
            path=str(md_path),
            error=str(e),
        )
        return {"pdf": None, "docx": None}

    results: dict[str, Optional[Path]] = {"pdf": None, "docx": None}
    for fmt in ("pdf", "docx"):
        results[fmt] = await _convert_via_lambda(
            md_s3_key=md_s3_key, md_path=md_path, target_format=fmt
        )

    return results


async def _convert_via_lambda(
    md_s3_key: str,
    md_path: Path,
    target_format: str,
) -> Optional[Path]:
    """Invoke document-converter Lambda for a single target format.

    Returns the local Path of the converted file on success, or None on
    failure. On failure, logs the error — doesn't raise, so the caller can
    try other formats and still produce partial artefacts.
    """
    lambda_client = boto3.client(
        "lambda",
        region_name=AWS_REGION,
        config=Config(read_timeout=300, connect_timeout=10),
    )

    payload = json.dumps(
        {
            "body": json.dumps(
                {
                    "action": "file",
                    "format": target_format,
                    "sourceBucket": OUTPUTS_BUCKET,
                    "sourceKey": md_s3_key,
                }
            )
        }
    ).encode("utf-8")

    try:
        response = lambda_client.invoke(
            FunctionName=DOCUMENT_CONVERTER_LAMBDA,
            InvocationType="RequestResponse",
            Payload=payload,
        )
    except Exception as e:
        logger.error(
            "document-converter invoke failed",
            _name="NOLIA_FUNDING_CONVERT_INVOKE_FAIL",
            target_format=target_format,
            error=str(e),
        )
        return None

    try:
        response_payload = json.loads(response["Payload"].read())
        body = (
            json.loads(response_payload["body"])
            if "body" in response_payload
            else response_payload
        )
    except Exception as e:
        logger.error(
            "document-converter response parse failed",
            _name="NOLIA_FUNDING_CONVERT_PARSE_FAIL",
            target_format=target_format,
            error=str(e),
        )
        return None

    if not body.get("success"):
        logger.error(
            "document-converter returned failure",
            _name="NOLIA_FUNDING_CONVERT_FAIL",
            target_format=target_format,
            error=body.get("error", "unknown"),
        )
        return None

    download_url = body.get("downloadUrl")
    if not download_url:
        logger.error(
            "document-converter returned no downloadUrl",
            _name="NOLIA_FUNDING_CONVERT_NO_URL",
            target_format=target_format,
        )
        return None

    # Write to /workdir/outputs/ with the same stem as the MD.
    # Stream the presigned URL straight to the final path atomically
    # (temp + fsync + os.replace) instead of buffering the whole file in RAM.
    target_path = md_path.with_suffix(f".{target_format}")
    try:
        from ...atomic_io import atomic_download_url

        atomic_download_url(download_url, target_path)
    except Exception as e:
        logger.error(
            "Failed to download converted artefact",
            _name="NOLIA_FUNDING_CONVERT_DOWNLOAD_FAIL",
            target_format=target_format,
            error=str(e),
        )
        return None

    logger.info(
        "Converted MD",
        _name="NOLIA_FUNDING_CONVERT_OK",
        target_format=target_format,
        target_path=str(target_path),
        size_bytes=target_path.stat().st_size,
    )

    return target_path
