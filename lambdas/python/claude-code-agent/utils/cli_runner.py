"""
Claude CLI runner utilities for Claude Code Agent.

Provides functions for managing and executing the Claude CLI binary,
including downloading, version checking, and command execution.
"""

import os
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Optional

import structlog

import s3_helpers

logger = structlog.get_logger(__name__)


def check_cli_version(bin_path: str) -> str:
    """
    Check if Claude CLI is available and return its version.

    Args:
        bin_path: Path to the Claude CLI binary

    Returns:
        Version string

    Raises:
        RuntimeError: If CLI is not found or version check fails
    """
    try:
        proc = subprocess.run(
            [bin_path, "--version"],
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                proc.stderr.strip() or proc.stdout.strip() or "unknown error"
            )
        version = (proc.stdout or proc.stderr or "").strip()
        logger.info("Claude CLI detected", version=version)
        return version
    except FileNotFoundError as e:
        logger.error("Claude CLI not found in PATH", error=str(e))
        raise RuntimeError("Claude CLI not available in runtime") from e
    except Exception as e:
        logger.error("Claude CLI version check failed", error=str(e))
        raise


def _extract_claude_binary_from_zip(zip_data: bytes, target: Path) -> None:
    """Extract Claude CLI binary from zip data to target path."""
    zip_tmp = Path("/tmp/claude-cli.zip")
    try:
        zip_tmp.write_bytes(zip_data)
        with zipfile.ZipFile(zip_tmp, "r") as zf:
            # Find the claude binary in the zip
            member = None
            for info in zf.infolist():
                if info.filename.endswith("/"):
                    continue
                if info.filename.lstrip("./") == "bin/claude":
                    member = info
                    break

            if not member:
                raise RuntimeError(
                    "claude binary not found in layer zip (expected bin/claude)"
                )

            # Extract and copy to target
            extract_dir = Path("/tmp/claude-extract")
            extract_dir.mkdir(parents=True, exist_ok=True)
            zf.extract(member, path=extract_dir)
            src = extract_dir / "bin" / "claude"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            os.chmod(target, 0o755)
    finally:
        try:
            if zip_tmp.exists():
                zip_tmp.unlink()
        except OSError:
            pass


def ensure_claude_cli(
    bucket: str, s3_key: Optional[str] = None, target_path: Optional[str] = None
) -> str:
    """
    Ensure the Claude CLI is present. If missing, download from S3 and extract.

    Args:
        bucket: S3 bucket containing the CLI
        s3_key: S3 key for the CLI zip file (defaults to env var CLAUDE_CLI_S3_KEY)
        target_path: Target path for the CLI binary (defaults to env var CLAUDE_BIN or /opt/bin/claude)

    Returns:
        Path to the Claude CLI binary
    """
    if target_path:
        bin_path = target_path
    else:
        bin_path = os.environ.get("CLAUDE_BIN") or "/opt/bin/claude"
    target = Path(bin_path)

    if target.exists():
        return bin_path

    cli_s3_key = s3_key or os.environ.get("CLAUDE_CLI_S3_KEY")
    if not cli_s3_key:
        raise RuntimeError("CLAUDE_CLI_S3_KEY not set; cannot fetch Claude CLI")

    # Download the layer ZIP and extract bin/claude
    try:
        blob = s3_helpers.read(cli_s3_key, bucket=bucket)
    except Exception as e:
        logger.error(
            "Failed to download Claude CLI zip from S3", key=cli_s3_key, error=str(e)
        )
        raise

    _extract_claude_binary_from_zip(blob, target)
    return bin_path
