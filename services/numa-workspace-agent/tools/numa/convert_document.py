#!/usr/bin/env python3
"""
Convert Document Tool for Numa Workspace Agent.

Supports two conversion modes:

1. DIRECT FILE CONVERSION (--mode file):
   - DOCX → PDF: High quality, uses LibreOffice directly
   - PDF → DOCX: Variable quality (PDFs are presentation format, not editable)

2. MARKDOWN CONVERSION (--mode markdown, default):
   - Markdown/text → PDF: Uses Pandoc + LibreOffice
   - Markdown/text → DOCX: Uses Pandoc

For best results:
  - Use --mode file for direct DOCX ↔ PDF conversion
  - Use --mode markdown for converting markdown/text to documents

Usage:
    # Direct DOCX → PDF conversion (recommended for DOCX files)
    python3 /workdir/tools/numa/convert_document.py \\
        --file-path "/workdir/uploads/document.docx" \\
        --format pdf \\
        --mode file

    # Direct PDF → DOCX conversion
    python3 /workdir/tools/numa/convert_document.py \\
        --file-path "/workdir/uploads/document.pdf" \\
        --format docx \\
        --mode file

    # Markdown to PDF (default mode)
    python3 /workdir/tools/numa/convert_document.py \\
        --file-path "/workdir/session/report.md" \\
        --format pdf

Parameters:
    --file-path, -f    Path to input file in workspace (required)
    --format, -o       Output format: 'pdf' or 'docx' (required)
    --mode, -m         Conversion mode: 'file' or 'markdown' (default: markdown)
    --title, -t        Optional document title (used for filename)

Output:
    Converted document is saved to /workdir/session/converted_{filename}.{ext}
    Returns JSON with path to the converted file.

Conversion Quality:
    DOCX → PDF (--mode file):     Excellent - LibreOffice handles this well
    PDF → DOCX (--mode file):     Variable - PDFs are presentation format
    Markdown → PDF/DOCX:          Good - works well for formatted markdown

For complex/scanned PDFs, use the two-step approach:
    # Step 1: Extract content using vision AI
    python3 /workdir/tools/numa/extract_content.py \\
        --file-path "/workdir/uploads/scanned_document.pdf"

    # Step 2: Convert extracted markdown to DOCX
    python3 /workdir/tools/numa/convert_document.py \\
        --file-path "/workdir/session/extracted_scanned_document.txt" \\
        --format docx
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

# Valid output formats
VALID_FORMATS = ["pdf", "docx"]

# Valid conversion modes
VALID_MODES = ["markdown", "file"]

# Valid input formats for direct file conversion
VALID_INPUT_FORMATS = ["pdf", "docx"]


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
        description="Convert documents between formats using LibreOffice and Pandoc",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Conversion Modes:
  --mode file      Direct DOCX ↔ PDF conversion using LibreOffice
  --mode markdown  Convert markdown/text to PDF/DOCX using Pandoc (default)

Examples:
  # Direct DOCX → PDF conversion (recommended for DOCX files)
  python3 /workdir/tools/numa/convert_document.py \\
      --file-path "/workdir/uploads/document.docx" \\
      --format pdf \\
      --mode file

  # Direct PDF → DOCX conversion
  python3 /workdir/tools/numa/convert_document.py \\
      --file-path "/workdir/uploads/document.pdf" \\
      --format docx \\
      --mode file

  # Markdown to PDF (default mode)
  python3 /workdir/tools/numa/convert_document.py \\
      --file-path "/workdir/session/report.md" \\
      --format pdf

  # Markdown to DOCX with custom title
  python3 /workdir/tools/numa/convert_document.py \\
      --file-path "/workdir/session/report.md" \\
      --format docx \\
      --title "Quarterly Report"
""",
    )

    parser.add_argument(
        "--file-path",
        "-f",
        required=True,
        help="Path to input file in workspace (e.g., /workdir/uploads/document.docx)",
    )

    parser.add_argument(
        "--format",
        "-o",
        required=True,
        choices=VALID_FORMATS,
        help="Output format: 'pdf' or 'docx'",
    )

    parser.add_argument(
        "--mode",
        "-m",
        required=False,
        choices=VALID_MODES,
        default="markdown",
        help="Conversion mode: 'file' for direct DOCX↔PDF, 'markdown' for text→document (default: markdown)",
    )

    parser.add_argument(
        "--title",
        "-t",
        required=False,
        help="Optional document title (used for output filename)",
    )

    args = parser.parse_args()

    # Validate format
    if args.format not in VALID_FORMATS:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Invalid format '{args.format}'. Must be one of: {', '.join(VALID_FORMATS)}",
                }
            )
        )
        sys.exit(1)

    # Validate mode
    if args.mode not in VALID_MODES:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Invalid mode '{args.mode}'. Must be one of: {', '.join(VALID_MODES)}",
                }
            )
        )
        sys.exit(1)

    # For file mode, validate input format
    if args.mode == "file":
        file_ext = Path(args.file_path).suffix.lower().lstrip(".")
        if file_ext not in VALID_INPUT_FORMATS:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": f"For --mode file, input must be .pdf or .docx (got .{file_ext})",
                    }
                )
            )
            sys.exit(1)

        # Check that we're actually converting to a different format
        if file_ext == args.format:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "error": f"Input and output format are the same ({file_ext}). No conversion needed.",
                    }
                )
            )
            sys.exit(1)

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
    ensure_file_in_s3(args.file_path, user_sub, conversation_id)

    # Build Lambda payload
    payload = {
        "tool": "convert_document",
        "user_sub": user_sub,
        "conversation_id": conversation_id,
        "params": {
            "file_path": args.file_path,
            "format": args.format,
            "mode": args.mode,
        },
    }

    # Add optional title if provided
    if args.title:
        payload["params"]["title"] = args.title

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

        # Download the converted document from S3 to local workspace
        outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
        if not outputs_bucket:
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
            "message": result.get("message", f"Document converted to {output_path}"),
            "output_path": output_path,
            "original_file": result.get("original_file", args.file_path),
            "format": args.format,
            "mode": args.mode,
            "size": result.get("size", 0),
        }
        print(json.dumps(output, indent=2))

    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Failed to convert document: {str(e)}",
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
