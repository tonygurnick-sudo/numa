"""
Create agent tool implementation for Numa Chat Agent.

Provides a guarded tool that can write personal or workspace agents directly
to DynamoDB after confirming the user explicitly requested agent creation.
"""

from __future__ import annotations

import mimetypes
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import boto3
import structlog
from botocore.exceptions import ClientError
from strands import tool

from bedrock import BedrockClaude3Model  # type: ignore

from ..auth import get_current_user_auth

# No direct runtime client calls; we use BedrockClaude3Model wrapper
from ..dynamodb_utils import NumaChatDynamoUtils

logger = structlog.get_logger()

# ── Environment ----------------------------------------------------------------

CLIENT_NAME = os.environ.get("CLIENT_NAME")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME") or os.environ.get("BUCKET")
WORKSPACE_AGENTS_TABLE = os.environ.get("WORKSPACE_AGENTS_TABLE")
USER_AGENTS_TABLE = os.environ.get("USER_AGENTS_TABLE")
AGENTS_SETTINGS_TABLE = os.environ.get("AGENTS_SETTINGS_TABLE_NAME")

if not CLIENT_NAME:
    logger.warning("CLIENT_NAME environment variable not set for agent creation tool")


# ── Data containers ------------------------------------------------------------


@dataclass
class AgentToolsConfig:
    auto_tools_enabled: bool = True
    query_data_sources: bool = False
    web_search_enabled: bool = False
    create_agent_enabled: bool = False
    enabled_connections: Optional[List[str]] = None
    # Multi-KB support: None = all KBs, [] = no KB access, list = specific KBs
    allowed_knowledge_bases: Optional[List[str]] = None

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "AgentToolsConfig":
        payload = payload or {}
        # Handle allowedKnowledgeBases: preserve null vs undefined vs array
        allowed_kbs_raw = payload.get("allowedKnowledgeBases")
        allowed_kbs: Optional[List[str]] = None
        if allowed_kbs_raw is None and "allowedKnowledgeBases" in payload:
            # Explicitly set to null in payload
            allowed_kbs = None
        elif isinstance(allowed_kbs_raw, list):
            allowed_kbs = list(allowed_kbs_raw)
        # else: undefined, leave as None (backwards compat - means all KBs)

        return cls(
            auto_tools_enabled=bool(payload.get("autoToolsEnabled", True)),
            query_data_sources=bool(payload.get("queryDataSources", False)),
            web_search_enabled=bool(payload.get("webSearchEnabled", False)),
            create_agent_enabled=bool(payload.get("createAgentEnabled", False)),
            enabled_connections=list(payload.get("enabledConnections") or []),
            allowed_knowledge_bases=allowed_kbs,
        )

    def to_item(self) -> Dict[str, Any]:
        item: Dict[str, Any] = {
            "autoToolsEnabled": self.auto_tools_enabled,
            "queryDataSources": self.query_data_sources,
            "webSearchEnabled": self.web_search_enabled,
        }
        if self.enabled_connections:
            item["enabledConnections"] = self.enabled_connections
        if self.create_agent_enabled:
            item["createAgentEnabled"] = True
        # Always include allowedKnowledgeBases if set (including empty array)
        if self.allowed_knowledge_bases is not None:
            item["allowedKnowledgeBases"] = self.allowed_knowledge_bases
        return item


@dataclass
class AgentPayload:
    title: str
    system_prompt: str
    visibility: str = "personal"
    description: Optional[str] = None
    user_welcome_message: Optional[str] = None
    estimated_time_saved_minutes: Optional[int] = None
    agent_type: str = "task"
    required_integrations: Optional[List[str]] = None
    tools_config: AgentToolsConfig = field(default_factory=AgentToolsConfig)
    reference_files: Optional[List[Dict[str, Any]]] = None
    created_by_name: Optional[str] = None

    @classmethod
    def from_kwargs(cls, kwargs: Dict[str, Any]) -> "AgentPayload":
        if "title" not in kwargs or not str(kwargs["title"]).strip():
            raise ValueError("`title` is required")
        if "system_prompt" not in kwargs or not str(kwargs["system_prompt"]).strip():
            raise ValueError("`system_prompt` is required")

        tools_config = AgentToolsConfig.from_payload(
            kwargs.get("tools_config") or kwargs.get("toolsConfig") or {}
        )

        reference_files = kwargs.get("reference_files") or kwargs.get("referenceFiles")
        if reference_files is not None and not isinstance(reference_files, list):
            raise ValueError("`reference_files` must be a list when provided")

        return cls(
            title=str(kwargs["title"]).strip(),
            system_prompt=str(kwargs["system_prompt"]).strip(),
            visibility=str(kwargs.get("visibility", "personal")).strip() or "personal",
            description=_clean_optional_text(kwargs.get("description")),
            user_welcome_message=_clean_optional_text(
                kwargs.get("user_welcome_message") or kwargs.get("userWelcomeMessage")
            ),
            estimated_time_saved_minutes=_clean_optional_int(
                kwargs.get("estimated_time_saved_minutes")
                or kwargs.get("estimatedTimeSavedMinutes")
            ),
            agent_type=str(
                kwargs.get("agent_type") or kwargs.get("agentType") or "task"
            ).strip()
            or "task",
            required_integrations=_clean_string_list(
                kwargs.get("required_integrations")
                or kwargs.get("requiredIntegrations")
            ),
            tools_config=tools_config,
            reference_files=reference_files,
            created_by_name=_clean_optional_text(
                kwargs.get("created_by_name") or kwargs.get("createdByName")
            ),
        )


# ── Helpers --------------------------------------------------------------------


def _clean_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clean_optional_int(value: Any) -> Optional[int]:
    if value in (None, "", "null"):
        return None
    try:
        number = int(value)
        return max(number, 0)
    except (TypeError, ValueError):
        return None


def _clean_string_list(value: Any) -> Optional[List[str]]:
    if not value:
        return None
    if not isinstance(value, (list, tuple, set)):
        raise ValueError("Expected list for required_integrations")
    cleaned = [str(item).strip() for item in value if str(item).strip()]
    return cleaned or None


def _generate_agent_id() -> str:
    return f"agt_{uuid.uuid4().hex}"


def _build_guardrail_prompt(context_snippets: str, latest_user_message: str) -> str:
    return f"""You are an expert at determining if the user explicitly asked to create an agent, or if Numa (the assistant) has created out of turn. You will be given the last few messages between the user and the AI assistant and it's your job to determine if the user was asking for the agent to be created or not. This is necessary to avoid the AI assistant from creating agent unnecessarily.

        Return ONLY the word YES or NO. Respond YES only if the user clearly directs the assistant to create, set up, or has confirmed the creation of an agent the the assistant drafted. Otherwise, response NO. If the user says things like "Yes" after being drafted an agent, response YES. Or if you can see in the conversation them saying clearly to the assistant to create an agent based on what the assistant has drafted, return yes.

        Conversation excerpts:\n{context_snippets}

        Latest user message:\n{latest_user_message.strip()}

        Decision (YES or NO):"""


def _call_haiku_classifier(prompt: str) -> str:
    """
    Classify intent via BedrockClaude3Model with a forced tool output schema
    that returns an enum YES/NO for stronger output guarantees.
    """
    tool_name = "confirm_intent"
    tools_schema = [
        {
            "name": tool_name,
            "description": "Confirm if the user explicitly asked to create an agent",
            "input_schema": {
                "type": "object",
                "properties": {"answer": {"type": "string", "enum": ["YES", "NO"]}},
                "required": ["answer"],
            },
        }
    ]

    model = BedrockClaude3Model(
        enable_fallback=True,
        claude_only=True,
        model_args={
            "max_tokens": 100,
            "temperature": 0,
            "tools": tools_schema,
            "tool_choice": {"type": "tool", "name": tool_name},
        },
    )
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
    try:
        result = model.run_with_messages(
            messages, name_for_logging="agent_creation_intent"
        )
        for item in result.response:
            if (
                isinstance(item, dict)
                and item.get("type") == "tool_use"
                and item.get("name") == tool_name
            ):
                data = item.get("input") or {}
                ans = str(data.get("answer", "")).strip().upper()
                if ans in ("YES", "NO"):
                    return ans

        for item in result.response:
            if isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text") or "").strip().upper()
                if text.startswith("YES"):
                    return "YES"
                if text.startswith("NO"):
                    return "NO"

    except Exception as e:  # defensive fallback
        logger.warning("Classifier call failed, falling back to NO", error=str(e))

    return "NO"


def _get_recent_conversation_snippets(
    conversation_id: str, user_id: str, max_items: int = 12
) -> Tuple[str, str, List[Dict[str, Any]]]:
    dynamo_utils = NumaChatDynamoUtils()
    items = dynamo_utils.query_conversations(
        conversation_id, limit=max(50, max_items), user_id=user_id
    )

    if not items:
        return "", "", []

    # Build a lightweight transcript that excludes tool plumbing
    # and focuses on natural user/assistant text turns.
    allow_message_types = {"text", "file", "image_description", "meta"}

    latest_user_text = ""
    filtered_snippets: List[Tuple[str, str]] = []

    for item in items[-max_items:]:
        message_type = item.get("message_type") or "text"
        role = item.get("role") or "system"

        # Skip tool plumbing to avoid confusing the classifier
        if message_type not in allow_message_types:
            continue

        # Normalise content
        content = (item.get("content") or "").strip()
        if message_type == "file" and item.get("fileInfo"):
            content = f"[Uploaded file: {item['fileInfo'].get('fileName', 'unknown')}]"
        if not content:
            continue

        # Keep only user/assistant roles for context
        if role not in ("user", "assistant"):
            continue

        filtered_snippets.append((role, content))
        if role == "user" and message_type == "text":
            latest_user_text = content

    # If we didn't find a user text message in the last window, search older ones
    if not latest_user_text:
        for item in reversed(items):
            if (
                (item.get("role") == "user")
                and (item.get("message_type") == "text")
                and str(item.get("content") or "").strip()
            ):
                latest_user_text = str(item.get("content") or "").strip()
                break

    # Keep the last ~8 conversational snippets for the guardrail prompt
    transcript = "\n".join(f"{role}: {text}" for role, text in filtered_snippets[-8:])
    return transcript, latest_user_text, items


def _check_policy_allows_visibility(visibility: str) -> Tuple[str, Optional[str]]:
    if not AGENTS_SETTINGS_TABLE:
        return visibility, None

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(AGENTS_SETTINGS_TABLE)

    try:
        response = table.get_item(Key={"setting": "policy"})
    except ClientError as error:
        logger.warning("Failed to read agents policy", error=str(error))
        return visibility, None

    item = response.get("Item") or {}
    mode = item.get("mode", "full")

    if mode == "off":
        return "denied", "Agent creation is currently disabled by your administrator."
    if mode == "personal_only" and visibility == "public":
        return "personal", "Agent creation limited to personal scope in this workspace."

    return visibility, None


def _normalise_reference_files(
    reference_specs: Optional[List[Dict[str, Any]]],
    conversation_items: List[Dict[str, Any]],
    agent_id: str,
    user_id: str,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Locate referenced files in the conversation history and copy them into
    the agent's dedicated prefix.
    """
    if not reference_specs:
        return [], []

    if not OUTPUTS_BUCKET:
        raise ValueError(
            "Outputs bucket is not configured; cannot copy reference files."
        )

    def _parse_s3_uri(uri: str) -> Tuple[Optional[str], str]:
        if not isinstance(uri, str):
            return None, uri
        if uri.startswith("s3://"):
            try:
                without = uri[5:]
                bucket, key = without.split("/", 1)
                return bucket, key
            except Exception:
                return None, uri
        return None, uri

    def _normalize_key(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        _, key = _parse_s3_uri(value)
        return key

    def _maybe_original_from_json(key: Optional[str]) -> Optional[str]:
        if not key:
            return None
        return key[:-5] if key.endswith(".json") else None

    def _infer_mime(
        file_name: Optional[str], fallback_key: Optional[str]
    ) -> Optional[str]:
        name = file_name or (fallback_key or "").split("/")[-1]
        if not name:
            return None
        base = name[:-5] if name.endswith(".json") else name
        mime, _ = mimetypes.guess_type(base)
        return mime

    file_messages = [
        item
        for item in conversation_items
        if item.get("message_type") == "file" and isinstance(item.get("fileInfo"), dict)
    ]
    name_index = {
        msg["fileInfo"].get("fileName"): msg["fileInfo"] for msg in file_messages
    }
    key_index: Dict[Optional[str], Dict[str, Any]] = {}
    extracted_index: Dict[Optional[str], Dict[str, Any]] = {}
    for msg in file_messages:
        fi = msg.get("fileInfo", {})
        k_norm = _normalize_key(fi.get("s3Key"))
        ek_norm = _normalize_key(fi.get("extractedContentS3Key"))
        if k_norm and k_norm not in key_index:
            key_index[k_norm] = fi
        if ek_norm and ek_norm not in extracted_index:
            extracted_index[ek_norm] = fi

    s3_client = boto3.client("s3")
    attached_files: List[Dict[str, Any]] = []
    warnings: List[str] = []

    for spec in reference_specs[:5]:
        if isinstance(spec, str):
            candidate = name_index.get(spec)
            if not candidate:
                k_norm = _normalize_key(spec)
                candidate = key_index.get(k_norm) or extracted_index.get(k_norm)
        else:
            name = spec.get("fileName") or spec.get("name")
            s3_key_spec = spec.get("s3Key")
            candidate = name_index.get(name) if name else None
            if not candidate and s3_key_spec:
                k_norm = _normalize_key(s3_key_spec)
                candidate = key_index.get(k_norm) or extracted_index.get(k_norm)

        parsed_bucket = None
        parsed_key = None
        if not candidate and isinstance(spec, dict):
            s3k = spec.get("s3Key")
            if isinstance(s3k, str):
                parsed_bucket, parsed_key = _parse_s3_uri(s3k)
                if (parsed_key or "").endswith(".json"):
                    orig_key = _maybe_original_from_json(parsed_key)
                    if orig_key:
                        candidate = {
                            "fileName": spec.get("fileName")
                            or os.path.basename(orig_key),
                            "fileType": spec.get("fileType")
                            or _infer_mime(spec.get("fileName"), orig_key),
                            "s3Bucket": parsed_bucket or OUTPUTS_BUCKET,
                            "s3Key": orig_key,
                            "extractedContentS3Key": parsed_key,
                        }

        if not candidate:
            warnings.append(f"Reference file not found in recent uploads: {spec}")
            continue

        source_bucket = candidate.get("s3Bucket") or parsed_bucket or OUTPUTS_BUCKET
        source_key = _normalize_key(candidate.get("s3Key"))
        extracted_key = _normalize_key(candidate.get("extractedContentS3Key"))

        if (source_key or "").endswith(".json") and not extracted_key:
            extracted_key = source_key
            source_key = _maybe_original_from_json(source_key)
        if not source_key:
            warnings.append(
                f"Missing S3 key for file: {candidate.get('fileName', 'unknown')}"
            )
            continue

        basename = os.path.basename(source_key)
        timestamp = int(time.time() * 1000)
        dest_prefix = f"numa-chat/agents/{user_id}/{agent_id}"
        dest_key = f"{dest_prefix}/{timestamp}_{basename}"

        copied_binary = False
        try:
            if source_key:
                s3_client.copy_object(
                    Bucket=OUTPUTS_BUCKET,
                    Key=dest_key,
                    CopySource={"Bucket": source_bucket, "Key": source_key},
                )
                copied_binary = True
        except ClientError as error:
            logger.warning(
                "Failed to copy reference file", source=source_key, error=str(error)
            )

        new_entry: Dict[str, Any] = {
            "fileName": candidate.get("fileName") or basename,
            "fileType": candidate.get("fileType")
            or _infer_mime(candidate.get("fileName"), source_key)
            or _infer_mime(candidate.get("fileName"), extracted_key),
            "fileSize": candidate.get("fileSize"),
            "s3Bucket": OUTPUTS_BUCKET,
            **({"s3Key": dest_key} if copied_binary else {}),
            "uploadedAt": candidate.get("uploadedAt")
            or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "conversation",
        }

        if extracted_key:
            dest_extracted_key = f"{dest_prefix}/{os.path.basename(extracted_key)}"
            try:
                s3_client.copy_object(
                    Bucket=OUTPUTS_BUCKET,
                    Key=dest_extracted_key,
                    CopySource={"Bucket": source_bucket, "Key": extracted_key},
                )
                new_entry["extractedContentS3Key"] = dest_extracted_key
            except ClientError as error:
                logger.warning(
                    "Failed to copy extracted content file",
                    source=extracted_key,
                    error=str(error),
                )

        attached_files.append(new_entry)

    return attached_files, warnings


def _put_user_agent(
    dynamodb, payload: AgentPayload, user_id: str, agent_id: str, now_ms: int
) -> Dict[str, Any]:
    if dynamodb is None:
        dynamodb = boto3.resource("dynamodb")
    if not USER_AGENTS_TABLE:
        raise RuntimeError("USER_AGENTS_TABLE environment variable is not set")
    table = dynamodb.Table(USER_AGENTS_TABLE)
    item = {
        "tenant_id": CLIENT_NAME,
        "user_id": user_id,
        "agent_id": agent_id,
        "visibility": "personal",
        "agent_type": payload.agent_type,
        "title": payload.title,
        "description": payload.description,
        "system_prompt": payload.system_prompt,
        "user_instructions": payload.user_welcome_message,
        "estimated_time_saved_minutes": payload.estimated_time_saved_minutes,
        "is_favorite": False,
        "icon": None,
        "icon_image": None,
        "required_integrations": payload.required_integrations,
        "tools_config": payload.tools_config.to_item(),
        "reference_files": payload.reference_files or [],
        "created_by_user_id": user_id,
        "created_by_name": payload.created_by_name,
        "created_at": now_ms,
        "updated_at": now_ms,
        "version": now_ms,
    }
    table.put_item(Item=_remove_none(item))
    return item


def _put_workspace_agent(
    dynamodb, payload: AgentPayload, user_id: str, agent_id: str, now_ms: int
) -> Dict[str, Any]:
    if dynamodb is None:
        dynamodb = boto3.resource("dynamodb")
    if not WORKSPACE_AGENTS_TABLE:
        raise RuntimeError("WORKSPACE_AGENTS_TABLE environment variable is not set")
    table = dynamodb.Table(WORKSPACE_AGENTS_TABLE)
    item = {
        "tenant_id": CLIENT_NAME,
        "agent_id": agent_id,
        "visibility": "public",
        "agent_type": payload.agent_type,
        "title": payload.title,
        "description": payload.description,
        "system_prompt": payload.system_prompt,
        "user_instructions": payload.user_welcome_message,
        "estimated_time_saved_minutes": payload.estimated_time_saved_minutes,
        "is_favorite": False,
        "icon": None,
        "icon_image": None,
        "required_integrations": payload.required_integrations,
        "tools_config": payload.tools_config.to_item(),
        "reference_files": payload.reference_files or [],
        "created_by_user_id": user_id,
        "created_by_name": payload.created_by_name,
        "created_at": now_ms,
        "updated_at": now_ms,
        "version": now_ms,
    }
    table.put_item(Item=_remove_none(item))
    return item


def _remove_none(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in item.items() if v is not None}


def _assert_env_ready():
    missing = []
    if not CLIENT_NAME:
        missing.append("CLIENT_NAME")
    if not USER_AGENTS_TABLE:
        missing.append("USER_AGENTS_TABLE")
    if not OUTPUTS_BUCKET:
        missing.append("OUTPUTS_BUCKET_NAME")
    if missing:
        raise RuntimeError(
            f"Agent creation tool is misconfigured. Missing env vars: {', '.join(missing)}"
        )


# ── Tool implementation --------------------------------------------------------


@tool
def create_agent_tool(**kwargs):
    """
    Create a new agent in your workspace or personal library.

    Provide structured parameters such as:
    {
        "title": "Customer Service Agent",
        "system_prompt": "Always respond in a friendly tone...",
        "visibility": "personal" | "public",
        "description": "...",
        "user_welcome_message": "...",
        "estimated_time_saved_minutes": 15,
        "agent_type": "task",
        "required_integrations": ["slack"],
        "tools_config": {
            "autoToolsEnabled": true,
            "queryDataSources": true,
            "webSearchEnabled": false,
            "createAgentEnabled": false,
            "enabledConnections": ["slack"]
        },
        "reference_files": [
            {"fileName": "support_playbook.pdf"}
        ]
    }

    The tool first verifies the user explicitly requested this action.
    Returns a success summary or a warning message if creation was skipped.
    """
    # Check user context first so unit tests that don't set env vars
    # can still validate guard behavior without raising.
    user_auth = get_current_user_auth() or {}
    user_id = user_auth.get("sub")
    conversation_id = user_auth.get("conversation_id") or user_auth.get(
        "conversationId"
    )

    if not user_id:
        return {
            "status": "error",
            "message": "Missing user context; cannot create agent.",
        }

    # Environment is only required once we proceed with creation
    # (after confirming user intent and having user context).
    payload = AgentPayload.from_kwargs(kwargs or {})

    if payload.tools_config.create_agent_enabled is False:
        logger.info(
            "create_agent_tool invoked while tool disabled in agent config",
            user_id=user_id,
        )

    visibility, policy_message = _check_policy_allows_visibility(payload.visibility)
    if visibility == "denied":
        return {
            "status": "denied",
            "message": policy_message or "Agent creation is disabled.",
        }
    payload.visibility = visibility

    if conversation_id:
        transcript, latest_user_message, history_items = (
            _get_recent_conversation_snippets(conversation_id, user_id, max_items=24)
        )
    else:
        transcript, latest_user_message, history_items = "", "", []

    # Explicit confirmation guard: require clear user intent to create an agent
    try:
        guard_prompt = _build_guardrail_prompt(transcript, latest_user_message)
        decision = _call_haiku_classifier(guard_prompt)
        logger.info(
            "Agent creation intent classification",
            decision=decision,
            has_latest_user_message=bool(latest_user_message),
            prompt=guard_prompt,
        )
    except Exception as e:  # defensive fallback
        logger.warning("Intent guard failed; defaulting to NO", error=str(e))
        decision = "NO"

    if decision != "YES":
        return {
            "status": "denied",
            "message": (
                "I won't create the agent without your explicit confirmation. "
                "Please say something like 'Yes, create this agent' when you're ready."
            ),
        }

    # Ensure required environment is configured before persisting
    _assert_env_ready()

    # Prepare Dynamo writes (pass None so tests that mock boto3 don't break)
    dynamodb = None
    now_ms = int(time.time() * 1000)
    agent_id = _generate_agent_id()

    # Attach reference files if any
    attached_files, warnings = _normalise_reference_files(
        payload.reference_files, history_items, agent_id, user_id
    )
    if attached_files:
        payload.reference_files = attached_files

    # Write to appropriate table(s)
    if payload.visibility == "personal":
        item = _put_user_agent(dynamodb, payload, user_id, agent_id, now_ms)
    else:
        item = _put_workspace_agent(dynamodb, payload, user_id, agent_id, now_ms)

    # Ensure visibility is present in response item even if storage layer is mocked
    if isinstance(item, dict) and "visibility" not in item:
        item["visibility"] = payload.visibility

    result = {
        "status": "success",
        "message": "Agent created successfully",
        "agent": item,
    }
    if warnings:
        result["warnings"] = warnings
    return result
