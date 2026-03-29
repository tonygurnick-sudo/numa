"""
Agent configuration module for Numa Workspace Agent.

Handles fetching agent configuration from DynamoDB (workspace-agents and user-agents tables)
and caching to avoid repeated database reads.
"""

import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Optional

import boto3
import structlog

logger = structlog.get_logger()

# Environment variables
CLIENT_NAME = os.environ.get("CLIENT_NAME", "")
REGION = os.environ.get("AWS_REGION", "us-east-1")

# Table names follow the pattern: numa-{client}-agents and numa-{client}-user-agents
# These are passed as environment variables from the infrastructure


@dataclass
class AgentReferenceFile:
    """Reference file metadata for agent configuration."""

    file_name: str
    s3_key: str
    s3_bucket: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    extracted_content_s3_key: Optional[str] = None
    uploaded_at: Optional[str] = None
    source: Optional[str] = None


@dataclass
class AgentToolsConfig:
    """Tools configuration for agent."""

    auto_tools_enabled: bool = True
    query_data_sources: bool = False
    web_search_enabled: bool = True
    create_agent_enabled: bool = False
    enabled_connections: list[str] = field(default_factory=list)
    # Multi-KB support:
    # None = all KBs (backwards compat)
    # [] = no KB access
    # ['company', 'kb-123'] = specific KBs only
    allowed_knowledge_bases: Optional[list[str]] = None
    # Legacy integration approval mode (backwards compat):
    # None = use user default (no agent override)
    approval_mode: Optional[str] = None
    # Per-category approval mode overrides:
    # None per-category = use user default for that category
    # Maps category -> mode ('always'|'non_destructive'|'never')
    approval_modes: Optional[dict[str, Optional[str]]] = None


@dataclass
class AgentConfig:
    """Agent configuration loaded from DynamoDB."""

    agent_id: str
    title: str
    system_prompt: str
    user_welcome_message: Optional[str]
    tools_config: AgentToolsConfig
    reference_files: list[AgentReferenceFile]
    version: int
    icon: Optional[str] = None
    icon_image: Optional[dict] = None
    agent_type: str = "task"
    description: Optional[str] = None
    scope: str = "user"  # 'user' or 'workspace'


def _get_dynamodb_client():
    """Get DynamoDB client."""
    return boto3.client("dynamodb", region_name=REGION)


def _parse_tools_config(raw_config: Optional[dict]) -> AgentToolsConfig:
    """Parse tools config from DynamoDB item."""
    if not raw_config:
        return AgentToolsConfig()

    # Parse per-category approval modes, validating each value
    raw_modes = raw_config.get("approvalModes")
    parsed_modes: Optional[dict[str, Optional[str]]] = None
    if isinstance(raw_modes, dict):
        parsed_modes = {}
        for cat in VALID_NUMA_TOOL_CATEGORIES:
            val = raw_modes.get(cat)
            if isinstance(val, str) and val in VALID_APPROVAL_MODES:
                parsed_modes[cat] = val
            else:
                parsed_modes[cat] = None  # Use user default
        # Also handle integrations category
        int_val = raw_modes.get("integrations")
        if isinstance(int_val, str) and int_val in VALID_APPROVAL_MODES:
            parsed_modes["integrations"] = int_val
        else:
            parsed_modes["integrations"] = None

    return AgentToolsConfig(
        auto_tools_enabled=raw_config.get("autoToolsEnabled", True),
        query_data_sources=raw_config.get("queryDataSources", False),
        web_search_enabled=raw_config.get("webSearchEnabled", True),
        create_agent_enabled=raw_config.get("createAgentEnabled", False),
        enabled_connections=raw_config.get("enabledConnections", []),
        allowed_knowledge_bases=raw_config.get("allowedKnowledgeBases"),
        approval_mode=raw_config.get("approvalMode"),
        approval_modes=parsed_modes,
    )


def _parse_reference_files(raw_files: Optional[list]) -> list[AgentReferenceFile]:
    """Parse reference files from DynamoDB item."""
    if not raw_files:
        return []

    result = []
    for raw in raw_files:
        if not raw.get("fileName") or not raw.get("s3Key"):
            continue
        result.append(
            AgentReferenceFile(
                file_name=raw["fileName"],
                s3_key=raw["s3Key"],
                s3_bucket=raw.get("s3Bucket", ""),
                file_type=raw.get("fileType"),
                file_size=raw.get("fileSize"),
                extracted_content_s3_key=raw.get("extractedContentS3Key"),
                uploaded_at=raw.get("uploadedAt"),
                source=raw.get("source"),
            )
        )
    return result


def _parse_workspace_agent(item: dict) -> AgentConfig:
    """Parse a workspace agent item from DynamoDB."""
    return AgentConfig(
        agent_id=item["agent_id"],
        title=item.get("title", "Untitled Agent"),
        system_prompt=item.get("system_prompt", ""),
        user_welcome_message=item.get("user_instructions"),
        tools_config=_parse_tools_config(item.get("tools_config")),
        reference_files=_parse_reference_files(item.get("reference_files")),
        version=item.get("version", 0),
        icon=item.get("icon"),
        icon_image=item.get("icon_image"),
        agent_type=item.get("agent_type", "task"),
        description=item.get("description"),
        scope="workspace",
    )


def _parse_user_agent(item: dict) -> AgentConfig:
    """Parse a user agent item from DynamoDB."""
    return AgentConfig(
        agent_id=item["agent_id"],
        title=item.get("title", "Untitled Agent"),
        system_prompt=item.get("system_prompt", ""),
        user_welcome_message=item.get("user_instructions"),
        tools_config=_parse_tools_config(item.get("tools_config")),
        reference_files=_parse_reference_files(item.get("reference_files")),
        version=item.get("version", 0),
        icon=item.get("icon"),
        icon_image=item.get("icon_image"),
        agent_type=item.get("agent_type", "task"),
        description=item.get("description"),
        scope="user",
    )


def _get_workspace_agent(
    dynamo, agent_id: str, workspace_table: str
) -> Optional[AgentConfig]:
    """Fetch agent from workspace agents table."""
    try:
        response = dynamo.get_item(
            TableName=workspace_table,
            Key={
                "tenant_id": {"S": CLIENT_NAME},
                "agent_id": {"S": agent_id},
            },
        )
        if "Item" not in response:
            return None

        # Convert DynamoDB item to Python dict
        item = _dynamodb_item_to_dict(response["Item"])
        return _parse_workspace_agent(item)
    except Exception as e:
        logger.warning(
            "Failed to fetch workspace agent",
            agent_id=agent_id,
            error=str(e),
        )
        return None


def _get_user_agent(
    dynamo, agent_id: str, user_sub: str, user_table: str
) -> Optional[AgentConfig]:
    """Fetch agent from user agents table."""
    try:
        response = dynamo.get_item(
            TableName=user_table,
            Key={
                "user_id": {"S": user_sub},
                "agent_id": {"S": agent_id},
            },
        )
        if "Item" not in response:
            return None

        # Convert DynamoDB item to Python dict
        item = _dynamodb_item_to_dict(response["Item"])
        return _parse_user_agent(item)
    except Exception as e:
        logger.warning(
            "Failed to fetch user agent",
            agent_id=agent_id,
            user_sub=user_sub,
            error=str(e),
        )
        return None


def _dynamodb_item_to_dict(item: dict) -> dict:
    """Convert DynamoDB item format to Python dict."""
    result = {}
    for key, value in item.items():
        result[key] = _dynamodb_value_to_python(value)
    return result


def _dynamodb_value_to_python(value: dict):
    """Convert a DynamoDB value to Python."""
    if "S" in value:
        return value["S"]
    elif "N" in value:
        num_str = value["N"]
        # Try int first, fall back to float
        try:
            return int(num_str)
        except ValueError:
            return float(num_str)
    elif "BOOL" in value:
        return value["BOOL"]
    elif "NULL" in value:
        return None
    elif "L" in value:
        return [_dynamodb_value_to_python(v) for v in value["L"]]
    elif "M" in value:
        return {k: _dynamodb_value_to_python(v) for k, v in value["M"].items()}
    elif "SS" in value:
        return list(value["SS"])
    elif "NS" in value:
        return [float(n) for n in value["NS"]]
    else:
        # Unknown type, return as-is
        return value


def fetch_agent_config(
    agent_id: str,
    user_sub: str,
    workspace_table: Optional[str] = None,
    user_table: Optional[str] = None,
) -> Optional[AgentConfig]:
    """
    Fetch agent configuration from DynamoDB.

    Checks user agents first (personal agents), then workspace agents (public).
    Results are cached by (agent_id, version) to avoid repeated reads.

    Args:
        agent_id: The agent ID to fetch
        user_sub: The user's Cognito sub (for personal agents)
        workspace_table: Optional override for workspace agents table name
        user_table: Optional override for user agents table name

    Returns:
        AgentConfig if found, None otherwise
    """
    if not agent_id:
        return None

    # Resolve table names
    ws_table = workspace_table or os.environ.get(
        "WORKSPACE_AGENTS_TABLE", f"numa-{CLIENT_NAME}-agents"
    )
    u_table = user_table or os.environ.get(
        "USER_AGENTS_TABLE", f"numa-{CLIENT_NAME}-user-agents"
    )

    dynamo = _get_dynamodb_client()

    # Try user agents first (personal agents)
    config = _get_user_agent(dynamo, agent_id, user_sub, u_table)
    if config:
        logger.info(
            "Fetched user agent config",
            agent_id=agent_id,
            title=config.title,
            version=config.version,
        )
        return config

    # Then try workspace agents (public)
    config = _get_workspace_agent(dynamo, agent_id, ws_table)
    if config:
        logger.info(
            "Fetched workspace agent config",
            agent_id=agent_id,
            title=config.title,
            version=config.version,
        )
        return config

    logger.warning(
        "Agent not found in either table",
        agent_id=agent_id,
        user_sub=user_sub,
    )
    return None


@lru_cache(maxsize=50)
def get_cached_agent_config(
    agent_id: str, user_sub: str, version: int  # noqa: ARG001 - used as cache key
) -> Optional[AgentConfig]:
    """
    Get agent config with caching by (agent_id, user_sub, version).

    This is useful when the version is known to avoid refetching unchanged agents.
    The version parameter is part of the lru_cache key, ensuring cache invalidation
    when agent versions change.

    Args:
        agent_id: The agent ID
        user_sub: The user's Cognito sub
        version: The agent version (used as cache key for invalidation)

    Returns:
        AgentConfig if found, None otherwise
    """
    return fetch_agent_config(agent_id, user_sub)


def clear_agent_cache():
    """Clear the agent config cache."""
    get_cached_agent_config.cache_clear()


# Valid approval modes
VALID_APPROVAL_MODES = ("always", "non_destructive", "never")
DEFAULT_APPROVAL_MODE = "non_destructive"


def fetch_user_approval_mode(user_sub: str) -> str:
    """
    Fetch the user's integration approval mode from the chat settings table.

    The chat settings table stores per-user defaults (tools, KBs, integrations, etc.).
    The approvalMode field controls how integration tool calls are approved:
    - 'always': require manual approval for every integration tool call
    - 'non_destructive': auto-approve read-only actions, require approval for writes
    - 'never': auto-approve all integration tool calls

    Args:
        user_sub: The user's Cognito sub (used as partition key in chat settings table)

    Returns:
        The approval mode string, defaulting to 'always' if not set or table unavailable.
    """
    table_name = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
    if not table_name:
        logger.debug(
            "CHAT_SETTINGS_TABLE_NAME not configured, using default approval mode"
        )
        return DEFAULT_APPROVAL_MODE

    try:
        dynamo = _get_dynamodb_client()
        response = dynamo.get_item(
            TableName=table_name,
            Key={"user_id": {"S": user_sub}},
            ProjectionExpression="approvalMode",
        )
        item = response.get("Item", {})
        mode = item.get("approvalMode", {}).get("S", DEFAULT_APPROVAL_MODE)
        if mode not in VALID_APPROVAL_MODES:
            logger.warning(
                "Invalid approval mode in user settings, using default",
                user_sub=user_sub[:8] + "...",
                invalid_mode=mode,
            )
            return DEFAULT_APPROVAL_MODE
        return mode
    except Exception as e:
        logger.warning(
            "Failed to fetch user approval mode, using default",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return DEFAULT_APPROVAL_MODE


VALID_NUMA_TOOL_CATEGORIES = ("agents", "memories", "knowledgeBases", "ops")
DEFAULT_NUMA_TOOL_APPROVAL_MODE: dict[str, str] = {
    "agents": "never",
    "memories": "never",
    "knowledgeBases": "never",
    "ops": "never",
}


def fetch_numa_tool_approval_mode(user_sub: str) -> dict[str, str]:
    """
    Fetch the user's per-category numa tool approval modes from the chat settings table.

    Each category (agents, memories, knowledgeBases) has its own approval mode:
    - 'always': require approval for every operation
    - 'non_destructive': auto-approve read-only ops, require approval for writes
    - 'never': auto-approve all operations (default)

    Args:
        user_sub: The user's Cognito sub (used as partition key in chat settings table)

    Returns:
        Dict mapping category to approval mode string.
    """
    table_name = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
    if not table_name:
        return dict(DEFAULT_NUMA_TOOL_APPROVAL_MODE)

    try:
        dynamo = _get_dynamodb_client()
        response = dynamo.get_item(
            TableName=table_name,
            Key={"user_id": {"S": user_sub}},
            ProjectionExpression="numaToolApprovalMode",
        )
        item = response.get("Item", {})
        raw = item.get("numaToolApprovalMode", {}).get("M", {})
        result = dict(DEFAULT_NUMA_TOOL_APPROVAL_MODE)
        for cat in VALID_NUMA_TOOL_CATEGORIES:
            val = raw.get(cat, {}).get("S", "")
            if val in VALID_APPROVAL_MODES:
                result[cat] = val
        return result
    except Exception as e:
        logger.warning(
            "Failed to fetch numa tool approval modes, using defaults",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return dict(DEFAULT_NUMA_TOOL_APPROVAL_MODE)


DEFAULT_EMAIL_SIGNATURE_TEXT = "Sent by my AI assistant, Numa (https://www.arcanum.ai)"


def fetch_user_email_signature(user_sub: str) -> dict:
    """
    Fetch the user's email signature settings from the chat settings table.

    Returns a dict with 'enabled' (bool) and 'text' (str), defaulting to
    enabled with the standard Numa signature if not set or table unavailable.

    Args:
        user_sub: The user's Cognito sub (partition key in chat settings table)

    Returns:
        {"enabled": bool, "text": str}
    """
    defaults = {"enabled": True, "text": DEFAULT_EMAIL_SIGNATURE_TEXT}
    table_name = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
    if not table_name:
        logger.debug(
            "CHAT_SETTINGS_TABLE_NAME not configured, using default email signature"
        )
        return defaults

    try:
        dynamo = _get_dynamodb_client()
        response = dynamo.get_item(
            TableName=table_name,
            Key={"user_id": {"S": user_sub}},
            ProjectionExpression="emailSignatureEnabled, emailSignatureText",
        )
        item = response.get("Item", {})
        enabled = item.get("emailSignatureEnabled", {}).get("BOOL", True)
        text = item.get("emailSignatureText", {}).get("S", DEFAULT_EMAIL_SIGNATURE_TEXT)
        return {"enabled": enabled, "text": text}
    except Exception as e:
        logger.warning(
            "Failed to fetch user email signature, using default",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return defaults


def fetch_user_profile(user_sub: str) -> Optional[dict]:
    """
    Fetch the user's profile from the chat settings table.

    Returns the user profile dict if available and enabled, or None if the
    profile is disabled, empty, or the table is unavailable.

    Args:
        user_sub: The user's Cognito sub (partition key in chat settings table)

    Returns:
        User profile dict or None
    """
    table_name = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
    if not table_name:
        logger.debug(
            "CHAT_SETTINGS_TABLE_NAME not configured, skipping user profile fetch"
        )
        return None

    try:
        dynamo = _get_dynamodb_client()
        response = dynamo.get_item(
            TableName=table_name,
            Key={"user_id": {"S": user_sub}},
            ProjectionExpression="userProfile",
        )
        item = response.get("Item", {})
        raw_profile = item.get("userProfile", {}).get("M")
        if not raw_profile:
            return None

        # Parse DynamoDB Map to Python dict
        profile = _dynamodb_item_to_dict(raw_profile)

        # Check if profile is disabled
        if not profile.get("useProfile", True):
            return None

        # Check if profile has any actual content
        content_fields = [
            "name",
            "jobTitle",
            "jobDescription",
            "linkedInUrl",
            "goalsAndObjectives",
            "otherInformation",
            "customInstructions",
        ]
        has_content = any(profile.get(f) for f in content_fields)
        has_memories = bool(profile.get("memories"))
        if not has_content and not has_memories:
            return None

        return profile
    except Exception as e:
        logger.warning(
            "Failed to fetch user profile, continuing without profile",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return None


def resolve_approval_mode(
    user_sub: str,
    agent_config: Optional[AgentConfig] = None,
) -> str:
    """
    Resolve the effective integration approval mode.

    Priority: agent config > user setting > default ('always').

    Args:
        user_sub: The user's Cognito sub
        agent_config: Optional agent configuration (may override user setting)

    Returns:
        The resolved approval mode string.
    """
    # Agent config takes priority if it specifies an approval mode
    if agent_config and agent_config.tools_config.approval_mode:
        mode = agent_config.tools_config.approval_mode
        if mode in VALID_APPROVAL_MODES:
            logger.info(
                "Using agent-level approval mode",
                agent_id=agent_config.agent_id,
                approval_mode=mode,
            )
            return mode
        logger.warning(
            "Invalid agent approval mode, falling through to user setting",
            agent_id=agent_config.agent_id,
            invalid_mode=mode,
        )

    # Fall back to user setting
    return fetch_user_approval_mode(user_sub)


def resolve_all_approval_modes(
    user_sub: str,
    agent_config: Optional[AgentConfig] = None,
) -> dict[str, str]:
    """
    Resolve effective approval modes for all categories.

    Merges agent-level overrides with user settings. Each category resolves
    independently: agent override > user setting > default.

    Backwards compat: if an agent has the legacy `approvalMode` field but no
    `approvalModes`, it applies to the integrations category only.

    Returns:
        Dict mapping category -> resolved mode string.
    """
    # Start with user settings as base
    user_modes = fetch_numa_tool_approval_mode(user_sub)
    user_integration_mode = fetch_user_approval_mode(user_sub)

    result = {
        "integrations": user_integration_mode,
        **user_modes,
    }

    if not agent_config:
        return result

    tc = agent_config.tools_config

    # New per-category overrides take priority
    if tc.approval_modes:
        for cat, mode in tc.approval_modes.items():
            if mode and mode in VALID_APPROVAL_MODES:
                result[cat] = mode

    # Legacy: single approvalMode applies to integrations only
    # (only if approvalModes doesn't already override integrations)
    elif tc.approval_mode and tc.approval_mode in VALID_APPROVAL_MODES:
        result["integrations"] = tc.approval_mode

    logger.info(
        "Resolved all approval modes",
        _name="APPROVAL_MODES_RESOLVED",
        agent_id=agent_config.agent_id if agent_config else None,
        resolved_modes=result,
    )

    return result
