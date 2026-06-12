"""Custom pipeline orchestrator for the NZSBA Policy Designer (FEAT-174).

Two strictly sequential phases inside one MicroVM:

1. Generation — writes the four customised policy area files to /workdir/tmp/.
2. Review & assemble — focused edits, front/back matter, assembles
   /workdir/outputs/final_policy.md.

The markdown is the only pipeline deliverable. DOCX/PDF are converted on
demand by the frontend through the document-converter Lambda (see
numa-frontend/CLAUDE.md → "Markdown → DOCX/PDF Downloads") — an earlier
in-workspace render phase was removed once that path proved better.

The orchestrator mirrors Nolia's (``nolia/orchestrator.py``) but is simpler:
no KB downloads, no document extraction, no parallelism, no subagents. It
adds a completion email via the centralized numa-email-sender Lambda
(deployer account) using the STS presigned-URL proof pattern.

Unlike Nolia, error results are also written to S3 here (not just by
``_background_run``) so the failure email is only sent after the result is
durable.
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
from .workspace_setup import OUTPUTS_DIR, setup_policy_designer_workspace

logger = structlog.get_logger()

# The sole pipeline deliverable — DOCX/PDF are converted from this markdown
# on demand by the frontend (document-converter Lambda).
FINAL_POLICY_MD = "final_policy.md"


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


async def run_policy_designer_pipeline(
    prompt: str,
    user_sub: str,
    conversation_id: str,
    parent_config: AgentTypeConfig,
    *,
    timezone: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    request_id: Optional[str] = None,
    request_metadata: Optional[dict] = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Run the Policy Designer pipeline.

    This is the ``pipeline_orchestrator`` callable set on the
    ``policy-designer`` AgentTypeConfig.

    Args:
        prompt: The freeform school context from the run form.
        user_sub: Cognito user sub.
        conversation_id: Base run ID (steps get suffixes).
        parent_config: The policy-designer AgentTypeConfig.
        user_email: Run initiator's email — completion email recipient.
        request_metadata: Frontend fields: ``school_name`` and optionally
            ``additional_instructions``.

    Returns:
        dict with status, text, artifacts, usage, steps.
    """
    pipeline_start = time.monotonic()
    metadata = request_metadata or {}
    school_name = (metadata.get("school_name") or "").strip() or "the school"

    logger.info(
        "Starting Policy Designer pipeline",
        _name="POLICY_DESIGNER_PIPELINE_START",
        phase="pipeline",
        conversation_id=conversation_id,
        school_name=school_name,
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

    # ── Pre-pipeline: workspace seeding ──────────────────────────────────
    emit("setup", "Preparing workspace...")
    setup_policy_designer_workspace(
        user_sub,
        conversation_id,
        school_context=prompt,
        additional_instructions=metadata.get("additional_instructions", ""),
    )

    # ── Step-specific prompts ────────────────────────────────────────────
    # System prompts carry the real instructions; these just orient each
    # step within the pipeline.
    generation_prompt = (
        f"You are running Phase 1 (Generation) for **{school_name}**. "
        "No prior phases have run. Your inputs are /workdir/exemplar.md, "
        "/workdir/school_context.md, and /workdir/additional_instructions.md. "
        "Write the four policy area files to /workdir/tmp/ per your system prompt."
    )

    review_prompt = (
        f"You are running Phase 2 (Review & Assemble) for **{school_name}**. "
        "Phase 1 has completed — the four policy area files are in /workdir/tmp/. "
        "Review and correct them in place, write the front and back matter, and "
        "assemble /workdir/outputs/final_policy.md per your system prompt."
    )

    step_kwargs = dict(
        user_sub=user_sub,
        conversation_id=conversation_id,
        timezone=timezone,
        user_email=user_email,
        today_string=today_string,
        request_id=request_id or str(uuid.uuid4()),
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

    async def _fail(step_label: str) -> dict[str, Any]:
        """Build, persist, and email a pipeline failure result."""
        error_msg = f"{step_label} failed"
        result = {
            "status": "error",
            "text": "",
            "artifacts": all_artifacts,
            "usage": total_usage,
            "error": error_msg,
            "steps": all_steps,
        }
        _persist_result(user_sub, conversation_id, result, parent_config, s3_prefix_fmt)
        _send_completion_email(
            user_email,
            success=False,
            school_name=school_name,
            error_msg=error_msg,
        )
        return result

    def _check_error(result: dict[str, Any], step_name: str) -> bool:
        if result.get("status") == "error":
            logger.error(
                "Policy Designer pipeline step failed",
                _name="POLICY_DESIGNER_STEP_ERROR",
                phase="pipeline",
                step=step_name,
                error=result.get("error", "unknown"),
            )
            return True
        return False

    # ── Phase 1: Generation ──────────────────────────────────────────────
    emit("generation", "Generating policy areas...")
    gen_result = _accumulate(
        await _run_step(
            "policy-designer-generation",
            "generation",
            prompt=generation_prompt,
            **step_kwargs,
        ),
        "policy-designer-generation",
    )
    if _check_error(gen_result, "policy-designer-generation"):
        return await _fail("Phase 1 (Generation)")

    # ── Phase 2: Review & assemble ───────────────────────────────────────
    emit("review", "Reviewing and assembling the policy document...")
    review_result = _accumulate(
        await _run_step(
            "policy-designer-review",
            "review",
            prompt=review_prompt,
            **step_kwargs,
        ),
        "policy-designer-review",
    )
    if _check_error(review_result, "policy-designer-review"):
        return await _fail("Phase 2 (Review & Assemble)")

    # The markdown is the canonical deliverable — without it the run failed
    # no matter what Phase 2 reported.
    if not (OUTPUTS_DIR / FINAL_POLICY_MD).exists():
        logger.error(
            "Phase 2 completed but final_policy.md is missing",
            _name="POLICY_DESIGNER_MISSING_OUTPUT",
            phase="pipeline",
        )
        return await _fail("Phase 2 (Review & Assemble) — final_policy.md missing")

    # ── Done ──────────────────────────────────────────────────────────────
    emit("complete", "Policy suite complete")
    total_usage["duration_ms"] = int((time.monotonic() - pipeline_start) * 1000)

    final_artifacts = [{"type": "file", "path": f"outputs/{FINAL_POLICY_MD}"}]
    final_text = (
        f"# Policy Suite for {school_name}\n\n"
        f"The complete policy suite has been generated.\n\n"
        f"<file:outputs/{FINAL_POLICY_MD}>\n\n"
        f"{all_steps[-1].get('text', '')}"
    )

    logger.info(
        "Policy Designer pipeline completed",
        _name="POLICY_DESIGNER_PIPELINE_COMPLETE",
        phase="pipeline",
        total_steps=len(all_steps),
        total_turns=total_usage["num_turns"],
        total_cost=total_usage["total_cost_usd"],
        duration_ms=total_usage["duration_ms"],
        outputs=[FINAL_POLICY_MD],
    )

    result = {
        "status": "completed",
        "text": final_text,
        "artifacts": final_artifacts,
        "usage": total_usage,
        "steps": all_steps,
    }

    # Persist BEFORE emailing: in fire-and-forget mode the container can be
    # SIGKILLed shortly after the last SDK subprocess exits, and the email
    # must never point at a run whose result isn't in S3 yet.
    _persist_result(user_sub, conversation_id, result, parent_config, s3_prefix_fmt)
    _send_completion_email(user_email, success=True, school_name=school_name)

    return result


async def _run_step(
    step_type_id: str,
    step_suffix: str,
    *,
    prompt: str,
    user_sub: str,
    conversation_id: str,
    timezone: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    request_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run a single pipeline step. Trimmed copy of Nolia's ``_run_step`` —
    no KB/integration plumbing because every phase runs with
    ``restrict_kbs=True`` / ``restrict_integrations=True`` and empty defaults.
    """
    # Lazy imports to avoid circular import at module load time
    # (orchestrator → sdk_runner → s3_workspace → sdk_config → agent_types)
    from ...sdk_config import LOCAL_ROOT
    from ...sdk_runner import run_claude_sdk
    from ...workspace import setup_agent_tools
    from .. import ALWAYS_COPY, TOOL_FILE_MAP

    step_config = get_agent_type_config(step_type_id)
    step_conversation_id = f"{conversation_id}-step-{step_suffix}"

    # Isolate Claude SDK session state per step to prevent cross-contamination.
    step_system_dir = LOCAL_ROOT / ".system" / f"step-{step_suffix}"
    step_system_dir.mkdir(parents=True, exist_ok=True)

    setup_agent_tools(
        enabled_numa_tools=step_config.enabled_numa_tools,
        tools_source_dirs=step_config.tools_source_dirs,
        tool_file_map=TOOL_FILE_MAP,
        always_copy=ALWAYS_COPY,
    )

    logger.info(
        "Running Policy Designer pipeline step",
        _name="POLICY_DESIGNER_STEP_START",
        phase="pipeline",
        step_type=step_type_id,
        step_conversation_id=step_conversation_id,
    )

    try:
        # NOTE: model_id intentionally omitted — each step's
        # AgentTypeConfig.default_model controls its own model.
        result = await run_claude_sdk(
            conversation_id=step_conversation_id,
            prompt=prompt,
            user_sub=user_sub,
            timezone_str=timezone,
            user_email=user_email,
            today_string=today_string,
            available_kbs=step_config.default_kbs or [],
            enabled_tools=None,
            is_cold_start=True,
            attached_files=[],
            attached_folders=[],
            original_prompt=prompt,
            kb_listings=None,
            request_id=request_id or str(uuid.uuid4()),
            agent_config=None,
            external_user_id=None,
            enabled_integrations=step_config.default_integrations or [],
            agent_type_config=step_config,
            system_dir=step_system_dir,
        )
    except Exception as e:
        logger.error(
            "Policy Designer pipeline step exception",
            _name="POLICY_DESIGNER_STEP_EXCEPTION",
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
        "Policy Designer pipeline step completed",
        _name="POLICY_DESIGNER_STEP_COMPLETE",
        phase="pipeline",
        step_type=step_type_id,
        status=result.get("status", "completed"),
        turns=result.get("usage", {}).get("num_turns", 0),
    )

    return result


def _persist_result(
    user_sub: str,
    conversation_id: str,
    result: dict[str, Any],
    parent_config: AgentTypeConfig,
    s3_prefix_fmt: str,
) -> None:
    """Sync the workspace and write _result.json to S3.

    In fire-and-forget mode the container may be terminated shortly after the
    pipeline returns, so the critical S3 writes happen here — inside the
    pipeline — for success AND error results (Nolia only does this for
    success and relies on ``_background_run`` for errors; we email on failure
    too, so the error result must be durable first).
    """
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
            _name="POLICY_DESIGNER_RESULT_WRITTEN",
            phase="pipeline",
            conversation_id=conversation_id,
            status=result.get("status"),
        )
    except Exception as e:
        logger.error(
            "Orchestrator failed to write result to S3",
            _name="POLICY_DESIGNER_RESULT_WRITE_ERROR",
            phase="pipeline",
            error=str(e),
        )


# ─── Completion email ─────────────────────────────────────────────────────────

# The email-sender validator rejects X-Amz-Expires > 60s and only accepts
# proofs against sts.us-east-1 / sts.ap-southeast-2 endpoints. The sender
# Lambda itself lives in the deployer account in us-east-1.
_STS_PROOF_REGION = "us-east-1"
_EMAIL_SENDER_REGION = "us-east-1"


def _local_boto3_session():
    """boto3 session bound to the LOCAL account (AgentCore role) credentials.

    With cross-account Bedrock enabled the process-level ``AWS_*`` env vars
    hold Bedrock-account credentials; ``NUMA_LOCAL_AWS_*`` hold the local
    AgentCore role credentials (same pattern as
    ``mcp_tools/lambda_client.py``). When the local vars are unset,
    boto3 falls back to the default chain — also the AgentCore role.
    """
    import boto3

    return boto3.Session(
        aws_access_key_id=os.environ.get("NUMA_LOCAL_AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("NUMA_LOCAL_AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.environ.get("NUMA_LOCAL_AWS_SESSION_TOKEN"),
    )


def _send_completion_email(
    user_email: Optional[str],
    *,
    success: bool,
    school_name: str,
    error_msg: Optional[str] = None,
) -> None:
    """Email the run initiator via the centralized numa-email-sender Lambda.

    Best-effort: any failure is logged and swallowed — email must never fail
    the run. No-ops when EMAIL_SENDER_LAMBDA_ARN or the recipient is missing.
    """
    import json

    email_sender_arn = os.environ.get("EMAIL_SENDER_LAMBDA_ARN", "")
    client_name = os.environ.get("CLIENT_NAME", "")
    frontend_url = os.environ.get("NUMA_FRONTEND_URL", "").rstrip("/")

    if not email_sender_arn:
        logger.warning(
            "EMAIL_SENDER_LAMBDA_ARN not configured — skipping completion email",
            _name="POLICY_DESIGNER_EMAIL_SKIPPED",
            phase="pipeline",
        )
        return
    if not user_email or user_email == "unknown":
        logger.warning(
            "No recipient email on the run — skipping completion email",
            _name="POLICY_DESIGNER_EMAIL_SKIPPED",
            phase="pipeline",
        )
        return

    app_url = f"{frontend_url}/app/policy-designer" if frontend_url else ""
    link_html = (
        f'<p><a href="{app_url}">Open the Policy Designer</a> to download it.</p>'
        if app_url
        else ""
    )
    link_text = (
        f"\n\nOpen the Policy Designer to download it: {app_url}" if app_url else ""
    )

    if success:
        subject = f"Your policy suite for {school_name} is ready"
        title = "Policy suite ready"
        body_html = (
            f"<p>The policy suite for <strong>{school_name}</strong> has been "
            f"generated and is ready to download (Markdown, Word, and PDF)."
            f"</p>{link_html}"
        )
        body_text = (
            f"The policy suite for {school_name} has been generated and is "
            f"ready to download (Markdown, Word, and PDF).{link_text}"
        )
    else:
        subject = f"Policy generation for {school_name} failed"
        title = "Policy generation failed"
        detail = f" ({error_msg})" if error_msg else ""
        body_html = (
            f"<p>The policy suite generation for <strong>{school_name}</strong> "
            f"did not complete{detail}. Please try running it again — if it "
            f"keeps failing, contact support.</p>{link_html}"
        )
        body_text = (
            f"The policy suite generation for {school_name} did not "
            f"complete{detail}. Please try running it again — if it keeps "
            f"failing, contact support.{link_text}"
        )

    try:
        session = _local_boto3_session()

        # STS presigned GetCallerIdentity URL proving the AgentCore role
        # identity to the cross-account email sender. The validator rejects
        # X-Amz-Expires > 60s.
        sts_client = session.client("sts", region_name=_STS_PROOF_REGION)
        sts_proof_url = sts_client.generate_presigned_url(  # type: ignore[attr-defined]
            "get_caller_identity", Params={}, ExpiresIn=60, HttpMethod="GET"
        )

        payload = {
            "sts_proof_url": sts_proof_url,
            "client_name": client_name,
            "to": [user_email],
            "template": "generic",
            "template_data": {
                "subject": subject,
                "title": title,
                "body_html": body_html,
                "body_text": body_text,
            },
        }

        lambda_client = session.client("lambda", region_name=_EMAIL_SENDER_REGION)
        lambda_client.invoke(
            FunctionName=email_sender_arn,
            InvocationType="Event",
            Payload=json.dumps(payload).encode("utf-8"),
        )
        logger.info(
            "Completion email dispatched",
            _name="POLICY_DESIGNER_EMAIL_SENT",
            phase="pipeline",
            success=success,
            recipient_domain=user_email.split("@")[-1] if "@" in user_email else "",
        )
    except Exception as e:
        logger.error(
            "Failed to send completion email",
            _name="POLICY_DESIGNER_EMAIL_ERROR",
            phase="pipeline",
            error=str(e),
        )


# Re-exported for tests
__all__ = [
    "run_policy_designer_pipeline",
    "_send_completion_email",
    "FINAL_POLICY_MD",
]
