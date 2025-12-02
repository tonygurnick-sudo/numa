"""
Main implementation for the Nolia Procurement Rules (Phase 3) Agent.

This agent checks the evaluation report against procurement-specific
rules, with deep-dive analysis on technical evaluation and qualification criteria.
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
    trace_parser,
)

from .prompts import SYSTEM_PROMPT
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


def run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main entry point for the Nolia Procurement Rules (Phase 3) agent.

    This phase:
    1. Downloads tmp/ from Phase 1
    2. Runs Claude CLI to check procurement rules compliance
    3. Uploads updated tmp/ to S3

    Args:
        event: Lambda event with job parameters
        context: Lambda context

    Returns:
        AppOutput dictionary with results
    """
    helpers.setup_step_function_lambda_logging(event, context)

    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event["user_id"]
    extracted_content_key = event.get("extracted_content_key", "")
    global_kb = event.get("global_kb", "")
    procurement_kb = event.get("procurement_kb", "")
    phase = event.get("phase", 3)

    logger.info(
        "Starting Nolia Procurement Rules (Phase 3)", job_id=job_id, phase=phase
    )

    # Setup workspace
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = nolia_utils.setup_nolia_workspace(workdir)
    bucket = os.environ["OUTPUTS_BUCKET_NAME"]
    data_bucket = os.environ.get("DATA_BUCKET_NAME", bucket)
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)

    # Setup event streaming
    app_context = event_streaming.setup_event_context(event, bucket)
    event_streaming.try_append_event("PHASE:PROCUREMENT:START", app_context)
    event_streaming.try_append_event(
        "Checking procurement-specific requirements...", app_context
    )

    # Hydrate tmp/ from Phase 1
    nolia_utils.hydrate_tmp_from_s3(dirs["tmp"], bucket, prefix)

    # Download extracted content if not already present
    if extracted_content_key:
        _download_extracted_content(extracted_content_key, bucket, dirs["inputs"])

    # Download knowledge base files
    nolia_utils.download_kb_files(data_bucket, global_kb, procurement_kb, workdir)

    # Setup home directory and settings
    home = Path(os.environ.get("HOME", "/tmp"))
    session.ensure_settings(SETTINGS_JSON, home)

    # Build the prompt
    user_prompt = _build_user_prompt()

    # Ensure Claude CLI is available
    bin_path = cli_runner.ensure_claude_cli(bucket)

    # Build system prompt
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC")
    )

    # Run Claude CLI
    trace_path = workdir / "trace.jsonl"
    event_streaming.try_append_event(
        "Assessing compliance with procurement criteria...", app_context
    )
    _, _ = _run_claude_cli(
        bin_path=bin_path,
        workdir=workdir,
        prompt=user_prompt,
        system_prompt=system_prompt,
        trace_path=trace_path,
        app_context=app_context,
    )

    # Extract final response from trace and save as phase notes
    result = trace_parser.extract_result_from_trace(trace_path)
    if result:
        phase_notes_path = dirs["tmp"] / "procurement-phase-notes.md"
        phase_notes_path.write_text(result, encoding="utf-8")
        logger.info("Saved procurement phase notes from trace")

    # Upload tmp/ directory to S3 for Phase 4
    nolia_utils.upload_tmp_to_s3(dirs["tmp"], bucket, prefix)

    # Upload trace
    _upload_trace(trace_path, bucket, prefix)

    # Get result text
    result_text = _get_phase_result(dirs["tmp"])

    logger.info("Nolia Procurement Rules (Phase 3) complete", job_id=job_id)
    event_streaming.try_append_event("PHASE:PROCUREMENT:COMPLETE", app_context)

    return appoutput.format_inline_result(
        title="Phase 3: Procurement Rules Compliance Complete",
        content=result_text,
        s3_key=s3_operations.safe_s3_key(prefix, "outputs", ".phase3.md"),
    )


def _download_extracted_content(key: str, bucket: str, inputs_dir: Path) -> None:
    """Download extracted document content from S3."""
    try:
        data = s3_helpers.read(key, bucket=bucket)
        filename = Path(key).name
        dest = inputs_dir / filename
        if not dest.exists():
            dest.write_bytes(data)
            logger.info("Downloaded extracted content", key=key)
    except Exception as e:
        logger.warning("Failed to download extracted content", error=str(e))


def _build_user_prompt() -> str:
    """Build the user prompt for Phase 3."""
    return """Check the evaluation report against all procurement-specific rules.

Read the document manifest first (tmp/document_manifest.json) to understand the document structure.
Then systematically check each rule in ./procurement-rules.md.

Perform deep-dive analysis on:
- Technical evaluation (Form 12/13/14) - scoring analysis
- Qualification evaluation (Form 11) - pass/fail analysis
- Recurring issues detection

Create the required output files:
- tmp/procurement_rules_compliance.csv
- tmp/procurement_rules_summary.md
- tmp/technical_scoring_analysis.json
- tmp/recurring_issues.csv
- tmp/failed_lots_analysis.md (if any lots have zero responsive bidders)

End with a summary of your key findings and the files you generated."""


def _build_runtime_system_prompt(workdir: Path, user_tz: str) -> str:
    """Build system prompt with runtime context."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
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

    bedrock_creds = get_cross_account_bedrock_credentials()

    env: dict[str, str] = {
        **os.environ,
        **ENV_VARS,
        "HOME": os.environ.get("HOME", "/tmp"),
        "PYTHONPATH": ":".join(
            filter(None, [os.environ.get("PYTHONPATH"), "/opt/python", "/var/task"])
        ),
    }
    if bedrock_creds:
        env.update(cast(dict[str, str], bedrock_creds))

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
                raise RuntimeError(f"Claude CLI failed: {err}")

    return new_session_id, proc.returncode


def _upload_trace(trace_path: Path, bucket: str, prefix: str) -> None:
    """Upload trace file to S3."""
    if trace_path.exists():
        trace_key = s3_operations.safe_s3_key(prefix, "trace", "phase3_trace.jsonl")
        s3_helpers.write(
            trace_key,
            trace_path.read_bytes(),
            content_type="application/x-ndjson",
            bucket=bucket,
        )


def _get_phase_result(tmp_dir: Path) -> str:
    """Get the result text from phase outputs."""
    summary_path = tmp_dir / "procurement_rules_summary.md"
    if summary_path.exists():
        return summary_path.read_text(encoding="utf-8")
    return "# Phase 3 Complete\n\nProcurement rules compliance check completed."
