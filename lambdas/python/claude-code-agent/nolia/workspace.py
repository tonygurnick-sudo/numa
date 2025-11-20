# pylint: disable=duplicate-code,R0801
"""
Workspace management utilities for Claude Code Agent.

Provides functions for managing the isolated workspace directories,
hydrating inputs from S3, and listing user-uploaded files.
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

import structlog

from s3_helpers import list_objects, read

logger = structlog.get_logger(__name__)


def setup_workspace(workdir: Path) -> Dict[str, Path]:
    """
    Create standard workspace directories for a Claude Code Agent run.

    Args:
        workdir: Root workspace directory (typically /tmp/cc_ws/{job_id})

    Returns:
        Dictionary with paths to inputs, outputs, and tmp directories
    """
    inputs = workdir / "user-inputs"
    outputs = workdir / "outputs"
    tmp = workdir / "tmp"
    for d in (inputs, outputs, tmp):
        d.mkdir(parents=True, exist_ok=True)
    return {"inputs": inputs, "outputs": outputs, "tmp": tmp}


def list_user_files(
    inputs_dir: Path, max_files: int = 50, skip_hidden: bool = True
) -> Tuple[List[str], int]:
    """
    Return up to max_files file names in the inputs directory and count of any extras.

    - Skips directories; returns base names only.
    - Optionally skips dotfiles.
    - Sorts case-insensitively for deterministic ordering.

    Args:
        inputs_dir: Directory containing user input files
        max_files: Maximum number of files to return
        skip_hidden: Whether to skip hidden (dot) files

    Returns:
        Tuple of (list of file names, count of extra files beyond max_files)
    """
    if not inputs_dir.exists():
        return [], 0

    names: List[str] = []
    try:
        for p in inputs_dir.iterdir():
            if not p.is_file():
                continue
            name = p.name
            if skip_hidden and name.startswith("."):
                continue
            # Truncate extremely long file names for prompt readability
            if len(name) > 200:
                name = name[:197] + "..."
            names.append(name)
    except Exception:  # pylint: disable=broad-exception-caught
        # On any listing error, fail gracefully
        return [], 0

    names.sort(key=lambda x: x.lower())
    if len(names) <= max_files:
        return names, 0
    return names[:max_files], len(names) - max_files


def augment_prompt_with_uploads(
    user_prompt: str, inputs_dir: Path, include: bool = True
) -> Tuple[str, int, int]:
    """
    Build a composite prompt that prefaces the user's message with uploaded files.

    Args:
        user_prompt: Original user prompt
        inputs_dir: Directory containing uploaded files
        include: Whether to include the file list

    Returns:
        Tuple of (final_prompt, included_count, extra_count)
    """
    if not include:
        return user_prompt, 0, 0

    files, extra = list_user_files(inputs_dir)
    if not files:
        return user_prompt, 0, 0

    lines: List[str] = []
    lines.append("User uploaded files (available under ./user-inputs/):")
    for n in files:
        lines.append(f"- {n}")
    if extra:
        lines.append(f"... and {extra} more")
    lines.append("")
    lines.append("User prompt:")
    lines.append(user_prompt.strip())

    return "\n".join(lines), len(files), extra


def hydrate_inputs(
    bucket: str, uploaded_files: List[Dict[str, Any]], inputs_dir: Path
) -> List[str]:
    """
    Download uploaded files from S3 to the local inputs directory.

    Args:
        bucket: S3 bucket name
        uploaded_files: List of dicts containing s3_key or key fields
        inputs_dir: Local directory to save files

    Returns:
        List of downloaded file names
    """
    downloaded: List[str] = []
    for item in uploaded_files or []:
        key = item.get("s3_key") or item.get("key")
        if not key:
            continue
        data = read(key, bucket=bucket)
        name = os.path.basename(key)
        dest = inputs_dir / name
        dest.write_bytes(data)
        downloaded.append(name)
    return downloaded


def hydrate_prior_outputs(bucket: str, prefix: str, outputs_dir: Path) -> int:
    """
    Download prior outputs from S3 so the agent can read its previous artifacts.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix for prior outputs
        outputs_dir: Local directory to save outputs

    Returns:
        Count of files downloaded
    """
    count = 0
    try:
        keys = list_objects(prefix=f"{prefix}/outputs/", bucket=bucket)
        for key in keys:
            # skip folders and ensure relative name
            rel = key.split(f"{prefix}/outputs/")[-1]
            if not rel or rel.endswith("/"):
                continue
            target = outputs_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            data = read(key, bucket=bucket)
            target.write_bytes(data)
            count += 1
        if count:
            logger.info("Hydrated prior outputs", files=count)
    except Exception:  # pylint: disable=broad-exception-caught
        logger.warning("Failed hydrating prior outputs")
    return count
