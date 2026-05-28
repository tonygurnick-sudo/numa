"""
SDK Configuration module for Numa Workspace Agent.

Provides ClaudeAgentOptions builder for the Claude Agent SDK,
replacing the CLI-based settings.json configuration.
"""

import json
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

# Disable OpenTelemetry tracing to avoid X-Ray OTLP export errors
# X-Ray requires CloudWatch Logs as trace destination for OTLP, which isn't configured
os.environ["OTEL_SDK_DISABLED"] = "true"

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, create_sdk_mcp_server
from numa_workspace_agent.agent_types import AgentTypeConfig, get_agent_type_config
from numa_workspace_agent.hooks import (
    audit_hook,
    compaction_hook,
    image_resize_hook,
    param_aliases_hook,
    security_hook,
)
from numa_workspace_agent.mcp_tools import (
    configure_props,
    connectors,
    execute_script,
    numa_tool,
    proxy_request,
    run_action,
    vault,
)
from numa_workspace_agent.prompts import build_workspace_system_prompt

if TYPE_CHECKING:
    from numa_workspace_agent.agent_config import AgentConfig

# ── Environment Variables ──────────────────────────────────────────────────────

REGION = os.environ.get("AWS_REGION", "us-east-1")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "unknown")
CLOUDFRONT_SECRET = os.environ.get("CLOUDFRONT_SECRET", "")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID", "")
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME", "")

# ── Workspace Configuration ────────────────────────────────────────────────────

# Local workspace root (ephemeral storage in AgentCore, synced to S3)
LOCAL_ROOT = Path(os.environ.get("LOCAL_WORKSPACE_ROOT", "/workdir"))

# ── SDK Configuration ──────────────────────────────────────────────────────────

# Bedrock inference profile prefixes. Two maps below, selected at startup by
# USE_GLOBAL_INFERENCE_PROFILE:
#   - GLOBAL_MODEL_MAP routes Sonnet/Opus 4.5+ via the `global.*` profile,
#     avoiding the 10% per-token cross-region premium AWS charges on `us.*`,
#     `au.*`, and `apac.*` profiles.
#   - REGIONAL_MODEL_MAP keeps traffic on regional `us.*` / `au.*` / `apac.*`
#     profiles. Required for customers whose parent-org SCPs deny the
#     `global.*` route (e.g. Suez, whose org-level SCP blocks the underlying
#     `foundation-model/anthropic.claude-sonnet-4-6` ARN when reached via the
#     global profile).
# Haiku 4.5 has no global profile published — stays on us./au. in both maps.
# Legacy Sonnet 4 (20250514) is not available on a global profile from
# ap-southeast-2 — stays on apac.* in both maps.
# ap-southeast-3 (Jakarta) has no local Bedrock for Claude, so both maps fall
# back to the global profile there regardless of the flag.
_KNOWN_PREFIXES = ("us.", "au.", "apac.", "eu.", "global.")

GLOBAL_MODEL_MAP: dict[str, dict[str, str]] = {
    "us-east-1": {
        "anthropic.claude-sonnet-4-6": "global.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "global.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    "ap-southeast-2": {
        "anthropic.claude-sonnet-4-6": "global.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "global.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "au.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    "ap-southeast-3": {
        "anthropic.claude-sonnet-4-6": "global.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "global.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    },
}

REGIONAL_ONLY_MODEL_MAP: dict[str, dict[str, str]] = {
    "us-east-1": {
        "anthropic.claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "us.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    "ap-southeast-2": {
        "anthropic.claude-sonnet-4-6": "au.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "au.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "au.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0": "apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    # ap-southeast-3 (Jakarta) has no local Bedrock — global is the only option.
    "ap-southeast-3": GLOBAL_MODEL_MAP["ap-southeast-3"],
}

USE_GLOBAL_INFERENCE_PROFILE = os.environ.get(
    "USE_GLOBAL_INFERENCE_PROFILE", "true"
).strip().lower() in ("1", "true", "yes")

REGIONAL_MODEL_MAP = (
    GLOBAL_MODEL_MAP if USE_GLOBAL_INFERENCE_PROFILE else REGIONAL_ONLY_MODEL_MAP
)


def _strip_prefix(model_id: str) -> str:
    """Strip regional prefix from a model ID."""
    for p in _KNOWN_PREFIXES:
        if model_id.startswith(p):
            return model_id[len(p) :]
    return model_id


def _regionalize(bare_model_id: str) -> str:
    """Map a bare model ID to the correct regionalized ID for current AWS_REGION."""
    region_map = REGIONAL_MODEL_MAP.get(REGION, REGIONAL_MODEL_MAP["us-east-1"])
    return region_map.get(bare_model_id, f"us.{bare_model_id}")


# Default model — env var is set per-region by infra construct; fallback computes dynamically
DEFAULT_MODEL = os.environ.get(
    "ANTHROPIC_MODEL", _regionalize("anthropic.claude-sonnet-4-6")
)

# Fallback model for when a model's daily Bedrock quota is exhausted (429 "per day")
FALLBACK_MODEL_BARE = "anthropic.claude-sonnet-4-5-20250929-v1:0"
FALLBACK_MODEL = _regionalize(FALLBACK_MODEL_BARE)

# Allowed models for user selection (computed from regional map)
ALLOWED_MODELS = set(
    REGIONAL_MODEL_MAP.get(REGION, REGIONAL_MODEL_MAP["us-east-1"]).values()
)

# Cross-account Bedrock access (if configured)
BEDROCK_ACCOUNT = os.environ.get("BEDROCK_ACCOUNT")

# Cap on per-API-call output tokens. The CLI default is 64k; we hold this to
# 32k so interactive chats can run more turns before the SDK's auto-compaction
# trigger fires (compaction is driven by total context size, and a smaller per-
# turn output budget means each turn adds less). Tune via the
# NUMA_MAX_OUTPUT_TOKENS env var if a deployment needs a different cap. The
# subprocess CLI reads this from CLAUDE_CODE_MAX_OUTPUT_TOKENS — the model can
# still emit "max_tokens reached" stop reason and recover on the next turn.
MAX_OUTPUT_TOKENS = int(os.environ.get("NUMA_MAX_OUTPUT_TOKENS", "32000"))


# ── Cost-recompute table for Anthropic models on Bedrock ──────────────────────
# The bundled Claude Code CLI's pricing table only carries 5-minute cache-write
# rates. Numa interactive chat uses the 1-hour cache tier
# (ENABLE_PROMPT_CACHING_1H_BEDROCK=1, see env build below), which AWS bills at
# 2× the base input rate instead of 1.25×. Result: every interactive turn's
# `total_cost_usd` from the SDK under-reports cache_creation cost by 0.75× the
# base input rate. AWS still bills correctly; only our telemetry is wrong.
#
# `recalculate_anthropic_cost` below recomputes total_cost_usd from raw token
# counts using these rates, applied selectively when 1h caching is on. Rates
# are per million tokens (USD).
#
# Sources:
#   https://platform.claude.com/docs/en/about-claude/pricing
#   https://aws.amazon.com/bedrock/pricing/
#
# Keep keys in sync with REGIONAL_MODEL_MAP keys (bare ids, no regional prefix).
ANTHROPIC_MODEL_PRICING: dict[str, dict[str, float]] = {
    "anthropic.claude-sonnet-4-6": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
    "anthropic.claude-opus-4-6-v1": {
        "input": 15.00,
        "output": 75.00,
        "cache_write_5m": 18.75,
        "cache_write_1h": 30.00,
        "cache_read": 1.50,
    },
    "anthropic.claude-haiku-4-5-20251001-v1:0": {
        "input": 1.00,
        "output": 5.00,
        "cache_write_5m": 1.25,
        "cache_write_1h": 2.00,
        "cache_read": 0.10,
    },
    "anthropic.claude-sonnet-4-5-20250929-v1:0": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
    "anthropic.claude-sonnet-4-20250514-v1:0": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_write_1h": 6.00,
        "cache_read": 0.30,
    },
}


def recalculate_anthropic_cost(
    model_id: Optional[str],
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_creation_tokens: int,
    cache_ttl: str = "5m",
) -> Optional[float]:
    """Recompute total_cost_usd from raw token counts using AWS-billed rates.

    Returns None when the model id can't be mapped to a known entry — callers
    should keep the SDK's reported value as a fallback in that case.

    `cache_ttl` is "5m" (default Bedrock) or "1h" (Numa interactive chats —
    selected via ENABLE_PROMPT_CACHING_1H_BEDROCK=1). Only `cache_write` rate
    varies between the two; cache_read is identical.
    """
    if not model_id:
        return None
    bare = _strip_prefix(model_id)
    bare = _normalise_anthropic_bare_id(bare)
    rates = ANTHROPIC_MODEL_PRICING.get(bare)
    if rates is None:
        return None
    write_rate = (
        rates["cache_write_1h"] if cache_ttl == "1h" else rates["cache_write_5m"]
    )
    return (
        input_tokens * rates["input"]
        + output_tokens * rates["output"]
        + cache_read_tokens * rates["cache_read"]
        + cache_creation_tokens * write_rate
    ) / 1_000_000


# Thinking-config presets selectable via the "@<suffix>" form on modelId.
# Throwaway plumbing for comparison testing — productionised path will configure
# thinking per-model server-side. See plan: thinking-config model variants.
#
# "no-thinking" sets thinking=None so the field is omitted entirely from the
# ClaudeAgentOptions kwargs — the model-agnostic way to disable extended
# thinking. Sonnet 4.6 and Opus 4.6 accept the new
# {"type": "adaptive" | "enabled" | "disabled"} forms without budget_tokens;
# Haiku 4.5 still requires the legacy {"type": "enabled", "budget_tokens": N}
# form, which is why we omit the field for "no-thinking" rather than passing
# {"type": "disabled"}.
THINKING_PRESETS: dict[str, dict] = {
    # max_thinking_tokens=0 ensures the SDK env-var fallback also says "off" —
    # otherwise MAX_THINKING_TOKENS=10000 (from agent type default) keeps
    # thinking on even when the `thinking` kwarg is omitted.
    "no-thinking": {"thinking": None, "effort": None, "max_thinking_tokens": 0},
    "medium-thinking": {
        "thinking": {"type": "adaptive"},
        "effort": "medium",
        "max_thinking_tokens": None,
    },
    "high-thinking": {
        "thinking": {"type": "adaptive"},
        "effort": "high",
        "max_thinking_tokens": None,
    },
}


def parse_model_id_with_thinking(
    raw: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """Split a composite modelId like 'anthropic.claude-sonnet-4-6@high-thinking'
    into (bare_id, 'high-thinking'). Returns (raw, None) when no recognised suffix
    is present."""
    if not raw or "@" not in raw:
        return raw, None
    bare, _, suffix = raw.partition("@")
    return bare, suffix if suffix in THINKING_PRESETS else None


def _normalise_anthropic_bare_id(bare: str) -> str:
    """Best-effort normalisation of a bare model id to the canonical Bedrock form
    used as keys in REGIONAL_MODEL_MAP.

    The frontend always sends canonical forms (`anthropic.<name>[-v1:0]`), but
    bench tools, scheduled-run authors, and direct API consumers sometimes pass
    short forms like `claude-haiku-4-5-20251001` or `claude-haiku-4-5-20251001-v1:0`.
    Without normalisation those silently fall through to DEFAULT_MODEL (Sonnet),
    masking the fact that the requested model never ran. This function tries the
    common variants before we give up; it never reaches outside the
    REGIONAL_MODEL_MAP keys for the current region, so we can't accidentally
    invent a wrong model id.
    """
    region_keys = set(
        REGIONAL_MODEL_MAP.get(REGION, REGIONAL_MODEL_MAP["us-east-1"]).keys()
    )
    candidates = [bare]
    if not bare.startswith("anthropic."):
        candidates.append(f"anthropic.{bare}")
        if not bare.endswith("-v1:0"):
            candidates.append(f"anthropic.{bare}-v1:0")
    elif not bare.endswith("-v1:0"):
        # Already prefixed, just try the -v1:0 form
        candidates.append(f"{bare}-v1:0")
    for c in candidates:
        if c in region_keys:
            return c
    return bare


def validate_model_id(model_id: Optional[str]) -> Optional[str]:
    """
    Validate and return a region-appropriate model ID for use with Bedrock.

    Accepts model IDs with any regional prefix (us., apac., global.) or bare IDs.
    Strips the prefix, re-adds the correct one for the current AWS_REGION,
    and validates against the allowed set.

    Returns None when model_id is None so that downstream callers
    (e.g. build_claude_options) can fall back to the agent type's
    default_model before using the global DEFAULT_MODEL.

    When the supplied id is non-empty but unrecognised, logs a warning and
    falls back to DEFAULT_MODEL. The pre-warning behaviour silently dropped
    these inputs onto Sonnet, which made Haiku-as-eval-only invisible — the
    eval was bogus because Haiku was never actually invoked.

    Args:
        model_id: Optional model ID from frontend request (may have any prefix or none)

    Returns:
        Validated model ID string with correct regional prefix, or None
    """
    if model_id is None:
        return None
    if not model_id:
        return None
    bare = _normalise_anthropic_bare_id(_strip_prefix(model_id))
    regionalized = _regionalize(bare)
    if regionalized in ALLOWED_MODELS:
        return regionalized
    # Unrecognised: surface the silent fallback so eval/bench callers can
    # spot mistyped or short-form ids that previously got routed to Sonnet.
    import structlog

    structlog.get_logger().warning(
        "Unrecognised model id, falling back to DEFAULT_MODEL",
        _name="MODEL_ID_FALLBACK",
        requested_model=model_id,
        normalised_bare=bare,
        regionalized_attempt=regionalized,
        fallback_model=DEFAULT_MODEL,
        region=REGION,
    )
    return DEFAULT_MODEL


def _get_local_credentials() -> dict[str, str]:
    """
    Capture local account credentials before cross-account assume.

    These allow tools to invoke Lambdas/S3 in the local account
    while the SDK subprocess has cross-account Bedrock credentials.

    Returns:
        Dict with NUMA_LOCAL_AWS_* environment variables for local account access
    """
    import boto3
    import structlog

    logger = structlog.get_logger()

    try:
        session = boto3.Session()
        credentials = session.get_credentials()

        if credentials is None:
            logger.warning("No local credentials available")
            return {}

        frozen = credentials.get_frozen_credentials()

        result = {
            "NUMA_LOCAL_AWS_ACCESS_KEY_ID": frozen.access_key,
            "NUMA_LOCAL_AWS_SECRET_ACCESS_KEY": frozen.secret_key,
        }
        if frozen.token:
            result["NUMA_LOCAL_AWS_SESSION_TOKEN"] = frozen.token
        return result
    except Exception as e:
        logger.error(
            "Failed to capture local credentials",
            _name="CRED_ERROR",
            phase="init",
            error=str(e),
        )
        return {}


def _get_cross_account_credentials() -> dict[str, str] | None:
    """
    Get temporary credentials for cross-account Bedrock access.

    If BEDROCK_ACCOUNT is configured, assumes the bedrock-quota-sharing role
    in that account and returns temporary credentials.

    Returns:
        Dict with AWS credential environment variables, or None if not configured
    """
    if not BEDROCK_ACCOUNT:
        return None

    import boto3
    import structlog

    logger = structlog.get_logger()

    try:
        sts = boto3.client("sts", region_name=REGION)
        credentials = sts.assume_role(
            RoleArn=f"arn:aws:iam::{BEDROCK_ACCOUNT}:role/bedrock-quota-sharing",
            RoleSessionName="numa-workspace-agent",
        )["Credentials"]

        logger.info(
            "Using cross-account Bedrock credentials",
            _name="BEDROCK_CROSS_ACCOUNT",
            phase="init",
            bedrock_account=BEDROCK_ACCOUNT,
        )

        return {
            "AWS_ACCESS_KEY_ID": credentials["AccessKeyId"],
            "AWS_SECRET_ACCESS_KEY": credentials["SecretAccessKey"],
            "AWS_SESSION_TOKEN": credentials["SessionToken"],
        }
    except Exception as e:
        logger.error(
            "Failed to assume cross-account Bedrock role",
            _name="BEDROCK_ROLE_ERROR",
            phase="init",
            bedrock_account=BEDROCK_ACCOUNT,
            error=str(e),
        )
        return None


# Maximum agentic turns
MAX_TURNS = int(os.environ.get("MAX_TURNS", "50"))

# Maximum thinking tokens
MAX_THINKING_TOKENS = int(os.environ.get("MAX_THINKING_TOKENS", "10000"))

# ── Tool Configuration ─────────────────────────────────────────────────────────

# Base tools to enable (limits what tools are available at all)
# Removed: AskUserQuestion, SlashCommand, EnterPlanMode, ExitPlanMode, NotebookEdit, WebFetch
TOOLS = [
    # File operations
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    # Shell
    "Bash",
    "KillShell",
    # Task management
    "Task",
    "TaskOutput",
    "TodoWrite",
    "Skill",
]

# Granular tool permissions (patterns for allowed commands)
ALLOWED_TOOLS = [
    # File operations
    "Read",
    "Write",
    "Glob",
    "Grep",
    "Edit",
    # Task management
    "TodoWrite",
    "Task",
    "Skill",
    # Shell
    "BashOutput",
    "KillShell",
    # MCP tools (our custom tools)
    "mcp__scripts__execute_script",  # Execute code without shell heredocs
    # Pipedream integration tools
    "mcp__integrations__run_action",  # Execute integration actions (with approval)
    "mcp__integrations__configure_props",  # Get dynamic prop options (no approval)
    "mcp__integrations__proxy_request",  # Raw API proxy calls (with approval)
    # Unified Numa platform tools (KB, web search, files, agents, memories)
    "mcp__numa__numa_tool",
    # External connectors (OAuth cloud storage, Synergy, generic HTTP)
    "mcp__connectors__connectors",
    "mcp__connectors__ns_*",  # NetSuite Native Tools
    # Secrets vault (user credentials with approval flow)
    "mcp__vault__vault",
    # Bash with allowed commands
    "Bash(python:*)",
    "Bash(python3:*)",
    "Bash(python3.13:*)",
    "Bash(ls:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(cat:*)",
    "Bash(wc:*)",
    "Bash(file:*)",
    "Bash(stat:*)",
    "Bash(du:*)",
    "Bash(tree:*)",
    "Bash(echo:*)",
    "Bash(date)",
    "Bash(pwd)",
    "Bash(tar:*)",
    "Bash(unzip:*)",
    "Bash(mkdir:*)",
    "Bash(mv:*)",
    "Bash(cp:*)",
    # Node.js runtime (PowerPoint generation, data processing scripts, etc.)
    "Bash(node:*)",
    "Bash(npm:*)",
    "Bash(npx:*)",
    # Common data analysis tools
    "Bash(sqlite3:*)",  # Database queries
    "Bash(jq:*)",  # JSON processing
    "Bash(sort:*)",  # Sorting
    "Bash(uniq:*)",  # Deduplication
    "Bash(cut:*)",  # Field extraction
    "Bash(awk:*)",  # Text processing
    "Bash(sed:*)",  # Text substitution
    "Bash(diff:*)",  # File comparison
    "Bash(grep:*)",  # Pattern matching (useful with pipes)
    "Bash(xargs:*)",  # Build command lines from input
    # Document handling binaries (pre-installed in container)
    "Bash(pdftoppm:*)",  # PDF → images (visual QA)
    "Bash(pdftotext:*)",  # PDF text extraction
    "Bash(pdfimages:*)",  # PDF image extraction
    "Bash(pandoc:*)",  # Document format conversion
    "Bash(qpdf:*)",  # PDF manipulation (merge, split)
]

# Tools that Claude cannot use
DISALLOWED_TOOLS: list[str] = [
    # Note: We explicitly allow mcp__scripts__* tools above
    # Block other MCP tools that we don't control
]


def create_agent_options(
    session_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    user_sub: Optional[str] = None,
    user_email: Optional[str] = None,
    user_timezone: Optional[str] = None,
    today_string: Optional[str] = None,
    allowed_kb_ids: Optional[list[dict]] = None,
    enabled_tools: Optional[list[str]] = None,
    model: Optional[str] = None,
    agent_config: Optional["AgentConfig"] = None,
    agent_file_paths: Optional[list[str]] = None,
    external_user_id: Optional[str] = None,
    enabled_integrations: Optional[list[dict]] = None,
    available_integrations: Optional[list[dict]] = None,
    request_id: Optional[str] = None,
    email_signature: Optional[dict] = None,
    agent_type_config: Optional[AgentTypeConfig] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[dict | str] = None,
    feature_flags: Optional[dict[str, bool]] = None,
    home_dir: Optional[Path] = None,
    thinking_override: Optional[str] = None,
    is_streaming: bool = True,
) -> ClaudeAgentOptions:
    """
    Create ClaudeAgentOptions for the Numa Workspace Agent.

    Args:
        session_id: Session ID to resume (from previous conversation)
        conversation_id: Current conversation ID
        user_sub: User's Cognito sub
        user_email: User's email address
        user_timezone: User's timezone (e.g., "America/New_York")
        today_string: Pre-formatted date string from frontend
        allowed_kb_ids: List of allowed knowledge base configs
        enabled_tools: List of enabled tool names (e.g., ["web_search"])
        model: Model override (defaults to DEFAULT_MODEL)
        agent_config: Optional agent configuration for custom prompts and restrictions
        agent_file_paths: Optional list of downloaded agent reference file paths
        agent_type_config: Optional agent type config. Defaults to "numa-chat".
        user_profile: Optional user profile dict for AI personalisation
        is_streaming: True for interactive streaming chat (uses 1h prompt
            cache TTL, allows background-bash). False for scheduled runs,
            sync, fire-and-forget, pipelines, V2 apps, Nolia phases (uses
            default 5m TTL, disables background-bash). Caller knows this
            because `stream_claude_sdk` and `run_claude_sdk` are the two
            entry points and they each set this flag explicitly.

    Returns:
        Configured ClaudeAgentOptions
    """
    # Resolve agent type config (default to numa-chat)
    type_config = agent_type_config or get_agent_type_config("numa-chat")

    # Build system prompt with context (including agent context if configured).
    # Agent types can supply a custom builder via system_prompt_builder; when
    # None we fall back to the default build_workspace_system_prompt().
    prompt_builder = type_config.system_prompt_builder or build_workspace_system_prompt
    flags = feature_flags or {}

    # NOTE: today_string is intentionally NOT passed to the default prompt builder.
    # It is prepended to each user message instead (see augment_prompt_with_context)
    # to keep the system prompt stable for prompt caching. Custom prompt builders
    # (e.g. Nolia) still receive it via **kwargs if they need it.
    system_prompt = prompt_builder(
        working_dir=str(LOCAL_ROOT),
        user_timezone=user_timezone,
        platform="Numa Workspace",
        user_email=user_email,
        today_string=today_string,
        agent_config=agent_config,
        agent_file_paths=agent_file_paths,
        enabled_integrations=enabled_integrations,
        available_integrations=available_integrations,
        email_signature=email_signature,
        identity_override=type_config.identity_override,
        user_profile=user_profile,
        company_profile=company_profile,
        feature_flags=flags,
    )

    # Build environment variables for SDK subprocess
    # Note: Credentials are NOT passed explicitly - the subprocess inherits
    # access to the container metadata service from the parent environment
    # Get workspace tools Lambda name from parent environment
    workspace_tools_lambda = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
    # Get OAuth workspace tools Lambda name from parent environment
    oauth_workspace_tools_lambda = os.environ.get(
        "OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME", ""
    )

    # Resolve MAX_THINKING_TOKENS so the SDK env-var fallback stays in sync with
    # any request-scoped thinking_override. Without this, the SDK falls back to
    # the agent type default (10k) even when the `thinking` kwarg is omitted,
    # which keeps thinking on for @no-thinking.
    effective_max_thinking_tokens = type_config.max_thinking_tokens
    if thinking_override and thinking_override in THINKING_PRESETS:
        preset_max = THINKING_PRESETS[thinking_override].get("max_thinking_tokens")
        if preset_max is not None:
            effective_max_thinking_tokens = preset_max

    env: dict[str, str] = {
        # SDK Bedrock configuration
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "AWS_REGION": REGION,
        "AWS_DEFAULT_REGION": REGION,  # Some AWS SDKs need this
        # Disable OpenTelemetry in SDK subprocess (X-Ray OTLP not configured)
        "OTEL_SDK_DISABLED": "true",
        # Thinking tokens (from agent type config, or thinking_override preset)
        "MAX_THINKING_TOKENS": str(effective_max_thinking_tokens),
        # Per-API-call output cap. See MAX_OUTPUT_TOKENS comment at module top.
        "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(MAX_OUTPUT_TOKENS),
        # Set HOME so SDK stores sessions in .claude/ under this directory.
        # Pipeline steps can override via home_dir for per-step isolation.
        "HOME": str(home_dir) if home_dir else str(LOCAL_ROOT / ".system"),
        # ── SDK noise reduction ─────────────────────────────────────────
        # Workspace is /workdir/, not a git repo — strip built-in commit/PR
        # workflow guidance and git-status snapshot from the system prompt.
        "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS": "1",
        # Hide slash commands that aren't reachable through our chat UI
        # (auth is via Cognito/JWT, version pinned by deploy, feedback goes
        # through Arcanum support channels).
        "DISABLE_LOGIN_COMMAND": "1",
        "DISABLE_LOGOUT_COMMAND": "1",
        "DISABLE_UPGRADE_COMMAND": "1",
        "DISABLE_DOCTOR_COMMAND": "1",
        "DISABLE_EXTRA_USAGE_COMMAND": "1",
        "DISABLE_FEEDBACK_COMMAND": "1",
        "DISABLE_INSTALL_GITHUB_APP_COMMAND": "1",
        # Strip the SDK's built-in subagent types (Explore, Plan, etc.) from
        # the system prompt. We have our own subagent strategy via the Task
        # tool and Nolia phases. Only applies in non-interactive mode (which
        # is what we run via the Python SDK wrapper).
        "CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS": "1",
        # Route the SDK's internal temp files (incl. background-bash output)
        # into /workdir/tmp/claude-{uid}/... where the model can Read them.
        # Default is /tmp/, which our security hook blocks — so completed
        # background tasks have unrecoverable output once the SDK's task
        # registry evicts the ID. With this redirect:
        #   /workdir/tmp/claude-{uid}/tasks/<shell_id>.output
        # is readable by the model directly when TaskOutput returns
        # "no task found" for a task that completed between turns.
        "CLAUDE_CODE_TMPDIR": str(LOCAL_ROOT / "tmp"),
        # Force TCP keepalive on every outbound socket the Node subprocess
        # opens. Bedrock streaming connections silently die after ~360s of
        # network idle (fleet-wide ceiling observed across 1,132 healthy
        # messages and 7 customer accounts). The bundled CLI does not set
        # SO_KEEPALIVE with sub-360s timing on its own. The shim wraps
        # connect(2) and applies SO_KEEPALIVE + TCP_KEEPIDLE=60 +
        # TCP_KEEPINTVL=30 + TCP_KEEPCNT=5 to every TCP socket. Built into
        # the image at /usr/local/lib/tcp_keepalive.so by the Dockerfile.
        # Skipped automatically when the .so isn't present (local dev
        # without the container), so the Python wrapper still runs.
        **(
            {"LD_PRELOAD": "/usr/local/lib/tcp_keepalive.so"}
            if Path("/usr/local/lib/tcp_keepalive.so").exists()
            else {}
        ),
        # ────────────────────────────────────────────────────────────────
        # Workspace tools Lambda for custom tools (KB queries, etc.)
        "WORKSPACE_TOOLS_LAMBDA_NAME": workspace_tools_lambda,
        # OAuth workspace tools Lambda for OAuth cloud storage tools
        "OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME": oauth_workspace_tools_lambda,
    }

    # Prompt-cache TTL: 1h for interactive streaming chats; default 5m for
    # everything else (scheduled runs, sync, fire-and-forget, pipelines, V2
    # apps, Nolia phases).
    #
    # Why this split: 1h tier costs ~$6/MTok on cache writes, 5m tier
    # ~$3.75/MTok. Interactive chats amortise the higher write across
    # follow-up turns within the hour, so 1h wins overall. Non-streaming
    # invocations fire once and never reuse the cache before it expires —
    # the 1h write premium is pure waste. Measured ~25% savings per
    # scheduled run ($0.13 avg across 311 sampled runs).
    #
    # The 5m TTL has a sliding window (refreshes on each cache hit), so
    # even multi-minute scheduled runs stay warm during active processing.
    if is_streaming:
        env["ENABLE_PROMPT_CACHING_1H_BEDROCK"] = "1"

    # Background bash (`run_in_background: true` + BashOutput / TaskStop) is only
    # useful when the harness can hold a connection open to surface completion.
    # That's the "watching state" wired into stream_claude_sdk (streaming response
    # mode only). For non-streaming invocations — scheduled runs, fire-and-forget,
    # sync pipelines — there's no user listening and no watching state, so a
    # background task that outlives the agent's turn is orphaned: it keeps
    # running in the MicroVM, produces no notification, and the agent declares
    # its work done without seeing the result. Disable the feature for those.
    #
    # Uses `is_streaming` rather than `type_config.response_mode` because the
    # runtime response mode can differ from the agent type's default (e.g. the
    # schedule runner uses the `numa-chat` type but overrides to `sync` via
    # the request body).
    if not is_streaming:
        env["CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"] = "1"

    # Pass allowed KBs (with id and name) to custom tools for security and attribution
    if allowed_kb_ids is not None:
        env["NUMA_ALLOWED_KBS"] = json.dumps(
            allowed_kb_ids
        )  # Full objects with id and name
    else:
        env["NUMA_ALLOWED_KBS"] = "[]"

    # Pass enabled tools list for security validation (e.g., ["web_search"])
    if enabled_tools is not None:
        env["NUMA_ENABLED_TOOLS"] = json.dumps(enabled_tools)
    else:
        env["NUMA_ENABLED_TOOLS"] = "[]"

    # Pass allowed operations from agent type config (developer-level restriction).
    # None = all operations allowed; list = only these operations.
    if type_config.allowed_numa_operations is not None:
        env["NUMA_ALLOWED_OPERATIONS"] = json.dumps(type_config.allowed_numa_operations)
    # else: don't set env var — None means "no restriction"

    # Pass allowed KB sub-operations (e.g. read-only: ["query", "list", "download", "download_folder"])
    if type_config.allowed_kb_operations is not None:
        env["NUMA_ALLOWED_KB_OPERATIONS"] = json.dumps(
            type_config.allowed_kb_operations
        )

    # Pass user context to custom tools
    if user_sub:
        env["NUMA_USER_SUB"] = user_sub
    if user_email:
        env["NUMA_USER_EMAIL"] = user_email
    if user_profile and user_profile.get("name"):
        env["NUMA_USER_NAME"] = user_profile["name"]
    if conversation_id:
        env["NUMA_CONVERSATION_ID"] = conversation_id

    # Pipedream external user ID for integration tools
    if external_user_id:
        env["NUMA_EXTERNAL_USER_ID"] = external_user_id

    # Request ID for deterministic approval IDs
    if request_id:
        env["NUMA_REQUEST_ID"] = request_id

    # Pass enabled Pipedream integration slugs to SDK subprocess (filtered
    # from the unified list — the workspace-chat-tools Lambda enforces per-
    # integration access using this var).
    _enabled_pipedream_slugs = [
        it.get("slug", "")
        for it in (enabled_integrations or [])
        if isinstance(it, dict) and it.get("method") == "pipedream" and it.get("slug")
    ]
    if _enabled_pipedream_slugs:
        env["NUMA_ENABLED_INTEGRATIONS"] = json.dumps(_enabled_pipedream_slugs)

    # FEAT-019: per-conversation account scope. JSON dict of
    #   { "<app_slug>": ["apn_xxx", "apn_yyy", ...] }
    # When set, run_action / proxy_request narrow the candidate account list
    # to this subset before resolving authProvisionId:"auto". Absent or empty
    # → all of the user's connected accounts are eligible (legacy). Only
    # populated when the admin has enabled multi-account for the app AND the
    # user actually narrowed the selection in the chat picker.
    _allowed_accounts_by_app: dict[str, list[str]] = {}
    _account_names_by_app: dict[str, dict[str, str]] = {}
    for it in enabled_integrations or []:
        if not isinstance(it, dict):
            continue
        if it.get("method") != "pipedream":
            continue
        slug = it.get("slug")
        ids = it.get("account_ids")
        if isinstance(slug, str) and slug and isinstance(ids, list) and ids:
            _allowed_accounts_by_app[slug] = [
                x for x in ids if isinstance(x, str) and x
            ]
        names = it.get("account_names")
        if isinstance(slug, str) and slug and isinstance(names, dict) and names:
            _account_names_by_app[slug] = {
                str(k): str(v)
                for k, v in names.items()
                if isinstance(k, str) and isinstance(v, str)
            }
    if _allowed_accounts_by_app:
        env["NUMA_ALLOWED_ACCOUNTS_BY_APP"] = json.dumps(_allowed_accounts_by_app)
    if _account_names_by_app:
        env["NUMA_ACCOUNT_NAMES_BY_APP"] = json.dumps(_account_names_by_app)

    # FEAT-019: informational full per-app account roster — always emitted
    # when the FE / V2-app / schedule producer attaches `available_accounts`
    # to an integration row. The prompt builder reads this to list every
    # connected account (with its apn_xxx) so the model can target specific
    # accounts via explicit `authProvisionId` instead of relying on the
    # proxy's first-match `auto` resolution. Distinct from
    # NUMA_ALLOWED_ACCOUNTS_BY_APP (a proxy filter applied only when the
    # user has narrowed the selection).
    _available_accounts_by_app: dict[str, list[dict]] = {}
    for it in enabled_integrations or []:
        if not isinstance(it, dict) or it.get("method") != "pipedream":
            continue
        slug = it.get("slug")
        avail = it.get("available_accounts")
        if (
            not isinstance(slug, str)
            or not slug
            or not isinstance(avail, list)
            or not avail
        ):
            continue
        cleaned: list[dict] = []
        for entry in avail:
            if not isinstance(entry, dict):
                continue
            acc_id = entry.get("account_id")
            if not isinstance(acc_id, str) or not acc_id:
                continue
            cleaned.append(
                {
                    "account_id": acc_id,
                    "name": (
                        entry.get("name")
                        if isinstance(entry.get("name"), str)
                        else None
                    ),
                }
            )
        if cleaned:
            _available_accounts_by_app[slug] = cleaned
    if _available_accounts_by_app:
        env["NUMA_AVAILABLE_ACCOUNTS_BY_APP"] = json.dumps(_available_accounts_by_app)

    # Pass enabled native connector slugs (filtered from the unified list).
    # The `connectors` MCP tool enforces per-call which connectors are
    # callable so a stale agent can't reach a service the user disabled
    # mid-conversation. Empty list means "none enabled" (explicit) — the
    # tool fails open only when the env var is unset entirely.
    _enabled_native_slugs = [
        it.get("slug", "")
        for it in (enabled_integrations or [])
        if isinstance(it, dict) and it.get("method") == "native" and it.get("slug")
    ]
    env["NUMA_ENABLED_NATIVE_CONNECTORS"] = json.dumps(_enabled_native_slugs)

    # IMPORTANT: Capture local credentials BEFORE cross-account assume.
    # Tools need these to invoke Lambdas/S3 in the local account while
    # the SDK subprocess has cross-account Bedrock credentials in AWS_* vars.
    local_creds = _get_local_credentials()
    env.update(local_creds)

    # Add cross-account Bedrock credentials if configured.
    # This MUST come after local creds capture since it overwrites AWS_* vars.
    cross_account_creds = _get_cross_account_credentials()
    if cross_account_creds:
        env.update(cross_account_creds)

    # Propagate env vars to os.environ for in-process MCP tools.
    # The env dict in ClaudeAgentOptions only reaches subprocess-based tools,
    # but MCP servers created via create_sdk_mcp_server run in-process and
    # read os.environ directly. Sync the keys that MCP tools need.
    for _key in (
        "NUMA_ENABLED_TOOLS",
        "NUMA_ALLOWED_OPERATIONS",
        "NUMA_ALLOWED_KB_OPERATIONS",
        "NUMA_ENABLED_INTEGRATIONS",
        "NUMA_ENABLED_NATIVE_CONNECTORS",
        "NUMA_EXTERNAL_USER_ID",
        # FEAT-019: multi-account state. integrations.py reads
        # NUMA_ALLOWED_ACCOUNTS_BY_APP at run_action time to forward the
        # per-conversation account scope to the proxy. WITHOUT this propagation
        # the in-process MCP tool always sees an empty allow-list and the
        # proxy can't filter — silently using the wrong account.
        "NUMA_ALLOWED_ACCOUNTS_BY_APP",
        "NUMA_AVAILABLE_ACCOUNTS_BY_APP",
        "NUMA_ACCOUNT_NAMES_BY_APP",
        # Numa tool needs these for Lambda invocation, KB operations, S3 file sync
        "WORKSPACE_TOOLS_LAMBDA_NAME",
        "NUMA_ALLOWED_KBS",
        "NUMA_USER_SUB",
        "NUMA_USER_EMAIL",
        "NUMA_USER_NAME",
        "NUMA_CONVERSATION_ID",
        "OUTPUTS_BUCKET_NAME",
        # Local account credentials for Lambda/S3 calls from in-process MCP tools
        "NUMA_LOCAL_AWS_ACCESS_KEY_ID",
        "NUMA_LOCAL_AWS_SECRET_ACCESS_KEY",
        "NUMA_LOCAL_AWS_SESSION_TOKEN",
        "OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME",
    ):
        if _key in env:
            os.environ[_key] = env[_key]
    # Also propagate OUTPUTS_BUCKET_NAME from parent environment if not in env dict
    if "OUTPUTS_BUCKET_NAME" not in env:
        _outputs_bucket = os.environ.get("OUTPUTS_BUCKET_NAME", "")
        if _outputs_bucket:
            os.environ["OUTPUTS_BUCKET_NAME"] = _outputs_bucket

    # Stderr callback to capture CLI subprocess errors
    def log_stderr(msg: str) -> None:
        import structlog

        logger = structlog.get_logger()
        logger.warning("SDK CLI stderr", message=msg)

    # Build MCP servers conditionally based on agent type config and feature flags
    mcp_servers: dict[str, Any] = {}

    if type_config.enable_scripts_mcp:
        mcp_servers["scripts"] = create_sdk_mcp_server(
            name="scripts",
            version="1.0.0",
            tools=[execute_script],
        )

    if type_config.enable_integrations_mcp:
        mcp_servers["integrations"] = create_sdk_mcp_server(
            name="integrations",
            version="1.0.0",
            tools=[run_action, configure_props, proxy_request],
        )

    if type_config.enable_numa_mcp:
        numa_tools = [numa_tool]
        # Add the ops tool when the feature flag is enabled
        if os.environ.get("NUMA_OPS_ENABLED", "").lower() in ("1", "true", "yes"):
            from numa_workspace_agent.mcp_tools import numa_ops_tool

            numa_tools.append(numa_ops_tool)
        mcp_servers["numa"] = create_sdk_mcp_server(
            name="numa",
            version="1.0.0",
            tools=numa_tools,
        )

    # Connectors MCP — register iff any enabled item is method=native.
    # The unified Integrations list is the single source of truth: if the
    # user has at least one native row enabled for this chat, the agent
    # gets the `connectors` tool. Otherwise it isn't registered, so the
    # agent literally can't call it. Per-integration enforcement (within
    # the registered tool) uses NUMA_ENABLED_NATIVE_CONNECTORS, set above.
    #
    # Admin gating: DATA_CONNECTORS_CHAT_ENABLED no longer controls per-chat
    # registration — it only controls whether the unified catalog surfaces
    # natives to admins/users in the first place. When off, no native row
    # ever reaches this code path, so the MCP is naturally not registered.
    _has_native_enabled = any(
        isinstance(it, dict) and it.get("method") == "native"
        for it in (enabled_integrations or [])
    )

    if (
        type_config.enable_connect_mcp
        and flags.get("OAUTH_INTEGRATIONS_ENABLED", False)
        and _has_native_enabled
    ):
        mcp_servers["connectors"] = create_sdk_mcp_server(
            name="connectors",
            version="1.0.0",
            tools=[connectors],
        )

    # Vault: register when native data connectors are enabled. The vault and
    # connectors travel together — connectors are the only thing that auto-
    # populates secrets, so gating both on DATA_CONNECTORS_ENABLED keeps a
    # single switch for admins (TASK-146).
    if type_config.enable_vault_mcp and flags.get("DATA_CONNECTORS_ENABLED", False):
        mcp_servers["vault"] = create_sdk_mcp_server(
            name="vault",
            version="1.0.0",
            tools=[vault],
        )

    import structlog as _structlog

    _logger = _structlog.get_logger()
    _logger.info(
        "SDK env configured",
        _name="SDK_ENV_TOOLS",
        phase="sdk",
        agent_type=type_config.type_id,
        mcp_servers=list(mcp_servers.keys()),
        feature_flags=flags,
        numa_enabled_tools=env.get("NUMA_ENABLED_TOOLS", "NOT SET"),
        numa_enabled_integrations=env.get("NUMA_ENABLED_INTEGRATIONS", "NOT SET"),
        numa_external_user_id=env.get("NUMA_EXTERNAL_USER_ID", "NOT SET"),
    )

    # Resolve effective model: request override > type config default > global default
    # Regionalize type_config.default_model since it may use bare IDs (e.g. without us. prefix)
    raw_model = model or type_config.default_model or DEFAULT_MODEL
    effective_model = (
        _regionalize(_strip_prefix(raw_model)) if raw_model else DEFAULT_MODEL
    )

    # Build options dict, conditionally including agents if defined
    options_kwargs: dict[str, Any] = {
        # Core settings
        "system_prompt": system_prompt,
        "model": effective_model,
        "max_turns": type_config.max_turns,
        # Buffer size for multimodal content (images, PDFs)
        "max_buffer_size": 10 * 1024 * 1024,  # 10MB
        # Working directory
        "cwd": str(LOCAL_ROOT),
        # Tools - use agent type config if specified, otherwise default set
        "tools": type_config.tools if type_config.tools else TOOLS,
        # MCP servers — conditionally built above based on feature flags
        "mcp_servers": mcp_servers,
        # Permissions - use acceptEdits mode with Python hooks for security
        # acceptEdits auto-approves file operations; hooks handle deny logic
        "permission_mode": "acceptEdits",
        "allowed_tools": type_config.allowed_tools,
        "disallowed_tools": type_config.disallowed_tools,
        # Session management
        "resume": session_id,
        # Plugin for skills and agents (from type config)
        "plugins": [{"type": "local", "path": type_config.plugins_path}],
        "setting_sources": ["project"],
        # Python hooks for security (can be disabled for closed pipelines).
        # Order matters in PreToolUse: security_hook denies first to avoid
        # wasted work; param_aliases_hook + image_resize_hook may rewrite
        # tool input; audit_hook logs the rewritten path for forensics.
        "hooks": (
            {
                "PreToolUse": [
                    HookMatcher(
                        hooks=[
                            security_hook,
                            param_aliases_hook,
                            image_resize_hook,
                            audit_hook,
                        ]
                    ),
                ],
                "PostToolUse": [
                    HookMatcher(hooks=[audit_hook]),
                ],
                "PreCompact": [
                    HookMatcher(hooks=[compaction_hook]),
                ],
            }
            if type_config.enable_security_hooks
            else {
                "PreToolUse": [
                    HookMatcher(
                        hooks=[param_aliases_hook, image_resize_hook, audit_hook]
                    ),
                ],
                "PostToolUse": [
                    HookMatcher(hooks=[audit_hook]),
                ],
                "PreCompact": [
                    HookMatcher(hooks=[compaction_hook]),
                ],
            }
        ),
        # Environment variables for custom tools
        "env": env,
        # Include partial messages for streaming
        "include_partial_messages": True,
        # Capture stderr from CLI subprocess for debugging
        "stderr": log_stderr,
    }

    # Pre-defined sub-agents for Task tool (cost optimisation — e.g. Haiku)
    if type_config.agents:
        options_kwargs["agents"] = type_config.agents

    # Thinking configuration — request-scoped `thinking_override` (from the modelId
    # "@<suffix>" form) always wins over the agent type's defaults when set.
    effective_thinking = type_config.thinking
    effective_effort = type_config.effort
    if thinking_override and thinking_override in THINKING_PRESETS:
        preset = THINKING_PRESETS[thinking_override]
        effective_thinking = preset["thinking"]
        effective_effort = preset["effort"]

    # Haiku 4.5 does not support the new adaptive thinking form on Bedrock.
    # When the request would have used {"type": "adaptive"} + effort (the
    # Sonnet/Opus path), translate it to the legacy {"type": "enabled",
    # "budget_tokens": N} form Haiku accepts, and drop `effort` (Haiku
    # ignores it). Without this, the kwargs are sent to Bedrock and silently
    # produce no thinking blocks for Haiku — verified empirically.
    is_haiku_4_5 = effective_model and "haiku-4-5" in effective_model
    if (
        is_haiku_4_5
        and isinstance(effective_thinking, dict)
        and effective_thinking.get("type") == "adaptive"
    ):
        # Map effort to a fixed budget. Minimum is 1024 (Bedrock requirement).
        # "max" mirrors high since Haiku has no separate ceiling preset.
        effort_to_budget = {"low": 1024, "medium": 4000, "high": 10000, "max": 10000}
        budget = effort_to_budget.get(effective_effort or "low", 1024)
        effective_thinking = {"type": "enabled", "budget_tokens": budget}
        effective_effort = None  # Haiku 4.5 does not accept the `effort` field.

    if effective_thinking:
        options_kwargs["thinking"] = effective_thinking

    # Effort level — controls reasoning depth ("low", "medium", "high", "max")
    if effective_effort:
        options_kwargs["effort"] = effective_effort

    return ClaudeAgentOptions(**options_kwargs)


def get_allowed_tools() -> list[str]:
    """Get the list of allowed tools for reference."""
    return ALLOWED_TOOLS.copy()
