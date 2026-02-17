#!/usr/bin/env python3
"""
Unified Knowledge Base Tool for Numa Workspace Agent.

This is a thin wrapper that invokes the numa-chat-workspace-tools Lambda.
The Lambda handles all KB operations.

Subcommands:
    query           Search knowledge bases with optional AI summarization
    upload          Add files to a knowledge base
    download        Download a file from KB storage by filename or S3 URI
    list            List files in a knowledge base
    download-folder Download all files in a KB folder as a zip

Usage:
    python3 /workdir/tools/numa/knowledge_base.py query --query "search" --user-intent "intent"
    python3 /workdir/tools/numa/knowledge_base.py upload --file /workdir/session/report.pdf
    python3 /workdir/tools/numa/knowledge_base.py download --file "policy.pdf" --kb-id company
    python3 /workdir/tools/numa/knowledge_base.py download --uri "s3://bucket/documents/company/file.pdf"
    python3 /workdir/tools/numa/knowledge_base.py list --kb-id company --pattern "*.pdf"
    python3 /workdir/tools/numa/knowledge_base.py download-folder --kb-id company --folder-path "reports/"

Examples:
    # Query the company knowledge base
    python3 /workdir/tools/numa/knowledge_base.py query \\
        --query "annual leave policy" \\
        --user-intent "find how many days of leave employees get"

    # Query all enabled KBs at once
    python3 /workdir/tools/numa/knowledge_base.py query \\
        --query "security policies" \\
        --user-intent "compare policies across departments" \\
        --all-kbs

    # Upload a file to the company KB
    python3 /workdir/tools/numa/knowledge_base.py upload \\
        --file /workdir/session/report.pdf \\
        --kb-id company

    # Download a file by filename (simplest - when you know the filename)
    python3 /workdir/tools/numa/knowledge_base.py download \\
        --file "policy.pdf" --kb-id company

    # Download a file by S3 URI (from KB query result references)
    python3 /workdir/tools/numa/knowledge_base.py download \\
        --uri "s3://bucket/documents/company/policy.pdf"

    # List all PDFs in the company KB
    python3 /workdir/tools/numa/knowledge_base.py list \\
        --kb-id company --pattern "*.pdf"

    # Download an entire folder as a zip
    python3 /workdir/tools/numa/knowledge_base.py download-folder \\
        --kb-id company --folder-path "reports/2024/"
"""

import argparse
import base64
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

from helpers.credentials import get_local_lambda_client

# Upload size limit for Lambda payload (6 MB with base64 overhead).
# Downloads no longer have this limit thanks to presigned URL fallback.
MAX_UPLOAD_SIZE = 4 * 1024 * 1024


def _download_from_presigned_url(
    url: str, dest_path: Path, expected_size: int = 0
) -> int:
    """
    Download a file from a presigned S3 URL to a local path.

    Uses urllib.request (stdlib) to stream the download.

    Args:
        url: Presigned S3 GET URL
        dest_path: Local file path to write to
        expected_size: Expected file size in bytes (for logging; 0 = unknown)

    Returns:
        Number of bytes written
    """
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with urllib.request.urlopen(url) as response:
            with open(dest_path, "wb") as out_file:
                shutil.copyfileobj(response, out_file)

        return dest_path.stat().st_size

    except urllib.error.HTTPError as e:
        raise ValueError(
            f"Failed to download from presigned URL: HTTP {e.code} {e.reason}. "
            "The URL may have expired (5 minute window). Try the download again."
        ) from e
    except urllib.error.URLError as e:
        raise ValueError(
            f"Failed to download from presigned URL: {e.reason}. "
            "Check network connectivity."
        ) from e
    except Exception as e:
        # Clean up partial download
        if dest_path.exists():
            dest_path.unlink()
        raise ValueError(f"Failed to download file: {str(e)}") from e


def get_lambda_client_and_config():
    """Get Lambda client and common configuration from environment."""
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

    # Get allowed KBs from environment (security: fail-closed)
    # Format: [{"id": "company", "name": "Company KB"}, {"id": "kb-uuid", "name": "User KB"}]
    allowed_kbs_json = os.environ.get("NUMA_ALLOWED_KBS", "[]")
    try:
        allowed_kbs = json.loads(allowed_kbs_json)
    except json.JSONDecodeError:
        allowed_kbs = []

    # Extract just IDs for security validation
    allowed_kb_ids = [kb.get("id") for kb in allowed_kbs if kb.get("id")]

    # Get user_sub for server-side permission verification
    user_sub = os.environ.get("NUMA_USER_SUB", "")

    return {
        "lambda_name": lambda_name,
        "allowed_kbs": allowed_kbs,
        "allowed_kb_ids": allowed_kb_ids,
        "user_sub": user_sub,
        "client": get_local_lambda_client(),
    }


def invoke_lambda(config, payload):
    """Invoke Lambda and handle response."""
    try:
        response = config["client"].invoke(
            FunctionName=config["lambda_name"],
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        response_payload = json.loads(response["Payload"].read().decode("utf-8"))

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

        return response_payload

    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"Failed to invoke Lambda: {str(e)}",
                }
            )
        )
        sys.exit(1)


# =============================================================================
# QUERY SUBCOMMAND
# =============================================================================


def cmd_query(args):
    """Execute the query subcommand."""
    config = get_lambda_client_and_config()

    payload = {
        "tool": "query_knowledgebase",
        "user_sub": config["user_sub"],
        "allowed_kbs": config["allowed_kb_ids"],
        "allowed_kbs_with_names": config["allowed_kbs"],
        "params": {
            "query": args.query,
            "user_intent": args.user_intent,
            "max_results": args.max_results,
            "kb_id": args.kb_id,
            "summarise_results": args.summarise,
            "all_kbs": args.all_kbs,
        },
    }

    response_payload = invoke_lambda(config, payload)

    # Handle output (file or stdout)
    if args.output_file:
        output_path = Path(args.output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(response_payload, indent=2))

        print(
            json.dumps(
                {
                    "status": "success",
                    "message": f"Results written to {output_path}",
                    "file_path": str(output_path),
                    "results_count": response_payload.get(
                        "results_count", response_payload.get("total_results_count", 0)
                    ),
                },
                indent=2,
            )
        )
    else:
        print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# UPLOAD SUBCOMMAND
# =============================================================================


def cmd_upload(args):
    """Execute the upload subcommand."""
    # Validate file exists
    file_path = Path(args.file)
    if not file_path.exists():
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"File not found: {args.file}",
                }
            )
        )
        sys.exit(1)

    # Check file size
    file_size = file_path.stat().st_size
    if file_size > MAX_UPLOAD_SIZE:
        size_mb = file_size / 1024 / 1024
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": f"File too large ({size_mb:.1f} MB). Maximum is 4 MB. "
                    "Please upload large files manually via the Numa web interface.",
                }
            )
        )
        sys.exit(1)

    config = get_lambda_client_and_config()

    # Read and encode file
    with open(file_path, "rb") as f:
        content_base64 = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "tool": "add_to_kb",
        "user_sub": config["user_sub"],
        "allowed_kbs": config["allowed_kb_ids"],
        "params": {
            "filename": file_path.name,
            "kb_id": args.kb_id,
            "kb_path": args.path,
            "content_base64": content_base64,
            "size_bytes": file_size,
        },
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# DOWNLOAD SUBCOMMAND
# =============================================================================


def cmd_download(args):
    """Execute the download subcommand."""
    config = get_lambda_client_and_config()

    # Validate: either --uri or --file must be provided
    if not args.uri and not args.file:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": "Either --uri or --file must be provided",
                }
            )
        )
        sys.exit(1)

    params = {"mode": "download"}

    if args.uri:
        # URI-based download (existing behavior)
        params["uri"] = args.uri
    else:
        # Filename + kb_id based download (new behavior)
        params["file"] = args.file
        params["kb_id"] = args.kb_id

    payload = {
        "tool": "retrieve_kb_file",
        "user_sub": config["user_sub"],
        "allowed_kbs": config["allowed_kb_ids"],
        "params": params,
    }

    response_payload = invoke_lambda(config, payload)

    if response_payload.get("status") == "error":
        print(json.dumps(response_payload, indent=2))
        sys.exit(1)

    # Save file to disk
    result = response_payload.get("result", {})
    filename = result.get("filename", "downloaded_file")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    if result.get("presigned_url"):
        # Large file: download directly from S3 via presigned URL
        try:
            actual_size = _download_from_presigned_url(
                url=result["presigned_url"],
                dest_path=output_path,
                expected_size=result.get("size_bytes", 0),
            )
            output = {
                "status": "success",
                "message": f"File saved to {output_path}",
                "filename": filename,
                "size_bytes": actual_size,
                "output_path": str(output_path),
                "s3_uri": result.get("s3_uri"),
            }
            print(json.dumps(output, indent=2))
        except ValueError as e:
            print(json.dumps({"status": "error", "error": str(e)}, indent=2))
            sys.exit(1)

    elif result.get("content_base64"):
        # Small file: decode from inline base64 (existing behavior)
        file_content = base64.b64decode(result["content_base64"])

        with open(output_path, "wb") as f:
            f.write(file_content)

        output = {
            "status": "success",
            "message": f"File saved to {output_path}",
            "filename": filename,
            "size_bytes": len(file_content),
            "output_path": str(output_path),
            "s3_uri": result.get("s3_uri"),
        }
        print(json.dumps(output, indent=2))
    else:
        print(json.dumps(response_payload, indent=2))


# =============================================================================
# LIST SUBCOMMAND
# =============================================================================


def cmd_list(args):
    """Execute the list subcommand."""
    config = get_lambda_client_and_config()

    payload = {
        "tool": "retrieve_kb_file",
        "user_sub": config["user_sub"],
        "allowed_kbs": config["allowed_kb_ids"],
        "params": {
            "mode": "list",
            "kb_id": args.kb_id,
            "pattern": args.pattern,
        },
    }

    response_payload = invoke_lambda(config, payload)
    print(json.dumps(response_payload, indent=2))

    if response_payload.get("status") == "error":
        sys.exit(1)


# =============================================================================
# DOWNLOAD-FOLDER SUBCOMMAND
# =============================================================================


def cmd_download_folder(args):
    """Execute the download-folder subcommand."""
    config = get_lambda_client_and_config()

    payload = {
        "tool": "retrieve_kb_file",
        "user_sub": config["user_sub"],
        "allowed_kbs": config["allowed_kb_ids"],
        "params": {
            "mode": "download_folder",
            "kb_id": args.kb_id,
            "folder_path": args.folder_path,
        },
    }

    response_payload = invoke_lambda(config, payload)

    if response_payload.get("status") == "error":
        print(json.dumps(response_payload, indent=2))
        sys.exit(1)

    # Save zip file to disk
    result = response_payload.get("result", {})
    filename = result.get("filename", "download.zip")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    if result.get("presigned_url"):
        # Large zip: download directly from S3 via presigned URL
        try:
            actual_size = _download_from_presigned_url(
                url=result["presigned_url"],
                dest_path=output_path,
                expected_size=result.get("size_bytes", 0),
            )
            output = {
                "status": "success",
                "message": f"Folder downloaded to {output_path}",
                "filename": filename,
                "size_bytes": actual_size,
                "output_path": str(output_path),
                "file_count": result.get("file_count", 0),
                "total_files_in_folder": result.get("total_files_in_folder", 0),
            }
            print(json.dumps(output, indent=2))
        except ValueError as e:
            print(json.dumps({"status": "error", "error": str(e)}, indent=2))
            sys.exit(1)

    elif result.get("content_base64"):
        # Small zip: decode from inline base64 (existing behavior)
        file_content = base64.b64decode(result["content_base64"])

        with open(output_path, "wb") as f:
            f.write(file_content)

        output = {
            "status": "success",
            "message": f"Folder downloaded to {output_path}",
            "filename": filename,
            "size_bytes": len(file_content),
            "output_path": str(output_path),
            "file_count": result.get("file_count", 0),
            "total_files_in_folder": result.get("total_files_in_folder", 0),
        }
        print(json.dumps(output, indent=2))
    else:
        print(json.dumps(response_payload, indent=2))


# =============================================================================
# MAIN
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Numa Knowledge Base Tool - Query, upload, and download KB files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # -------------------------------------------------------------------------
    # QUERY subcommand
    # -------------------------------------------------------------------------
    query_parser = subparsers.add_parser(
        "query",
        help="Search knowledge bases",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Simple search
  python3 knowledge_base.py query \\
      --query "annual leave policy" \\
      --user-intent "find leave entitlements"

  # Get raw results without summarization
  python3 knowledge_base.py query \\
      --query "security guidelines" \\
      --user-intent "find security requirements" \\
      --no-summarise

  # Query all enabled KBs
  python3 knowledge_base.py query \\
      --query "compliance" --user-intent "find compliance info" \\
      --all-kbs
""",
    )
    query_parser.add_argument(
        "--query", "-q", required=True, help="Natural language search query"
    )
    query_parser.add_argument(
        "--user-intent",
        "-u",
        required=True,
        help="What the user is trying to accomplish",
    )
    query_parser.add_argument(
        "--max-results",
        "-m",
        type=int,
        default=6,
        help="Maximum results (default: 6, max: 15)",
    )
    query_parser.add_argument(
        "--kb-id",
        "-k",
        default="company",
        help="Knowledge base ID (default: company)",
    )
    query_parser.add_argument(
        "--summarise",
        "--summarize",
        dest="summarise",
        action="store_true",
        default=True,
        help="Summarize results (default)",
    )
    query_parser.add_argument(
        "--no-summarise",
        "--no-summarize",
        dest="summarise",
        action="store_false",
        help="Return raw results without summarization",
    )
    query_parser.add_argument(
        "--output-file",
        "-o",
        help="Write results to file instead of stdout",
    )
    query_parser.add_argument(
        "--all-kbs",
        action="store_true",
        default=False,
        help="Query all enabled knowledge bases",
    )
    query_parser.set_defaults(func=cmd_query)

    # -------------------------------------------------------------------------
    # UPLOAD subcommand
    # -------------------------------------------------------------------------
    upload_parser = subparsers.add_parser(
        "upload",
        help="Upload file to knowledge base",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload to company KB root
  python3 knowledge_base.py upload \\
      --file /workdir/session/report.pdf --kb-id company

  # Upload to user KB with path
  python3 knowledge_base.py upload \\
      --file /workdir/session/policy.docx --kb-id kb-123 --path policies/

Permissions:
  - Company KB: Only admins can upload
  - User KBs: Only editors/owners can upload

Size limit: 4 MB max. Larger files should be uploaded via the web UI.
""",
    )
    upload_parser.add_argument(
        "--file", "-f", required=True, help="Path to file in workspace"
    )
    upload_parser.add_argument(
        "--kb-id", "-k", default="company", help="Knowledge base ID (default: company)"
    )
    upload_parser.add_argument(
        "--path", "-p", default="", help="Path within KB (e.g., 'policies/hr/')"
    )
    upload_parser.set_defaults(func=cmd_upload)

    # -------------------------------------------------------------------------
    # DOWNLOAD subcommand
    # -------------------------------------------------------------------------
    download_parser = subparsers.add_parser(
        "download",
        help="Download file from KB by filename or S3 URI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download by filename (simplest - use when you know the filename)
  python3 knowledge_base.py download \\
      --file "employee-handbook.pdf" --kb-id company

  # Download from user KB by filename
  python3 knowledge_base.py download \\
      --file "project-specs.docx" --kb-id "abc-123-uuid"

  # Download by S3 URI (from KB query references)
  python3 knowledge_base.py download \\
      --uri "s3://bucket/documents/company/policy.pdf"

  # Download to specific directory
  python3 knowledge_base.py download \\
      --uri "s3://bucket/documents/company/report.xlsx" \\
      --output-dir /workdir/session/downloads/

When to use which:
  --file + --kb-id: When you know the filename (e.g., from system prompt KB listings)
  --uri: When downloading from KB query result references
""",
    )
    download_parser.add_argument(
        "--file", "-f", help="Filename to download (alternative to --uri)"
    )
    download_parser.add_argument(
        "--kb-id",
        "-k",
        default="company",
        help="KB ID when using --file (default: company)",
    )
    download_parser.add_argument(
        "--uri", "-u", help="S3 URI to download (alternative to --file)"
    )
    download_parser.add_argument(
        "--output-dir",
        "-o",
        default="/workdir/session/",
        help="Download location (default: /workdir/session/)",
    )
    download_parser.set_defaults(func=cmd_download)

    # -------------------------------------------------------------------------
    # LIST subcommand
    # -------------------------------------------------------------------------
    list_parser = subparsers.add_parser(
        "list",
        help="List files in a knowledge base",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all files in company KB
  python3 knowledge_base.py list --kb-id company

  # List only PDF files
  python3 knowledge_base.py list --kb-id company --pattern "*.pdf"

  # List files in a user KB
  python3 knowledge_base.py list --kb-id abc-123-uuid
""",
    )
    list_parser.add_argument(
        "--kb-id", "-k", default="company", help="Knowledge base ID (default: company)"
    )
    list_parser.add_argument(
        "--pattern", "-p", help="Filename pattern filter (e.g., *.pdf)"
    )
    list_parser.set_defaults(func=cmd_list)

    # -------------------------------------------------------------------------
    # DOWNLOAD-FOLDER subcommand
    # -------------------------------------------------------------------------
    download_folder_parser = subparsers.add_parser(
        "download-folder",
        help="Download all files in a KB folder as a zip",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download entire company KB
  python3 knowledge_base.py download-folder --kb-id company

  # Download a specific folder
  python3 knowledge_base.py download-folder \\
      --kb-id company --folder-path "reports/2024/"

  # Download from a user KB
  python3 knowledge_base.py download-folder \\
      --kb-id abc-123-uuid --folder-path "contracts/"

Limits:
  - Maximum 400 files per download
  - Large folders may take time to process
  - Files are downloaded as a zip - analyze directly without extracting
""",
    )
    download_folder_parser.add_argument(
        "--kb-id", "-k", default="company", help="Knowledge base ID (default: company)"
    )
    download_folder_parser.add_argument(
        "--folder-path",
        "-f",
        default="",
        help="Folder path within KB (default: root)",
    )
    download_folder_parser.add_argument(
        "--output-dir",
        "-o",
        default="/workdir/session/",
        help="Where to save the zip (default: /workdir/session/)",
    )
    download_folder_parser.set_defaults(func=cmd_download_folder)

    # -------------------------------------------------------------------------
    # Parse and execute
    # -------------------------------------------------------------------------
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
