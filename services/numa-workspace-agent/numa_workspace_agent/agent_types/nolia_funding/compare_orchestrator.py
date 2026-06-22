"""Pipeline orchestrator for Nolia Funding application comparison.

Single-phase pipeline:
    Phase: Compare (nolia-funding-compare-step)

Pre-pipeline: ``setup_funding_compare_workspace()`` downloads each prior
run's outputs (`_result.json`, `_summary_and_reasoning.md`, full
`outputs/` folder) into ``/workdir/prior-assessments/run-{i}/``, plus the
Funding KB's output template for criteria-grouping context.

The compare phase produces THREE primary artefacts:
- ``Comparison_<stamp>.json`` — structured payload the frontend renders
- ``Comparison_<stamp>.md`` — human-readable Markdown for download/archive
- ``_summary_and_reasoning.md`` — comparator narrative (mirrors assess)

PDF/DOCX export is handled by the frontend at download time, so the
orchestrator no longer pre-converts. ``_summary_and_reasoning.md`` lives
at the workspace root (not under ``outputs/``) so the standard S3 sync
publishes it alongside the run-level ``_result.json``.
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
from .workspace_setup import OUTPUTS_DIR, setup_funding_compare_workspace

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


async def run_nolia_funding_compare_pipeline(
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
    """Run the Nolia Funding comparison pipeline.

    Args:
        prompt: User prompt (typically auto-generated).
        user_sub: Cognito user sub.
        conversation_id: Run ID for this comparison.
        parent_config: The nolia-funding-compare AgentTypeConfig.
        request_metadata: Required fields:
            funding_kb_id, run_ids_to_compare, client_name.

            ``run_ids_to_compare`` is a list of 2–3 entries. Each entry
            can be either:
              - a string ``"run-id"`` (legacy — compare assumes current
                user owns it; only works for same-user compares),
              - a dict ``{"run_id": "...", "user_sub": "..."}`` (preferred
                — supports cross-user compare under Fund-scoped
                visibility).

        **_kwargs: Standard pipeline kwargs forwarded to run_claude_sdk.

    Returns:
        dict with status, text, artifacts, usage, steps.
    """
    pipeline_start = time.monotonic()
    metadata = request_metadata or {}
    funding_kb_id = metadata.get("funding_kb_id", "")
    raw_run_entries_in = metadata.get("run_ids_to_compare", []) or []
    client_name = metadata.get("client_name", "")

    # Normalise.
    #
    # Accepts three wire formats:
    #   1. list[str]                          — back-compat; current caller owns all runs
    #   2. list[dict{run_id,user_sub}]        — cross-user compare (canonical)
    #   3. str (JSON of 1 or 2)               — V2 Apps UI passes string fields
    #
    # Strings with empty user_sub fall back to the current user's sub.
    import json as _json

    if isinstance(raw_run_entries_in, str):
        try:
            raw_run_entries = _json.loads(raw_run_entries_in)
        except Exception as e:
            logger.error(
                "run_ids_to_compare was a string but not valid JSON",
                _name="NOLIA_FUNDING_COMPARE_BAD_RUN_IDS_JSON",
                phase="pipeline",
                error=str(e),
                raw_preview=raw_run_entries_in[:200],
            )
            raw_run_entries = []
    else:
        raw_run_entries = raw_run_entries_in

    run_entries: list[dict] = []
    for entry in raw_run_entries or []:
        if isinstance(entry, str):
            run_entries.append({"run_id": entry, "user_sub": user_sub})
        elif isinstance(entry, dict) and entry.get("run_id"):
            run_entries.append(
                {
                    "run_id": entry["run_id"],
                    "user_sub": entry.get("user_sub") or user_sub,
                }
            )

    run_ids_for_log = [e["run_id"] for e in run_entries]

    logger.info(
        "Starting Nolia Funding compare pipeline",
        _name="NOLIA_FUNDING_COMPARE_PIPELINE_START",
        phase="pipeline",
        funding_kb_id=funding_kb_id,
        run_ids=run_ids_for_log,
        run_count=len(run_entries),
        cross_user_count=sum(1 for e in run_entries if e["user_sub"] != user_sub),
        client_name=client_name,
        conversation_id=conversation_id,
    )

    # Validate input early — comparison needs 2 or 3 runs.
    if len(run_entries) < 2 or len(run_entries) > 3:
        error_msg = (
            f"Comparison requires 2 or 3 run entries; received {len(run_entries)}."
        )
        logger.error(
            "Invalid compare request",
            _name="NOLIA_FUNDING_COMPARE_INVALID_INPUT",
            phase="pipeline",
            run_count=len(run_entries),
        )
        return {
            "status": "error",
            "text": "",
            "artifacts": [],
            "usage": {"num_turns": 0, "total_cost_usd": 0.0, "duration_ms": 0},
            "error": error_msg,
            "steps": [],
        }

    s3_prefix_fmt = parent_config.s3_prefix_template.format(
        user_sub=user_sub,
        conversation_id=conversation_id,
    )
    progress_events: list[dict] = []

    def emit(phase: str, message: str) -> None:
        _emit_progress(
            user_sub, conversation_id, s3_prefix_fmt, progress_events, phase, message
        )

    # ── Pre-pipeline: download prior assessments + template context ────────
    emit("download", f"Loading {len(run_entries)} assessments...")
    await setup_funding_compare_workspace(
        user_sub,
        conversation_id,
        funding_kb_id=funding_kb_id,
        run_entries=run_entries,
    )

    # ── Compare phase ──────────────────────────────────────────────────────
    user_context = (
        f"Compare {len(run_entries)} prior funding assessments side-by-side. "
        f"Funding KB: {funding_kb_id or 'unknown'}. Run IDs: "
        f"{', '.join(run_ids_for_log)}. The downloaded prior assessments "
        f"are in `/workdir/prior-assessments/`. Produce both JSON and MD "
        f"outputs."
    )

    compare_prompt = (
        f"{user_context}\n\n"
        "Read each `/workdir/prior-assessments/run-N/tmp/findings.md` "
        "and `_result.json`. Use the Funding KB's output template in "
        "`/workdir/knowledge-bases/templates/` for criteria-group context. "
        "Write the JSON comparison and the MD comparison as instructed."
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

    emit("compare", "Preparing side-by-side comparison...")
    compare_result = await _run_step(
        "nolia-funding-compare-step",
        "compare",
        is_first_step=True,
        **{**step_kwargs, "prompt": compare_prompt},
    )

    usage = compare_result.get("usage", {})
    all_steps.append(
        {
            "step": "nolia-funding-compare-step",
            "step_number": 1,
            "status": compare_result.get("status", "completed"),
            "text": compare_result.get("text", ""),
            "usage": usage,
        }
    )
    all_artifacts.extend(compare_result.get("artifacts", []))
    total_usage["num_turns"] += usage.get("num_turns", 0)
    total_usage["total_cost_usd"] += usage.get("total_cost_usd", 0.0)
    total_usage["duration_ms"] += usage.get("duration_ms", 0)

    if compare_result.get("status") == "error":
        logger.error(
            "Funding compare phase failed",
            _name="NOLIA_FUNDING_COMPARE_STEP_ERROR",
            phase="pipeline",
            error=compare_result.get("error", "unknown"),
        )
        return _build_error_result(
            all_steps,
            all_artifacts,
            total_usage,
            f"Compare phase failed: {compare_result.get('error', 'unknown')}",
        )

    # ── Post-pipeline: register output artefacts ───────────────────────────
    # PDF/DOCX export is handled by the frontend at download time — the
    # backend just registers the MD and JSON the agent produced. The
    # ``_summary_and_reasoning.md`` at the workspace root is published by
    # the standard S3 sync below; no need to register it explicitly.
    md_path = _find_comparison_md()
    json_path = _find_comparison_json()

    if md_path is not None:
        all_artifacts.append({"type": "file", "path": f"outputs/{md_path.name}"})
    else:
        logger.warning(
            "No Comparison_*.md found in /workdir/outputs/",
            _name="NOLIA_FUNDING_COMPARE_NO_MD",
            phase="pipeline",
        )

    if json_path is not None:
        # Validate JSON shape before registering. Frontend rendering depends
        # on the structure documented in prompts/compare.py — a malformed
        # JSON would silently break the UI. Log loudly but don't block.
        if _validate_comparison_json(json_path):
            all_artifacts.append({"type": "file", "path": f"outputs/{json_path.name}"})
        else:
            logger.warning(
                "Comparison JSON failed schema validation — frontend may fall back to MD",
                _name="NOLIA_FUNDING_COMPARE_JSON_INVALID",
                phase="pipeline",
                json_path=str(json_path),
            )
            # Still register so the file is preserved for inspection.
            all_artifacts.append({"type": "file", "path": f"outputs/{json_path.name}"})
    else:
        logger.warning(
            "No Comparison_*.json found in /workdir/outputs/ — frontend rendering will fall back to MD",
            _name="NOLIA_FUNDING_COMPARE_NO_JSON",
            phase="pipeline",
        )

    # ── Done ────────────────────────────────────────────────────────────────
    emit("complete", "Comparison complete")
    pipeline_duration = int((time.monotonic() - pipeline_start) * 1000)
    total_usage["duration_ms"] = pipeline_duration

    final_text = all_steps[-1].get("text", "") if all_steps else ""

    logger.info(
        "Nolia Funding compare pipeline completed",
        _name="NOLIA_FUNDING_COMPARE_PIPELINE_COMPLETE",
        phase="pipeline",
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
        duration_ms=pipeline_duration,
        artifact_count=len(all_artifacts),
    )

    result = {
        "status": "completed",
        "text": final_text,
        "artifacts": all_artifacts,
        "usage": total_usage,
        "steps": all_steps,
        "pipeline": {
            "name": "nolia-funding-compare",
            "version": "1.0",
            "funding_kb_id": funding_kb_id,
            "source_run_ids": run_ids_for_log,
            "source_run_entries": run_entries,
            "client_name": client_name,
        },
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
            "Funding compare orchestrator wrote result to S3",
            _name="NOLIA_FUNDING_COMPARE_RESULT_WRITTEN",
            phase="pipeline",
            conversation_id=conversation_id,
        )
    except Exception as e:
        logger.error(
            "Funding compare orchestrator failed to write result",
            _name="NOLIA_FUNDING_COMPARE_RESULT_WRITE_ERROR",
            phase="pipeline",
            error=str(e),
        )

    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _find_comparison_md():
    """Find the Phase output MD in /workdir/outputs/. Pick the most recent."""
    if not OUTPUTS_DIR.exists():
        return None
    candidates = sorted(
        OUTPUTS_DIR.glob("Comparison_*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def _find_comparison_json():
    """Find the Phase output JSON in /workdir/outputs/. Pick the most recent."""
    if not OUTPUTS_DIR.exists():
        return None
    candidates = sorted(
        OUTPUTS_DIR.glob("Comparison_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def _validate_comparison_json(json_path) -> bool:
    """Lightweight schema check on the comparison JSON.

    Confirms the top-level required keys are present and non-empty, the
    applicants list has 2–3 entries, and each criterion result uses an
    allowed status enum. Returns True if the file looks reasonable. Logs
    detailed reasons via ``NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL`` on
    failure so we can fix prompt drift quickly.

    This is a best-effort check, not a strict schema. We want to catch
    obvious breakage (missing fields, wrong enum) without blocking on
    cosmetic issues.
    """
    import json

    allowed_statuses = {
        "met",
        "not_met",
        "partial",
        "manual_review",
        "unclear",
        "not_applicable",
    }

    try:
        data = json.loads(json_path.read_text())
    except Exception as e:
        logger.warning(
            "Comparison JSON failed to parse",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="parse_error",
            error=str(e),
        )
        return False

    if not isinstance(data, dict):
        logger.warning(
            "Comparison JSON top-level is not an object",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="not_object",
        )
        return False

    applicants = data.get("applicants")
    if not isinstance(applicants, list) or not (2 <= len(applicants) <= 3):
        logger.warning(
            "Comparison JSON has unexpected applicants list",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="bad_applicants",
            applicants_type=type(applicants).__name__,
            length=len(applicants) if isinstance(applicants, list) else None,
        )
        return False

    groups = data.get("criteria_groups")
    if not isinstance(groups, list) or not groups:
        logger.warning(
            "Comparison JSON has no criteria_groups",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="no_criteria_groups",
        )
        return False

    bad_statuses: list[str] = []
    bad_scores: list[str] = []
    for group in groups:
        for criterion in group.get("criteria", []) or []:
            for result in criterion.get("results", []) or []:
                status = result.get("status")
                if status not in allowed_statuses:
                    bad_statuses.append(str(status))
                # Score is optional; when present it must have
                # numeric value + max keys.
                score = result.get("score")
                if score is not None:
                    if not isinstance(score, dict):
                        bad_scores.append(f"not_object:{type(score).__name__}")
                    elif "value" not in score or "max" not in score:
                        bad_scores.append(f"missing_keys:{sorted(score.keys())}")
                    elif not isinstance(
                        score.get("value"), (int, float)
                    ) or not isinstance(score.get("max"), (int, float)):
                        bad_scores.append(
                            f"non_numeric:{score.get('value')},{score.get('max')}"
                        )

    if bad_statuses:
        logger.warning(
            "Comparison JSON contains disallowed status values",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="bad_status",
            bad_statuses=bad_statuses[:10],  # cap log size
        )
        return False

    if bad_scores:
        logger.warning(
            "Comparison JSON contains malformed score fields",
            _name="NOLIA_FUNDING_COMPARE_JSON_VALIDATION_FAIL",
            reason="bad_score",
            bad_scores=bad_scores[:10],
        )
        # Don't fail the file for malformed scores — they're optional.
        # Caller still registers it; the frontend will ignore bad scores.

    return True


# ─── Step runner (mirrors assess/rules orchestrators) ────────────────────────


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

    logger.info(
        "Running funding compare pipeline step",
        _name="NOLIA_FUNDING_COMPARE_STEP_START",
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
            "Funding compare pipeline step exception",
            _name="NOLIA_FUNDING_COMPARE_STEP_EXCEPTION",
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
        "Funding compare pipeline step completed",
        _name="NOLIA_FUNDING_COMPARE_STEP_COMPLETE",
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
