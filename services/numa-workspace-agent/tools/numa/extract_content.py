#!/usr/bin/env python3
"""
Extract Content Tool for Numa Workspace Agent.

Extracts text content from files using advanced OCR and vision AI processing.
This tool is ideal for complex documents that standard Python libraries can't
handle well, such as scanned PDFs, images of documents, or handwritten text.

Supported File Formats:
-----------------------
Documents (Vision AI):
  .pdf     - PDFs (text-based and scanned/image-based)
  .docx    - Microsoft Word documents
  .xlsx    - Microsoft Excel spreadsheets

Images (OCR/Vision):
  .png     - PNG images
  .jpg     - JPEG images
  .jpeg    - JPEG images

Audio/Video (Transcription):
  .mp3     - MP3 audio
  .mp4     - MP4 video
  .wav     - WAV audio
  .flac    - FLAC audio
  .ogg     - OGG audio
  .amr     - AMR audio
  .webm    - WebM video
  .m4a     - M4A audio

Text Files (direct reading):
  .txt, .csv, .json, .xml, .yaml, .yml, .md, .html
  .py, .js, .ts, .css, .scss, .less, .sql
  .sh, .bash, .cfg, .conf, .ini, .log, .tex

Usage:
    python3 /workdir/tools/numa/extract_content.py --file-path "/workdir/uploads/document.pdf"

Parameters:
    --file-path, -f    Path to file in workspace (required)
                       Supports: /workdir/uploads/, /workdir/session/,
                                /workdir/chat-workflows/, or root files

Output:
    Extracted content is saved to /workdir/session/extracted_{filename}.txt
    Returns JSON with path to the extracted file.

Example:
    # Extract from a scanned PDF
    python3 /workdir/tools/numa/extract_content.py \\
        --file-path "/workdir/uploads/scanned_invoice.pdf"

    # Output: {"status": "success", "output_path": "/workdir/session/extracted_scanned_invoice.txt"}
"""

import argparse
import json
import os
import sys
from pathlib import Path

from botocore.exceptions import ClientError

from helpers.credentials import get_local_lambda_client, get_local_s3_client

# S3 path configuration (must match Lambda's expectations)
S3_PREFIX = "numa-chat/workspace"
WORKSPACE_ROOT = "/workdir"


def _get_relative_path(file_path: str) -> str:
    """Extract relative path from absolute workspace path."""
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    return file_path


def _get_s3_key_for_file(rel_path: str, user_sub: str, conversation_id: str) -> str:
    """Determine the S3 key for a workspace file."""
    # chat-workflows/ is globally persistent (not scoped to conversation)
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"
    # Everything else is conversation-scoped
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def ensure_file_in_s3(file_path: str, user_sub: str, conversation_id: str) -> None:
    """
    Upload local file to S3 if it doesn't exist there yet.

    This handles files created locally during the same chat session that haven't
    been synced to S3 yet (sync happens after chat completes, but tools need
    files in S3 during the chat).
    """
    # Check if file exists locally
    if not os.path.exists(file_path):
        return  # Nothing to upload, let Lambda handle the error

    outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
    if not outputs_bucket:
        return  # Can't upload without bucket

    # Construct S3 key
    rel_path = _get_relative_path(file_path)
    s3_key = _get_s3_key_for_file(rel_path, user_sub, conversation_id)

    s3_client = get_local_s3_client()

    # Check if already exists in S3
    try:
        s3_client.head_object(Bucket=outputs_bucket, Key=s3_key)
        return  # Already exists
    except ClientError as e:
        if e.response["Error"]["Code"] != "404":
            raise  # Some other error, re-raise

    # Upload local file to S3
    with open(file_path, "rb") as f:
        s3_client.put_object(Bucket=outputs_bucket, Key=s3_key, Body=f.read())


def main():
    parser = argparse.ArgumentParser(
        description="Extract text content from files using advanced OCR/vision AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Supported formats:
  Documents: .pdf, .docx, .xlsx
  Images:    .png, .jpg, .jpeg
  Audio:     .mp3, .mp4, .wav, .flac, .ogg, .amr, .webm, .m4a
  Text:      .txt, .csv, .json, .xml, .yaml, .yml, .md, .html, .py, .js, .ts, etc.

Examples:
  # Extract from a scanned PDF
  python3 /workdir/tools/numa/extract_content.py \\
      --file-path "/workdir/uploads/scanned_invoice.pdf"

  # Extract from an image
  python3 /workdir/tools/numa/extract_content.py \\
      --file-path "/workdir/uploads/whiteboard_photo.jpg"
""",
    )

    parser.add_argument(
        "--file-path",
        "-f",
        required=True,
        help="Path to file in workspace (e.g., /workdir/uploads/document.pdf)",
    )

    args = parser.parse_args()

    # Get Lambda function name from environment
    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME")
    if not lambda_name:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "WORKSPACE_TOOLS_LAMBDA_NAME environment variable not set. "
                    "This tool must be run within the numa-workspace-agent environment.",
                }
            )
        )
        sys.exit(1)

    # Get user context from environment
    user_sub = os.environ.get("NUMA_USER_SUB", "")
    conversation_id = os.environ.get("NUMA_CONVERSATION_ID", "")

    if not user_sub:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "NUMA_USER_SUB environment variable not set. "
                    "User context is required for file access.",
                }
            )
        )
        sys.exit(1)

    if not conversation_id:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "NUMA_CONVERSATION_ID environment variable not set. "
                    "Conversation context is required for file access.",
                }
            )
        )
        sys.exit(1)

    # Ensure file exists in S3 before Lambda invocation
    # This handles files created locally during the same chat session that haven't
    # been synced to S3 yet (sync happens after chat completes)
    ensure_file_in_s3(args.file_path, user_sub, conversation_id)

    # Build Lambda payload
    payload = {
        "tool": "extract_content",
        "user_sub": user_sub,
        "conversation_id": conversation_id,
        "params": {
            "file_path": args.file_path,
        },
    }

    try:
        # Invoke Lambda using local account credentials
        lambda_client = get_local_lambda_client()
        response = lambda_client.invoke(
            FunctionName=lambda_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        # Parse response
        response_payload = json.loads(response["Payload"].read().decode("utf-8"))

        # Check for Lambda-level errors
        if "FunctionError" in response:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": f"Lambda execution error: {response_payload}",
                    }
                )
            )
            sys.exit(1)

        # Check for tool-level errors
        if response_payload.get("status") == "error":
            print(json.dumps(response_payload, indent=2))
            sys.exit(1)

        # Get the result
        result = response_payload.get("result", {})
        output_path = result.get("output_path")
        s3_key = result.get("s3_key")

        if not output_path or not s3_key:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "No output path in response",
                    }
                )
            )
            sys.exit(1)

        # Download the extracted content from S3 to local workspace
        outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
        if not outputs_bucket:
            # Try to get from the workspace tools environment
            # The file should be available at the S3 key returned
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": "OUTPUTS_BUCKET_NAME not configured for local download",
                    }
                )
            )
            sys.exit(1)

        s3_client = get_local_s3_client()

        # Ensure local output directory exists
        local_path = Path(output_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # Download the file
        s3_client.download_file(outputs_bucket, s3_key, str(local_path))

        # Return success with file info
        output = {
            "status": "success",
            "message": result.get("message", f"Content extracted to {output_path}"),
            "output_path": output_path,
            "original_file": result.get("original_file", args.file_path),
            "text_length": result.get("text_length", 0),
        }
        print(json.dumps(output, indent=2))

    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Failed to extract content: {str(e)}",
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
