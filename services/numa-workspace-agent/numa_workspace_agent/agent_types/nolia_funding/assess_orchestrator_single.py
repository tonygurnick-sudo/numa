"""Single-step pipeline orchestrator for Nolia Funding application assessment.

Experimental V2 alternate to the three-phase orchestrator in
``assess_orchestrator.py``. Same pre- and post-pipeline scaffolding (KB
download, upload extraction, MD→PDF/DOCX conversion, S3 sync, _result.json
write) — but a single Opus run replaces Extract → Evaluate → Render.

Toggled on by pointing ``nolia-funding-assess``'s
``pipeline_orchestrator`` at ``run_nolia_funding_assess_pipeline_single``.
The three-phase pipeline is unchanged and still importable.

Differences from ``run_nolia_funding_assess_pipeline``:

- One Claude step (``nolia-funding-assess-single``) instead of three.
- The agent writes ``_applicant.json`` directly to ``/workdir/outputs/`` so
  the file is published to S3 by the standard sync at the end. The mid-run
  preview write is dropped — there is no Phase 1 boundary to fire it from
  in a single-step pipeline.
- Result-summary helpers read ``/workdir/outputs/_applicant.json`` instead
  of ``/workdir/tmp/applicant.json``.
"""

import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import structlog

from ..base import AgentTypeConfig
from ..registry import get_agent_type_config
from .workspace_setup import (
    OUTPUTS_DIR,
    extract_funding_application,
    setup_funding_assess_workspace,
)

logger = structlog.get_logger()

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


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


async def run_nolia_funding_assess_pipeline_single(
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
    """Run the single-step Nolia Funding assessment pipeline end-to-end."""
    pipeline_start = time.monotonic()
    metadata = request_metadata or {}
    global_kb_id = metadata.get("global_kb_id", "")
    funding_kb_id = metadata.get("funding_kb_id", "")
    applicant_id = metadata.get("applicant_id", "")
    client_name = metadata.get("client_name", "")

    logger.info(
        "Starting Nolia Funding assess pipeline (single-step)",
        _name="NOLIA_FUNDING_ASSESS_SINGLE_PIPELINE_START",
        phase="pipeline",
        global_kb_id=global_kb_id,
        funding_kb_id=funding_kb_id,
        applicant_id=applicant_id,
        client_name=client_name,
        conversation_id=conversation_id,
    )

    s3_prefix_fmt = parent_config.s3_prefix_template.format(
        user_sub=user_sub,
        conversation_id=conversation_id,
    )
    progress_events: list[dict] = []

    def emit(phase: str, message: str) -> None:
        _emit_progress(
            user_sub, conversation_id, s3_prefix_fmt, progress_events, phase, message
        )

    # ── Pre-pipeline: KB download + applicant doc extraction ───────────────
    emit("download", "Loading selection criteria and supporting data...")
    await setup_funding_assess_workspace(
        user_sub,
        conversation_id,
        global_kb_id=global_kb_id,
        funding_kb_id=funding_kb_id,
    )

    emit("extract-uploads", "Pre-extracting applicant PDFs and DOCX files...")
    extracted = await extract_funding_application(s3_prefix_fmt)
    logger.info(
        "Applicant extraction complete",
        _name="NOLIA_FUNDING_ASSESS_SINGLE_EXTRACTION_DONE",
        phase="pipeline",
        extracted_count=len(extracted),
    )

    # ── User prompt for the single step ────────────────────────────────────
    if applicant_id:
        applicant_id_instruction = (
            f"The assessor has supplied this Application Number: `{applicant_id}`. "
            "This is the canonical application reference set by the assessor in the "
            "frontend. Use it verbatim in BOTH places:\n"
            f"  1. As the top-level `applicant_id` field in `/workdir/outputs/_applicant.json` (value: `{applicant_id}`).\n"
            "  2. As the value for any Application Number / Applicant ID / Reference / "
            "Application Reference / `[APP-XXXXXX]` placeholder in the rendered "
            f"assessment template (substitute the literal text `{applicant_id}`).\n"
            "Do NOT write 'Not available' or 'Not provided' for the Application Number — "
            "you have it. Still extract the applicant's full name from the documents "
            "for `applicant.name`."
        )
    else:
        applicant_id_instruction = (
            "The assessor did not supply an Application Number. Extract the "
            "applicant's full name from the documents and use that for both "
            "`applicant.name` and the top-level `applicant_id` field in "
            "`/workdir/outputs/_applicant.json`. For Application Number / "
            "Reference fields in the rendered template, write `Not available`."
        )

    single_prompt = (
        "Assess this funding application end-to-end. All inputs are in the "
        "workspace already (see the system prompt for paths). PDF and DOCX "
        "uploads in `/workdir/uploads/` have been pre-extracted to "
        "`extracted_{stem}.json` sidecars — read those instead of the raw "
        "binaries. Any other file types (xlsx, csv, txt, images, etc.) are "
        "left as-is for you to read directly with the appropriate tool.\n\n"
        f"{applicant_id_instruction}\n\n"
        "Run Step 1 (write `/workdir/outputs/_applicant.json`), Step 2 "
        "(assess against the rules), Step 2.5 (render the assessment to "
        "`/workdir/outputs/Assessment_<name>.md` and, if the template was "
        "DOCX, also `/workdir/outputs/Assessment_<name>.docx`), and Step 3 "
        "(extend `_applicant.json` with the `decision` block). Then stop."
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
                "Funding assess pipeline step failed",
                _name="NOLIA_FUNDING_ASSESS_SINGLE_STEP_ERROR",
                phase="pipeline",
                step=step_name,
                error=result.get("error", "unknown"),
            )
            return True
        return False

    # ── The single step ────────────────────────────────────────────────────
    emit("assess", "Assessing application against criteria...")
    single_result = _accumulate(
        await _run_step(
            "nolia-funding-assess-single",
            "single",
            is_first_step=True,
            **{**step_kwargs, "prompt": single_prompt},
        ),
        "nolia-funding-assess-single",
    )
    if _check_error(single_result, "nolia-funding-assess-single"):
        return _build_error_result(
            all_steps,
            all_artifacts,
            total_usage,
            "Single-step assessment failed",
            applicant_id=applicant_id,
        )

    # ── Post-pipeline: register artifacts (no MD→PDF/DOCX conversion here) ──
    # The frontend converts MD→PDF/DOCX at export time, so we skip the
    # backend conversion to save a couple of Lambda invocations per run.
    # If the agent produced a DOCX (template was DOCX), it's already in
    # /workdir/outputs/ and will be registered below.
    rendered_md = _find_rendered_assessment()
    if rendered_md is not None:
        all_artifacts.append({"type": "file", "path": f"outputs/{rendered_md.name}"})
        # Pick up an agent-produced DOCX sibling if it exists
        rendered_docx = rendered_md.with_suffix(".docx")
        if rendered_docx.exists():
            all_artifacts.append(
                {"type": "file", "path": f"outputs/{rendered_docx.name}"}
            )
    else:
        logger.warning(
            "No rendered MD found in /workdir/outputs/",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_NO_MD",
            phase="pipeline",
        )

    # ── Pull applicant + decision + score summary out of /workdir/outputs/ ─
    (
        applicant_info,
        inputs_unreliable_flag,
        unreliable_reason,
        decision_info,
        score_info,
    ) = _read_applicant_summary_from_outputs()

    # ── Done ───────────────────────────────────────────────────────────────
    emit("complete", "Assessment complete")
    pipeline_duration = int((time.monotonic() - pipeline_start) * 1000)
    total_usage["duration_ms"] = pipeline_duration

    final_text = all_steps[-1].get("text", "") if all_steps else ""

    logger.info(
        "Nolia Funding assess pipeline (single-step) completed",
        _name="NOLIA_FUNDING_ASSESS_SINGLE_PIPELINE_COMPLETE",
        phase="pipeline",
        total_steps=len(all_steps),
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
        duration_ms=pipeline_duration,
        inputs_unreliable=inputs_unreliable_flag,
    )

    result = {
        "status": "completed",
        "text": final_text,
        "artifacts": all_artifacts,
        "usage": total_usage,
        "steps": all_steps,
        "pipeline": {
            "name": "nolia-funding-assess-single",
            "version": "1.0",
            "applicant_id": applicant_id,
            "global_kb_id": global_kb_id,
            "funding_kb_id": funding_kb_id,
            "client_name": client_name,
        },
        "applicant": applicant_info,
        "decision": decision_info,
        "score": score_info,
        "inputs_unreliable": inputs_unreliable_flag,
        "unreliable_reason": unreliable_reason,
    }

    # Safety-net write of _result.json + S3 sync
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
            "Funding assess (single-step) wrote result to S3",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_RESULT_WRITTEN",
            phase="pipeline",
            conversation_id=conversation_id,
        )
    except Exception as e:
        logger.error(
            "Funding assess (single-step) failed to write result",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_RESULT_WRITE_ERROR",
            phase="pipeline",
            error=str(e),
        )

    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _find_rendered_assessment():
    """Find the rendered MD in /workdir/outputs/.

    The agent writes ``Assessment_<name>.md`` — we glob to find it without
    needing to know the applicant name. Pick the most recently modified
    if multiple match.
    """
    if not OUTPUTS_DIR.exists():
        return None
    candidates = sorted(
        OUTPUTS_DIR.glob("Assessment_*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def _read_applicant_summary_from_outputs() -> (
    tuple[Optional[dict], bool, Optional[str], Optional[dict], Optional[dict]]
):
    """Read /workdir/outputs/_applicant.json for the result-level blocks.

    Single-step variant of ``_read_applicant_summary`` — the single-step
    prompt writes ``_applicant.json`` directly to ``outputs/`` (so it's
    published to S3 by the standard sync), so we read from there.

    Returns
    ``(applicant_info, inputs_unreliable_flag, unreliable_reason, decision_info, score_info)``.
    All five default to ``None`` / ``False`` / ``None`` / ``None`` / ``None``
    if the file is missing or unparseable.
    """
    import json

    applicant_path = OUTPUTS_DIR / "_applicant.json"
    if not applicant_path.exists():
        return None, False, None, None, None
    try:
        data = json.loads(applicant_path.read_text())
    except Exception as e:
        logger.warning(
            "Failed to parse _applicant.json for result summary",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_APPLICANT_PARSE_FAIL",
            error=str(e),
        )
        return None, False, None, None, None

    applicant = data.get("applicant") or {}
    if not applicant.get("name"):
        logger.warning(
            "_applicant.json missing expected schema — `applicant.name` not found",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_APPLICANT_SCHEMA_MISMATCH",
            top_level_keys=sorted(data.keys()),
            applicant_keys=(
                sorted(applicant.keys()) if isinstance(applicant, dict) else []
            ),
        )
    summary = {
        "id": data.get("applicant_id"),
        "name": applicant.get("name"),
        "selected_fund": applicant.get("selected_fund"),
        "requested_amount": applicant.get("requested_amount"),
    }
    inputs_unreliable = bool(data.get("inputs_unreliable", False))
    raw_reason = data.get("unreliable_reason")
    unreliable_reason = (
        raw_reason if isinstance(raw_reason, str) and raw_reason.strip() else None
    )

    decision = data.get("decision")
    if decision is not None and not isinstance(decision, dict):
        logger.warning(
            "_applicant.json `decision` present but not a dict",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_DECISION_SCHEMA_MISMATCH",
            decision_type=type(decision).__name__,
        )
        decision = None
    elif isinstance(decision, dict) and not decision.get("status"):
        logger.warning(
            "_applicant.json `decision` missing `status`",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_DECISION_SCHEMA_MISMATCH",
            decision_keys=sorted(decision.keys()),
        )

    score = data.get("score")
    if score is not None:
        if not isinstance(score, dict) or "value" not in score or "max" not in score:
            logger.warning(
                "_applicant.json `score` present but malformed",
                _name="NOLIA_FUNDING_ASSESS_SINGLE_SCORE_SCHEMA_MISMATCH",
                score_type=type(score).__name__,
                score_keys=(sorted(score.keys()) if isinstance(score, dict) else []),
            )
            score = None

    return summary, inputs_unreliable, unreliable_reason, decision, score


# ─── Step runner (mirrors assess_orchestrator's _run_step) ───────────────────


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
    """Run a single pipeline step via the Claude Agent SDK."""
    from ...sdk_config import LOCAL_ROOT
    from ...sdk_runner import run_claude_sdk
    from ...workspace import setup_agent_tools
    from .. import ALWAYS_COPY, TOOL_FILE_MAP

    step_config = get_agent_type_config(step_type_id)
    step_conversation_id = f"{conversation_id}-step-{step_suffix}"
    step_request_id = request_id or str(uuid.uuid4())

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
        "Running funding assess (single-step) pipeline step",
        _name="NOLIA_FUNDING_ASSESS_SINGLE_STEP_START",
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
            "Funding assess (single-step) pipeline step exception",
            _name="NOLIA_FUNDING_ASSESS_SINGLE_STEP_EXCEPTION",
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
        shutil.rmtree(step_system_dir, ignore_errors=True)

    logger.info(
        "Funding assess (single-step) pipeline step completed",
        _name="NOLIA_FUNDING_ASSESS_SINGLE_STEP_COMPLETE",
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
    *,
    applicant_id: str = "",
) -> dict[str, Any]:
    return {
        "status": "error",
        "text": "",
        "artifacts": artifacts,
        "usage": usage,
        "error": error_msg,
        "steps": steps,
        "applicant": {"id": applicant_id, "name": None},
        "decision": None,
        "score": None,
        "inputs_unreliable": True,
        "unreliable_reason": "Pipeline error before assessment completed.",
    }
