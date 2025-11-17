"""
Session management utilities for Claude Code Agent.

Provides functions for managing Claude CLI session persistence,
including archiving/restoring sessions and managing settings.
"""

import io
import json
import tarfile
from pathlib import Path
from typing import Any, Dict

import structlog

import s3_helpers

logger = structlog.get_logger(__name__)


def session_archive_key(prefix: str) -> str:
    """
    Generate the S3 key for session archive storage.

    Args:
        prefix: S3 prefix for the job

    Returns:
        S3 key for the session archive
    """
    # Using simple path joining since we're in utils now
    cleaned = "/".join(
        p.strip("/") for p in [prefix, "sessions", "claude-home.tar.gz"] if p
    )
    return cleaned


def restore_session(bucket: str, prefix: str, home: Path) -> bool:
    """
    Restore a Claude CLI session from S3 archive.

    Downloads and extracts a tar.gz archive containing the .claude directory
    to restore session state from a previous run.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job
        home: Local home directory to restore session into

    Returns:
        True if session was successfully restored, False otherwise
    """
    key = session_archive_key(prefix)
    try:
        blob = s3_helpers.read(key, bucket=bucket)
    except Exception:  # pylint: disable=broad-exception-caught
        return False
    # Extract tar.gz into home (expects to contain a .claude/ tree)
    home.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        tf.extractall(path=home)
    return True


def archive_session(bucket: str, prefix: str, home: Path) -> None:
    """
    Archive the Claude CLI session to S3 for future restoration.

    Creates a tar.gz archive of the .claude directory and uploads it to S3.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for the job
        home: Local home directory containing .claude to archive
    """
    key = session_archive_key(prefix)
    buf = io.BytesIO()
    # Archive the entire .claude dir under home
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        base = home / ".claude"
        if base.exists():
            tf.add(base, arcname=base.name)
    s3_helpers.write(
        key, buf.getvalue(), content_type="application/gzip", bucket=bucket
    )


def ensure_settings(settings_dict: Dict[str, Any], home: Path) -> None:
    """
    Write settings.json to the Claude CLI configuration directory.

    Creates the .claude directory if needed and writes the settings file
    that controls Claude CLI behavior (tool permissions, sandbox settings, etc.).

    Args:
        settings_dict: Dictionary of settings to write
        home: Home directory containing .claude config
    """
    settings_dir = home / ".claude"
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_path = settings_dir / "settings.json"
    try:
        settings_path.write_text(json.dumps(settings_dict, indent=2), encoding="utf-8")
    except Exception:  # pylint: disable=broad-exception-caught
        logger.warning("Failed writing .claude/settings.json")
