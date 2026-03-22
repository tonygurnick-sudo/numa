"""Custom pipeline orchestrator for Nolia rules generation.

Two-phase pipeline:
1. Extract: Read all KB documents, extract comprehensive rules list
2. Review: Verify completeness, add citations, deduplicate, write final rules.md

The orchestrator downloads KB documents from S3 before running phases,
then uploads the final rules.md back to the KB's S3 prefix in the data bucket.
"""

import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import boto3
import structlog

from ..base import AgentTypeConfig
from ..registry import get_agent_type_config
from .workspace_setup import KB_DIR, OUTPUTS_DIR, TMP_DIR, UPLOADS_DIR, WORKDIR

logger = structlog.get_logger()

DATA_BUCKET = os.environ.get("DATA_BUCKET_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Rules filename by KB category (matches workspace_setup.py download pattern)
RULES_FILENAME_MAP = {
    "global": "global-rules.md",
    "procurement": "procurement-rules.md",
    "project": "project-rules.md",
}


def _emit_progress(
    user_sub: str,
    conversation_id: str,
    s3_prefix: str | None,
    events: list[dict],
    phase: str,
    message: str,
) -> None:
    """Append a progress event and write _progress.json to S3."""
    from ...s3_workspace import write_progress_to_s3

    events.append(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "phase": phase,
            "message": message,
        }
    )
    write_progress_to_s3(user_sub, conversation_id, events, s3_prefix=s3_prefix)


async def run_nolia_rules_pipeline(
    prompt: str,
    user_sub: str,
    conversation_id: str,
    parent_config: AgentTypeConfig,
    *,
    timezone: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    available_kbs: Optional[list[dict]] = None,
    enabled_tools: Optional[list[str]] = None,
    model_id: Optional[str] = None,
    request_id: Optional[str] = None,
    attached_files: Optional[list[dict]] = None,
    attached_folders: Optional[list[dict]] = None,
    kb_listings: Optional[dict[str, dict]] = None,
    external_user_id: Optional[str] = None,
    enabled_integrations: Optional[list[str]] = None,
    request_metadata: Optional[dict] = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Run the Nolia rules generation pipeline.

    Args:
        prompt: User prompt (usually auto-generated).
        user_sub: Cognito user sub.
        conversation_id: Base conversation ID.
        parent_config: The nolia-rules-generator AgentTypeConfig.
        request_metadata: Must contain:
            kb_id: UUID of the knowledge base
            kb_category: "global", "procurement", or "project"
            kb_name: Display name of the KB
        **kwargs: Standard pipeline kwargs.

    Returns:
        dict with status, text, artifacts, usage, steps.
    """
    pipeline_start = time.monotonic()
    metadata = request_metadata or {}
    kb_id = metadata.get("kb_id", "")
    kb_category = metadata.get("kb_category", "global")
    kb_name = metadata.get("kb_name", "Unknown KB")

    rules_filename = RULES_FILENAME_MAP.get(kb_category, "rules.md")

    logger.info(
        "Starting Nolia rules generation pipeline",
        _name="NOLIA_RULES_PIPELINE_START",
        phase="pipeline",
        kb_id=kb_id,
        kb_category=kb_category,
        kb_name=kb_name,
        rules_filename=rules_filename,
    )

    # ── Progress tracking ────────────────────────────────────────────────
    s3_prefix_fmt = parent_config.s3_prefix_template.format(
        user_sub=user_sub,
        conversation_id=conversation_id,
    )
    progress_events: list[dict] = []

    def emit(phase: str, message: str) -> None:
        _emit_progress(
            user_sub, conversation_id, s3_prefix_fmt, progress_events, phase, message
        )

    # ── Pre-pipeline: Download KB documents ──────────────────────────────
    emit("download", "Downloading knowledge base documents...")
    await _setup_rules_workspace(kb_id, kb_category)

    # ── Step-specific prompts ────────────────────────────────────────────
    user_context = (
        f"Generate compliance rules for the '{kb_name}' knowledge base "
        f"(category: {kb_category}). "
        f"Read all documents and extract a comprehensive, prioritised rules list."
    )

    extract_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 1 (Extract Rules). Read all documents in "
        "`/workdir/knowledge-bases/` and extract rules."
    )

    review_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 2 (Review Rules). Phase 1 has completed — "
        "the extracted rules are in `/workdir/tmp/extracted_rules.md`. "
        "Review them against the original documents, add citations, "
        "deduplicate, and write the final rules file.\n\n"
        f"Write the final file to: `/workdir/outputs/{rules_filename}`"
    )

    step_kwargs = dict(
        prompt=prompt,
        user_sub=user_sub,
        conversation_id=conversation_id,
        timezone=timezone,
        user_email=user_email,
        today_string=today_string,
        available_kbs=available_kbs,
        enabled_tools=enabled_tools,
        request_id=request_id or str(uuid.uuid4()),
        attached_files=attached_files,
        attached_folders=attached_folders,
        kb_listings=kb_listings,
        external_user_id=external_user_id,
        enabled_integrations=enabled_integrations,
    )

    all_steps: list[dict[str, Any]] = []
    all_artifacts: list[dict] = []
    total_usage: dict[str, Any] = {
        "num_turns": 0,
        "total_cost_usd": 0.0,
        "duration_ms": 0,
    }

    def _accumulate(result: dict[str, Any], step_name: str) -> dict[str, Any]:
        usage = result.get("usage", {})
        all_steps.append(
            {
                "step": step_name,
                "step_number": len(all_steps) + 1,
                "status": result.get("status", "completed"),
                "text": result.get("text", ""),
                "usage": usage,
            }
        )
        all_artifacts.extend(result.get("artifacts", []))
        total_usage["num_turns"] += usage.get("num_turns", 0)
        total_usage["total_cost_usd"] += usage.get("total_cost_usd", 0.0)
        total_usage["duration_ms"] += usage.get("duration_ms", 0)
        return result

    def _check_error(result: dict[str, Any], step_name: str) -> bool:
        if result.get("status") == "error":
            logger.error(
                "Rules pipeline step failed",
                _name="NOLIA_RULES_STEP_ERROR",
                phase="pipeline",
                step=step_name,
                error=result.get("error", "unknown"),
            )
            return True
        return False

    # ── Phase 1: Extract Rules ───────────────────────────────────────────
    # Select the correct extract phase type based on KB category
    extract_type = f"nolia-rules-extract-{kb_category}"
    emit("extract", "Reading and analyzing all documents...")

    logger.info(
        "Phase 1: Extract starting",
        _name="NOLIA_RULES_PHASE_START",
        phase="pipeline",
        step="extract",
        extract_type=extract_type,
    )

    extract_result = _accumulate(
        await _run_step(
            extract_type,
            "extract",
            is_first_step=True,
            **{**step_kwargs, "prompt": extract_prompt},
        ),
        extract_type,
    )
    if _check_error(extract_result, extract_type):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 1 (Extract) failed"
        )

    # ── Phase 2: Review and Refine ───────────────────────────────────────
    emit("review", "Reviewing and refining rules with citations...")

    logger.info(
        "Phase 2: Review starting",
        _name="NOLIA_RULES_PHASE_START",
        phase="pipeline",
        step="review",
    )

    review_result = _accumulate(
        await _run_step(
            "nolia-rules-review",
            "review",
            **{**step_kwargs, "prompt": review_prompt},
        ),
        "nolia-rules-review",
    )
    if _check_error(review_result, "nolia-rules-review"):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 2 (Review) failed"
        )

    # ── Fallback: If Phase 2 didn't write the output, copy from Phase 1 ──
    rules_local_path = OUTPUTS_DIR / rules_filename
    extracted_path = TMP_DIR / "extracted_rules.md"

    if not rules_local_path.exists() and extracted_path.exists():
        logger.warning(
            "Phase 2 did not write final rules file — falling back to Phase 1 output",
            _name="NOLIA_RULES_FALLBACK_COPY",
            phase="pipeline",
            source=str(extracted_path),
            dest=str(rules_local_path),
        )
        shutil.copy2(str(extracted_path), str(rules_local_path))

    # ── Post-pipeline: Upload rules.md to KB's S3 prefix ────────────────
    emit("upload", "Uploading rules file to knowledge base...")

    if rules_local_path.exists() and DATA_BUCKET and kb_id:
        rules_s3_key = f"documents/kb-{kb_id}/{rules_filename}"
        try:
            s3 = boto3.client("s3", region_name=AWS_REGION)
            s3.upload_file(
                str(rules_local_path),
                DATA_BUCKET,
                rules_s3_key,
                ExtraArgs={"ContentType": "text/markdown"},
            )
            all_artifacts.append({"type": "file", "path": f"outputs/{rules_filename}"})
            logger.info(
                "Uploaded rules file to KB",
                _name="NOLIA_RULES_UPLOADED",
                phase="pipeline",
                s3_key=rules_s3_key,
            )
        except Exception as e:
            logger.error(
                "Failed to upload rules file",
                _name="NOLIA_RULES_UPLOAD_ERROR",
                phase="pipeline",
                error=str(e),
            )
    else:
        logger.warning(
            "Rules file not found or missing config — skipping upload",
            _name="NOLIA_RULES_NO_UPLOAD",
            phase="pipeline",
            rules_path=str(rules_local_path),
            exists=rules_local_path.exists(),
            has_data_bucket=bool(DATA_BUCKET),
            has_kb_id=bool(kb_id),
        )

    # ── Done ─────────────────────────────────────────────────────────────
    emit("complete", "Rules generation complete")
    pipeline_duration = int((time.monotonic() - pipeline_start) * 1000)
    total_usage["duration_ms"] = pipeline_duration

    final_text = all_steps[-1].get("text", "") if all_steps else ""

    logger.info(
        "Nolia rules pipeline completed",
        _name="NOLIA_RULES_PIPELINE_COMPLETE",
        phase="pipeline",
        total_steps=len(all_steps),
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
        duration_ms=pipeline_duration,
    )

    return {
        "status": "completed",
        "text": final_text,
        "artifacts": all_artifacts,
        "usage": total_usage,
        "steps": all_steps,
    }


async def _setup_rules_workspace(kb_id: str, kb_category: str) -> None:
    """Download KB documents from S3 to the workspace for rules generation.

    Downloads all files from documents/kb-{kb_id}/ into
    /workdir/knowledge-bases/, preserving subfolder structure
    (e.g., pre-rfx/, rfx/, supporting/, templates/).
    """
    for d in [TMP_DIR, OUTPUTS_DIR, KB_DIR, UPLOADS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    if not DATA_BUCKET or not kb_id:
        logger.warning(
            "Missing DATA_BUCKET or kb_id — skipping KB download",
            _name="NOLIA_RULES_NO_DOWNLOAD",
            phase="pipeline",
        )
        return

    s3 = boto3.client("s3", region_name=AWS_REGION)

    # Download everything under documents/kb-{kb_id}/ directly into
    # /workdir/knowledge-bases/, preserving the subfolder structure
    # (e.g. documents/, templates/, pre-rfx/, rfx/, supporting/).
    kb_prefix = f"documents/kb-{kb_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    downloaded = 0

    for page in paginator.paginate(Bucket=DATA_BUCKET, Prefix=kb_prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            relative = key[len(kb_prefix) :]
            if not relative or relative.endswith("/"):
                continue

            # Skip rules files (we're generating new ones), metadata, and hidden files
            if relative.endswith("-rules.md") or relative == "rules.md":
                continue
            if relative.endswith(".metadata.json") or relative == ".metadata.json":
                continue

            local_path = KB_DIR / relative
            local_path.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(DATA_BUCKET, key, str(local_path))
            downloaded += 1

    logger.info(
        f"Downloaded {downloaded} KB files for rules generation",
        _name="NOLIA_RULES_KB_DOWNLOAD",
        phase="pipeline",
        kb_id=kb_id,
        kb_category=kb_category,
        files_downloaded=downloaded,
    )


async def _run_step(
    step_type_id: str,
    step_suffix: str,
    *,
    prompt: str,
    user_sub: str,
    conversation_id: str,
    is_first_step: bool = False,
    timezone: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    available_kbs: Optional[list[dict]] = None,
    enabled_tools: Optional[list[str]] = None,
    model_id: Optional[str] = None,
    request_id: Optional[str] = None,
    attached_files: Optional[list[dict]] = None,
    attached_folders: Optional[list[dict]] = None,
    kb_listings: Optional[dict[str, dict]] = None,
    external_user_id: Optional[str] = None,
    enabled_integrations: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Run a single pipeline step. Mirrors the Nolia orchestrator's _run_step."""
    from ...sdk_config import LOCAL_ROOT
    from ...sdk_runner import run_claude_sdk
    from ...workspace import setup_agent_tools
    from .. import ALWAYS_COPY, TOOL_FILE_MAP

    step_config = get_agent_type_config(step_type_id)
    step_conversation_id = f"{conversation_id}-step-{step_suffix}"
    step_request_id = request_id or str(uuid.uuid4())

    # Isolate Claude SDK session state per step
    step_system_dir = LOCAL_ROOT / ".system" / f"step-{step_suffix}"
    step_system_dir.mkdir(parents=True, exist_ok=True)

    step_kbs = available_kbs
    if step_config.restrict_kbs:
        step_kbs = step_config.default_kbs or []

    step_integrations = enabled_integrations
    if step_config.restrict_integrations:
        step_integrations = step_config.default_integrations or []

    step_external_user_id = external_user_id if step_integrations else None

    step_kb_listings = kb_listings
    if step_kbs != available_kbs:
        step_kb_listings = None

    setup_agent_tools(
        enabled_numa_tools=step_config.enabled_numa_tools,
        tools_source_dirs=step_config.tools_source_dirs,
        tool_file_map=TOOL_FILE_MAP,
        always_copy=ALWAYS_COPY,
    )

    logger.info(
        "Running rules pipeline step",
        _name="NOLIA_RULES_STEP_START",
        phase="pipeline",
        step_type=step_type_id,
        step_conversation_id=step_conversation_id,
    )

    try:
        result = await run_claude_sdk(
            conversation_id=step_conversation_id,
            prompt=prompt,
            user_sub=user_sub,
            timezone_str=timezone,
            user_email=user_email,
            today_string=today_string,
            available_kbs=step_kbs,
            enabled_tools=enabled_tools,
            is_cold_start=True,
            attached_files=attached_files if is_first_step else [],
            attached_folders=attached_folders if is_first_step else [],
            original_prompt=prompt,
            model_id=model_id,
            kb_listings=step_kb_listings,
            request_id=step_request_id,
            agent_config=None,
            external_user_id=step_external_user_id,
            enabled_integrations=step_integrations,
            agent_type_config=step_config,
            system_dir=step_system_dir,
        )
    except Exception as e:
        logger.error(
            "Rules pipeline step exception",
            _name="NOLIA_RULES_STEP_EXCEPTION",
            phase="pipeline",
            step_type=step_type_id,
            error=str(e),
            exc_info=True,
        )
        return {
            "status": "error",
            "text": "",
            "artifacts": [],
            "usage": {},
            "error": str(e),
        }
    finally:
        # Clean up step-specific system dir (session already archived to S3)
        shutil.rmtree(step_system_dir, ignore_errors=True)

    logger.info(
        "Rules pipeline step completed",
        _name="NOLIA_RULES_STEP_COMPLETE",
        phase="pipeline",
        step_type=step_type_id,
        status=result.get("status", "completed"),
        turns=result.get("usage", {}).get("num_turns", 0),
    )

    return result


def _build_error_result(
    steps: list[dict],
    artifacts: list[dict],
    usage: dict,
    error_msg: str,
) -> dict[str, Any]:
    return {
        "status": "error",
        "text": "",
        "artifacts": artifacts,
        "usage": usage,
        "error": error_msg,
        "steps": steps,
    }
