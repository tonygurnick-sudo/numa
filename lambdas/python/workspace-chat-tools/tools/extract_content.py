"""
Extract content from workspace files using the extract-content-from-file Lambda.

This tool enables the workspace agent to extract text content from files
(PDFs, images, DOCX, Excel, audio/video, etc.) using advanced OCR and vision AI.

For vision-extracted formats (PDF, DOCX, images), large files are automatically
split into 100-page chunks and processed in parallel for reliability and speed.

Security:
- Validates file_path is within allowed workspace directories
- User isolation via user_sub in S3 paths
- Conversation isolation via conversation_id in S3 paths (except chat-workflows/)
"""

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict

import structlog
from botocore.config import Config

from prm import client as prm_client

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
OUTPUTS_BUCKET_NAME = os.getenv("OUTPUTS_BUCKET_NAME", "")
EXTRACT_CONTENT_LAMBDA_NAME = os.getenv("EXTRACT_CONTENT_LAMBDA_NAME", "")

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

# Chunked extraction settings
CHUNK_SIZE = 100  # Pages per chunk — matches extract-content-from-file default
MAX_PARALLEL_CHUNKS = 10  # Max concurrent extract_chunk Lambda invocations

# File extensions that use vision AI extraction (and benefit from chunking)
VISION_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".doc",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".bmp",
    ".gif",
}


def _validate_workspace_path(file_path: str) -> tuple[bool, str | None]:
    """
    Validate that the file path is within allowed workspace directories.

    Args:
        file_path: Path to validate (e.g., /workdir/uploads/file.pdf)

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
        file_path: Absolute path (e.g., /workdir/uploads/file.pdf)

    Returns:
        Relative path (e.g., uploads/file.pdf)
    """
    # Remove /workdir/ prefix
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    elif file_path == WORKSPACE_ROOT:
        return ""
    return file_path


def _get_s3_key_for_file(rel_path: str, user_sub: str, conversation_id: str) -> str:
    """
    Determine the S3 key for a workspace file.

    Args:
        rel_path: Path relative to workspace root (e.g., uploads/file.pdf)
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


def _get_output_s3_key(input_rel_path: str, user_sub: str, conversation_id: str) -> str:
    """
    Determine the S3 key for the extracted content output.

    Output is always written to outputs/ directory (conversation-scoped).

    Args:
        input_rel_path: Relative path of input file
        user_sub: User's Cognito sub
        conversation_id: Current conversation ID

    Returns:
        Full S3 key for the output file
    """
    # Get the filename without extension
    filename = Path(input_rel_path).stem
    # Sanitize filename for S3 key
    safe_filename = re.sub(r"[^a-zA-Z0-9_-]", "_", filename)

    # Output goes to outputs/ with extracted_ prefix
    output_rel_path = f"outputs/extracted_{safe_filename}.txt"

    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{output_rel_path}"


# ── Lambda invocation helpers ────────────────────────────────────────────────


def _invoke_extract_lambda(lambda_client, payload: dict) -> dict:
    """Invoke extract-content-from-file Lambda synchronously.

    This is a blocking call — use ThreadPoolExecutor for parallel invocations.
    """
    response = lambda_client.invoke(
        FunctionName=EXTRACT_CONTENT_LAMBDA_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )

    if "FunctionError" in response:
        error_payload = response["Payload"].read().decode("utf-8")
        raise RuntimeError(f"Extract Lambda execution error: {error_payload}")

    result_bytes = response["Payload"].read()
    result = json.loads(result_bytes)

    if isinstance(result, dict) and "errorMessage" in result:
        raise RuntimeError(
            f"Extraction Lambda error (action={payload.get('action')}): "
            f"{result['errorMessage']}"
        )

    return result


def _handle_chunked_extraction(
    lambda_client,
    input_bucket: str,
    input_s3_key: str,
    output_bucket: str,
    extract_output_key: str,
    filename: str,
) -> None:
    """Orchestrate chunked parallel extraction for vision-extracted files.

    Calls the extract-content-from-file Lambda with 3 actions:
    1. prepare_chunks — convert pages to images, define chunks
    2. extract_chunk — extract text from each chunk (parallel)
    3. merge_chunks — combine into final document JSON
    """
    extract_start = time.monotonic()

    # Step 1: Prepare chunks
    step1_start = time.monotonic()
    logger.info(
        "Chunked extraction step 1/3: preparing chunks",
        filename=filename,
        input_key=input_s3_key,
    )

    prepare_result = _invoke_extract_lambda(
        lambda_client,
        {
            "action": "prepare_chunks",
            "input_bucket": input_bucket,
            "input_key": input_s3_key,
            "chunk_size": CHUNK_SIZE,
        },
    )

    chunks = prepare_result["chunks"]
    temp_prefix = prepare_result["temp_prefix"]
    total_pages = prepare_result.get("total_pages", 0)
    step1_dur = time.monotonic() - step1_start

    logger.info(
        "Chunked extraction step 1/3 complete",
        total_pages=total_pages,
        num_chunks=len(chunks),
        duration_s=round(step1_dur, 1),
    )

    # Step 2: Extract chunks in parallel
    step2_start = time.monotonic()
    logger.info(
        f"Chunked extraction step 2/3: extracting {len(chunks)} chunks "
        f"(max {MAX_PARALLEL_CHUNKS} concurrent)",
    )

    chunk_results = []
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_CHUNKS) as executor:
        futures = {}
        for chunk in chunks:
            future = executor.submit(
                _invoke_extract_lambda,
                lambda_client,
                {
                    "action": "extract_chunk",
                    "chunk_id": chunk["chunk_id"],
                    "start_page": chunk["start_page"],
                    "end_page": chunk["end_page"],
                    "temp_prefix": temp_prefix,
                    "input_bucket": input_bucket,
                },
            )
            futures[future] = chunk

        errors = []
        for future in as_completed(futures):
            chunk = futures[future]
            try:
                result = future.result()
                chunk_results.append(result)
                logger.debug(
                    f"Chunk {chunk['chunk_id']} extracted "
                    f"(pages {chunk['start_page']}-{chunk['end_page']})",
                    chunk_id=chunk["chunk_id"],
                )
            except Exception as e:
                errors.append((chunk["chunk_id"], e))
                logger.error(
                    f"Chunk {chunk['chunk_id']} failed",
                    chunk_id=chunk["chunk_id"],
                    error=str(e),
                )

    if errors:
        raise RuntimeError(
            f"Extraction failed: {len(errors)} of {len(chunks)} chunks failed. "
            f"First error (chunk {errors[0][0]}): {errors[0][1]}"
        )

    step2_dur = time.monotonic() - step2_start
    logger.info(
        "Chunked extraction step 2/3 complete",
        chunks_extracted=len(chunk_results),
        duration_s=round(step2_dur, 1),
    )

    # Step 3: Merge chunks
    step3_start = time.monotonic()
    logger.info("Chunked extraction step 3/3: merging chunks")

    _invoke_extract_lambda(
        lambda_client,
        {
            "action": "merge_chunks",
            "chunks": chunk_results,
            "output_bucket": output_bucket,
            "output_key": extract_output_key,
            "temp_prefix": temp_prefix,
            "input_bucket": input_bucket,
        },
    )

    step3_dur = time.monotonic() - step3_start
    total_dur = time.monotonic() - extract_start

    logger.info(
        "Chunked extraction complete",
        filename=filename,
        total_pages=total_pages,
        num_chunks=len(chunks),
        step1_prepare_s=round(step1_dur, 1),
        step2_extract_s=round(step2_dur, 1),
        step3_merge_s=round(step3_dur, 1),
        total_s=round(total_dur, 1),
        pages_per_second=round(total_pages / total_dur, 1) if total_dur > 0 else 0,
    )


# ── Main handler ─────────────────────────────────────────────────────────────


def handle_extract_content(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle extract_content tool invocation.

    Extracts text content from a file in the workspace using the
    extract-content-from-file Lambda.

    For vision-extracted formats (PDF, DOCX, images), uses chunked parallel
    extraction for reliability with large files. Other formats (XLSX, CSV, etc.)
    use the direct single-invocation path.

    Parameters:
        file_path (str, required): Workspace path to the file
            (e.g., /workdir/uploads/document.pdf)
        __user_sub (str, internal): User's Cognito sub for S3 path
        __conversation_id (str, internal): Conversation ID for S3 path

    Returns:
        Dict with output_path and message

    Raises:
        ValueError: If required parameters missing or invalid
    """
    # Extract parameters
    file_path = params.get("file_path")
    user_sub = params.get("__user_sub", "")
    conversation_id = params.get("__conversation_id", "")

    # Validate required parameters
    if not file_path:
        raise ValueError("Missing required parameter: file_path")

    if not user_sub:
        raise ValueError("Missing user context: user_sub not provided")

    if not conversation_id:
        raise ValueError("Missing conversation context: conversation_id not provided")

    # Validate workspace path
    is_valid, error = _validate_workspace_path(file_path)
    if not is_valid:
        raise ValueError(f"Invalid file path: {error}")

    # Check configuration
    if not OUTPUTS_BUCKET_NAME:
        raise ValueError("OUTPUTS_BUCKET_NAME not configured")

    if not EXTRACT_CONTENT_LAMBDA_NAME:
        raise ValueError("EXTRACT_CONTENT_LAMBDA_NAME not configured")

    # Get relative path and S3 keys
    rel_path = _get_relative_path(file_path)
    input_s3_key = _get_s3_key_for_file(rel_path, user_sub, conversation_id)
    output_s3_key = _get_output_s3_key(rel_path, user_sub, conversation_id)

    # The extract lambda writes JSON, we'll need to convert to txt
    extract_output_key = output_s3_key.replace(".txt", ".json")

    logger.info(
        "Invoking extract-content-from-file Lambda",
        file_path=file_path,
        input_s3_key=input_s3_key,
        output_s3_key=output_s3_key,
        user_sub=user_sub[:8] + "..." if user_sub else "",
    )

    # Get filename for the extract lambda
    filename = Path(file_path).name
    file_ext = Path(file_path).suffix.lower()

    # Create Lambda client with long timeout for large file extraction
    lambda_client = prm_client(
        "lambda",
        region=REGION,
        config=Config(read_timeout=900, connect_timeout=10),
    )

    try:
        if file_ext in VISION_EXTENSIONS:
            # Chunked parallel extraction for vision-extracted formats
            _handle_chunked_extraction(
                lambda_client,
                OUTPUTS_BUCKET_NAME,
                input_s3_key,
                OUTPUTS_BUCKET_NAME,
                extract_output_key,
                filename,
            )
        else:
            # Direct single-invocation path for non-vision formats
            payload = {
                "input_bucket": OUTPUTS_BUCKET_NAME,
                "input_key": input_s3_key,
                "output_bucket": OUTPUTS_BUCKET_NAME,
                "output_key": extract_output_key,
                "file_name": filename,
                "return_content": False,
            }
            _invoke_extract_lambda(lambda_client, payload)

        logger.info("Extract Lambda completed", extract_output_key=extract_output_key)

    except Exception as e:
        logger.error(
            "Failed to extract content",
            error=str(e),
            exc_info=True,
        )
        raise ValueError(f"Failed to extract content: {str(e)}") from e

    # Read the extracted JSON from S3 and convert to text
    s3_client = prm_client("s3", region=REGION)

    try:
        # Read the extracted JSON
        json_response = s3_client.get_object(
            Bucket=OUTPUTS_BUCKET_NAME, Key=extract_output_key
        )
        extracted_json = json.loads(json_response["Body"].read().decode("utf-8"))

        # Extract text from the document structure
        # The extract lambda returns: {"name": "...", "num_pages": N, "pages": [...]}
        text_parts = []

        if "pages" in extracted_json:
            for page in extracted_json["pages"]:
                page_num = page.get("page_number", "?")
                page_text = page.get("text", "")
                if page_text:
                    text_parts.append(f"--- Page {page_num} ---\n{page_text}")
        elif "content" in extracted_json:
            # Some formats return content directly
            text_parts.append(extracted_json["content"])
        else:
            # Fallback: convert entire JSON to string
            text_parts.append(json.dumps(extracted_json, indent=2))

        full_text = "\n\n".join(text_parts)

        # Write the text file to S3
        s3_client.put_object(
            Bucket=OUTPUTS_BUCKET_NAME,
            Key=output_s3_key,
            Body=full_text.encode("utf-8"),
            ContentType="text/plain",
        )

        logger.info(
            "Wrote extracted text to S3",
            output_s3_key=output_s3_key,
            text_length=len(full_text),
        )

        # Clean up the intermediate JSON file
        try:
            s3_client.delete_object(Bucket=OUTPUTS_BUCKET_NAME, Key=extract_output_key)
        except Exception as e:
            logger.warning("Failed to clean up intermediate JSON", error=str(e))

    except Exception as e:
        logger.error(
            "Failed to process extracted content",
            error=str(e),
            exc_info=True,
        )
        raise ValueError(f"Failed to process extracted content: {str(e)}") from e

    # Return the output path in workspace format
    # Extract relative path from S3 key for the workspace path
    output_rel_path = output_s3_key.replace(
        f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/", ""
    )
    output_workspace_path = f"{WORKSPACE_ROOT}/{output_rel_path}"

    return {
        "message": f"Content extracted successfully to {output_workspace_path}",
        "output_path": output_workspace_path,
        "s3_key": output_s3_key,
        "original_file": file_path,
        "text_length": len(full_text),
    }
