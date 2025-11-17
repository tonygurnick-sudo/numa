"""
Main implementation for the Default Claude Code Agent.

A simplified agent that provides basic Claude CLI functionality
without specialized features or complex workflows.
"""

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union
from zoneinfo import ZoneInfo

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers
from utils import (
    appoutput,
    cli_runner,
    s3_operations,
    session,
    trace_parser,
)

from .prompts import SYSTEM_PROMPT
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


# =============================================================================
# WORKSPACE HELPERS (inlined for simplicity)
# =============================================================================


def _setup_workspace(workdir: Path) -> Dict[str, Path]:
    """Create standard workspace directories."""
    inputs = workdir / "user-inputs"
    outputs = workdir / "outputs"
    tmp = workdir / "tmp"
    for d in (inputs, outputs, tmp):
        d.mkdir(parents=True, exist_ok=True)
    return {"inputs": inputs, "outputs": outputs, "tmp": tmp}


def _hydrate_inputs(
    bucket: str, uploaded_files: List[Dict[str, Any]], inputs_dir: Path
) -> List[str]:
    """Download uploaded files from S3 to local inputs directory."""
    downloaded: List[str] = []
    for item in uploaded_files or []:
        key = item.get("s3_key") or item.get("key")
        if not key:
            continue
        data = s3_helpers.read(key, bucket=bucket)
        name = os.path.basename(key)
        dest = inputs_dir / name
        dest.write_bytes(data)
        downloaded.append(name)
    return downloaded


def _list_user_files(
    inputs_dir: Path, max_files: int = 50, skip_hidden: bool = True
) -> Tuple[List[str], int]:
    """Return up to max_files file names in the inputs directory."""
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
            if len(name) > 200:
                name = name[:197] + "..."
            names.append(name)
    except Exception:
        return [], 0

    names.sort(key=lambda x: x.lower())
    if len(names) <= max_files:
        return names, 0
    return names[:max_files], len(names) - max_files


def _augment_prompt_with_uploads(
    user_prompt: str, inputs_dir: Path, include: bool = True
) -> Tuple[str, int, int]:
    """Build a composite prompt with uploaded file list."""
    if not include:
        return user_prompt, 0, 0

    files, extra = _list_user_files(inputs_dir)
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


# Local helpers to reduce repetition across agents
def _collect_and_upload_outputs(
    outputs_dir: Path, bucket: str, prefix: str
) -> list[dict]:
    files: list[dict] = []
    if not outputs_dir.exists():
        return files

    for file_path in outputs_dir.rglob("*"):
        if not file_path.is_file():
            continue
        rel_path = file_path.relative_to(outputs_dir)
        key = s3_operations.safe_s3_key(prefix, "outputs", str(rel_path))
        content_type = s3_operations.guess_content_type(file_path)
        try:
            s3_helpers.write(
                key,
                file_path.read_bytes(),
                content_type=content_type,
                bucket=bucket,
            )
            files.append(
                {
                    "name": file_path.name,
                    "path": key,
                    "type": content_type,
                }
            )
        except Exception as e:
            logger.warning(
                "Failed to upload output file", file=str(file_path), error=str(e)
            )

    return files


def _try_upload_trace(trace_path: Path, bucket: str, prefix: str) -> None:
    try:
        s3_helpers.write(
            s3_operations.safe_s3_key(prefix, "trace.jsonl"),
            trace_path.read_bytes(),
            content_type="application/x-ndjson",
            bucket=bucket,
        )
    except Exception:
        logger.warning("Failed to upload trace")


def build_system_prompt(working_directory: str, platform: str, today_date: str) -> str:
    """
    Build the complete system prompt with runtime context.

    Args:
        working_directory: Current working directory
        platform: Platform information
        today_date: Formatted current date

    Returns:
        Complete system prompt with context
    """
    return SYSTEM_PROMPT.format(
        working_directory=working_directory,
        platform=platform,
        today_date=today_date,
    )


def _build_runtime_system_prompt(workdir: Path, user_tz: str) -> str:
    """Build system prompt with current date and platform info."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    return build_system_prompt(
        working_directory=str(workdir),
        platform=os.environ.get("PLATFORM", "Lambda"),
        today_date=today_date,
    )


def _run_cli_and_extract_result(
    bin_path: str, workdir: Path, prompt: str, system_prompt: str
) -> Tuple[str, Path]:
    """Run Claude CLI and extract result from trace."""
    # Build command arguments from settings
    permission_mode = (SETTINGS_JSON.get("permissions", {}) or {}).get("defaultMode")
    if not permission_mode:
        raise RuntimeError("SETTINGS_JSON.permissions.defaultMode is required")

    # Build allowed tools list
    allowed_tools: List[str] = []
    tools_cfg = SETTINGS_JSON.get("tools", {})
    for t in tools_cfg.get("allow", []) or []:
        if isinstance(t, str) and t:
            allowed_tools.append(t)
    for pat in tools_cfg.get("bash_allow", []) or []:
        if isinstance(pat, str) and pat:
            allowed_tools.append(f"Bash({pat})")
    if not allowed_tools:
        raise RuntimeError("SETTINGS_JSON.tools must define at least one allowed tool")

    # Build CLI command
    args = [bin_path, "-p", "--verbose", prompt]
    args += [
        "--output-format",
        "stream-json",
        "--permission-mode",
        permission_mode,
        "--allowedTools",
        ",".join(allowed_tools),
        "--append-system-prompt",
        system_prompt,
    ]

    # Prepare environment
    env = {
        **os.environ,
        **ENV_VARS,
        "HOME": os.environ.get("HOME", "/tmp"),
        "PYTHONPATH": ":".join(
            filter(
                None,
                [
                    os.environ.get("PYTHONPATH"),
                    "/opt/python",
                    "/var/task",
                ],
            )
        ),
    }

    # Execute CLI and write trace
    trace_path = workdir / "trace.jsonl"
    with trace_path.open("w", encoding="utf-8") as trace_file:
        with subprocess.Popen(
            args,
            cwd=str(workdir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        ) as proc:
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    trace_file.write(line)
                    trace_file.flush()
            finally:
                proc.wait(timeout=840)

        if proc.returncode != 0:
            err = (proc.stderr.read() if proc.stderr else "")[:1024]
            logger.error("Claude CLI failed", returncode=proc.returncode, stderr=err)
            raise RuntimeError(f"Claude CLI failed: {err}")

    result_text = trace_parser.extract_result_from_trace(trace_path)
    if not result_text:
        result_text = "Claude completed but did not produce a result."

    return result_text, trace_path


def run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main entry point for the Default agent.

    This provides a minimal implementation that:
    - Sets up a workspace
    - Runs Claude CLI once with the user prompt
    - Returns the output

    No conversation history, no session persistence, minimal features.

    Args:
        event: Lambda event containing job parameters
        context: Lambda context

    Returns:
        AppOutput dictionary with results
    """
    helpers.setup_step_function_lambda_logging(event, context)

    # Extract core identifiers
    app_id, job_id, user_id = event["app_id"], event["job_id"], event["user_id"]
    prompt = event.get("prompt", "").strip()

    if not prompt:
        return appoutput.format_error_result("Error: No prompt provided")

    # Get S3 bucket
    bucket = os.environ.get("OUTPUTS_BUCKET_NAME")
    if not bucket:
        return appoutput.format_error_result(
            "Error: OUTPUTS_BUCKET_NAME not configured"
        )

    # Setup workspace
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = _setup_workspace(workdir)

    # Handle uploaded files if any
    uploaded_files = event.get("uploaded_files", [])
    if uploaded_files:
        _hydrate_inputs(bucket, uploaded_files, dirs["inputs"])
        prompt, _, _ = _augment_prompt_with_uploads(prompt, dirs["inputs"])

    # Ensure Claude CLI is available
    try:
        bin_path = cli_runner.ensure_claude_cli(bucket)
        cli_runner.check_cli_version(bin_path)
    except Exception as e:
        logger.error("Failed to ensure Claude CLI", error=str(e))
        return appoutput.format_error_result(
            f"Error: Failed to initialize Claude CLI: {str(e)}"
        )

    # Setup home directory and settings
    home = Path(os.environ.get("HOME", "/tmp"))
    session.ensure_settings(SETTINGS_JSON, home)

    # Build system prompt with context
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC")
    )

    # Run Claude CLI and extract result
    try:
        result_text, trace_path = _run_cli_and_extract_result(
            bin_path, workdir, prompt, system_prompt
        )
    except Exception as e:
        logger.error("Failed to run Claude CLI", error=str(e))
        return appoutput.format_error_result(f"Error: Failed to run Claude: {str(e)}")

    # Upload outputs to S3
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)
    output_files = _collect_and_upload_outputs(dirs["outputs"], bucket, prefix)

    # Upload trace for debugging
    _try_upload_trace(trace_path, bucket, prefix)

    # Return result with proper structure
    return appoutput.format_success_with_files(result_text, output_files or [])
