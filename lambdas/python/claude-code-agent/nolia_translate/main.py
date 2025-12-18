"""
Main implementation for the Nolia Translate (Phase 5) Agent.

This agent translates the final World Bank evaluation report from English
to the user's requested output language.
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
    SYSTEM_PROMPT_TRANSLATE,
    get_language_display_name,
)
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


def run(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Main entry point for the Nolia Translate (Phase 5) agent.

    This phase:
    1. Downloads the final report from Phase 4
    2. Translates it to the target language using Claude CLI
    3. Uploads the translated report back to S3

    Args:
        event: Lambda event with job parameters including output_language
        context: Lambda context

    Returns:
        AppOutput dictionary with results
    """
    helpers.setup_step_function_lambda_logging(event, context)

    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event["user_id"]
    output_language = event.get("output_language", "english")
    assessment_type = event.get("assessment_type", "evaluation-report")
    phase = event.get("phase", 5)

    # Get display name for the language
    target_language = get_language_display_name(output_language)

    logger.info(
        "Starting Nolia Translate (Phase 5)",
        job_id=job_id,
        phase=phase,
        output_language=output_language,
        target_language=target_language,
    )

    # Setup workspace
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = nolia_utils.setup_nolia_workspace(workdir)
    bucket = os.environ["OUTPUTS_BUCKET_NAME"]
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)

    # Setup event streaming
    app_context = event_streaming.setup_event_context(event, bucket)
    event_streaming.try_append_event("PHASE:TRANSLATE:START", app_context)
    event_streaming.try_append_event(
        f"Translating report to {target_language}...", app_context
    )

    # Download outputs from Phase 4 (the final report)
    _download_outputs_from_s3(dirs["outputs"], bucket, prefix)

    # Setup home directory and settings
    home = Path(os.environ.get("HOME", "/tmp"))
    session.ensure_settings(SETTINGS_JSON, home)

    # Build the translation prompt
    user_prompt = _build_user_prompt(target_language)

    # Ensure Claude CLI is available
    bin_path = cli_runner.ensure_claude_cli(bucket)

    # Build system prompt
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC"), target_language
    )

    # Run Claude CLI to translate
    trace_path = workdir / "translate_trace.jsonl"
    new_session_id, _ = _run_claude_cli(
        bin_path=bin_path,
        workdir=workdir,
        prompt=user_prompt,
        system_prompt=system_prompt,
        trace_path=trace_path,
        app_context=app_context,
    )

    # Upload translated outputs back to S3
    _upload_outputs(dirs["outputs"], bucket, prefix)

    # Upload trace
    _upload_trace(trace_path, bucket, prefix, trace_name="phase5_translate_trace.jsonl")

    # Get result text and S3 key
    result_text, report_s3_key = _get_translated_report(dirs["outputs"], bucket, prefix)

    logger.info(
        "Nolia Translate (Phase 5) complete",
        job_id=job_id,
        output_language=output_language,
    )
    event_streaming.try_append_event("PHASE:TRANSLATE:COMPLETE", app_context)

    # For large reports, return summary inline with full report in S3
    max_inline_size = 50000  # ~50KB to be safe

    if len(result_text) > max_inline_size:
        summary = _extract_summary(result_text)
        return appoutput.format_s3_result(
            title=f"Final Evaluation Report ({target_language})",
            s3_key=report_s3_key,
            summary=summary,
        )

    return appoutput.format_inline_result(
        title=f"Final Evaluation Report ({target_language})",
        content=result_text,
        s3_key=report_s3_key,
    )


def _build_user_prompt(target_language: str) -> str:
    """Build the user prompt for translation."""
    return f"""Translate the final evaluation report to {target_language}.

1. Read the report from outputs/Final_*.md (or any .md file in outputs/)
2. Translate the entire document to {target_language}
3. Keep all formatting exactly the same (Markdown structure, tables, headings)
4. Do NOT translate: proper nouns, acronyms, rule IDs, form numbers, citations
5. Save the translated report to the same file (overwrite it)

Important: Maintain the professional World Bank tone in {target_language}."""


def _build_runtime_system_prompt(
    workdir: Path, user_tz: str, target_language: str
) -> str:
    """Build system prompt with runtime context."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    platform_info = f"{platform.system()} {platform.release()}"

    return SYSTEM_PROMPT_TRANSLATE.format(
        working_directory=str(workdir),
        platform=platform_info,
        today_date=today_date,
        target_language=target_language,
    )


def _download_outputs_from_s3(outputs_dir: Path, bucket: str, prefix: str) -> None:
    """Download outputs from S3 (Phase 4 results)."""
    outputs_prefix = s3_operations.safe_s3_key(prefix, "outputs")

    # List and download all files from the outputs prefix
    try:
        from prm import client as prm_client

        s3_client = prm_client("s3")

        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=outputs_prefix)

        for obj in response.get("Contents", []):
            key = obj["Key"]
            # Get relative path from outputs prefix
            rel_path = key[len(outputs_prefix) :].lstrip("/")
            if not rel_path:
                continue

            local_path = outputs_dir / rel_path
            local_path.parent.mkdir(parents=True, exist_ok=True)

            # Download the file
            file_obj = s3_client.get_object(Bucket=bucket, Key=key)
            local_path.write_bytes(file_obj["Body"].read())
            logger.info("Downloaded output file", key=key, local=str(local_path))

    except Exception as e:
        logger.warning("Error downloading outputs from S3", error=str(e))


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
    """Upload all output files to S3 (overwriting originals with translated versions)."""
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
                logger.info("Uploaded translated output", file=str(rel_path))
            except Exception as e:
                logger.warning(
                    "Failed to upload output", file=str(rel_path), error=str(e)
                )


def _upload_trace(
    trace_path: Path,
    bucket: str,
    prefix: str,
    trace_name: str = "phase5_translate_trace.jsonl",
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


def _get_translated_report(
    outputs_dir: Path, bucket: str, prefix: str
) -> Tuple[str, str]:
    """
    Get the translated report content and ensure it's uploaded to S3.

    Returns:
        Tuple of (report_content, s3_key)
    """
    # Look for the final report file (various naming patterns)
    report_patterns = [
        "Final_Evaluation_Report_*.md",
        "Final_ToR_Assessment_*.md",
        "Final_*.md",
        "*.md",
    ]

    report_file = None
    for pattern in report_patterns:
        files = list(outputs_dir.glob(pattern))
        if files:
            report_file = files[0]
            break

    if report_file:
        content = report_file.read_text(encoding="utf-8")
        s3_key = s3_operations.safe_s3_key(prefix, "outputs", report_file.name)
    else:
        content = "# Translated Report\n\nTranslation completed. Check outputs directory for files."
        s3_key = s3_operations.safe_s3_key(prefix, "outputs", "Translated_Report.md")

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
        "## Ringkasan Eksekutif",  # Bahasa Indonesia
        "## 1. Ringkasan Eksekutif",
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
