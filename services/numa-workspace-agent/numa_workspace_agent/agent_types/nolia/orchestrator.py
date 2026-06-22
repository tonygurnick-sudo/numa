"""Custom pipeline orchestrator for the Nolia compliance review.

Unlike the generic sequential pipeline in ``pipeline.py``, this orchestrator:
1. Runs Phase 1 (EDA) first
2. Runs Phases 2 and 3 sequentially (global then domain)
3. Conditionally selects Phase 3 variant based on assessment_type
4. Runs Phase 4 (two passes: generate + review)
5. Conditionally runs Phase 5 only if output_language != "english"

Phases 2+3 were previously parallel (asyncio.gather) but this caused
intermittent silent OOM kills on AgentCore MicroVMs (2 vCPU / 8 GB RAM).
Each query() spawns a Node.js CLI subprocess, and each phase's agent spawns
up to 5 subagents — running two phases simultaneously exceeded the memory
ceiling, causing the Linux OOM killer to SIGKILL the process with no
logged error.

The orchestrator reuses ``run_claude_sdk()`` and the per-step patterns from
``pipeline.py`` but adds conditional branching.
"""

import asyncio
import platform
import resource
import shutil
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import structlog

from ..base import AgentTypeConfig
from ..registry import get_agent_type_config
from .workspace_setup import extract_uploaded_document, setup_nolia_workspace

logger = structlog.get_logger()


def _log_memory(label: str) -> None:
    """Log current process memory usage for resource tracking.

    Uses the stdlib ``resource`` module so we don't need psutil.
    On Linux (AgentCore) ru_maxrss is in KB; on macOS it's in bytes.
    """
    usage = resource.getrusage(resource.RUSAGE_SELF)
    max_rss_kb = usage.ru_maxrss
    if platform.system() == "Darwin":
        max_rss_kb = max_rss_kb // 1024  # bytes -> KB on macOS
    max_rss_mb = max_rss_kb / 1024
    logger.info(
        f"Memory usage at {label}",
        _name="NOLIA_MEMORY",
        phase="pipeline",
        label=label,
        max_rss_mb=round(max_rss_mb, 1),
        max_rss_kb=max_rss_kb,
    )


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


async def run_nolia_pipeline(
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
    """Run the Nolia compliance review pipeline.

    This is the ``pipeline_orchestrator`` callable set on the
    ``nolia-compliance`` AgentTypeConfig. It replaces the default
    sequential pipeline with custom orchestration.

    Args:
        prompt: User prompt (document description, instructions).
        user_sub: Cognito user sub.
        conversation_id: Base conversation ID (steps get suffixes).
        parent_config: The nolia-compliance AgentTypeConfig.
        request_metadata: Nolia-specific fields from the frontend:
            assessment_type, output_language, global_kb, procurement_kb,
            project_kb.
        **kwargs: Standard pipeline kwargs forwarded to run_claude_sdk.

    Returns:
        dict with status, text, artifacts, usage, steps.
    """
    pipeline_start = time.monotonic()
    metadata = request_metadata or {}
    assessment_type = metadata.get("assessment_type", "evaluation-report")
    output_language = metadata.get("output_language", "english")

    global_kb = metadata.get("global_kb", "")
    procurement_kb = metadata.get("procurement_kb", "")
    project_kb = metadata.get("project_kb", "")

    _log_memory("pipeline_start")
    logger.info(
        "Starting Nolia pipeline",
        _name="NOLIA_PIPELINE_START",
        phase="pipeline",
        assessment_type=assessment_type,
        output_language=output_language,
        conversation_id=conversation_id,
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

    emit("extraction", "Extracting document content...")

    # ── Pre-pipeline: Workspace setup + document extraction ───────────────
    # Download KBs, resolve template, extract PDF if needed
    await setup_nolia_workspace(
        user_sub,
        conversation_id,
        assessment_type=assessment_type,
        global_kb=global_kb,
        procurement_kb=procurement_kb,
        project_kb=project_kb,
    )

    # Extract PDF via parallel vision extraction (if uploaded file is a PDF)
    await extract_uploaded_document(s3_prefix_fmt)

    # ── Step-specific prompts ────────────────────────────────────────────
    # Each step's system prompt already defines its role, workspace, and
    # outputs. We just need to contextualise the user's message so steps
    # don't treat "run the full pipeline" as an instruction to re-do
    # everything, and tell each step what prior phases have produced.
    user_context = (
        "The user submitted a document for compliance review with this context:\n"
        f"> {prompt}\n\n"
        "Follow your system prompt instructions. Do NOT re-run or duplicate "
        "work from other phases."
    )

    eda_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 1 (EDA). No prior phases have run. "
        "Read the uploaded document in `/workdir/uploads/` and produce your outputs."
    )

    global_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 2 (Global Rules). "
        "Phase 1 (EDA) has already completed — its outputs are in `/workdir/tmp/` "
        "(document_manifest.json, document_summary.md, page_index.csv). "
        "Read those first, then check the document against global rules.\n\n"
        "IMPORTANT: Launch ALL subagents in a SINGLE response for parallel "
        "execution. Sequential launches will cause the pipeline to time out."
    )

    domain_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 3 (Domain Rules). "
        "Phases 1 (EDA) and 2 (Global Rules) have already completed — their outputs are in `/workdir/tmp/`. "
        "Check the document against your domain-specific rules.\n\n"
        "IMPORTANT: Launch ALL subagents in a SINGLE response for parallel "
        "execution. Sequential launches will cause the pipeline to time out."
    )

    report_gen_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 4a (Report Generation). "
        "Phases 1, 2, and 3 have ALL completed. Their outputs are in `/workdir/tmp/`. "
        "Read them all before writing the report to `/workdir/outputs/`."
    )

    report_review_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 4b (Report Review). "
        "ALL prior phases including report generation (4a) have completed. "
        "The report already exists in `/workdir/outputs/` — find it and edit it in-place. "
        "The Phase 2/3 CSV files in `/workdir/tmp/` are available for cross-referencing. "
        "Do NOT regenerate any files or create a new report. "
        "Your ONLY job is to review and improve the existing report. "
        "Do NOT write any files to `/workdir/outputs/` other than editing the existing report. "
        "Reference files (CSVs, summaries) must stay in `/workdir/tmp/`."
    )

    fidelity_audit_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 4c (Fidelity Audit). "
        "The report has been generated (4a) and reviewed (4b). "
        "The report exists in `/workdir/outputs/` — edit it in-place. "
        "The Phase 2/3 CSV files in `/workdir/tmp/` are the source of truth. "
        "Your job is to verify every finding in the CSVs made it into the report "
        "without being softened or dropped, and that procurement/project rules "
        "took priority over global rules wherever they overlap. "
        "Do NOT create new files — edit the existing report only."
    )

    translate_prompt = (
        f"{user_context}\n\n"
        "You are running Phase 5 (Translation). "
        "The final reviewed report exists in `/workdir/outputs/`. "
        f"Translate it in-place to **{output_language}**."
    )

    # Shared kwargs for _run_step (prompt is overridden per step)
    # NOTE: model_id intentionally omitted — each step's AgentTypeConfig.default_model
    # controls its own model. Passing the pipeline-level model_id would override it
    # because sdk_config precedence is: request model > type config default > global default.
    step_kwargs = dict(
        prompt=prompt,  # default, overridden below
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
        """Record step result and accumulate usage metrics."""
        step_status = result.get("status", "completed")
        usage = result.get("usage", {})
        all_steps.append(
            {
                "step": step_name,
                "step_number": len(all_steps) + 1,
                "status": step_status,
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
        """Return True if the step errored (pipeline should stop)."""
        if result.get("status") == "error":
            logger.error(
                "Nolia pipeline step failed",
                _name="NOLIA_STEP_ERROR",
                phase="pipeline",
                step=step_name,
                error=result.get("error", "unknown"),
            )
            return True
        return False

    # ── Phase 1: EDA ──────────────────────────────────────────────────────
    emit("eda", "Analysing document structure...")
    logger.info(
        "Phase 1: EDA starting", _name="NOLIA_PHASE_START", phase="pipeline", step="eda"
    )
    eda_result = _accumulate(
        await _run_step(
            "nolia-eda",
            "eda",
            is_first_step=True,
            **{**step_kwargs, "prompt": eda_prompt},
        ),
        "nolia-eda",
    )
    if _check_error(eda_result, "nolia-eda"):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 1 (EDA) failed"
        )
    _log_memory("after_eda")

    # ── Phases 2 + 3: Parallel ──────────────────────────────────────────
    # EXPERIMENT: Running in parallel via asyncio.gather() to save ~10-15
    # min. Previously sequential due to OOM on AgentCore MicroVMs (2 vCPU
    # / 8 GB). With rules-only mode (no KB folders in context), memory
    # footprint is lower. Revert to sequential if OOM resurfaces.
    phase3_type = (
        "nolia-procurement"
        if assessment_type == "evaluation-report"
        else "nolia-project"
    )
    logger.info(
        "Phases 2+3 starting in parallel (global + domain)",
        _name="NOLIA_PARALLEL_START",
        phase="pipeline",
        phase3_type=phase3_type,
    )

    emit("global", "Checking global knowledge base compliance...")
    emit("domain", "Checking domain-specific compliance...")
    _log_memory("before_global_domain")

    global_result, domain_result = await asyncio.gather(
        _run_step("nolia-global", "global", **{**step_kwargs, "prompt": global_prompt}),
        _run_step(phase3_type, "domain", **{**step_kwargs, "prompt": domain_prompt}),
    )

    _accumulate(global_result, "nolia-global")
    _accumulate(domain_result, phase3_type)
    _log_memory("after_global_domain")

    if _check_error(global_result, "nolia-global"):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 2 (Global Rules) failed"
        )
    if _check_error(domain_result, phase3_type):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, f"Phase 3 ({phase3_type}) failed"
        )

    # Save phase notes for the report agent to read
    _save_phase_notes(global_result, "global-phase-notes.md")
    domain_notes_name = (
        "procurement-phase-notes.md"
        if assessment_type == "evaluation-report"
        else "project-phase-notes.md"
    )
    _save_phase_notes(domain_result, domain_notes_name)

    # ── Phase 4: Report (generate then review) ────────────────────────────
    # Select the correct report agent type based on assessment_type
    report_gen_type = "nolia-report-generate"
    report_review_type = "nolia-report-review"

    emit("report", "Generating compliance report...")
    logger.info(
        "Phase 4a: Report generation starting",
        _name="NOLIA_PHASE_START",
        phase="pipeline",
        step="report-gen",
    )
    gen_result = _accumulate(
        await _run_step(
            report_gen_type,
            "report-gen",
            **{**step_kwargs, "prompt": report_gen_prompt},
        ),
        report_gen_type,
    )
    if _check_error(gen_result, report_gen_type):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 4a (Report Generate) failed"
        )

    emit("review", "Reviewing and refining report...")
    logger.info(
        "Phase 4b: Report review starting",
        _name="NOLIA_PHASE_START",
        phase="pipeline",
        step="report-review",
    )
    review_result = _accumulate(
        await _run_step(
            report_review_type,
            "report-review",
            **{**step_kwargs, "prompt": report_review_prompt},
        ),
        report_review_type,
    )
    if _check_error(review_result, report_review_type):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 4b (Report Review) failed"
        )

    # Phase 4c: Fidelity Audit
    emit("fidelity-audit", "Auditing report fidelity against phase findings...")
    logger.info(
        "Phase 4c: Fidelity Audit starting",
        _name="NOLIA_PHASE_START",
        phase="pipeline",
        step="fidelity-audit",
    )
    fidelity_result = _accumulate(
        await _run_step(
            "nolia-report-fidelity-audit",
            "fidelity-audit",
            **{**step_kwargs, "prompt": fidelity_audit_prompt},
        ),
        "nolia-report-fidelity-audit",
    )
    if _check_error(fidelity_result, "nolia-report-fidelity-audit"):
        return _build_error_result(
            all_steps, all_artifacts, total_usage, "Phase 4c (Fidelity Audit) failed"
        )
    _log_memory("after_report")

    # ── Phase 5: Translation (conditional) ────────────────────────────────
    if output_language != "english":
        emit("translate", "Translating report...")
        logger.info(
            "Phase 5: Translation starting",
            _name="NOLIA_PHASE_START",
            phase="pipeline",
            step="translate",
            target_language=output_language,
        )
        translate_result = _accumulate(
            await _run_step(
                "nolia-translate",
                "translate",
                **{**step_kwargs, "prompt": translate_prompt},
            ),
            "nolia-translate",
        )
        if _check_error(translate_result, "nolia-translate"):
            return _build_error_result(
                all_steps, all_artifacts, total_usage, "Phase 5 (Translation) failed"
            )

        # Sync immediately after translation — the container can be killed
        # at any point after the last SDK subprocess exits. Getting the
        # translated report into S3 here prevents a repeat of the race
        # condition where the pipeline completes but the final sync never
        # runs (see c5535e8a-4fcb-485b-9a71-ee8b5973e972).
        from ...s3_workspace import sync_to_s3

        try:
            sync_to_s3(user_sub, conversation_id, s3_prefix=s3_prefix_fmt)
            logger.info(
                "Post-translation S3 sync complete",
                _name="NOLIA_TRANSLATE_SYNC",
                phase="pipeline",
            )
        except Exception as e:
            logger.warning(
                "Post-translation S3 sync failed",
                _name="NOLIA_TRANSLATE_SYNC_ERROR",
                phase="pipeline",
                error=str(e),
            )

    # ── Done ──────────────────────────────────────────────────────────────
    emit("complete", "Review complete")
    pipeline_duration = int((time.monotonic() - pipeline_start) * 1000)
    total_usage["duration_ms"] = pipeline_duration

    # The final text is the last step's text (report review or translation)
    final_text = all_steps[-1].get("text", "") if all_steps else ""

    _log_memory("pipeline_complete")
    logger.info(
        "Nolia pipeline completed",
        _name="NOLIA_PIPELINE_COMPLETE",
        phase="pipeline",
        total_steps=len(all_steps),
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
        duration_ms=pipeline_duration,
    )

    result = {
        "status": "completed",
        "text": final_text,
        "artifacts": all_artifacts,
        "usage": total_usage,
        "steps": all_steps,
    }

    # ── Safety net: sync workspace and write result BEFORE returning ──────
    # In fire-and-forget mode the container may be terminated shortly after
    # the pipeline completes (AgentCore idle timeout treats the session as
    # idle once the 202 is returned, and SIGKILLs the MicroVM as soon as
    # the last SDK subprocess exits). Performing the critical S3 writes
    # here — inside the pipeline — ensures they complete even if
    # _background_run()'s post-pipeline code is interrupted.
    from ...s3_workspace import sync_to_s3, write_result_to_s3

    try:
        sync_to_s3(user_sub, conversation_id, s3_prefix=s3_prefix_fmt)
        write_result_to_s3(
            user_sub,
            conversation_id,
            result,
            s3_prefix=parent_config.s3_prefix_template,
        )
        logger.info(
            "Orchestrator wrote result to S3",
            _name="NOLIA_RESULT_WRITTEN",
            phase="pipeline",
            conversation_id=conversation_id,
        )
    except Exception as e:
        logger.error(
            "Orchestrator failed to write result to S3",
            _name="NOLIA_RESULT_WRITE_ERROR",
            phase="pipeline",
            error=str(e),
        )

    return result


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
    """Run a single pipeline step. Mirrors pipeline.py's per-step logic."""
    # Lazy imports to avoid circular import at module load time
    # (orchestrator → sdk_runner → s3_workspace → sdk_config → agent_types)
    from ...sdk_config import LOCAL_ROOT
    from ...sdk_runner import run_claude_sdk

    step_config = get_agent_type_config(step_type_id)
    step_conversation_id = f"{conversation_id}-step-{step_suffix}"
    step_request_id = request_id or str(uuid.uuid4())

    # Isolate Claude SDK session state per step to prevent cross-contamination.
    # Each step gets its own .claude/ directory and trace file.
    step_system_dir = LOCAL_ROOT / ".system" / f"step-{step_suffix}"
    step_system_dir.mkdir(parents=True, exist_ok=True)

    # Apply step-level KB restrictions
    step_kbs = available_kbs
    if step_config.restrict_kbs:
        step_kbs = step_config.default_kbs or []
    elif step_config.default_kbs and not step_kbs:
        step_kbs = step_config.default_kbs

    step_integrations = enabled_integrations
    if step_config.restrict_integrations:
        step_integrations = step_config.default_integrations or []
    elif step_config.default_integrations and not step_integrations:
        step_integrations = step_config.default_integrations

    step_external_user_id = external_user_id if step_integrations else None

    step_kb_listings = kb_listings
    if step_kbs != available_kbs:
        step_kb_listings = None

    # TODO: Remove after testing — log full prompts for debugging
    logger.info(
        "Nolia step prompts",
        _name="NOLIA_STEP_PROMPTS",
        phase="pipeline",
        step_type=step_type_id,
        user_prompt=prompt,
        user_prompt_length=len(prompt),
    )

    logger.info(
        "Running Nolia pipeline step",
        _name="NOLIA_STEP_START",
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
            "Nolia pipeline step exception",
            _name="NOLIA_STEP_EXCEPTION",
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
        "Nolia pipeline step completed",
        _name="NOLIA_STEP_COMPLETE",
        phase="pipeline",
        step_type=step_type_id,
        status=result.get("status", "completed"),
        turns=result.get("usage", {}).get("num_turns", 0),
    )

    return result


def _save_phase_notes(result: dict[str, Any], filename: str) -> None:
    """Save a phase's final text response as notes for the report agent."""
    from pathlib import Path

    text = result.get("text", "")
    if not text:
        return
    try:
        from ...atomic_io import atomic_write_text

        notes_path = Path("/workdir/tmp") / filename
        atomic_write_text(text, notes_path, encoding="utf-8")
        logger.info(
            "Saved phase notes",
            _name="NOLIA_PHASE_NOTES",
            phase="pipeline",
            filename=filename,
        )
    except Exception as e:
        logger.warning(
            "Failed to save phase notes",
            _name="NOLIA_PHASE_NOTES_ERROR",
            phase="pipeline",
            filename=filename,
            error=str(e),
        )


def _build_error_result(
    steps: list[dict],
    artifacts: list[dict],
    usage: dict,
    error_msg: str,
) -> dict[str, Any]:
    """Build a pipeline error result."""
    return {
        "status": "error",
        "text": "",
        "artifacts": artifacts,
        "usage": usage,
        "error": error_msg,
        "steps": steps,
    }
