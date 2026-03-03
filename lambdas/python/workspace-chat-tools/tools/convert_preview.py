"""
Convert a document for frontend preview using the document-converter Lambda.

This is a lightweight tool designed for the file preview panel. Unlike
convert_document (which saves converted files to the workspace), this tool
returns a presigned download URL directly so the frontend can fetch and
render the converted file without any workspace side effects.

Supported conversions:
- DOCX -> PDF (via LibreOffice in the document-converter Lambda)
"""

import json
import os
from typing import Any, Dict

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

REGION = os.getenv("AWS_REGION", "us-east-1")
DOCUMENT_CONVERTER_LAMBDA_NAME = os.getenv("DOCUMENT_CONVERTER_LAMBDA_NAME", "")

VALID_FORMATS = ["pdf", "docx"]


def handle_convert_preview(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a document for preview, returning a presigned download URL.

    Parameters:
        source_bucket (str, required): S3 bucket containing the source file
        source_key (str, required): S3 key of the source file
        format (str, required): Target format - 'pdf' or 'docx'

    Returns:
        Dict with url, filename, and size

    Raises:
        ValueError: If required parameters are missing or invalid
    """
    source_bucket = params.get("source_bucket")
    source_key = params.get("source_key")
    target_format = params.get("format")

    if not source_bucket:
        raise ValueError("Missing required parameter: source_bucket")
    if not source_key:
        raise ValueError("Missing required parameter: source_key")
    if not target_format:
        raise ValueError("Missing required parameter: format")
    if target_format not in VALID_FORMATS:
        raise ValueError(
            f"Invalid format '{target_format}'. Must be one of: {', '.join(VALID_FORMATS)}"
        )
    if not DOCUMENT_CONVERTER_LAMBDA_NAME:
        raise ValueError("DOCUMENT_CONVERTER_LAMBDA_NAME not configured")

    logger.info(
        "Converting document for preview",
        source_bucket=source_bucket,
        source_key=source_key[:80] + "..." if len(source_key) > 80 else source_key,
        target_format=target_format,
    )

    # Build payload for document-converter Lambda (action="file" for direct conversion)
    inner_payload = {
        "action": "file",
        "sourceBucket": source_bucket,
        "sourceKey": source_key,
        "format": target_format,
    }

    # Wrap in API Gateway event format (the Lambda expects event.body)
    converter_payload = {"body": json.dumps(inner_payload)}

    lambda_client = prm_client("lambda", region=REGION)

    try:
        response = lambda_client.invoke(
            FunctionName=DOCUMENT_CONVERTER_LAMBDA_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(converter_payload).encode("utf-8"),
        )

        if "FunctionError" in response:
            error_payload = response["Payload"].read().decode("utf-8")
            logger.error(
                "Document converter Lambda execution error", error=error_payload
            )
            raise ValueError(f"Document converter Lambda failed: {error_payload}")

        api_response = json.loads(response["Payload"].read().decode("utf-8"))
        response_payload = json.loads(api_response.get("body", "{}"))

        status_code = api_response.get("statusCode", 500)
        if status_code >= 400:
            error_msg = response_payload.get("error", f"HTTP {status_code}")
            logger.error(
                "Document conversion failed",
                error=error_msg,
                status_code=status_code,
            )
            raise ValueError(f"Document conversion failed: {error_msg}")

        if not response_payload.get("success"):
            error_msg = response_payload.get("error", "Unknown error")
            logger.error("Document conversion failed", error=error_msg)
            raise ValueError(f"Document conversion failed: {error_msg}")

        download_url = response_payload.get("downloadUrl")
        output_filename = response_payload.get("filename")
        output_size = response_payload.get("size", 0)

        if not download_url:
            raise ValueError("Document converter did not return a download URL")

        logger.info(
            "Document preview conversion succeeded",
            filename=output_filename,
            size=output_size,
        )

        return {
            "url": download_url,
            "filename": output_filename,
            "size": output_size,
        }

    except ValueError:
        raise
    except Exception as e:
        logger.error(
            "Failed to invoke document converter Lambda",
            error=str(e),
            exc_info=True,
        )
        raise ValueError(f"Failed to invoke document converter: {str(e)}") from e
