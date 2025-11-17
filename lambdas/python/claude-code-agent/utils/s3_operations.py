"""
S3 operation utilities for Claude Code Agent.

Provides helper functions for S3 path manipulation and content type detection.
"""

from pathlib import Path
from typing import Optional


def safe_s3_key(prefix: str, *parts: Optional[str]) -> str:
    """
    Safely join S3 path segments, normalizing slashes.

    Args:
        prefix: Base S3 prefix
        *parts: Additional path segments to join

    Returns:
        Properly formatted S3 key with normalized slashes
    """
    cleaned = "/".join(p.strip("/") for p in parts if p is not None)
    return f"{prefix}/{cleaned}" if cleaned else prefix


def guess_content_type(p: Path) -> str:
    """
    Guess the MIME content type based on file extension.

    Args:
        p: Path to file

    Returns:
        MIME type string, defaults to application/octet-stream
    """
    ext = p.suffix.lower()
    return {
        ".md": "text/markdown",
        ".csv": "text/csv",
        ".json": "application/json",
        ".html": "text/html",
        ".txt": "text/plain",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".zip": "application/zip",
        ".tar": "application/x-tar",
        ".gz": "application/gzip",
        ".xml": "application/xml",
        ".yaml": "text/x-yaml",
        ".yml": "text/x-yaml",
        ".py": "text/x-python",
        ".js": "text/javascript",
        ".ts": "text/typescript",
        ".css": "text/css",
        ".sh": "text/x-shellscript",
        ".svg": "image/svg+xml",
    }.get(ext, "application/octet-stream")
