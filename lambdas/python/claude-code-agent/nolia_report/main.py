"""
Main implementation for the Nolia Report (Phase 4) Agent.

This agent generates the final World Bank peer review evaluation report,
synthesizing findings from all previous phases.
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

from .prompts import (
    SYSTEM_PROMPT_EVALUATION,
    SYSTEM_PROMPT_REVIEW_EVALUATION,
    SYSTEM_PROMPT_REVIEW_TOR,
    SYSTEM_PROMPT_TOR,
)
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


def run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main entry point for the Nolia Report (Phase 4) agent.

    This phase:
    1. Downloads tmp/ from all previous phases
    2. Runs Claude CLI to generate the final report
    3. Uploads the final report to S3

    Supports two assessment types:
    - evaluation-report: Procurement evaluation reports (default)
    - terms-of-reference: Terms of Reference / Project documents

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
    global_kb = event.get("global_kb", "")
    procurement_kb = event.get("procurement_kb", "")
    project_kb = event.get("project_kb", "")
    assessment_type = event.get("assessment_type", "evaluation-report")
    phase = event.get("phase", 4)

    logger.info(
        "Starting Nolia Report (Phase 4)",
        job_id=job_id,
        phase=phase,
        assessment_type=assessment_type,
    )

    # Setup workspace
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = nolia_utils.setup_nolia_workspace(workdir)
    bucket = os.environ["OUTPUTS_BUCKET_NAME"]
    data_bucket = os.environ.get("DATA_BUCKET_NAME", bucket)
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)

    # Setup event streaming
    app_context = event_streaming.setup_event_context(event, bucket)
    event_streaming.try_append_event("PHASE:REPORT:START", app_context)
    event_streaming.try_append_event(
        "Preparing final evaluation report...", app_context
    )

    # Hydrate tmp/ from previous phases
    nolia_utils.hydrate_tmp_from_s3(dirs["tmp"], bucket, prefix)

    # Download knowledge base files (for reference documents)
    nolia_utils.download_kb_files(
        data_bucket, global_kb, procurement_kb, workdir, project_kb=project_kb
    )

    # Copy output template to workspace
    nolia_utils.copy_output_template_to_workspace(workdir)

    # Setup home directory and settings
    home = Path(os.environ.get("HOME", "/tmp"))
    session.ensure_settings(SETTINGS_JSON, home)

    # Build the prompt based on assessment type
    user_prompt = _build_user_prompt(assessment_type)

    # Ensure Claude CLI is available
    bin_path = cli_runner.ensure_claude_cli(bucket)

    # Build system prompt based on assessment type
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC"), assessment_type
    )

    # Run Claude CLI - First pass: Generate report
    trace_path = workdir / "trace.jsonl"
    event_streaming.try_append_event("Writing final evaluation report...", app_context)
    new_session_id, _ = _run_claude_cli(
        bin_path=bin_path,
        workdir=workdir,
        prompt=user_prompt,
        system_prompt=system_prompt,
        trace_path=trace_path,
        app_context=app_context,
    )

    # Run Claude CLI - Second pass: Review and refine report
    event_streaming.try_append_event("Reviewing and refining report...", app_context)
    review_prompt = _build_review_prompt(assessment_type)
    review_system_prompt = _build_review_system_prompt(
        workdir, event.get("user_timezone", "UTC"), assessment_type
    )
    review_trace_path = workdir / "review_trace.jsonl"
    _run_claude_cli(
        bin_path=bin_path,
        workdir=workdir,
        prompt=review_prompt,
        system_prompt=review_system_prompt,
        trace_path=review_trace_path,
        app_context=app_context,
    )

    # Upload outputs directory to S3
    _upload_outputs(dirs["outputs"], bucket, prefix)

    # Upload traces
    _upload_trace(trace_path, bucket, prefix, trace_name="phase4_trace.jsonl")
    _upload_trace(
        review_trace_path, bucket, prefix, trace_name="phase4_review_trace.jsonl"
    )

    # Finalize job artifacts
    _finalize_job(dirs, bucket, prefix, job_id, new_session_id)

    # Get result text and S3 key
    result_text, report_s3_key = _get_final_report(dirs["outputs"], bucket, prefix)

    logger.info("Nolia Report (Phase 4) complete", job_id=job_id)
    event_streaming.try_append_event("PHASE:REPORT:COMPLETE", app_context)

    # For large reports, return summary inline with full report in S3
    # Step Functions have 256KB payload limit
    max_inline_size = 50000  # ~50KB to be safe

    if len(result_text) > max_inline_size:
        summary = _extract_summary(result_text)
        return appoutput.format_s3_result(
            title="Final Evaluation Report",
            s3_key=report_s3_key,
            summary=summary,
        )

    return appoutput.format_inline_result(
        title="Final Evaluation Report",
        content=result_text,
        s3_key=report_s3_key,
    )


def _build_user_prompt(assessment_type: str = "evaluation-report") -> str:
    """Build the user prompt for Phase 4 based on assessment type."""
    if assessment_type == "terms-of-reference":
        return """Generate the final World Bank Terms of Reference assessment report.

Read the phase notes FIRST to understand key findings from prior phases:
- tmp/global-phase-notes.md - Key findings from Phase 2 (Global Rules)
- tmp/project-phase-notes.md - Key findings from Phase 3 (Project Rules)

Then read the required input files:
- tmp/document_manifest.json
- tmp/global_rules_compliance.csv
- tmp/global_rules_summary.md
- tmp/project_rules_compliance.csv
- tmp/project_rules_summary.md
- tmp/recurring_issues.csv (if exists)
- tmp/gaps_analysis.md (if exists)

Create the final report in outputs/Final_ToR_Assessment_{PROJECT_NAME}.md

Include:
- All findings from Phase 2 and 3 CSVs
- Professional World Bank peer review tone
- Path forward recommendations
- Compliant Areas section with positive observations
- Complete Annexes"""

    # Default: evaluation-report
    return """Generate the final World Bank peer review evaluation report.

Read the phase notes FIRST to understand key findings from prior phases:
- tmp/global-phase-notes.md - Key findings from Phase 2 (Global Rules)
- tmp/procurement-phase-notes.md - Key findings from Phase 3 (Procurement Rules)

Then read the required input files:
- tmp/document_manifest.json
- tmp/global_rules_compliance.csv
- tmp/global_rules_summary.md
- tmp/procurement_rules_compliance.csv
- tmp/procurement_rules_summary.md
- tmp/recurring_issues.csv (if exists)
- tmp/failed_lots_analysis.md (if exists)

Follow the Output_Template_Evaluation_Report.md structure exactly.

Create the final report in outputs/Final_Evaluation_Report_{PROCUREMENT_NAME}.md

Include:
- All findings from Phase 2 and 3 CSVs
- Professional World Bank peer review tone
- Path forward recommendations (Options A/B/C)
- Compliant Areas section with positive observations
- Complete Annexes"""


def _build_runtime_system_prompt(
    workdir: Path, user_tz: str, assessment_type: str = "evaluation-report"
) -> str:
    """Build system prompt with runtime context based on assessment type."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    platform_info = f"{platform.system()} {platform.release()}"

    # Select base prompt based on assessment type
    if assessment_type == "terms-of-reference":
        base_prompt = SYSTEM_PROMPT_TOR
    else:
        base_prompt = SYSTEM_PROMPT_EVALUATION

    return base_prompt.format(
        working_directory=str(workdir),
        platform=platform_info,
        today_date=today_date,
    )


def _build_review_prompt(assessment_type: str = "evaluation-report") -> str:
    """Build the user prompt for the review pass."""
    if assessment_type == "terms-of-reference":
        return """Review and refine the generated Terms of Reference assessment report.

Read the generated report in outputs/ and review it against:
1. The compliance CSVs in tmp/ - use the `source_reference` column to replace any internal rule IDs with actual policy citations
2. The phase notes and summaries for completeness
3. The expected structure and tone

Focus on:
- Replacing internal rule references (G-001, P-003, etc.) with actual policy document citations from the CSVs
- Ensuring all sections are present and properly structured
- Making annexes detailed with specific data
- Verifying all Phase 2/3 findings are included
- Maintaining World Bank professional tone throughout

Edit the report file in-place."""

    return """Review and refine the generated evaluation report.

Read the generated report in outputs/ and review it against:
1. The compliance CSVs in tmp/ - use the `source_reference` column to replace any internal rule IDs with actual policy citations
2. The phase notes and summaries for completeness
3. The Output_Template_Evaluation_Report.md for expected structure

Focus on:
- Replacing internal rule references (G-001, P-003, etc.) with actual policy document citations from the CSVs
- Ensuring all 19 sections are present and properly structured
- Making annexes detailed with specific data (bidder names, lot numbers, page references)
- Verifying all Phase 2/3 findings are included
- Maintaining World Bank professional peer-review tone throughout

Edit the report file in-place."""


def _build_review_system_prompt(
    workdir: Path, user_tz: str, assessment_type: str = "evaluation-report"
) -> str:
    """Build system prompt for review pass with runtime context."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    platform_info = f"{platform.system()} {platform.release()}"

    # Select review prompt based on assessment type
    if assessment_type == "terms-of-reference":
        base_prompt = SYSTEM_PROMPT_REVIEW_TOR
    else:
        base_prompt = SYSTEM_PROMPT_REVIEW_EVALUATION

    return base_prompt.format(
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


def _upload_outputs(outputs_dir: Path, bucket: str, prefix: str) -> None:
    """Upload all output files to S3."""
    if not outputs_dir.exists():
        return

    for file_path in outputs_dir.rglob("*"):
        if file_path.is_file() and not file_path.name.startswith("."):
            rel_path = file_path.relative_to(outputs_dir)
            s3_key = s3_operations.safe_s3_key(prefix, "outputs", str(rel_path))
            content_type = s3_operations.guess_content_type(file_path)

            try:
                s3_helpers.write(
                    s3_key,
                    file_path.read_bytes(),
                    content_type=content_type,
                    bucket=bucket,
                )
                logger.info("Uploaded output", file=str(rel_path))
            except Exception as e:
                logger.warning(
                    "Failed to upload output", file=str(rel_path), error=str(e)
                )


def _upload_trace(
    trace_path: Path, bucket: str, prefix: str, trace_name: str = "phase4_trace.jsonl"
) -> None:
    """Upload trace file to S3."""
    if trace_path.exists():
        trace_key = s3_operations.safe_s3_key(prefix, "trace", trace_name)
        s3_helpers.write(
            trace_key,
            trace_path.read_bytes(),
            content_type="application/x-ndjson",
            bucket=bucket,
        )


def _finalize_job(
    dirs: Dict[str, Path],
    bucket: str,
    prefix: str,
    job_id: str,
    session_id: Optional[str],
) -> None:
    """Finalize job with manifest and metadata."""
    # Collect output files
    outputs_list = []
    if dirs["outputs"].exists():
        for file_path in dirs["outputs"].rglob("*"):
            if file_path.is_file():
                rel_path = file_path.relative_to(dirs["outputs"])
                s3_key = s3_operations.safe_s3_key(prefix, "outputs", str(rel_path))
                outputs_list.append(s3_key)

    # Write manifest
    manifest = {
        "jobId": job_id,
        "phase": 4,
        "ccSessionId": session_id,
        "outputs": outputs_list,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    s3_helpers.write(
        s3_operations.safe_s3_key(prefix, "meta", "manifest.json"),
        json.dumps(manifest).encode("utf-8"),
        content_type="application/json",
        bucket=bucket,
    )
    logger.info("Wrote final manifest", job_id=job_id, outputs=len(outputs_list))


def _get_final_report(outputs_dir: Path, bucket: str, prefix: str) -> Tuple[str, str]:
    """
    Get the final report content and upload to S3.

    Returns:
        Tuple of (report_content, s3_key)
    """
    # Look for the final report file
    report_files = list(outputs_dir.glob("Final_Evaluation_Report_*.md"))
    if report_files:
        report_file = report_files[0]
        content = report_file.read_text(encoding="utf-8")
        s3_key = s3_operations.safe_s3_key(prefix, "outputs", report_file.name)
    else:
        # Fallback to any markdown file
        md_files = list(outputs_dir.glob("*.md"))
        if md_files:
            report_file = md_files[0]
            content = report_file.read_text(encoding="utf-8")
            s3_key = s3_operations.safe_s3_key(prefix, "outputs", report_file.name)
        else:
            content = "# Final Report\n\nReport generation completed. Check outputs directory for files."
            s3_key = s3_operations.safe_s3_key(prefix, "outputs", "Final_Report.md")

    # Upload report to S3 (ensures it's accessible even if inline is truncated)
    s3_helpers.write(
        s3_key,
        content.encode("utf-8"),
        content_type="text/markdown",
        bucket=bucket,
    )

    return content, s3_key


def _extract_summary(report_text: str, max_length: int = 5000) -> str:
    """
    Extract a summary from the report for inline display.

    Tries to find an Executive Summary section, otherwise takes the first portion.

    Args:
        report_text: Full report content
        max_length: Maximum characters for summary

    Returns:
        Summary text with note about full report
    """
    # Try to find Executive Summary section
    exec_summary_markers = [
        "## Executive Summary",
        "## 1. Executive Summary",
        "# Executive Summary",
    ]

    for marker in exec_summary_markers:
        if marker in report_text:
            start = report_text.find(marker)
            # Find next section (## heading)
            next_section = report_text.find("\n## ", start + len(marker))
            if next_section == -1:
                next_section = report_text.find("\n# ", start + len(marker))

            if next_section != -1:
                summary = report_text[start:next_section].strip()
                if len(summary) <= max_length:
                    return summary + "\n\n---\n*See full report for complete details.*"

    # Fallback: take first portion of report
    if len(report_text) <= max_length:
        return report_text

    # Find a good break point (end of paragraph)
    truncated = report_text[:max_length]
    last_para = truncated.rfind("\n\n")
    if last_para > max_length // 2:
        truncated = truncated[:last_para]

    return (
        truncated.strip()
        + "\n\n---\n*Report truncated. See full report for complete details.*"
    )
