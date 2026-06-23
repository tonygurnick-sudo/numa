"""
Pipeline runner for sequential agent type chaining.

Runs multiple agent "steps" in the same workspace container. Each step is a
separate ``run_claude_sdk()`` call with its own ``AgentTypeConfig`` — different
system prompt, tools, and limits. Steps share ``/workdir`` so files created by
step N are immediately available to step N+1.

The system prompts handle all coordination between steps. The runner does not
pass data between steps — it just runs them sequentially with the same original
user prompt. For example, step 1's prompt says "write your research to
/workdir/outputs/research.json" and step 2's prompt says "read
/workdir/outputs/research.json and create a quote".

Two result modes (configured via ``pipeline_result_mode`` on the parent type):
    - ``"last_step_text"``: Return the last step's text response (default).
    - ``"result_file"``: Read ``/workdir/outputs/result.json`` and return it.
"""

import inspect
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Optional

import structlog

from .agent_types import get_agent_type_config
from .agent_types.base import AgentTypeConfig
from .sdk_config import LOCAL_ROOT
from .sdk_runner import run_claude_sdk

logger = structlog.get_logger()

# Where the agent writes structured output when pipeline_result_mode = "result_file"
RESULT_FILE_PATH = Path("/workdir/outputs/result.json")


def validate_pipeline(
    pipeline_steps: list[str],
    parent_type_id: str,
) -> str | None:
    """Validate a pipeline definition before execution.

    Checks that all step type_ids exist, there are at least 2 steps, and
    there are no circular references (including transitive cycles like
    A -> B -> C -> A). Uses depth-first traversal with a visited set.

    Returns an error message string if invalid, or None if valid.
    """
    if len(pipeline_steps) < 2:
        return (
            f"Pipeline must have at least 2 steps, got {len(pipeline_steps)}. "
            "Use a single agent type instead."
        )

    for step_id in pipeline_steps:
        try:
            get_agent_type_config(step_id)
        except KeyError:
            return f"Unknown step type_id in pipeline: {step_id!r}"

    # Detect circular references with recursive DFS.
    # Start from the parent and walk through all reachable pipeline_steps.
    error = _check_circular_refs(parent_type_id, pipeline_steps, set())
    if error:
        return error

    return None


def _check_circular_refs(
    root_type_id: str,
    steps: list[str],
    visited: set[str],
) -> str | None:
    """Recursively check for circular pipeline references.

    Walks the pipeline_steps graph depth-first. If any step (or nested
    step) references the root or an already-visited type, it's circular.
    """
    for step_id in steps:
        if step_id == root_type_id:
            return (
                f"Circular pipeline reference: {step_id!r} references "
                f"root pipeline {root_type_id!r}"
            )
        if step_id in visited:
            # Already visited this node — cycle detected
            return f"Circular pipeline reference involving {step_id!r}"

        visited.add(step_id)

        try:
            step_config = get_agent_type_config(step_id)
        except KeyError:
            continue  # Already validated above

        if step_config.pipeline_steps:
            error = _check_circular_refs(
                root_type_id,
                step_config.pipeline_steps,
                visited,
            )
            if error:
                return error

    return None


async def run_pipeline(
    pipeline_steps: list[str],
    prompt: str,
    user_sub: str,
    conversation_id: str,
    parent_type_config: AgentTypeConfig,
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
    approval_mode: str = "always",
    numa_tool_approval_mode: Optional[dict[str, str]] = None,
    integration_approval_modes: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Run a sequence of agent type steps in the same workspace.

    Each step is a separate ``run_claude_sdk()`` call with that step's
    ``AgentTypeConfig``. Steps share ``/workdir`` — files created by step N
    are immediately available to step N+1. Every step receives the original
    user prompt; the system prompts handle coordination.

    Args:
        pipeline_steps: Ordered list of type_ids to run.
        prompt: The original user prompt (passed to every step).
        user_sub: Cognito user sub.
        conversation_id: Base conversation ID (steps get ``-step-N`` suffix).
        parent_type_config: The pipeline's own AgentTypeConfig.
        timezone: User timezone string.
        user_email: User email address.
        today_string: Today's date string.
        available_kbs: Knowledge bases available to steps.
        enabled_tools: Enabled Numa CLI tools.
        model_id: Model override (steps can also set their own via default_model).
        request_id: Request ID for tracing.
        attached_files: Files attached to the request.
        attached_folders: Folders attached to the request.
        kb_listings: Pre-fetched KB listing data.
        external_user_id: External user ID for integrations.
        enabled_integrations: Enabled integration IDs.
        approval_mode: Resolved integrations-category approval mode.
        numa_tool_approval_mode: Resolved per-category numa tool approval modes.
        integration_approval_modes: Resolved per-slug integration overrides.

    Returns:
        dict with status, text, artifacts, usage, and steps.
    """
    total_steps = len(pipeline_steps)

    # Validate before running anything
    error = validate_pipeline(pipeline_steps, parent_type_config.type_id)
    if error:
        logger.error(
            "Pipeline validation failed",
            _name="PIPELINE_VALIDATION_ERROR",
            phase="pipeline",
            error=error,
            pipeline_steps=pipeline_steps,
        )
        return {
            "status": "error",
            "text": "",
            "artifacts": [],
            "usage": {},
            "error": error,
            "steps": [],
        }

    # Optional workspace setup before the first step.
    # Support both sync and async callables.
    if parent_type_config.workspace_setup:
        try:
            result = parent_type_config.workspace_setup(user_sub, conversation_id)
            if inspect.iscoroutine(result):
                await result
            logger.info(
                "Workspace setup completed",
                _name="PIPELINE_WORKSPACE_SETUP",
                phase="pipeline",
                type_id=parent_type_config.type_id,
            )
        except Exception as e:
            logger.error(
                "Workspace setup failed",
                _name="PIPELINE_WORKSPACE_SETUP_ERROR",
                phase="pipeline",
                error=str(e),
                exc_info=True,
            )
            return {
                "status": "error",
                "text": "",
                "artifacts": [],
                "usage": {},
                "error": f"Workspace setup failed: {e}",
                "steps": [],
            }

    logger.info(
        "Starting pipeline",
        _name="PIPELINE_START",
        phase="pipeline",
        parent_type=parent_type_config.type_id,
        steps=pipeline_steps,
        total_steps=total_steps,
    )

    step_results: list[dict[str, Any]] = []
    all_artifacts: list[dict] = []
    total_usage: dict[str, Any] = {
        "num_turns": 0,
        "total_cost_usd": 0.0,
        "duration_ms": 0,
    }

    for i, step_type_id in enumerate(pipeline_steps):
        step_config = get_agent_type_config(step_type_id)
        step_conversation_id = f"{conversation_id}-step-{i}"
        step_request_id = request_id or str(uuid.uuid4())

        # Isolate Claude SDK session state per step
        step_system_dir = LOCAL_ROOT / ".system" / f"step-{i}"
        step_system_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "Running pipeline step",
            _name="PIPELINE_STEP_START",
            phase="pipeline",
            step=i + 1,
            total_steps=total_steps,
            step_type=step_type_id,
            step_conversation_id=step_conversation_id,
        )

        # Each step uses its own agent type config for prompt, tools, limits.
        # KB and integration restrictions from the step config override request
        # values — this is handled inside run_claude_sdk via create_agent_options.
        #
        # Apply step-level KB restrictions here (same logic as _handle_sync)
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

        # Re-fetch KB listings if the step has different KBs
        step_kb_listings = kb_listings
        if step_kbs != available_kbs:
            step_kb_listings = None  # Will be fetched inside run_claude_sdk

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
                is_cold_start=True,  # Each step starts a fresh session
                attached_files=attached_files if i == 0 else [],
                attached_folders=attached_folders if i == 0 else [],
                original_prompt=prompt,
                model_id=model_id,
                kb_listings=step_kb_listings,
                request_id=step_request_id,
                agent_config=None,
                external_user_id=step_external_user_id,
                enabled_integrations=step_integrations,
                approval_mode=approval_mode,
                numa_tool_approval_mode=numa_tool_approval_mode,
                integration_approval_modes=integration_approval_modes,
                agent_type_config=step_config,
                system_dir=step_system_dir,
            )
        except Exception as e:
            logger.error(
                "Pipeline step failed with exception",
                _name="PIPELINE_STEP_ERROR",
                phase="pipeline",
                step=i + 1,
                total_steps=total_steps,
                step_type=step_type_id,
                error=str(e),
                exc_info=True,
            )
            step_results.append(
                {
                    "step": step_type_id,
                    "step_number": i + 1,
                    "status": "error",
                    "text": "",
                    "error": str(e),
                }
            )
            return {
                "status": "error",
                "text": "",
                "artifacts": all_artifacts,
                "usage": total_usage,
                "error": (
                    f"Pipeline failed at step {i + 1}/{total_steps} "
                    f"({step_type_id}): {e}"
                ),
                "steps": step_results,
            }
        finally:
            # Clean up step-specific system dir (session already archived to S3)
            shutil.rmtree(step_system_dir, ignore_errors=True)

        # Collect step result
        step_status = result.get("status", "completed")
        step_results.append(
            {
                "step": step_type_id,
                "step_number": i + 1,
                "status": step_status,
                "text": result.get("text", ""),
            }
        )
        all_artifacts.extend(result.get("artifacts", []))

        # Accumulate usage
        step_usage = result.get("usage", {})
        total_usage["num_turns"] += step_usage.get("num_turns", 0)
        total_usage["total_cost_usd"] += step_usage.get("total_cost_usd", 0.0)
        total_usage["duration_ms"] += step_usage.get("duration_ms", 0)

        logger.info(
            "Pipeline step completed",
            _name="PIPELINE_STEP_COMPLETE",
            phase="pipeline",
            step=i + 1,
            total_steps=total_steps,
            step_type=step_type_id,
            step_status=step_status,
            step_turns=step_usage.get("num_turns", 0),
        )

        # If step returned error status, stop the pipeline
        if step_status == "error":
            return {
                "status": "error",
                "text": result.get("text", ""),
                "artifacts": all_artifacts,
                "usage": total_usage,
                "error": (
                    f"Pipeline step {i + 1}/{total_steps} ({step_type_id}) "
                    f"returned error"
                ),
                "steps": step_results,
            }

    # All steps completed — determine what to return
    final_text = _extract_final_result(
        parent_type_config.pipeline_result_mode,
        step_results,
    )

    logger.info(
        "Pipeline completed",
        _name="PIPELINE_COMPLETE",
        phase="pipeline",
        parent_type=parent_type_config.type_id,
        total_steps=total_steps,
        result_mode=parent_type_config.pipeline_result_mode,
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
    )

    return {
        "status": "completed",
        "text": final_text,
        "artifacts": all_artifacts,
        "usage": total_usage,
        "steps": step_results,
    }


def _extract_final_result(
    result_mode: str,
    step_results: list[dict[str, Any]],
) -> str:
    """Extract the final text result based on the pipeline result mode.

    Args:
        result_mode: "last_step_text" or "result_file".
        step_results: Accumulated results from each step.

    Returns:
        The final text output for the pipeline response.
    """
    if result_mode == "result_file":
        if RESULT_FILE_PATH.exists():
            try:
                structured = json.loads(RESULT_FILE_PATH.read_text())
                # Return as JSON string so it's always a string in the response
                return json.dumps(structured, indent=2, default=str)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(
                    "Failed to read result.json, falling back to last step text",
                    _name="PIPELINE_RESULT_FILE_ERROR",
                    phase="pipeline",
                    error=str(e),
                )
        else:
            logger.warning(
                "result.json not found, falling back to last step text",
                _name="PIPELINE_RESULT_FILE_MISSING",
                phase="pipeline",
                expected_path=str(RESULT_FILE_PATH),
            )

    # Default: return last step's text
    if step_results:
        return step_results[-1].get("text", "")
    return ""
