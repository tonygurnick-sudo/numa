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
    security_hook,
    subagent_cleanup_hook,
    subagent_limit_hook,
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

# Regional inference profile prefixes
# us-east-1 uses us.*, ap-southeast-2 uses au.* for 4.5+ models, apac.* for older models
_KNOWN_PREFIXES = ("us.", "au.", "apac.", "eu.", "global.")

REGIONAL_MODEL_MAP: dict[str, dict[str, str]] = {
    "us-east-1": {
        "anthropic.claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "us.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    "ap-southeast-2": {
        "anthropic.claude-sonnet-4-6": "au.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "au.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "au.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    "ap-southeast-3": {
        "anthropic.claude-sonnet-4-6": "global.anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1": "global.anthropic.claude-opus-4-6-v1",
        "anthropic.claude-haiku-4-5-20251001-v1:0": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        "anthropic.claude-sonnet-4-20250514-v1:0": "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    },
}


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

# Allowed models for user selection (computed from regional map)
ALLOWED_MODELS = set(
    REGIONAL_MODEL_MAP.get(REGION, REGIONAL_MODEL_MAP["us-east-1"]).values()
)

# Cross-account Bedrock access (if configured)
BEDROCK_ACCOUNT = os.environ.get("BEDROCK_ACCOUNT")


def validate_model_id(model_id: Optional[str]) -> str:
    """
    Validate and return a region-appropriate model ID for use with Bedrock.

    Accepts model IDs with any regional prefix (us., apac., global.) or bare IDs.
    Strips the prefix, re-adds the correct one for the current AWS_REGION,
    and validates against the allowed set.

    Args:
        model_id: Optional model ID from frontend request (may have any prefix or none)

    Returns:
        Validated model ID string with correct regional prefix
    """
    if model_id:
        regionalized = _regionalize(_strip_prefix(model_id))
        if regionalized in ALLOWED_MODELS:
            return regionalized
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
    "Bash(soffice:*)",  # LibreOffice headless (DOCX/PPTX → PDF)
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
    enabled_integrations: Optional[list[str]] = None,
    request_id: Optional[str] = None,
    email_signature: Optional[dict] = None,
    agent_type_config: Optional[AgentTypeConfig] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[str] = None,
    feature_flags: Optional[dict[str, bool]] = None,
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

    system_prompt = prompt_builder(
        working_dir=str(LOCAL_ROOT),
        user_timezone=user_timezone,
        platform="Numa Workspace",
        user_email=user_email,
        today_string=today_string,
        agent_config=agent_config,
        agent_file_paths=agent_file_paths,
        enabled_integrations=enabled_integrations,
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

    env: dict[str, str] = {
        # SDK Bedrock configuration
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "AWS_REGION": REGION,
        "AWS_DEFAULT_REGION": REGION,  # Some AWS SDKs need this
        # "DISABLE_PROMPT_CACHING": "1",
        # Disable OpenTelemetry in SDK subprocess (X-Ray OTLP not configured)
        "OTEL_SDK_DISABLED": "true",
        # Thinking tokens (from agent type config)
        "MAX_THINKING_TOKENS": str(type_config.max_thinking_tokens),
        # Set HOME so SDK stores sessions in /workdir/.system/.claude
        # This ensures session persistence matches our archive/restore location
        "HOME": str(LOCAL_ROOT / ".system"),
        # Workspace tools Lambda for custom tools (KB queries, etc.)
        "WORKSPACE_TOOLS_LAMBDA_NAME": workspace_tools_lambda,
        # OAuth workspace tools Lambda for OAuth cloud storage tools
        "OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME": oauth_workspace_tools_lambda,
    }

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

    # Pass user context to custom tools
    if user_sub:
        env["NUMA_USER_SUB"] = user_sub
    if conversation_id:
        env["NUMA_CONVERSATION_ID"] = conversation_id

    # Pipedream external user ID for integration tools
    if external_user_id:
        env["NUMA_EXTERNAL_USER_ID"] = external_user_id

    # Request ID for deterministic approval IDs
    if request_id:
        env["NUMA_REQUEST_ID"] = request_id

    # Pass enabled integrations list to SDK subprocess
    if enabled_integrations:
        env["NUMA_ENABLED_INTEGRATIONS"] = json.dumps(enabled_integrations)

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
        "NUMA_ENABLED_INTEGRATIONS",
        "NUMA_EXTERNAL_USER_ID",
        # Numa tool needs these for Lambda invocation, KB operations, S3 file sync
        "WORKSPACE_TOOLS_LAMBDA_NAME",
        "NUMA_ALLOWED_KBS",
        "NUMA_USER_SUB",
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
        mcp_servers["numa"] = create_sdk_mcp_server(
            name="numa",
            version="1.0.0",
            tools=[numa_tool],
        )

    # Connectors: only register if OAuth integrations feature is enabled
    if type_config.enable_connect_mcp and flags.get(
        "OAUTH_INTEGRATIONS_ENABLED", False
    ):
        mcp_servers["connectors"] = create_sdk_mcp_server(
            name="connectors",
            version="1.0.0",
            tools=[connectors],
        )

    # Vault: only register if secrets vault feature is enabled
    if type_config.enable_vault_mcp and flags.get("SECRETS_VAULT_ENABLED", False):
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
    effective_model = model or type_config.default_model or DEFAULT_MODEL

    return ClaudeAgentOptions(
        # Core settings
        system_prompt=system_prompt,
        model=effective_model,
        max_turns=type_config.max_turns,
        # Buffer size for multimodal content (images, PDFs)
        max_buffer_size=10 * 1024 * 1024,  # 10MB
        # Working directory
        cwd=str(LOCAL_ROOT),
        # Tools - explicitly set which tools are available (reduces token overhead)
        tools=TOOLS,
        # MCP servers — conditionally built above based on feature flags
        mcp_servers=mcp_servers,
        # Permissions - use acceptEdits mode with Python hooks for security
        # acceptEdits auto-approves file operations; hooks handle deny logic
        permission_mode="acceptEdits",
        allowed_tools=type_config.allowed_tools,
        disallowed_tools=type_config.disallowed_tools,
        # Session management
        resume=session_id,
        # Plugin for skills and agents (from type config)
        plugins=[{"type": "local", "path": type_config.plugins_path}],
        setting_sources=["project"],
        # Python hooks for security
        hooks={
            "PreToolUse": [
                HookMatcher(hooks=[security_hook, subagent_limit_hook, audit_hook]),
            ],
            "PostToolUse": [
                HookMatcher(hooks=[subagent_cleanup_hook, audit_hook]),
            ],
        },
        # Environment variables for custom tools
        env=env,
        # Include partial messages for streaming
        include_partial_messages=True,
        # Note: fine-grained-tool-streaming beta is not supported with Bedrock
        # Bedrock may stream tool inputs natively, but we can't force it via beta flag
        # Capture stderr from CLI subprocess for debugging
        stderr=log_stderr,
    )


def get_allowed_tools() -> list[str]:
    """Get the list of allowed tools for reference."""
    return ALLOWED_TOOLS.copy()
