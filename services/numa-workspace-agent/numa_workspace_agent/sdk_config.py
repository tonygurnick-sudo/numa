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

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher
from numa_workspace_agent.hooks import (
    audit_hook,
    security_hook,
    subagent_cleanup_hook,
    subagent_limit_hook,
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

# Plugin path (outside workspace for security)
PLUGINS_PATH = "/app/plugins/numa"

# ── SDK Configuration ──────────────────────────────────────────────────────────

# Default model for Bedrock
DEFAULT_MODEL = os.environ.get(
    "ANTHROPIC_MODEL", "us.anthropic.claude-sonnet-4-20250514-v1:0"
)

# Allowed models for user selection (us-east-1 regional inference profiles)
# These are the only models users can select via the model dropdown
ALLOWED_MODELS = {
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",  # Sonnet 4.5 - Balanced
    "us.anthropic.claude-opus-4-5-20251101-v1:0",  # Opus 4.5 - Complex (~2/3 more)
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",  # Haiku 4.5 - Fast (1/3 cost)
    "us.anthropic.claude-sonnet-4-20250514-v1:0",  # Sonnet 4 - Numa Chat V1 Model
}

# Cross-account Bedrock access (if configured)
BEDROCK_ACCOUNT = os.environ.get("BEDROCK_ACCOUNT")


def validate_model_id(model_id: Optional[str]) -> str:
    """
    Validate and return a model ID for use with Bedrock.

    If the model_id is in the allowed set, returns it.
    Otherwise, returns the default model.

    Args:
        model_id: Optional model ID from frontend request

    Returns:
        Validated model ID string
    """
    if model_id and model_id in ALLOWED_MODELS:
        return model_id
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
]

# Tools that Claude cannot use
DISALLOWED_TOOLS = [
    # Block MCP tools (we don't use them in workspace agent)
    "mcp__*",
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

    Returns:
        Configured ClaudeAgentOptions
    """
    # Build system prompt with context (including agent context if configured)
    system_prompt = build_workspace_system_prompt(
        working_dir=str(LOCAL_ROOT),
        user_timezone=user_timezone,
        platform="Numa Workspace",
        user_email=user_email,
        today_string=today_string,
        agent_config=agent_config,
        agent_file_paths=agent_file_paths,
    )

    # Build environment variables for SDK subprocess
    # Note: Credentials are NOT passed explicitly - the subprocess inherits
    # access to the container metadata service from the parent environment
    # Get workspace tools Lambda name from parent environment
    workspace_tools_lambda = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")

    env: dict[str, str] = {
        # SDK Bedrock configuration
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "AWS_REGION": REGION,
        "AWS_DEFAULT_REGION": REGION,  # Some AWS SDKs need this
        "DISABLE_PROMPT_CACHING": "1",
        # Disable OpenTelemetry in SDK subprocess (X-Ray OTLP not configured)
        "OTEL_SDK_DISABLED": "true",
        # Thinking tokens
        "MAX_THINKING_TOKENS": str(MAX_THINKING_TOKENS),
        # Set HOME so SDK stores sessions in /workdir/.system/.claude
        # This ensures session persistence matches our archive/restore location
        "HOME": str(LOCAL_ROOT / ".system"),
        # Workspace tools Lambda for custom tools (KB queries, etc.)
        "WORKSPACE_TOOLS_LAMBDA_NAME": workspace_tools_lambda,
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

    # Pass user context to custom tools
    if user_sub:
        env["NUMA_USER_SUB"] = user_sub
    if conversation_id:
        env["NUMA_CONVERSATION_ID"] = conversation_id

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

    # Stderr callback to capture CLI subprocess errors
    def log_stderr(msg: str) -> None:
        import structlog

        logger = structlog.get_logger()
        logger.warning("SDK CLI stderr", message=msg)

    return ClaudeAgentOptions(
        # Core settings
        system_prompt=system_prompt,
        model=model or DEFAULT_MODEL,
        max_turns=MAX_TURNS,
        # Buffer size for multimodal content (images, PDFs)
        max_buffer_size=10 * 1024 * 1024,  # 10MB
        # Working directory
        cwd=str(LOCAL_ROOT),
        # Tools - explicitly set which tools are available (reduces token overhead)
        tools=TOOLS,
        # Permissions - use acceptEdits mode with Python hooks for security
        # acceptEdits auto-approves file operations; hooks handle deny logic
        permission_mode="acceptEdits",
        allowed_tools=ALLOWED_TOOLS,
        disallowed_tools=DISALLOWED_TOOLS,
        # Session management
        resume=session_id,
        # Plugin for skills and agents
        plugins=[{"type": "local", "path": PLUGINS_PATH}],
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
