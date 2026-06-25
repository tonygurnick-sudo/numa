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
    # Per-agent workspace-chat model id (Standard / Premium / Expert). None → the request's modelId
    # or, failing that, the platform default (Premium / Sonnet 4.6) is used at runtime.
    model_id: Optional[str] = None


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

    # Legacy `dataConnectorsEnabled` on agent records is silently dropped here.
    # Per-integration enablement (in the unified `enabledConnections` /
    # native enabled list) replaces the whole-feature toggle. Old agent
    # records keep the field in DDB but it has no effect at load time.
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
        model_id=item.get("model_id"),
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
        model_id=item.get("model_id"),
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


def _user_has_share_access(
    dynamo,
    agent_id: str,
    user_sub: str,
    sharing_table: str,
    team_members_table: str,
) -> bool:
    """Return True if user_sub has any share (direct or team-mediated) on agent_id."""
    try:
        response = dynamo.query(
            TableName=sharing_table,
            KeyConditionExpression="agent_id = :aid",
            ExpressionAttributeValues={":aid": {"S": agent_id}},
        )
    except Exception as e:
        logger.warning(
            "Failed to query agent sharing table",
            agent_id=agent_id,
            error=str(e),
        )
        return False

    items = response.get("Items", [])
    if not items:
        return False

    for raw in items:
        item = _dynamodb_item_to_dict(raw)
        principal_type = item.get("principal_type")
        principal_id = item.get("principal_id") or ""
        if principal_type == "user" and principal_id == user_sub:
            return True
        if principal_type == "team":
            team_id = principal_id.replace("team:", "", 1)
            try:
                mem = dynamo.get_item(
                    TableName=team_members_table,
                    Key={
                        "team_id": {"S": team_id},
                        "user_id": {"S": user_sub},
                    },
                )
                if "Item" in mem:
                    return True
            except Exception as e:
                logger.warning(
                    "Failed to check team membership",
                    agent_id=agent_id,
                    team_id=team_id,
                    user_sub=user_sub,
                    error=str(e),
                )
                continue

    return False


def _get_user_agent_by_agent_id(
    dynamo, agent_id: str, user_table: str, index_name: str
) -> Optional[AgentConfig]:
    """Fetch a user agent by agent_id alone via the agent-id-index GSI."""
    try:
        response = dynamo.query(
            TableName=user_table,
            IndexName=index_name,
            KeyConditionExpression="agent_id = :aid",
            ExpressionAttributeValues={":aid": {"S": agent_id}},
            Limit=1,
        )
    except Exception as e:
        logger.warning(
            "Failed to query user agents by agent_id",
            agent_id=agent_id,
            error=str(e),
        )
        return None

    items = response.get("Items", [])
    if not items:
        return None
    return _parse_user_agent(_dynamodb_item_to_dict(items[0]))


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

    # Share fallback: the agent may be a personal agent owned by someone else
    # that has been shared with a team the caller belongs to.
    sharing_table = os.environ.get("AGENT_SHARING_TABLE")
    team_members_table = os.environ.get("AGENT_TEAM_MEMBERS_TABLE")
    agent_id_index = os.environ.get("USER_AGENTS_AGENT_ID_INDEX", "agent-id-index")
    if sharing_table and team_members_table:
        if _user_has_share_access(
            dynamo, agent_id, user_sub, sharing_table, team_members_table
        ):
            config = _get_user_agent_by_agent_id(
                dynamo, agent_id, u_table, agent_id_index
            )
            if config:
                logger.info(
                    "Fetched shared user agent config",
                    agent_id=agent_id,
                    user_sub=user_sub,
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


# --- Consolidated Chat Settings ---
# All user chat settings (approval modes, email signature, user profile) live in the
# same DynamoDB table with the same key. We fetch once per request via a single
# GetItem instead of 4 separate calls. No cross-request caching -- user settings
# must reflect changes immediately on the next message.
#
# Call clear_user_settings_cache() at the start of each request to ensure fresh data.
_user_settings_cache: dict[str, dict] = {}

# One-shot guard so the missing-table warning logs once per container, not per request.
_warned_missing_settings_table = False


def clear_user_settings_cache() -> None:
    """Clear the per-request user settings cache. Call at the start of each request."""
    _user_settings_cache.clear()


def _get_cached_user_settings(user_sub: str) -> dict:
    """Fetch all user chat settings in a single DynamoDB GetItem.

    Within a request, the first caller fetches from DynamoDB and subsequent callers
    get the cached result. Call clear_user_settings_cache() at request start to
    ensure fresh data.

    Returns the raw DynamoDB item dict, or empty dict if unavailable.
    """
    if user_sub in _user_settings_cache:
        return _user_settings_cache[user_sub]

    table_name = os.environ.get("CHAT_SETTINGS_TABLE_NAME")
    if not table_name:
        global _warned_missing_settings_table
        if not _warned_missing_settings_table:
            _warned_missing_settings_table = True
            logger.error(
                "CHAT_SETTINGS_TABLE_NAME is not set — user chat settings cannot "
                "be read. Approval mode falls back to the default "
                f"('{DEFAULT_APPROVAL_MODE}') for every user, so an operator's "
                "'always'/auto-approve setting is silently ignored and integration "
                "writes may stall at the approval gate. Set this env var on the "
                "workspace container.",
                _name="CHAT_SETTINGS_TABLE_MISSING",
            )
        return {}

    try:
        dynamo = _get_dynamodb_client()
        response = dynamo.get_item(
            TableName=table_name,
            Key={"user_id": {"S": user_sub}},
        )
        item = response.get("Item", {})
        _user_settings_cache[user_sub] = item
        return item
    except Exception as e:
        logger.warning(
            "Failed to fetch user chat settings",
            user_sub=user_sub[:8] + "...",
            error=str(e),
        )
        return {}


# Valid approval modes
VALID_APPROVAL_MODES = ("always", "non_destructive", "never")
DEFAULT_APPROVAL_MODE = "non_destructive"


def fetch_user_approval_mode(user_sub: str) -> str:
    """
    Fetch the user's integration approval mode from the chat settings table.

    Uses the consolidated settings cache to avoid redundant DynamoDB calls.

    Returns:
        The approval mode string, defaulting to 'non_destructive' if not set.
    """
    item = _get_cached_user_settings(user_sub)
    mode = item.get("approvalMode", {}).get("S", DEFAULT_APPROVAL_MODE)
    if mode not in VALID_APPROVAL_MODES:
        return DEFAULT_APPROVAL_MODE
    return mode


VALID_NUMA_TOOL_CATEGORIES = (
    "agents",
    "memories",
    "knowledgeBases",
    "ops",
    "connectors",
)
DEFAULT_NUMA_TOOL_APPROVAL_MODE: dict[str, str] = {
    "agents": "never",
    "memories": "never",
    "knowledgeBases": "never",
    "ops": "never",
    "connectors": "non_destructive",
}


def fetch_numa_tool_approval_mode(user_sub: str) -> dict[str, str]:
    """
    Fetch the user's per-category numa tool approval modes from the chat settings table.

    Uses the consolidated settings cache to avoid redundant DynamoDB calls.

    Returns:
        Dict mapping category to approval mode string.
    """
    item = _get_cached_user_settings(user_sub)
    raw = item.get("numaToolApprovalMode", {}).get("M", {})
    result = dict(DEFAULT_NUMA_TOOL_APPROVAL_MODE)
    for cat in VALID_NUMA_TOOL_CATEGORIES:
        val = raw.get(cat, {}).get("S", "")
        if val in VALID_APPROVAL_MODES:
            result[cat] = val
    return result


def fetch_integration_approval_modes(user_sub: str) -> dict[str, str]:
    """
    Fetch per-integration approval-mode overrides (TASK-127).

    The chat-settings DDB record stores a Map<slug, mode>; this returns the
    same shape filtered to valid modes only. Missing/empty = no overrides.

    Returns:
        Dict mapping integration slug -> approval mode string. Empty when
        the user has set no per-integration overrides.
    """
    item = _get_cached_user_settings(user_sub)
    raw = item.get("integrationApprovalModes", {}).get("M", {})
    result: dict[str, str] = {}
    for slug, attr in raw.items():
        if not isinstance(slug, str) or not slug:
            continue
        val = attr.get("S", "") if isinstance(attr, dict) else ""
        if val in VALID_APPROVAL_MODES:
            result[slug] = val
    return result


DEFAULT_EMAIL_SIGNATURE_TEXT = "Sent by my AI assistant, Numa (https://www.arcanum.ai)"


def fetch_user_email_signature(user_sub: str) -> dict:
    """
    Fetch the user's email signature settings from the chat settings table.

    Uses the consolidated settings cache to avoid redundant DynamoDB calls.

    Returns:
        {"enabled": bool, "text": str}
    """
    defaults = {"enabled": True, "text": DEFAULT_EMAIL_SIGNATURE_TEXT}
    item = _get_cached_user_settings(user_sub)
    if not item:
        return defaults
    enabled = item.get("emailSignatureEnabled", {}).get("BOOL", True)
    text = item.get("emailSignatureText", {}).get("S", DEFAULT_EMAIL_SIGNATURE_TEXT)
    return {"enabled": enabled, "text": text}


def fetch_user_profile(user_sub: str) -> Optional[dict]:
    """
    Fetch the user's profile from the chat settings table.

    Uses the consolidated settings cache to avoid redundant DynamoDB calls.

    Returns:
        User profile dict or None if disabled/empty/unavailable.
    """
    item = _get_cached_user_settings(user_sub)
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


def _agent_overrides_integrations(agent_config: Optional[AgentConfig]) -> bool:
    """True if the agent explicitly sets the Integrations approval category.

    "Explicitly" means the agent record carries a valid Integrations mode via
    the per-category `approvalModes` map or the legacy single `approvalMode`
    field. A category left as "Use default" (stored as None) returns False.
    """
    if not agent_config:
        return False
    tc = agent_config.tools_config
    if (
        tc.approval_modes
        and tc.approval_modes.get("integrations") in VALID_APPROVAL_MODES
    ):
        return True
    if tc.approval_mode and tc.approval_mode in VALID_APPROVAL_MODES:
        return True
    return False


def resolve_per_integration_approval_modes(
    user_sub: str,
    agent_config: Optional[AgentConfig] = None,
) -> dict[str, str]:
    """
    Resolve the user's per-integration approval-mode overrides (TASK-127).

    Per-integration overrides are user-only state, but they only take effect
    when the agent leaves the Integrations category as "Use default". If the
    agent explicitly sets an Integrations approval mode (e.g. "Auto-approve
    all"), that agent-level decision applies uniformly to EVERY integration —
    so we return an empty map and let the resolved category mode drive every
    slug. This keeps the agent author's intent authoritative: choosing a
    specific Integrations mode on the agent overrides the user's per-slug
    preferences, while "Use default" defers to them.

    The caller (sdk_runner) consults the returned map per tool call, falling
    back to the resolved category mode when a slug is absent.

    Returns:
        Dict mapping integration slug -> approval mode string. Empty when the
        user has set no per-integration overrides, or when an agent-level
        Integrations mode takes precedence.
    """
    if _agent_overrides_integrations(agent_config):
        logger.info(
            "Agent explicitly set Integrations approval mode; "
            "ignoring per-integration user overrides",
            _name="PER_INTEGRATION_OVERRIDE_SUPPRESSED",
            agent_id=agent_config.agent_id if agent_config else None,
        )
        return {}
    return _mirror_cross_method_slugs(fetch_integration_approval_modes(user_sub))


def _mirror_cross_method_slugs(modes: dict[str, str]) -> dict[str, str]:
    """Mirror each per-integration override onto its cross-method slug alias.

    The Integrations UI saves a per-service override under ONE slug — the
    Pipedream slug when the service has one (e.g. ``google_drive``) — but the
    native connector path looks the override up under the native connector slug
    (``googledrive``). Without mirroring, a native read/write silently misses
    the override and falls back to the category default, so "always ask" set on
    Google Drive never reached the native connector (BUG-390).

    Expands ``{"google_drive": "always"}`` to
    ``{"google_drive": "always", "googledrive": "always"}`` using the canonical
    alias map (``integration_preferences.slug_aliases``). An explicitly-set slug
    always wins over an alias-derived value.
    """
    from numa_workspace_agent.mcp_tools.integration_preferences import slug_aliases

    expanded: dict[str, str] = {}
    for slug, mode in modes.items():
        for alias in slug_aliases(slug):
            # Never let an alias clobber a slug the user set explicitly.
            if alias != slug and alias in modes:
                continue
            expanded[alias] = mode
    return expanded


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

    if agent_config:
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

    # Unify Pipedream + native: a single "Integrations" approval setting
    # drives both the Pipedream `integrations` category and the native
    # `connectors` category. Users only ever see one row in the UI ("Google
    # Drive, Slack, Gmail, etc.") — having two backend categories let user
    # intent silently desync (e.g. setting Integrations to non_destructive
    # didn't auto-approve native Gmail reads because connectors stayed at
    # its own default). Make connectors a derived mirror, always.
    result["connectors"] = result["integrations"]

    logger.info(
        "Resolved all approval modes",
        _name="APPROVAL_MODES_RESOLVED",
        agent_id=agent_config.agent_id if agent_config else None,
        resolved_modes=result,
    )

    return result
