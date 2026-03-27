"""
Agent management tools for numa-chat-workspace-tools Lambda.

Provides handlers for listing, getting, creating, updating, and duplicating agents.
Security is enforced through user_sub validation and admin policy checks.
"""

import mimetypes
import os
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client
from prm import resource

from .approval import create_approval_request, poll_approval

logger = structlog.get_logger()

# Environment variables
CLIENT_NAME = os.environ.get("CLIENT_NAME")
WORKSPACE_AGENTS_TABLE = os.environ.get("WORKSPACE_AGENTS_TABLE")
USER_AGENTS_TABLE = os.environ.get("USER_AGENTS_TABLE")
AGENTS_SETTINGS_TABLE_NAME = os.environ.get("AGENTS_SETTINGS_TABLE_NAME")
OUTPUTS_BUCKET_NAME = os.environ.get("OUTPUTS_BUCKET_NAME")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# S3 prefix for workspace files (must match extract_content.py)
S3_PREFIX = "numa-chat/workspace"

# Workspace root path
WORKSPACE_ROOT = "/workdir"

# Blocked paths within workspace (security)
BLOCKED_PATH_PATTERNS = [
    ".system/",
    ".system",
    "secrets/",
    "secrets",
    ".env",
]

# Type aliases
AgentVisibility = str  # "personal" | "public"
AgentScope = str  # "workspace" | "user"
AgentsMode = str  # "off" | "personal_only" | "full"


def _get_dynamo_resource():
    """Get DynamoDB resource with PRM tracking."""
    return resource("dynamodb", region=AWS_REGION)


def _get_s3_client():
    """Get S3 client with PRM tracking."""
    return prm_client("s3", region=AWS_REGION)


def _validate_workspace_path(file_path: str) -> Tuple[bool, Optional[str]]:
    """
    Validate that the file path is within allowed workspace directories.

    Args:
        file_path: Path to validate (e.g., /workdir/uploads/file.pdf)

    Returns:
        (is_valid, error_message)
    """
    if not file_path:
        return False, "file_path is required"

    # Must start with workspace root
    if not file_path.startswith(WORKSPACE_ROOT):
        return False, f"Path must be within {WORKSPACE_ROOT}"

    # Check for blocked patterns
    for pattern in BLOCKED_PATH_PATTERNS:
        if pattern in file_path:
            return False, f"Access to '{pattern}' is blocked by security policy"

    # Check for path traversal attempts
    if ".." in file_path:
        return False, "Path traversal is not allowed"

    return True, None


def _get_relative_path(file_path: str) -> str:
    """
    Extract the relative path from a workspace absolute path.

    Args:
        file_path: Absolute path (e.g., /workdir/uploads/file.pdf)

    Returns:
        Relative path (e.g., uploads/file.pdf)
    """
    if file_path.startswith(WORKSPACE_ROOT + "/"):
        return file_path[len(WORKSPACE_ROOT) + 1 :]
    elif file_path == WORKSPACE_ROOT:
        return ""
    return file_path


def _get_s3_key_for_workspace_file(
    rel_path: str, user_sub: str, conversation_id: str
) -> str:
    """
    Determine the S3 key for a workspace file.

    Args:
        rel_path: Path relative to workspace root (e.g., uploads/file.pdf)
        user_sub: User's Cognito sub
        conversation_id: Current conversation ID

    Returns:
        Full S3 key for the file
    """
    # chat-workflows/ is globally persistent (not scoped to conversation)
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"

    # Everything else is conversation-scoped
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def _resolve_and_copy_reference_files(
    file_paths: List[str],
    agent_id: str,
    user_sub: str,
    conversation_id: str,
) -> Tuple[List[Dict], List[str]]:
    """
    Resolve workspace paths and copy files to agent-specific prefix.

    For each file path:
    1. Validate path is within /workdir/
    2. Derive source S3 key from workspace path
    3. Get file metadata (size, type) from S3
    4. Copy to: numa-chat/agents/{user_sub}/{agent_id}/{timestamp}_{filename}
    5. Look for extracted content (.txt in outputs/) and copy if exists
    6. Build reference file metadata with new S3 keys

    Args:
        file_paths: List of workspace paths (e.g., ["/workdir/uploads/doc.pdf"])
        agent_id: The agent ID to store files under
        user_sub: User's Cognito sub
        conversation_id: Current conversation ID for source S3 path

    Returns:
        Tuple of (reference_files_list, warnings_list)
    """
    if not file_paths:
        return [], []

    if not OUTPUTS_BUCKET_NAME:
        return [], ["OUTPUTS_BUCKET_NAME not configured - cannot attach files"]

    s3_client = _get_s3_client()
    reference_files: List[Dict] = []
    warnings: List[str] = []
    now = int(time.time() * 1000)

    for file_path in file_paths:
        # Validate workspace path
        is_valid, error = _validate_workspace_path(file_path)
        if not is_valid:
            warnings.append(f"Skipping {file_path}: {error}")
            continue

        # Get relative path and source S3 key
        rel_path = _get_relative_path(file_path)
        source_s3_key = _get_s3_key_for_workspace_file(
            rel_path, user_sub, conversation_id
        )

        # Get file metadata from S3
        try:
            head_response = s3_client.head_object(
                Bucket=OUTPUTS_BUCKET_NAME, Key=source_s3_key
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "404":
                warnings.append(f"File not found in S3: {file_path}")
            else:
                warnings.append(f"Error accessing {file_path}: {str(e)}")
            continue

        # Extract file info
        filename = Path(file_path).name
        file_size = head_response.get("ContentLength", 0)
        content_type = head_response.get("ContentType", "")

        # Determine file type from content type or extension
        file_type = (
            content_type
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )

        # Build destination S3 key for agent
        # Format: numa-chat/agents/{user_sub}/{timestamp}_{randomId}_{filename}
        # This matches the frontend's path structure for backwards compatibility
        random_id = secrets.token_hex(4)  # 8 character random string like frontend
        safe_filename = re.sub(r"[^a-zA-Z0-9_.-]", "_", filename)
        dest_s3_key = f"numa-chat/agents/{user_sub}/{now}_{random_id}_{safe_filename}"

        # Copy file to agent-specific location
        try:
            copy_source = {"Bucket": OUTPUTS_BUCKET_NAME, "Key": source_s3_key}
            s3_client.copy_object(
                CopySource=copy_source,
                Bucket=OUTPUTS_BUCKET_NAME,
                Key=dest_s3_key,
            )
            logger.info(
                "Copied file to agent storage",
                source_key=source_s3_key,
                dest_key=dest_s3_key,
                agent_id=agent_id,
            )
        except ClientError as e:
            warnings.append(f"Failed to copy {file_path} to agent storage: {str(e)}")
            continue

        # Look for extracted content file (e.g., outputs/extracted_document.txt)
        extracted_content_key: Optional[str] = None
        stem = Path(filename).stem
        safe_stem = re.sub(r"[^a-zA-Z0-9_-]", "_", stem)
        extracted_rel_path = f"outputs/extracted_{safe_stem}.txt"
        extracted_source_key = _get_s3_key_for_workspace_file(
            extracted_rel_path, user_sub, conversation_id
        )

        try:
            s3_client.head_object(Bucket=OUTPUTS_BUCKET_NAME, Key=extracted_source_key)
            # Extracted content exists, copy it (same path pattern as main file)
            extracted_dest_key = f"numa-chat/agents/{user_sub}/{now}_{random_id}_extracted_{safe_stem}.txt"
            copy_source = {"Bucket": OUTPUTS_BUCKET_NAME, "Key": extracted_source_key}
            s3_client.copy_object(
                CopySource=copy_source,
                Bucket=OUTPUTS_BUCKET_NAME,
                Key=extracted_dest_key,
            )
            extracted_content_key = extracted_dest_key
            logger.info(
                "Copied extracted content to agent storage",
                source_key=extracted_source_key,
                dest_key=extracted_dest_key,
                agent_id=agent_id,
            )
        except ClientError:
            # No extracted content file exists, that's fine
            pass

        # Build reference file metadata
        reference_file = {
            "fileName": filename,
            "fileType": file_type,
            "fileSize": file_size,
            "s3Key": dest_s3_key,
            "s3Bucket": OUTPUTS_BUCKET_NAME,
            "extractedContentS3Key": extracted_content_key,
            "uploadedAt": now,
            "source": "workspace",
        }
        reference_files.append(reference_file)

    return reference_files, warnings


def _get_agents_settings_mode() -> AgentsMode:
    """Read the agents settings mode from DynamoDB."""
    if not AGENTS_SETTINGS_TABLE_NAME:
        return "full"
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(AGENTS_SETTINGS_TABLE_NAME)
        response = table.get_item(Key={"setting": "policy"})
        item = response.get("Item", {})
        mode = item.get("mode", "full")
        if mode in ("off", "personal_only", "full"):
            return mode
        return "full"
    except Exception as e:
        logger.warning("Failed to read agents settings", error=str(e))
        return "full"


def _generate_agent_id() -> str:
    """Generate a unique agent ID."""
    return f"agt_{uuid.uuid4().hex}"


def _normalise_tools_config(config: Optional[Dict]) -> Dict:
    """Normalise agent tools configuration."""
    if not config:
        return {}
    return {
        "autoToolsEnabled": config.get("autoToolsEnabled", True),
        "queryDataSources": config.get("queryDataSources", False),
        "webSearchEnabled": config.get("webSearchEnabled", False),
        "createAgentEnabled": config.get("createAgentEnabled", False),
        "enabledConnections": config.get("enabledConnections", []),
        "allowedKnowledgeBases": config.get("allowedKnowledgeBases"),
    }


def _normalise_reference_files(files: Optional[List]) -> List[Dict]:
    """Normalise reference files list."""
    if not files:
        return []
    return [
        {
            "fileName": f.get("fileName"),
            "fileType": f.get("fileType"),
            "fileSize": f.get("fileSize"),
            "s3Key": f.get("s3Key"),
            "s3Bucket": f.get("s3Bucket") or OUTPUTS_BUCKET_NAME,
            "extractedContentS3Key": f.get("extractedContentS3Key"),
            "uploadedAt": f.get("uploadedAt"),
            "source": f.get("source"),
        }
        for f in files
        if f.get("fileName") and f.get("s3Key")
    ]


def _map_workspace_agent(item: Dict) -> Dict:
    """Map a workspace agent DynamoDB item to API response format."""
    return {
        "agentId": item.get("agent_id"),
        "scope": "workspace",
        "visibility": item.get("visibility", "public"),
        "agentType": item.get("agent_type", "task"),
        "title": item.get("title"),
        "description": item.get("description"),
        "systemPrompt": item.get("system_prompt"),
        "userWelcomeMessage": item.get("user_instructions"),
        "estimatedTimeSavedMinutes": item.get("estimated_time_saved_minutes"),
        "isFavorite": item.get("is_favorite"),
        "icon": item.get("icon"),
        "iconImage": item.get("icon_image"),
        "requiredIntegrations": item.get("required_integrations", []),
        "toolsConfig": _normalise_tools_config(item.get("tools_config")),
        "referenceFiles": _normalise_reference_files(item.get("reference_files")),
        "createdBy": {
            "userId": item.get("created_by_user_id"),
            "name": item.get("created_by_name"),
        },
        "createdAt": item.get("created_at"),
        "updatedAt": item.get("updated_at"),
        "version": item.get("version"),
    }


def _map_user_agent(item: Dict) -> Dict:
    """Map a user agent DynamoDB item to API response format."""
    return {
        "agentId": item.get("agent_id"),
        "scope": "user",
        "visibility": item.get("visibility", "personal"),
        "agentType": item.get("agent_type", "task"),
        "title": item.get("title"),
        "description": item.get("description"),
        "systemPrompt": item.get("system_prompt"),
        "userWelcomeMessage": item.get("user_instructions"),
        "estimatedTimeSavedMinutes": item.get("estimated_time_saved_minutes"),
        "isFavorite": item.get("is_favorite"),
        "icon": item.get("icon"),
        "iconImage": item.get("icon_image"),
        "requiredIntegrations": item.get("required_integrations", []),
        "toolsConfig": _normalise_tools_config(item.get("tools_config")),
        "referenceFiles": _normalise_reference_files(item.get("reference_files")),
        "createdBy": {
            "userId": item.get("created_by_user_id"),
            "name": item.get("created_by_name"),
        },
        "createdAt": item.get("created_at"),
        "updatedAt": item.get("updated_at"),
        "version": item.get("version"),
        "sourceAgentId": item.get("source_agent_id"),
    }


def _list_user_agents(user_id: str) -> List[Dict]:
    """List all agents for a user from the user agents table."""
    if not USER_AGENTS_TABLE:
        return []
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(USER_AGENTS_TABLE)
        response = table.query(
            KeyConditionExpression="user_id = :uid",
            ExpressionAttributeValues={":uid": user_id},
        )
        return response.get("Items", [])
    except Exception as e:
        logger.error("Failed to list user agents", error=str(e))
        return []


def _list_workspace_agents() -> List[Dict]:
    """List all workspace agents for the tenant."""
    if not WORKSPACE_AGENTS_TABLE or not CLIENT_NAME:
        return []
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(WORKSPACE_AGENTS_TABLE)
        response = table.query(
            KeyConditionExpression="tenant_id = :tenant",
            ExpressionAttributeValues={":tenant": CLIENT_NAME},
        )
        return response.get("Items", [])
    except Exception as e:
        logger.error("Failed to list workspace agents", error=str(e))
        return []


def _list_workspace_agents_by_creator(user_id: str) -> List[Dict]:
    """List workspace agents created by a specific user."""
    if not WORKSPACE_AGENTS_TABLE or not CLIENT_NAME:
        return []
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(WORKSPACE_AGENTS_TABLE)
        response = table.query(
            IndexName="agent-creator-index",
            KeyConditionExpression="created_by_user_id = :uid",
            ExpressionAttributeValues={":uid": user_id},
        )
        # Filter to ensure tenant_id matches
        items = response.get("Items", [])
        return [item for item in items if item.get("tenant_id") == CLIENT_NAME]
    except Exception as e:
        logger.error("Failed to list workspace agents by creator", error=str(e))
        return []


def _get_user_agent(agent_id: str, user_id: str) -> Optional[Dict]:
    """Get a user agent by ID."""
    if not USER_AGENTS_TABLE:
        return None
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(USER_AGENTS_TABLE)
        response = table.get_item(Key={"user_id": user_id, "agent_id": agent_id})
        return response.get("Item")
    except Exception as e:
        logger.error("Failed to get user agent", error=str(e), agent_id=agent_id)
        return None


def _get_workspace_agent(agent_id: str) -> Optional[Dict]:
    """Get a workspace agent by ID."""
    if not WORKSPACE_AGENTS_TABLE or not CLIENT_NAME:
        return None
    try:
        dynamo = _get_dynamo_resource()
        table = dynamo.Table(WORKSPACE_AGENTS_TABLE)
        response = table.get_item(Key={"tenant_id": CLIENT_NAME, "agent_id": agent_id})
        return response.get("Item")
    except Exception as e:
        logger.error("Failed to get workspace agent", error=str(e), agent_id=agent_id)
        return None


def _validate_create_payload(payload: Dict) -> Optional[str]:
    """Validate agent creation payload. Returns error message or None."""
    if not payload.get("title") or not str(payload.get("title", "")).strip():
        return "title is required"
    if (
        not payload.get("systemPrompt")
        or not str(payload.get("systemPrompt", "")).strip()
    ):
        return "systemPrompt is required"
    reference_files = payload.get("referenceFiles", [])
    if reference_files and len(reference_files) > 5:
        return "A maximum of 5 reference files is supported"
    estimated_time = payload.get("estimatedTimeSavedMinutes")
    if estimated_time is not None:
        if not isinstance(estimated_time, (int, float)) or estimated_time < 0:
            return "estimatedTimeSavedMinutes must be a non-negative number"
    return None


def _build_user_item(
    payload: Dict,
    user_id: str,
    timestamp: int,
    agent_id: str,
    existing: Optional[Dict] = None,
) -> Dict:
    """Build a user agent DynamoDB item from payload."""
    user_instructions = payload.get("userWelcomeMessage")
    if user_instructions is None and existing:
        user_instructions = existing.get("user_instructions")
    if isinstance(user_instructions, str):
        user_instructions = user_instructions.strip() or None
    else:
        user_instructions = None

    visibility = payload.get(
        "visibility", existing.get("visibility") if existing else "personal"
    )
    if visibility not in ("personal", "public"):
        visibility = "personal"

    return {
        "user_id": user_id,
        "tenant_id": CLIENT_NAME,
        "agent_id": agent_id,
        "visibility": visibility,
        "agent_type": payload.get("agentType")
        or (existing.get("agent_type") if existing else "task"),
        "title": str(
            payload.get(
                "title", existing.get("title") if existing else "Untitled Agent"
            )
        ).strip(),
        "description": (
            payload.get("description")
            or (existing.get("description") if existing else None)
        ),
        "system_prompt": str(
            payload.get(
                "systemPrompt", existing.get("system_prompt") if existing else ""
            )
        ).strip(),
        "user_instructions": user_instructions,
        "estimated_time_saved_minutes": payload.get(
            "estimatedTimeSavedMinutes",
            existing.get("estimated_time_saved_minutes") if existing else None,
        ),
        "icon": payload.get("icon", existing.get("icon") if existing else None),
        "icon_image": payload.get(
            "iconImage", existing.get("icon_image") if existing else None
        ),
        "required_integrations": payload.get(
            "requiredIntegrations",
            existing.get("required_integrations") if existing else [],
        ),
        "tools_config": _normalise_tools_config(
            payload.get(
                "toolsConfig", existing.get("tools_config") if existing else None
            )
        ),
        "reference_files": _normalise_reference_files(
            payload.get(
                "referenceFiles", existing.get("reference_files") if existing else None
            )
        ),
        "created_by_user_id": (
            existing.get("created_by_user_id") if existing else user_id
        ),
        "created_by_name": payload.get(
            "createdByName", existing.get("created_by_name") if existing else None
        ),
        "created_at": existing.get("created_at") if existing else timestamp,
        "updated_at": timestamp,
        "version": timestamp,
        "source_agent_id": payload.get(
            "sourceAgentId", existing.get("source_agent_id") if existing else None
        ),
        "is_favorite": payload.get(
            "isFavorite", existing.get("is_favorite") if existing else None
        ),
    }


def _build_workspace_item(
    payload: Dict, user_id: str, timestamp: int, agent_id: str
) -> Dict:
    """Build a workspace agent DynamoDB item from payload."""
    user_instructions = payload.get("userWelcomeMessage")
    if isinstance(user_instructions, str):
        user_instructions = user_instructions.strip() or None
    else:
        user_instructions = None

    return {
        "tenant_id": CLIENT_NAME,
        "agent_id": agent_id,
        "visibility": "public",
        "agent_type": payload.get("agentType", "task"),
        "title": str(payload.get("title", "Untitled Agent")).strip(),
        "description": payload.get("description"),
        "system_prompt": str(payload.get("systemPrompt", "")).strip(),
        "user_instructions": user_instructions,
        "estimated_time_saved_minutes": payload.get("estimatedTimeSavedMinutes"),
        "is_favorite": payload.get("isFavorite"),
        "icon": payload.get("icon"),
        "icon_image": payload.get("iconImage"),
        "required_integrations": payload.get("requiredIntegrations", []),
        "tools_config": _normalise_tools_config(payload.get("toolsConfig")),
        "reference_files": _normalise_reference_files(payload.get("referenceFiles")),
        "created_by_user_id": user_id,
        "created_by_name": payload.get("createdByName"),
        "created_at": timestamp,
        "updated_at": timestamp,
        "version": timestamp,
    }


def _generate_duplicate_title(
    original_title: Optional[str], existing_agents: List[Dict]
) -> str:
    """Generate a unique title for a duplicated agent."""
    base = (original_title or "Untitled Agent").strip()
    # Remove existing (Copy N) suffix
    base = (
        re.sub(r"\s+\(Copy(?:\s+\d+)?\)$", "", base, flags=re.IGNORECASE).strip()
        or "Untitled Agent"
    )

    existing_titles = {(agent.get("title") or "").lower() for agent in existing_agents}

    candidate = f"{base} (Copy)"
    counter = 2
    while candidate.lower() in existing_titles:
        candidate = f"{base} (Copy {counter})"
        counter += 1
    return candidate


# =============================================================================
# PUBLIC HANDLERS
# =============================================================================


def handle_list_agents(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    List agents for the user.

    Params:
        scope: "owned" | "public" | "all" (default: "owned")
        agent_type: Optional filter by agent type
        __user_sub: User's Cognito sub (required)

    Returns:
        agents: List of agent summaries
    """
    user_sub = params.get("__user_sub")
    if not user_sub:
        raise ValueError("User authentication required")

    # Check admin policy
    mode = _get_agents_settings_mode()
    if mode == "off":
        return {"agents": []}

    scope = (params.get("scope") or "owned").lower()
    agent_type_filter = (params.get("agent_type") or "").lower()
    include_owned = scope in ("owned", "all", "")
    include_public = scope in ("public", "all")

    results: Dict[str, Dict] = {}

    if include_owned:
        # Get user's personal agents
        user_agents = _list_user_agents(user_sub)
        for item in user_agents:
            mapped = _map_user_agent(item)
            if (
                not agent_type_filter
                or mapped.get("agentType", "").lower() == agent_type_filter
            ):
                results[f"user:{mapped['agentId']}"] = mapped

        # Get workspace agents created by user
        workspace_by_creator = _list_workspace_agents_by_creator(user_sub)
        for item in workspace_by_creator:
            mapped = _map_workspace_agent(item)
            if (
                not agent_type_filter
                or mapped.get("agentType", "").lower() == agent_type_filter
            ):
                results[f"workspace:{mapped['agentId']}"] = mapped

    if include_public and mode != "personal_only":
        # Get all workspace agents
        workspace_agents = _list_workspace_agents()
        for item in workspace_agents:
            mapped = _map_workspace_agent(item)
            if (
                not agent_type_filter
                or mapped.get("agentType", "").lower() == agent_type_filter
            ):
                results[f"workspace:{mapped['agentId']}"] = mapped

    # Filter out workspace agents if mode is personal_only
    if mode == "personal_only":
        results = {k: v for k, v in results.items() if v.get("scope") == "user"}

    # Sort by updated_at descending
    agents = sorted(results.values(), key=lambda a: a.get("updatedAt", 0), reverse=True)

    logger.info(
        "Listed agents",
        user_sub=user_sub[:8] + "...",
        scope=scope,
        count=len(agents),
        mode=mode,
    )

    return {"agents": agents}


def handle_get_agent(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get a specific agent by ID.

    Params:
        agent_id: Agent ID (required)
        __user_sub: User's Cognito sub (required)

    Returns:
        agent: Agent details
    """
    user_sub = params.get("__user_sub")
    agent_id = params.get("agent_id")

    if not user_sub:
        raise ValueError("User authentication required")
    if not agent_id:
        raise ValueError("agent_id is required")

    # Check personal agent first
    personal = _get_user_agent(agent_id, user_sub)
    if personal:
        return {"agent": _map_user_agent(personal)}

    # Check workspace agent
    workspace = _get_workspace_agent(agent_id)
    if workspace:
        return {"agent": _map_workspace_agent(workspace)}

    raise ValueError(f"Agent not found: {agent_id}")


def _check_approval(
    params: Dict[str, Any],
    action_key: str,
    description: str,
    props_preview: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Check approval if request_id is present and not auto-approved.

    Returns a denial/timeout dict if denied/timed out, or None to proceed.
    """
    request_id = params.get("request_id")
    if not request_id:
        return None

    is_auto_approved = params.get("auto_approved", False)
    if is_auto_approved:
        return None

    user_sub = params.get("__user_sub", "")
    approval_id = create_approval_request(
        user_sub=user_sub,
        action_key=action_key,
        description=description,
        props_preview=props_preview,
        approval_id=request_id,
    )

    decision, deny_reason = poll_approval(approval_id)

    if decision == "denied":
        msg = "The user denied this action."
        if deny_reason:
            msg += f' The user said: "{deny_reason}"'
        return {"status": "denied", "message": msg, "deny_reason": deny_reason}

    if decision == "timeout":
        return {"status": "timeout", "message": "Approval timed out"}

    return None


def handle_create_agent(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new agent.

    Params:
        title: Agent title (required)
        systemPrompt: System prompt (required)
        visibility: "personal" | "public" (default: "personal")
        description: Optional description
        agentType: Agent type (default: "task")
        userWelcomeMessage: Optional welcome message
        estimatedTimeSavedMinutes: Optional time savings estimate
        icon: Optional icon class
        iconImage: Optional {s3Bucket, s3Key}
        requiredIntegrations: Optional list of integration IDs
        toolsConfig: Optional tools configuration
        referenceFiles: Optional list of reference files (max 5)
        attachFiles: Optional list of workspace paths to attach (max 5)
        createdByName: Optional creator name
        __user_sub: User's Cognito sub (required)
        __conversation_id: Conversation ID for resolving workspace paths

    Returns:
        agent: Created agent details
    """
    user_sub = params.get("__user_sub")
    if not user_sub:
        raise ValueError("User authentication required")

    # HITL approval gate
    denial = _check_approval(
        params,
        action_key="numa_agents_create",
        description=f"Create agent: {params.get('title', 'Untitled')}",
        props_preview={
            "title": params.get("title", ""),
            "visibility": params.get("visibility", "personal"),
            "systemPrompt": (params.get("systemPrompt", "") or "")[:200],
        },
    )
    if denial:
        return denial

    # Check admin policy
    mode = _get_agents_settings_mode()
    if mode == "off":
        raise ValueError("Agent creation is disabled")

    visibility = params.get("visibility", "personal")
    if mode == "personal_only" and visibility == "public":
        raise ValueError("Company sharing is disabled")

    # Validate payload
    validation_error = _validate_create_payload(params)
    if validation_error:
        raise ValueError(validation_error)

    now = int(time.time() * 1000)
    agent_id = _generate_agent_id()

    # Process attachFiles if provided (workspace paths to attach)
    attach_files = params.get("attachFiles", [])
    conversation_id = params.get("__conversation_id", "")
    file_warnings: List[str] = []

    if attach_files:
        if not conversation_id:
            raise ValueError(
                "Conversation context required to attach workspace files. "
                "Ensure __conversation_id is provided."
            )

        # Resolve and copy files to agent storage
        resolved_files, file_warnings = _resolve_and_copy_reference_files(
            attach_files, agent_id, user_sub, conversation_id
        )

        # Merge with any existing referenceFiles in params
        existing_refs = params.get("referenceFiles", []) or []
        params["referenceFiles"] = existing_refs + resolved_files

        # Re-validate reference files count after merging
        if len(params["referenceFiles"]) > 5:
            raise ValueError(
                f"Too many reference files. Maximum is 5, got {len(params['referenceFiles'])}"
            )

        logger.info(
            "Processed attached files",
            agent_id=agent_id,
            attached_count=len(resolved_files),
            warnings_count=len(file_warnings),
        )

    dynamo = _get_dynamo_resource()

    result: Dict[str, Any]
    if visibility == "public":
        # Create workspace agent
        item = _build_workspace_item(params, user_sub, now, agent_id)
        table = dynamo.Table(WORKSPACE_AGENTS_TABLE)
        table.put_item(Item=item)
        logger.info(
            "Created workspace agent", agent_id=agent_id, user_sub=user_sub[:8] + "..."
        )
        result = {"agent": _map_workspace_agent(item)}
    else:
        # Create user agent
        item = _build_user_item(params, user_sub, now, agent_id)
        table = dynamo.Table(USER_AGENTS_TABLE)
        table.put_item(Item=item)
        logger.info(
            "Created user agent", agent_id=agent_id, user_sub=user_sub[:8] + "..."
        )
        result = {"agent": _map_user_agent(item)}

    # Include warnings about skipped files
    if file_warnings:
        result["fileWarnings"] = file_warnings

    return result


def handle_update_agent(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update an existing agent.

    Params:
        agent_id: Agent ID (required)
        title: Optional new title
        systemPrompt: Optional new system prompt
        visibility: Optional new visibility
        description: Optional new description
        agentType: Optional new agent type
        userWelcomeMessage: Optional new welcome message
        estimatedTimeSavedMinutes: Optional time savings estimate
        icon: Optional icon class
        iconImage: Optional {s3Bucket, s3Key}
        requiredIntegrations: Optional list of integration IDs
        toolsConfig: Optional tools configuration
        referenceFiles: Optional list of reference files (max 5)
        attachFiles: Optional list of workspace paths to attach (max 5)
        __user_sub: User's Cognito sub (required)
        __user_groups: User's Cognito groups (for admin check)
        __conversation_id: Conversation ID for resolving workspace paths

    Returns:
        agent: Updated agent details
    """
    user_sub = params.get("__user_sub")
    agent_id = params.get("agent_id")
    user_groups = params.get("__user_groups", [])

    if not user_sub:
        raise ValueError("User authentication required")
    if not agent_id:
        raise ValueError("agent_id is required")

    # HITL approval gate
    denial = _check_approval(
        params,
        action_key="numa_agents_update",
        description=f"Update agent: {params.get('title', agent_id)}",
        props_preview={
            "agent_id": agent_id,
            "title": params.get("title", ""),
            "systemPrompt": (params.get("systemPrompt", "") or "")[:200],
        },
    )
    if denial:
        return denial

    # Check admin policy
    mode = _get_agents_settings_mode()
    if mode == "off":
        raise ValueError("Agents are disabled")

    visibility = params.get("visibility")
    if mode == "personal_only" and visibility == "public":
        raise ValueError("Company sharing is disabled")

    # Process attachFiles if provided (workspace paths to attach)
    attach_files = params.get("attachFiles", [])
    conversation_id = params.get("__conversation_id", "")
    file_warnings: List[str] = []

    if attach_files:
        if not conversation_id:
            raise ValueError(
                "Conversation context required to attach workspace files. "
                "Ensure __conversation_id is provided."
            )

        # Resolve and copy files to agent storage
        resolved_files, file_warnings = _resolve_and_copy_reference_files(
            attach_files, agent_id, user_sub, conversation_id
        )

        # Merge with any existing referenceFiles in params
        existing_refs = params.get("referenceFiles", []) or []
        params["referenceFiles"] = existing_refs + resolved_files

        logger.info(
            "Processed attached files for update",
            agent_id=agent_id,
            attached_count=len(resolved_files),
            warnings_count=len(file_warnings),
        )

    # Validate reference files count
    reference_files = params.get("referenceFiles")
    if reference_files and len(reference_files) > 5:
        raise ValueError("A maximum of 5 reference files is supported")

    dynamo = _get_dynamo_resource()
    now = int(time.time() * 1000)
    is_admin = "admin" in user_groups

    # Check personal agent first
    user_agent = _get_user_agent(agent_id, user_sub)
    if user_agent:
        merged = _build_user_item(params, user_sub, now, agent_id, user_agent)
        table = dynamo.Table(USER_AGENTS_TABLE)
        table.put_item(Item=merged)
        logger.info(
            "Updated user agent", agent_id=agent_id, user_sub=user_sub[:8] + "..."
        )
        result: Dict[str, Any] = {"agent": _map_user_agent(merged)}
        if file_warnings:
            result["fileWarnings"] = file_warnings
        return result

    # Check workspace agent
    workspace_agent = _get_workspace_agent(agent_id)
    if workspace_agent:
        # Permission check
        if workspace_agent.get("created_by_user_id") != user_sub and not is_admin:
            raise ValueError("You do not have permission to update this agent")

        # Update workspace agent
        user_instructions = params.get("userWelcomeMessage")
        if user_instructions is None:
            user_instructions = workspace_agent.get("user_instructions")
        if isinstance(user_instructions, str):
            user_instructions = user_instructions.strip() or None

        merged = {
            **workspace_agent,
            "visibility": params.get(
                "visibility", workspace_agent.get("visibility", "public")
            ),
            "agent_type": params.get("agentType", workspace_agent.get("agent_type")),
            "title": str(params.get("title", workspace_agent.get("title"))).strip(),
            "description": params.get(
                "description", workspace_agent.get("description")
            ),
            "system_prompt": str(
                params.get("systemPrompt", workspace_agent.get("system_prompt"))
            ).strip(),
            "user_instructions": user_instructions,
            "estimated_time_saved_minutes": params.get(
                "estimatedTimeSavedMinutes",
                workspace_agent.get("estimated_time_saved_minutes"),
            ),
            "is_favorite": params.get("isFavorite", workspace_agent.get("is_favorite")),
            "icon": params.get("icon", workspace_agent.get("icon")),
            "icon_image": params.get("iconImage", workspace_agent.get("icon_image")),
            "required_integrations": params.get(
                "requiredIntegrations", workspace_agent.get("required_integrations", [])
            ),
            "tools_config": _normalise_tools_config(
                params.get("toolsConfig", workspace_agent.get("tools_config"))
            ),
            "reference_files": _normalise_reference_files(
                params.get("referenceFiles", workspace_agent.get("reference_files"))
            ),
            "updated_at": now,
            "version": now,
        }

        table = dynamo.Table(WORKSPACE_AGENTS_TABLE)
        table.put_item(Item=merged)
        logger.info(
            "Updated workspace agent", agent_id=agent_id, user_sub=user_sub[:8] + "..."
        )
        result = {"agent": _map_workspace_agent(merged)}
        if file_warnings:
            result["fileWarnings"] = file_warnings
        return result

    raise ValueError(f"Agent not found: {agent_id}")


def handle_duplicate_agent(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Duplicate an agent to the user's personal library.

    Params:
        agent_id: Agent ID to duplicate (required)
        __user_sub: User's Cognito sub (required)

    Returns:
        agent: New duplicated agent details
    """
    user_sub = params.get("__user_sub")
    agent_id = params.get("agent_id")

    if not user_sub:
        raise ValueError("User authentication required")
    if not agent_id:
        raise ValueError("agent_id is required")

    # HITL approval gate
    denial = _check_approval(
        params,
        action_key="numa_agents_duplicate",
        description=f"Duplicate agent: {agent_id}",
        props_preview={"agent_id": agent_id},
    )
    if denial:
        return denial

    # Check admin policy
    mode = _get_agents_settings_mode()
    if mode == "off":
        raise ValueError("Agents are disabled")

    # Get existing agents for title generation
    existing_agents = _list_user_agents(user_sub)

    # Check personal agent first
    personal_agent = _get_user_agent(agent_id, user_sub)
    if personal_agent:
        # Duplicate personal agent
        duplicate_title = _generate_duplicate_title(
            personal_agent.get("title"), existing_agents
        )
        now = int(time.time() * 1000)
        new_id = _generate_agent_id()

        new_item = _build_user_item(
            {
                "title": duplicate_title,
                "systemPrompt": personal_agent.get("system_prompt"),
                "visibility": "personal",
                "description": personal_agent.get("description"),
                "agentType": personal_agent.get("agent_type"),
                "userWelcomeMessage": personal_agent.get("user_instructions"),
                "estimatedTimeSavedMinutes": personal_agent.get(
                    "estimated_time_saved_minutes"
                ),
                "icon": personal_agent.get("icon"),
                "iconImage": personal_agent.get("icon_image"),
                "requiredIntegrations": personal_agent.get("required_integrations", []),
                "toolsConfig": personal_agent.get("tools_config"),
                "referenceFiles": personal_agent.get("reference_files"),
                "sourceAgentId": personal_agent.get("source_agent_id") or agent_id,
            },
            user_sub,
            now,
            new_id,
        )

        dynamo = _get_dynamo_resource()
        table = dynamo.Table(USER_AGENTS_TABLE)
        table.put_item(Item=new_item)

        logger.info(
            "Duplicated personal agent",
            source_agent_id=agent_id,
            new_agent_id=new_id,
            user_sub=user_sub[:8] + "...",
        )
        return {"agent": _map_user_agent(new_item)}

    # Check workspace agent
    workspace_agent = _get_workspace_agent(agent_id)
    if workspace_agent:
        # Duplicate workspace agent to personal
        duplicate_title = _generate_duplicate_title(
            workspace_agent.get("title"), existing_agents
        )
        now = int(time.time() * 1000)
        new_id = _generate_agent_id()

        # Mark reference files as coming from workspace
        reference_files = _normalise_reference_files(
            workspace_agent.get("reference_files")
        )
        for ref_file in reference_files:
            if not ref_file.get("source"):
                ref_file["source"] = "workspace"

        new_item = _build_user_item(
            {
                "title": duplicate_title,
                "systemPrompt": workspace_agent.get("system_prompt"),
                "visibility": "personal",
                "description": workspace_agent.get("description"),
                "agentType": workspace_agent.get("agent_type"),
                "userWelcomeMessage": workspace_agent.get("user_instructions"),
                "estimatedTimeSavedMinutes": workspace_agent.get(
                    "estimated_time_saved_minutes"
                ),
                "icon": workspace_agent.get("icon"),
                "iconImage": workspace_agent.get("icon_image"),
                "requiredIntegrations": workspace_agent.get(
                    "required_integrations", []
                ),
                "toolsConfig": workspace_agent.get("tools_config"),
                "referenceFiles": reference_files,
                "sourceAgentId": agent_id,
            },
            user_sub,
            now,
            new_id,
        )

        dynamo = _get_dynamo_resource()
        table = dynamo.Table(USER_AGENTS_TABLE)
        table.put_item(Item=new_item)

        logger.info(
            "Duplicated workspace agent",
            source_agent_id=agent_id,
            new_agent_id=new_id,
            user_sub=user_sub[:8] + "...",
        )
        return {"agent": _map_user_agent(new_item)}

    raise ValueError(f"Agent not found: {agent_id}")
