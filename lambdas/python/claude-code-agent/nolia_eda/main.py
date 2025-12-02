"""
Main implementation for the Nolia EDA (Phase 1) Agent.

This agent performs document understanding and mapping for World Bank
procurement evaluation reports. It creates structured outputs that
subsequent phases depend on.
"""

import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union, cast
from zoneinfo import ZoneInfo

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers
from utils import (
    appoutput,
    cli_runner,
    event_streaming,
    get_cross_account_bedrock_credentials,
    nolia_utils,
    s3_operations,
    session,
)

from .prompts import SYSTEM_PROMPT
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


def run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main entry point for the Nolia EDA (Phase 1) agent.

    This phase:
    1. Downloads the extracted document from S3
    2. Downloads knowledge base files from the data bucket
    3. Runs Claude CLI to analyze document structure
    4. Uploads tmp/ outputs to S3 for subsequent phases

    Args:
        event: Lambda event with job parameters
        context: Lambda context

    Returns:
        AppOutput dictionary with results
    """
    helpers.setup_step_function_lambda_logging(event, context)

    # Extract core identifiers
    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event["user_id"]
    extracted_content_key = event.get("extracted_content_key", "")
    global_kb = event.get("global_kb", "")
    procurement_kb = event.get("procurement_kb", "")
    phase = event.get("phase", 1)

    logger.info(
        "Starting Nolia EDA (Phase 1)",
        job_id=job_id,
        phase=phase,
        global_kb=global_kb,
        procurement_kb=procurement_kb,
    )

    # Setup workspace
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = nolia_utils.setup_nolia_workspace(workdir)
    bucket = os.environ["OUTPUTS_BUCKET_NAME"]
    data_bucket = os.environ.get("DATA_BUCKET_NAME", bucket)
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)

    # Setup event streaming
    app_context = event_streaming.setup_event_context(event, bucket)
    event_streaming.try_append_event("PHASE:EDA:START", app_context)
    event_streaming.try_append_event("Exploring document structure...", app_context)

    # Download extracted content
    if extracted_content_key:
        _download_extracted_content(extracted_content_key, bucket, dirs["inputs"])

    # Download knowledge base files
    nolia_utils.download_kb_files(data_bucket, global_kb, procurement_kb, workdir)

    # Copy output template to workspace
    nolia_utils.copy_output_template_to_workspace(workdir)

    # Setup home directory and settings
    home = Path(os.environ.get("HOME", "/tmp"))
    session.ensure_settings(SETTINGS_JSON, home)

    # Build the prompt
    user_prompt = _build_user_prompt(dirs["inputs"])

    # Ensure Claude CLI is available
    bin_path = cli_runner.ensure_claude_cli(bucket)
    cli_runner.check_cli_version(bin_path)

    # Build system prompt with runtime context
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC")
    )

    # Run Claude CLI
    trace_path = workdir / "trace.jsonl"
    event_streaming.try_append_event(
        "Identifying key sections and information...", app_context
    )
    new_session_id, _ = _run_claude_cli(
        bin_path=bin_path,
        workdir=workdir,
        prompt=user_prompt,
        system_prompt=system_prompt,
        trace_path=trace_path,
        app_context=app_context,
    )

    # Upload tmp/ directory to S3 for subsequent phases
    nolia_utils.upload_tmp_to_s3(dirs["tmp"], bucket, prefix)

    # Upload trace for debugging
    _upload_trace(trace_path, bucket, prefix)

    # Save session metadata for potential resume
    if new_session_id:
        _save_session_metadata(new_session_id, bucket, prefix, home)

    # Get result text from tmp/document_summary.md
    result_text = _get_phase_result(dirs["tmp"])

    logger.info("Nolia EDA (Phase 1) complete", job_id=job_id)
    event_streaming.try_append_event("PHASE:EDA:COMPLETE", app_context)

    return appoutput.format_inline_result(
        title="Phase 1: Document Analysis Complete",
        content=result_text,
        s3_key=s3_operations.safe_s3_key(prefix, "outputs", ".phase1.md"),
    )


def _download_extracted_content(key: str, bucket: str, inputs_dir: Path) -> None:
    """Download extracted document content from S3."""
    try:
        data = s3_helpers.read(key, bucket=bucket)
        # Get the filename from the key
        filename = Path(key).name
        dest = inputs_dir / filename
        dest.write_bytes(data)
        logger.info("Downloaded extracted content", key=key, dest=str(dest))
    except Exception as e:
        logger.warning("Failed to download extracted content", key=key, error=str(e))


def _build_user_prompt(inputs_dir: Path) -> str:
    """Build the user prompt with file inventory."""
    lines = ["Analyze the following document:"]

    # List input files
    for f in inputs_dir.iterdir():
        if f.is_file():
            lines.append(f"- {f.name}")

    lines.append("")
    lines.append("Create the document manifest, summary, and page index as specified.")

    return "\n".join(lines)


def _build_runtime_system_prompt(workdir: Path, user_tz: str) -> str:
    """Build system prompt with current date and platform info."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        logger.warning(f"Invalid timezone '{user_tz}', using UTC")
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    platform_info = f"{platform.system()} {platform.release()}"

    return SYSTEM_PROMPT.format(
        working_directory=str(workdir),
        platform=platform_info,
        today_date=today_date,
    )


def _run_claude_cli(
    bin_path: str,
    workdir: Path,
    prompt: str,
    system_prompt: str,
    trace_path: Path,
    app_context: Optional[event_streaming.AppContext] = None,
) -> Tuple[Optional[str], int]:
    """Run Claude CLI and capture output with event streaming."""
    # Build allowed tools list from settings
    allowed_tools = []
    tools_cfg = SETTINGS_JSON.get("tools", {})
    for t in tools_cfg.get("allow", []) or []:
        if isinstance(t, str) and t:
            allowed_tools.append(t)
    for pat in tools_cfg.get("bash_allow", []) or []:
        if isinstance(pat, str) and pat:
            allowed_tools.append(f"Bash({pat})")

    permission_mode = SETTINGS_JSON.get("permissions", {}).get(
        "defaultMode", "acceptEdits"
    )

    # Build CLI command
    args = [
        bin_path,
        "-p",
        "--verbose",
        prompt,
        "--output-format",
        "stream-json",
        "--permission-mode",
        permission_mode,
        "--allowedTools",
        ",".join(allowed_tools),
        "--append-system-prompt",
        system_prompt,
    ]

    # Get cross-account credentials if configured
    bedrock_creds = get_cross_account_bedrock_credentials()

    # Prepare environment
    env: dict[str, str] = {
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
    if bedrock_creds:
        env.update(cast(dict[str, str], bedrock_creds))

    # Execute CLI
    new_session_id: Optional[str] = None
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
                    try:
                        obj = json.loads(line)
                        if isinstance(obj, dict) and obj.get("session_id"):
                            new_session_id = obj.get("session_id")

                        # Stream events if enabled
                        if app_context:
                            event_msg = event_streaming.extract_meaningful_event(obj)
                            if event_msg:
                                event_streaming.try_append_event(event_msg, app_context)
                    except json.JSONDecodeError:
                        pass
            finally:
                proc.wait(timeout=840)

            if proc.returncode != 0:
                err = (proc.stderr.read() if proc.stderr else "")[:1024]
                logger.error(
                    "Claude CLI failed", returncode=proc.returncode, stderr=err
                )
                raise RuntimeError(f"Claude CLI failed: {err}")

    return new_session_id, proc.returncode


def _upload_trace(trace_path: Path, bucket: str, prefix: str) -> None:
    """Upload trace file to S3."""
    if trace_path.exists():
        trace_key = s3_operations.safe_s3_key(prefix, "trace", "phase1_trace.jsonl")
        s3_helpers.write(
            trace_key,
            trace_path.read_bytes(),
            content_type="application/x-ndjson",
            bucket=bucket,
        )


def _save_session_metadata(
    session_id: str, bucket: str, prefix: str, home: Path
) -> None:
    """Save session metadata for potential resume."""
    # Save session ID
    s3_helpers.write(
        s3_operations.safe_s3_key(prefix, "meta", "session.json"),
        json.dumps({"ccSessionId": session_id, "phase": 1}).encode("utf-8"),
        content_type="application/json",
        bucket=bucket,
    )

    # Archive Claude home for resume
    try:
        session.archive_session(bucket, prefix, home)
    except Exception as e:
        logger.warning("Failed to archive session", error=str(e))


def _get_phase_result(tmp_dir: Path) -> str:
    """Get the result text from phase outputs."""
    summary_path = tmp_dir / "document_summary.md"
    if summary_path.exists():
        return summary_path.read_text(encoding="utf-8")

    # Fallback
    manifest_path = tmp_dir / "document_manifest.json"
    if manifest_path.exists():
        return "# Phase 1 Complete\n\nDocument manifest created. See `tmp/document_manifest.json` for details."

    return "# Phase 1 Complete\n\nDocument analysis completed."
