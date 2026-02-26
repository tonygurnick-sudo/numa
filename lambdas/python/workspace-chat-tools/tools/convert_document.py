"""
Convert documents between formats using the document-converter Lambda.

This tool supports two conversion modes:

1. DIRECT FILE CONVERSION (mode='file'):
   - DOCX → PDF: High quality, uses LibreOffice directly
   - PDF → DOCX: Variable quality (PDFs are presentation format)

2. MARKDOWN CONVERSION (mode='markdown', default):
   - Markdown/text → PDF: Uses Pandoc + LibreOffice
   - Markdown/text → DOCX: Uses Pandoc

For best results with PDF ↔ DOCX conversion, use mode='file' for direct conversion.
The markdown mode is better for converting text/markdown content to documents.

Security:
- Validates file_path is within allowed workspace directories
- User isolation via user_sub in S3 paths
- Conversation isolation via conversation_id in S3 paths (except chat-workflows/)
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict
from urllib.request import urlopen

import structlog

from prm import client as prm_client

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
OUTPUTS_BUCKET_NAME = os.getenv("OUTPUTS_BUCKET_NAME", "")
DOCUMENT_CONVERTER_LAMBDA_NAME = os.getenv("DOCUMENT_CONVERTER_LAMBDA_NAME", "")

# S3 prefix for workspace files
S3_PREFIX = "numa-chat/workspace"

# Workspace root path
WORKSPACE_ROOT = "/workdir"

# Blocked paths within workspace
BLOCKED_PATH_PATTERNS = [
    ".system/",
    ".system",
    "secrets/",
    "secrets",
    ".env",
]

# Valid output formats
VALID_FORMATS = ["pdf", "docx"]

# Valid input formats for direct file conversion
VALID_INPUT_FORMATS = ["pdf", "docx"]

# Valid conversion modes
VALID_MODES = ["markdown", "file"]


def _validate_workspace_path(file_path: str) -> tuple[bool, str | None]:
    """
    Validate that the file path is within allowed workspace directories.

    Args:
        file_path: Path to validate (e.g., /workdir/outputs/file.txt)

    Returns:
        (is_valid, error_message)
    """
    if not file_path:
        return False, "file_path is required"

    # Must start with workspace root
    if not file_path.startswith(WORKSPACE_ROOT):
        return False, f"Path must be within {WORKSPACE_ROOT}"

    # Check for blocked patterns
    for pattern in BLOCKED_PATH_PATTERNS:
        if pattern in file_path:
            return False, f"Access to '{pattern}' is blocked by security policy"

    # Check for path traversal attempts
    if ".." in file_path:
        return False, "Path traversal is not allowed"

    return True, None


def _get_relative_path(file_path: str) -> str:
    """
    Extract the relative path from a workspace absolute path.

    Args:
        file_path: Absolute path (e.g., /workdir/outputs/file.txt)

    Returns:
        Relative path (e.g., outputs/file.txt)
    """
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    elif file_path == WORKSPACE_ROOT:
        return ""
    return file_path


def _get_s3_key_for_file(rel_path: str, user_sub: str, conversation_id: str) -> str:
    """
    Determine the S3 key for a workspace file.

    Args:
        rel_path: Path relative to workspace root (e.g., outputs/file.txt)
        user_sub: User's Cognito sub
        conversation_id: Current conversation ID

    Returns:
        Full S3 key for the file
    """
    # chat-workflows/ is globally persistent (not scoped to conversation)
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"

    # Everything else is conversation-scoped
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def _get_output_s3_key(
    input_rel_path: str, user_sub: str, conversation_id: str, output_format: str
) -> str:
    """
    Determine the S3 key for the converted document output.

    Output is always written to outputs/ directory (conversation-scoped).

    Args:
        input_rel_path: Relative path of input file
        user_sub: User's Cognito sub
        conversation_id: Current conversation ID
        output_format: Target format (pdf or docx)

    Returns:
        Full S3 key for the output file
    """
    # Get the filename without extension
    filename = Path(input_rel_path).stem
    # Remove any "extracted_" prefix to avoid "converted_extracted_"
    if filename.startswith("extracted_"):
        filename = filename[len("extracted_") :]
    # Sanitize filename for S3 key
    safe_filename = re.sub(r"[^a-zA-Z0-9_-]", "_", filename)

    # Output goes to outputs/ with converted_ prefix
    output_rel_path = f"outputs/converted_{safe_filename}.{output_format}"

    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{output_rel_path}"


def handle_convert_document(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle convert_document tool invocation.

    Converts documents using the document-converter Lambda.

    Parameters:
        file_path (str, required): Workspace path to the input file
            (e.g., /workdir/uploads/document.docx or /workdir/outputs/extracted.txt)
        format (str, required): Output format - 'pdf' or 'docx'
        mode (str, optional): Conversion mode - 'markdown' (default) or 'file'
            - 'file': Direct DOCX↔PDF conversion using LibreOffice
            - 'markdown': Convert markdown/text to PDF/DOCX using Pandoc
        title (str, optional): Document title (used for filename)
        __user_sub (str, internal): User's Cognito sub for S3 path
        __conversation_id (str, internal): Conversation ID for S3 path

    Returns:
        Dict with output_path, s3_key, and message

    Raises:
        ValueError: If required parameters missing or invalid
    """
    # Extract parameters
    file_path = params.get("file_path")
    output_format = params.get("format")
    mode = params.get(
        "mode", "markdown"
    )  # Default to markdown for backwards compatibility
    title = params.get("title")
    user_sub = params.get("__user_sub", "")
    conversation_id = params.get("__conversation_id", "")

    # Validate required parameters
    if not file_path:
        raise ValueError("Missing required parameter: file_path")

    if not output_format:
        raise ValueError("Missing required parameter: format")

    if output_format not in VALID_FORMATS:
        raise ValueError(
            f"Invalid format '{output_format}'. Must be one of: {', '.join(VALID_FORMATS)}"
        )

    if mode not in VALID_MODES:
        raise ValueError(
            f"Invalid mode '{mode}'. Must be one of: {', '.join(VALID_MODES)}"
        )

    if not user_sub:
        raise ValueError("Missing user context: user_sub not provided")

    if not conversation_id:
        raise ValueError("Missing conversation context: conversation_id not provided")

    # For file mode, validate input format and conversion makes sense
    if mode == "file":
        file_ext = Path(file_path).suffix.lower().lstrip(".")
        if file_ext not in VALID_INPUT_FORMATS:
            raise ValueError(
                f"For mode='file', input must be .pdf or .docx (got .{file_ext})"
            )
        if file_ext == output_format:
            raise ValueError(
                f"Input and output format are the same ({file_ext}). No conversion needed."
            )

    # Validate workspace path
    is_valid, error = _validate_workspace_path(file_path)
    if not is_valid:
        raise ValueError(f"Invalid file path: {error}")

    # Check configuration
    if not OUTPUTS_BUCKET_NAME:
        raise ValueError("OUTPUTS_BUCKET_NAME not configured")

    if not DOCUMENT_CONVERTER_LAMBDA_NAME:
        raise ValueError("DOCUMENT_CONVERTER_LAMBDA_NAME not configured")

    # Get relative path and S3 keys
    rel_path = _get_relative_path(file_path)
    input_s3_key = _get_s3_key_for_file(rel_path, user_sub, conversation_id)
    output_s3_key = _get_output_s3_key(
        rel_path, user_sub, conversation_id, output_format
    )

    logger.info(
        "Converting document",
        file_path=file_path,
        format=output_format,
        mode=mode,
        input_s3_key=input_s3_key,
        output_s3_key=output_s3_key,
        user_sub=user_sub[:8] + "..." if user_sub else "",
    )

    # Initialize clients
    s3_client = prm_client("s3", region=REGION)
    lambda_client = prm_client("lambda", region=REGION)

    # Build the inner payload based on mode
    if mode == "file":
        # Direct file conversion (DOCX ↔ PDF)
        # Pass S3 location to converter, it will fetch the file directly
        inner_payload = {
            "action": "file",
            "sourceBucket": OUTPUTS_BUCKET_NAME,
            "sourceKey": input_s3_key,
            "format": output_format,
        }
        if title:
            inner_payload["title"] = title

        logger.info(
            "Using direct file conversion",
            source_key=input_s3_key,
            target_format=output_format,
        )
    else:
        # Markdown conversion (existing behavior)
        # Read markdown content from S3
        try:
            response = s3_client.get_object(
                Bucket=OUTPUTS_BUCKET_NAME, Key=input_s3_key
            )
            markdown_content = response["Body"].read().decode("utf-8")

            logger.info(
                "Read input markdown from S3",
                content_length=len(markdown_content),
            )
        except Exception as e:
            logger.error(
                "Failed to read input file from S3",
                error=str(e),
                input_s3_key=input_s3_key,
            )
            raise ValueError(f"Failed to read input file: {str(e)}") from e

        inner_payload = {
            "action": "markdown",
            "markdown": markdown_content,
            "format": output_format,
        }
        if title:
            inner_payload["title"] = title

    # Wrap in API Gateway event format (the Lambda expects event.body)
    converter_payload = {
        "body": json.dumps(inner_payload),
    }

    try:
        response = lambda_client.invoke(
            FunctionName=DOCUMENT_CONVERTER_LAMBDA_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(converter_payload).encode("utf-8"),
        )

        # Check for Lambda-level errors
        if "FunctionError" in response:
            error_payload = response["Payload"].read().decode("utf-8")
            logger.error(
                "Document converter Lambda execution error",
                error=error_payload,
            )
            raise ValueError(f"Document converter Lambda failed: {error_payload}")

        # Parse response (returns API Gateway format with statusCode, headers, body)
        api_response = json.loads(response["Payload"].read().decode("utf-8"))

        # Parse the nested body (the actual response content)
        response_payload = json.loads(api_response.get("body", "{}"))

        # Check HTTP status code
        status_code = api_response.get("statusCode", 500)
        if status_code >= 400:
            error_msg = response_payload.get("error", f"HTTP {status_code}")
            logger.error(
                "Document conversion failed",
                error=error_msg,
                status_code=status_code,
            )
            raise ValueError(f"Document conversion failed: {error_msg}")

        # Check for application-level errors
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
            "Document converter succeeded",
            filename=output_filename,
            size=output_size,
        )

    except ValueError:
        raise
    except Exception as e:
        logger.error(
            "Failed to invoke document converter Lambda",
            error=str(e),
            exc_info=True,
        )
        raise ValueError(f"Failed to invoke document converter: {str(e)}") from e

    # Download the converted document from the presigned URL
    try:
        with urlopen(download_url) as response:
            converted_content = response.read()

        logger.info(
            "Downloaded converted document",
            content_length=len(converted_content),
        )
    except Exception as e:
        logger.error(
            "Failed to download converted document",
            error=str(e),
            download_url=download_url[:100] + "...",
        )
        raise ValueError(f"Failed to download converted document: {str(e)}") from e

    # Upload the converted document to workspace S3 path
    try:
        content_type = (
            "application/pdf"
            if output_format == "pdf"
            else (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            )
        )

        s3_client.put_object(
            Bucket=OUTPUTS_BUCKET_NAME,
            Key=output_s3_key,
            Body=converted_content,
            ContentType=content_type,
        )

        logger.info(
            "Uploaded converted document to workspace S3",
            output_s3_key=output_s3_key,
            content_length=len(converted_content),
        )
    except Exception as e:
        logger.error(
            "Failed to upload converted document to S3",
            error=str(e),
            output_s3_key=output_s3_key,
        )
        raise ValueError(f"Failed to upload converted document: {str(e)}") from e

    # Return the output path in workspace format
    output_rel_path = output_s3_key.replace(
        f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/", ""
    )
    output_workspace_path = f"{WORKSPACE_ROOT}/{output_rel_path}"

    return {
        "message": f"Document converted successfully to {output_workspace_path}",
        "output_path": output_workspace_path,
        "s3_key": output_s3_key,
        "original_file": file_path,
        "format": output_format,
        "mode": mode,
        "size": len(converted_content),
    }
