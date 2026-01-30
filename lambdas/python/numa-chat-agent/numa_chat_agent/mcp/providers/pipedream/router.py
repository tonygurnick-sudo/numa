"""
Tools-only Pipedream integration router (no full-config meta flow).

Exposes a single Strands tool per integration. The tool accepts:
- tool: exact action name to call (as exposed by MCP list_tools)
- instruction: natural language instruction for building the JSON payload

The router:
- Loads an integration prompt (base + optional integration snippet)
- Uses Bedrock Claude to construct a payload matching the tool's JSON schema
- Validates the payload against the JSON schema
- Calls the MCP tool directly (no BEGIN/CONFIGURE/FINISH)
"""

# pylint: disable=too-many-nested-blocks, useless-return

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional

import structlog
from jsonschema import Draft7Validator  # type: ignore[import-untyped,unused-ignore]

from ....auth import get_current_user_auth
from ....intent_verification import (
    IntentVerificationConfig,
    get_delete_config,
    get_reply_config,
    get_send_config,
    verify_user_intent,
)
from ...postprocessing import postprocess_tool_result

try:
    from strands import tool as _strands_tool  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    _strands_tool = None  # type: ignore[assignment]

# Expose a consistently-typed symbol for use below
if TYPE_CHECKING:  # pragma: no cover - static typing only
    from typing import Callable as _ToolCallable

    strands_tool: Optional[_ToolCallable] = None
else:
    strands_tool = _strands_tool  # type: ignore[assignment]

try:
    from bedrock import BedrockClaude3Model  # type: ignore
except ImportError:  # pragma: no cover
    BedrockClaude3Model = None  # type: ignore

logger = structlog.get_logger(__name__)

# ── Material Tool Verification Configuration ──────────────────────────────────

MATERIAL_TOOL_VERIFICATION_ENABLED = (
    os.getenv("MATERIAL_TOOL_VERIFICATION_ENABLED", "true").lower() == "true"
)

if not MATERIAL_TOOL_VERIFICATION_ENABLED:
    logger.error(
        "SECURITY_RISK: Material tool verification DISABLED via environment variable",
        env_setting="MATERIAL_TOOL_VERIFICATION_ENABLED=false",
        security_impact="Critical verification can be bypassed",
    )

MATERIAL_TOOL_PATTERNS = ["send", "reply", "delete"]


def _is_material_tool(tool_name: str) -> bool:
    """Check if tool name indicates a material action requiring verification.

    Material tools are those that have significant side effects like sending
    messages, replying to threads, or deleting data. These require explicit
    user confirmation before execution.

    Args:
        tool_name: The name of the tool to check.

    Returns:
        True if the tool matches a material pattern and verification is enabled.
    """
    if not MATERIAL_TOOL_VERIFICATION_ENABLED:
        return False
    name_lower = tool_name.lower()
    return any(pattern in name_lower for pattern in MATERIAL_TOOL_PATTERNS)


def _get_material_tool_config(tool_name: str) -> IntentVerificationConfig:
    """Get the appropriate intent verification config for a material tool.

    Args:
        tool_name: The name of the tool.

    Returns:
        IntentVerificationConfig with appropriate action type and messages.
    """
    name_lower = tool_name.lower()

    if "delete" in name_lower:
        return get_delete_config(tool_name)
    elif "reply" in name_lower:
        return get_reply_config(tool_name)
    else:
        # Default to send for any other matching pattern
        return get_send_config(tool_name)


# ── Prompt Configuration ──────────────────────────────────────────────────────

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
BASE_PROMPT_FILE = PROMPTS_DIR / "base_prompt.md"
PROMPT_SUFFIX = ".md"


def _safe_read_text(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8").strip()
        logger.info(
            "PROMPT_FILE_LOADED: Successfully loaded prompt file",
            path=str(path),
            content_length=len(content),
            has_content=bool(content),
        )
        return content
    except FileNotFoundError:
        logger.error(
            (
                "PROMPT_FILE_MISSING: Integration prompt file not found - "
                "integration will use base prompt only"
            ),
            path=str(path),
            filename=path.name,
            directory=str(path.parent),
            impact="Integration-specific guidance will be missing from AI prompts",
        )
        return ""
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error(
            (
                "PROMPT_FILE_ERROR: Failed to read integration prompt file - "
                "integration will use base prompt only"
            ),
            path=str(path),
            filename=path.name,
            error_type=type(exc).__name__,
            error=str(exc),
            impact="Integration-specific guidance will be missing from AI prompts",
        )
        return ""


def normalise_integration_name(raw_app_name: str) -> str:
    return raw_app_name.replace("-", "_").replace(" ", "_").lower()


@dataclass
class PipedreamToolDefinition:
    name: str
    description: str
    schema: Dict[str, Any]
    annotations: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mcp_payload(cls, payload: Dict[str, Any]) -> "PipedreamToolDefinition":
        return cls(
            name=payload.get("name") or "",
            description=payload.get("description") or "",
            schema=payload.get("inputSchema") or {},
            annotations=payload.get("annotations") or {},
        )


def _build_local_time_context() -> str:
    """Render a concise local time context string from current user auth.

    Expected keys under user_auth["timeInfo"]:
    - date, time, timezone, dayOfWeek (optional)
    Falls back gracefully if not provided.
    """
    try:
        ua = get_current_user_auth() or {}
        ti = (ua.get("timeInfo") or {}) if isinstance(ua, dict) else {}
        if not isinstance(ti, dict):
            return "not provided"
        date = str(ti.get("date") or "").strip()
        time_str = str(ti.get("time") or "").strip()
        tz = str(ti.get("timezone") or "").strip()
        day_of_week = str(ti.get("dayOfWeek") or "").strip()

        # Format: "Local date: {dayOfWeek}, {date}, Local time: {time} ({timezone})"
        if day_of_week and date and time_str and tz:
            return f"Local date: {day_of_week}, {date}, Local time: {time_str} ({tz})"

        # Fallback to partial info if not all fields available
        pieces = []
        if day_of_week and date:
            pieces.append(f"Local date: {day_of_week}, {date}")
        elif date:
            pieces.append(f"Local date: {date}")
        if time_str:
            pieces.append(f"Local time: {time_str}")
        if tz:
            pieces.append(f"Timezone: {tz}")
        if pieces:
            return ", ".join(pieces)
        return "not provided"
    except Exception:
        return "not provided"


def _get_user_timezone() -> Optional[str]:
    """Extract the user's timezone from the current user auth context.

    Returns the timezone string (e.g., "Australia/Brisbane") if available,
    otherwise None.
    """
    try:
        ua = get_current_user_auth() or {}
        ti = (ua.get("timeInfo") or {}) if isinstance(ua, dict) else {}
        if isinstance(ti, dict):
            tz = str(ti.get("timezone") or "").strip()
            if tz:
                return tz
        return None
    except Exception:
        return None


def _append_timezone_guidance(instruction: str) -> str:
    """Append timezone-aware guidance to the instruction string.

    This ensures the sub-agent always considers the user's timezone when handling
    time-sensitive data, even if Numa forgets to include timezone information in
    the original instruction.

    Args:
        instruction: The original instruction string from Numa

    Returns:
        The instruction with timezone guidance appended (if timezone is available)
    """
    timezone = _get_user_timezone()
    if not timezone:
        return instruction

    guidance = (
        f"\n\nIMPORTANT: All dates in instructions use DD/MM/YYYY format (day/month/year). "
        f"If this tool involves timestamps, dates, or time-sensitive data, "
        f"use the user's local timezone ({timezone}) in the request if applicable or for display "
        f"and convert any UTC timestamps to {timezone} format."
    )

    return instruction + guidance


def load_prompt_for_integration(integration_namespace: str) -> str:
    base_template = _safe_read_text(BASE_PROMPT_FILE)
    integration_prompt = _safe_read_text(
        PROMPTS_DIR / f"{integration_namespace}{PROMPT_SUFFIX}"
    )

    if not base_template.strip():
        base_template = (
            "You are generating JSON parameters for a Pipedream action on behalf of Numa.\n\n"
            "Guidelines:\n\n"
            "- Only use fields defined in the provided schema and follow their types.\n"
            "- Honour any pre-filled constraints.\n"
            "- Return strictly valid JSON with no extra prose.\n\n"
            "{INTEGRATION_GUIDANCE}\n\n"
            "---\n\n"
            "Action context:\n"
            "- Integration: {INTEGRATION_NAME}\n"
            "- Action: {ACTION_NAME}\n\n"
            "Action description:\n{ACTION_DESCRIPTION}\n\n"
            "JSON schema:\n```json\n{SCHEMA_JSON}\n```\n\n"
            "User instruction:\n{INSTRUCTION}\n\n"
            "Include any specific field constraints provided in the instruction or context. Honour pre-filled values and preserve required identifiers.\n\n"
            "{FEEDBACK_SECTION}\n\n"
            "Return only the JSON object matching the schema. Do not include explanations or code fences beyond the JSON block."
        )

    integration_section = ""
    if integration_prompt:
        integration_section = integration_prompt.replace("{", "{{").replace("}", "}}")
    # Inject local time context placeholder if present
    base_template = base_template.replace("{INTEGRATION_GUIDANCE}", integration_section)
    local_time_context = _build_local_time_context()
    base_template = base_template.replace("{LOCAL_TIME_CONTEXT}", local_time_context)
    return base_template


def _truncate_text(value: str, limit: int = 400) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _sorted_keys(mapping: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(mapping, dict):
        return []
    return sorted(mapping.keys())


def _json_default_serializer(obj: Any) -> Any:
    """Default handler that makes complex objects JSON serializable."""
    if hasattr(obj, "__dict__"):
        return {
            key: value for key, value in obj.__dict__.items() if not key.startswith("_")
        }
    return str(obj)


def _normalise_json_dict(value: Any) -> Dict[str, Any]:
    """
    Convert a JSON-like object (pydantic model, attr class, etc.) into a dictionary.
    """
    if value is None:
        return {}
    if isinstance(value, dict):
        return value

    for attr in ("model_dump", "dict"):
        method = getattr(value, attr, None)
        if callable(method):
            try:
                result = method()
                if isinstance(result, dict):
                    return result
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.debug(
                    "Failed to normalise JSON via %s",
                    attr,
                    error=str(exc),
                    value_type=type(value).__name__,
                )

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}

    try:
        serialised = json.loads(json.dumps(value, default=_json_default_serializer))
        if isinstance(serialised, dict):
            return serialised
    except (TypeError, ValueError):
        pass

    return {}


def _extract_input_schema(raw_schema: Any) -> Dict[str, Any]:
    """Flatten schema payloads that wrap the JSON under ``json`` keys."""
    schema_dict = _normalise_json_dict(raw_schema)
    if not schema_dict:
        return {}

    if "json" in schema_dict and isinstance(schema_dict["json"], dict):
        return schema_dict["json"]

    return schema_dict


class ToolsOnlyIntegrationRouter:
    def __init__(
        self,
        integration_name: str,
        mcp_client: Any,
        tool_definitions: Iterable[PipedreamToolDefinition],
        model_id: str,
        external_user_id: Optional[str],
        requires_backup: Optional[Dict[str, bool]] = None,
        static_backup: Optional[Dict[str, bool]] = None,
        backup_client: Optional[Any] = None,
    ) -> None:
        self.integration_name = integration_name
        self.integration_namespace = normalise_integration_name(integration_name)
        self._mcp_client = mcp_client
        self._definitions: Dict[str, PipedreamToolDefinition] = {
            d.name: d for d in tool_definitions if d and d.name
        }
        default_requires_backup = {name: False for name in self._definitions}
        if requires_backup:
            default_requires_backup.update(requires_backup)
        self._requires_backup = default_requires_backup
        self._model_id = model_id
        self._external_user_id = external_user_id
        self._prompt_cache: Optional[str] = None
        self._llm: Optional[Any] = None
        self._validator_cache: Dict[str, Optional[Draft7Validator]] = {}
        self._static_backup_map: Dict[str, bool] = dict(static_backup or {})

        logger.warning(
            "RELIABILITY_RISK: Initializing unbounded caches - potential memory leak with high tool usage",
            integration=self.integration_name,
            cache_types=["_prompt_cache", "_validator_cache"],
            reliability_concerns=[
                "unbounded_cache_growth",
                "no_memory_pressure_detection",
                "potential_out_of_memory_errors",
                "no_cache_eviction_policy",
            ],
            memory_risk_factors=[
                "high_integration_usage",
                "many_unique_tool_definitions",
                "long_running_lambda_instances",
                "no_cache_size_limits",
            ],
        )

        # RELIABILITY IMPROVEMENT NEEDED: Implement bounded caches with LRU eviction
        # RATIONALE: The current implementation uses unbounded caches for prompts and validators
        # that can grow indefinitely with high usage or many different tool definitions. In
        # long-running Lambda instances or high-traffic scenarios, this can cause memory pressure
        # and eventually out-of-memory errors, leading to intermittent Lambda crashes.
        # CONSEQUENCE OF NOT FIXING: The system will experience:
        # - Memory leaks in high-usage scenarios or long-running Lambda instances
        # - Intermittent Lambda crashes due to out-of-memory conditions
        # - Performance degradation as memory usage grows over time
        # - Unpredictable failures that seem random but correlate with memory pressure
        # CONSEQUENCE OF FIXING: With bounded caches, the system would have:
        # - Predictable memory usage regardless of traffic patterns
        # - Protection against out-of-memory crashes in high-usage scenarios
        # - Consistent performance over time without memory pressure degradation
        # - Better resource utilization with controlled memory footprint
        #
        # PROPOSED BOUNDED CACHE FIX:
        # from functools import lru_cache
        # from collections import OrderedDict
        # import threading
        #
        # class BoundedLRUCache:
        #     """Thread-safe bounded LRU cache with configurable size limits."""
        #     def __init__(self, max_size: int = 100):
        #         self.max_size = max_size
        #         self.cache = OrderedDict()
        #         self.lock = threading.Lock()
        #         self.hits = 0
        #         self.misses = 0
        #
        #     def get(self, key: str, default=None):
        #         with self.lock:
        #             if key in self.cache:
        #                 # Move to end (mark as recently used)
        #                 value = self.cache.pop(key)
        #                 self.cache[key] = value
        #                 self.hits += 1
        #                 return value
        #             else:
        #                 self.misses += 1
        #                 return default
        #
        #     def put(self, key: str, value):
        #         with self.lock:
        #             if key in self.cache:
        #                 # Update existing key
        #                 self.cache.pop(key)
        #             elif len(self.cache) >= self.max_size:
        #                 # Evict least recently used item
        #                 oldest_key, oldest_value = self.cache.popitem(last=False)
        #                 logger.debug(f"CACHE_EVICTION: Evicted LRU cache item", evicted_key=oldest_key)
        #
        #             self.cache[key] = value
        #
        #     def get_stats(self) -> dict:
        #         with self.lock:
        #             return {
        #                 "size": len(self.cache),
        #                 "max_size": self.max_size,
        #                 "hits": self.hits,
        #                 "misses": self.misses,
        #                 "hit_rate": self.hits / (self.hits + self.misses) if (self.hits + self.misses) > 0 else 0
        #             }
        #
        # # Replace unbounded dictionaries with bounded caches
        # VALIDATOR_CACHE_SIZE = 50  # Max 50 different tool validators
        # self._validator_cache = BoundedLRUCache(max_size=VALIDATOR_CACHE_SIZE)
        #
        # logger.info(
        #     "RELIABILITY_IMPROVEMENT: Initialized bounded LRU caches with eviction policy",
        #     integration=self.integration_name,
        #     validator_cache_max_size=VALIDATOR_CACHE_SIZE,
        #     memory_protection="ENABLED"
        # )
        # Prefer explicit backup client, else fallback to attribute on tools client
        self._backup_client: Any = backup_client or getattr(
            mcp_client, "_pipedream_backup_client", None
        )

    @property
    def prompt(self) -> str:
        if self._prompt_cache is None:
            self._prompt_cache = load_prompt_for_integration(self.integration_namespace)
            logger.info(
                "Loaded integration prompt",
                integration=self.integration_name,
                prompt_length=len(self._prompt_cache or ""),
            )
        return self._prompt_cache or ""

    def build_strands_tool(self) -> Any:
        if strands_tool is None:  # pragma: no cover
            raise RuntimeError("strands toolkit is not available")

        action_names = sorted(self._definitions.keys())
        if not action_names:
            raise ValueError(
                f"No executable Pipedream tools available for {self.integration_name}"
            )

        # Build a helpful description block that includes action names + descriptions
        # Keep it concise per-action and trim overall size defensively
        action_desc_lines: List[str] = []
        for name in action_names:
            desc = (self._definitions[name].description or "").strip()
            desc = _truncate_text(desc, 200) if desc else ""
            if desc:
                action_desc_lines.append(f"- {name}: {desc}")
            else:
                action_desc_lines.append(f"- {name}")

        actions_block = (
            "\nAvailable actions (name: description):\n" + "\n".join(action_desc_lines)
            if action_desc_lines
            else ""
        )

        tool_property: Dict[str, Any] = {
            "type": "string",
            "description": (
                "Exact name of the Pipedream action to execute." + actions_block
            ),
            "enum": action_names,
        }

        router = self

        @strands_tool(
            name=f"{self.integration_namespace}_integration",
            description=(
                f"Interact with {self.integration_name}. "
                "Provide the action name and a detailed instruction; the integration router constructs the JSON parameters and executes the action."
                + (
                    "\n\nAvailable actions (name: description):\n"
                    + "\n".join(action_desc_lines)
                    if action_desc_lines
                    else ""
                )
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "tool": tool_property,
                    "instruction": {
                        "type": "string",
                        "description": "Detailed instruction for the chosen action. These instructions are used by a sub-agent to build the JSON parameters for the action. Include anything you think is relevant.",
                    },
                    "full_payload": {
                        "type": "boolean",
                        "description": "Return the raw tool payload without post-processing. Use only if absolutely necessary (e.g., when the full payload is explicitly required), as responses can be extremely large and may degrade performance.",
                    },
                },
                "required": ["tool", "instruction"],
                "additionalProperties": False,
            },
        )
        def router_tool(
            tool: str,
            instruction: str,
            full_payload: Optional[bool] = False,
        ) -> Dict[str, Any]:
            return router.execute(tool, instruction, bool(full_payload))

        setattr(router_tool, "_router_integration", self.integration_name)
        setattr(router_tool, "_router_model_id", self._model_id)
        setattr(router_tool, "_router_available_tools", action_names)
        try:
            setattr(
                router_tool,
                "_router_action_descriptions",
                {
                    name: (self._definitions[name].description or "")
                    for name in action_names
                },
            )
        except Exception:
            # Best-effort metadata; continue without blocking tool creation
            pass
        return router_tool

    def _has_nested_objects(self, schema: Dict[str, Any]) -> bool:
        """Check if schema contains nested object properties."""
        properties = schema.get("properties", {}) if schema else {}
        if isinstance(properties, dict):
            for prop_def in properties.values():
                if isinstance(prop_def, dict) and prop_def.get("type") == "object":
                    return True
        return False

    def _has_arrays(self, schema: Dict[str, Any]) -> bool:
        """Check if schema contains array properties."""
        properties = schema.get("properties", {}) if schema else {}
        if isinstance(properties, dict):
            for prop_def in properties.values():
                if isinstance(prop_def, dict) and prop_def.get("type") == "array":
                    return True
        return False

    def execute(
        self,
        tool_name: str,
        instruction: str,
        full_payload: bool = False,
    ) -> Dict[str, Any]:
        execution_id = str(uuid.uuid4())[:8]
        execution_start = time.time()

        logger.info(
            "TOOL_EXECUTION_START: Beginning Pipedream tool execution",
            integration=self.integration_name,
            tool_name=tool_name,
            instruction_length=len(instruction),
            full_payload_requested=full_payload,
            execution_id=execution_id,
            external_user_id=(
                self._external_user_id[:8] + "..." if self._external_user_id else "None"
            ),
            available_tools=list(self._definitions.keys()),
        )

        logger.debug(
            "TOOL_EXECUTION_DETAILS: Full execution context",
            integration=self.integration_name,
            tool_name=tool_name,
            instruction_text=(
                instruction[:200] + "..." if len(instruction) > 200 else instruction
            ),
            model_id=self._model_id,
            has_backup_client=bool(self._backup_client),
            requires_backup=self._requires_backup.get(tool_name, False),
            execution_id=execution_id,
        )

        if not instruction or not instruction.strip():
            logger.error(
                "TOOL_EXECUTION_ERROR: Empty instruction provided",
                integration=self.integration_name,
                tool_name=tool_name,
                execution_id=execution_id,
            )
            raise ValueError("instruction must be a non-empty string")
        definition = self._definitions.get(tool_name)
        if not definition:
            logger.error(
                "TOOL_EXECUTION_ERROR: Unknown tool requested",
                integration=self.integration_name,
                tool_name=tool_name,
                available_tools=list(self._definitions.keys()),
                execution_id=execution_id,
            )
            raise ValueError(
                f"Unknown Pipedream tool '{tool_name}'. Available: {', '.join(sorted(self._definitions))}"
            )

        # Check if this is a material tool requiring explicit user confirmation
        if _is_material_tool(tool_name):
            logger.warning(
                "SECURITY_RISK: Material tool execution requires verification",
                integration=self.integration_name,
                tool=tool_name,
                verification_enabled=MATERIAL_TOOL_VERIFICATION_ENABLED,
                user_context_available=bool(get_current_user_auth()),
            )
            user_auth = get_current_user_auth() or {}
            if not user_auth:
                logger.error(
                    "SECURITY_RISK: No user auth context available during tool execution - authentication lost",
                    integration=self.integration_name,
                    tool=tool_name,
                    execution_time=time.time(),
                )
            else:
                logger.info(
                    "SECURITY_CHECK: User auth context retrieved successfully",
                    integration=self.integration_name,
                    tool=tool_name,
                    user_id=user_auth.get("sub", "unknown")[:8] + "...",
                )
            user_id = user_auth.get("sub")
            conversation_id = user_auth.get("conversation_id") or user_auth.get(
                "conversationId"
            )

            if user_id and conversation_id:
                config = _get_material_tool_config(tool_name)
                verification_result = verify_user_intent(
                    config, conversation_id, user_id
                )

                if not verification_result.verified:
                    logger.info(
                        "Material tool execution denied - user intent not verified",
                        integration=self.integration_name,
                        tool=tool_name,
                        decision=verification_result.decision,
                    )
                    return {
                        "status": "denied",
                        "integration": self.integration_name,
                        "tool": tool_name,
                        "message": verification_result.denial_message,
                    }

                logger.info(
                    "Material tool execution approved - user intent verified",
                    integration=self.integration_name,
                    tool=tool_name,
                    decision=verification_result.decision,
                )

        # Augment instruction with timezone guidance to ensure sub-agent always
        # considers user's timezone for time-sensitive operations
        instruction = _append_timezone_guidance(instruction)

        logger.info(
            "Appended timezone guidance to instruction",
            integration=self.integration_name,
            tool=tool_name,
            timezone=_get_user_timezone(),
            augmented_instruction=instruction,
        )

        logger.info(
            "Executing Pipedream router tool",
            integration=self.integration_name,
            tool=tool_name,
            instruction_text=_truncate_text(instruction, 1000),
        )

        if self._requires_backup.get(tool_name):
            raw_result = self._execute_via_sub_agent(definition, instruction)
            return postprocess_tool_result(
                result=raw_result,
                instruction=instruction,
                integration_name=self.integration_name,
                tool_name=definition.name,
                external_user_id=self._external_user_id,
                full_payload=full_payload,
            )

        logger.warning(
            "SECURITY_RISK: Using AI to generate payload from user instruction - prompt injection possible",
            integration=self.integration_name,
            tool=definition.name,
            instruction_length=len(instruction),
            contains_suspicious_patterns=any(
                pattern in instruction.lower()
                for pattern in [
                    "ignore",
                    "system",
                    "admin",
                    "bypass",
                    "override",
                    "sudo",
                    "root",
                ]
            ),
        )

        # IMPROVEMENT NEEDED: Implement prompt injection protection and instruction sanitization
        # RATIONALE: The current implementation directly passes user instructions to Claude for payload
        # generation without any sanitization or prompt injection protection. Malicious users could
        # craft instructions to manipulate the AI into generating unauthorized payloads or bypassing
        # security controls.
        # CONSEQUENCE: Without this protection, attackers could potentially:
        # - Bypass tool restrictions by manipulating the AI's reasoning
        # - Generate payloads that violate intended security policies
        # - Extract sensitive information from the AI model's training data
        # - Execute unintended actions by confusing the payload generation process
        #
        # PROPOSED FIX:
        # def sanitize_instruction(instruction: str) -> str:
        #     """Sanitize user instruction to prevent prompt injection attacks."""
        #     # Remove potential injection patterns
        #     dangerous_patterns = [
        #         r'(?i)ignore\s+(previous|above|system)',
        #         r'(?i)you\s+are\s+now',
        #         r'(?i)system\s*:',
        #         r'(?i)assistant\s*:',
        #         r'(?i)human\s*:',
        #         r'(?i)jailbreak',
        #         r'(?i)bypass.*restriction',
        #     ]
        #     sanitized = instruction
        #     for pattern in dangerous_patterns:
        #         sanitized = re.sub(pattern, '[FILTERED]', sanitized)
        #
        #     # Limit instruction length to prevent overflow attacks
        #     if len(sanitized) > 2000:
        #         sanitized = sanitized[:1997] + "..."
        #         logger.warning("Instruction truncated due to length", original_length=len(instruction))
        #
        #     return sanitized
        #
        # sanitized_instruction = sanitize_instruction(instruction)

        payload = self._generate_payload(definition, instruction)
        logger.info(
            "Prepared payload for tools-only execution",
            integration=self.integration_name,
            tool=definition.name,
            payload_json=payload,
        )
        result = self._call_mcp_tool(definition, payload)
        logger.warning(
            "SECURITY_RISK: Tool result received without integrity validation",
            integration=self.integration_name,
            tool=definition.name,
            result_size=len(str(result)) if result else 0,
            security_concern="Data could be tampered with by Pipedream or proxy",
            validation_performed="NONE",
        )

        # IMPROVEMENT NEEDED: Implement tool result validation and integrity checking
        # RATIONALE: The current implementation accepts tool results from external services
        # without any validation of data integrity, format compliance, or content safety.
        # Results could be tampered with by malicious Pipedream integrations, proxy compromises,
        # or man-in-the-middle attacks.
        # CONSEQUENCE: Without validation, the system is vulnerable to:
        # - Malicious data injection through crafted tool responses
        # - XSS attacks via unsanitized content in results
        # - Data corruption or manipulation going undetected
        # - Sensitive information leakage through malformed responses
        # - Application crashes from malformed data structures
        #
        # PROPOSED FIX:
        # def validate_tool_result(result: Dict[str, Any], tool_name: str, expected_schema: Optional[Dict] = None) -> Dict[str, Any]:
        #     """Validate and sanitize tool results for security and integrity."""
        #     if not isinstance(result, dict):
        #         logger.error("Tool result validation failed: not a dictionary", tool=tool_name, result_type=type(result))
        #         raise ValueError(f"Invalid result format from {tool_name}")
        #
        #     # Check for suspicious patterns in result data
        #     result_str = str(result)
        #     suspicious_patterns = [
        #         r'<script[^>]*>.*?</script>',
        #         r'javascript:',
        #         r'vbscript:',
        #         r'on\w+\s*=',
        #     ]
        #     for pattern in suspicious_patterns:
        #         if re.search(pattern, result_str, re.IGNORECASE):
        #             logger.warning("Suspicious content detected in tool result", tool=tool_name, pattern=pattern)
        #
        #     # Validate against expected schema if provided
        #     if expected_schema:
        #         try:
        #             jsonschema.validate(result, expected_schema)
        #         except jsonschema.ValidationError as e:
        #             logger.warning("Tool result schema validation failed", tool=tool_name, error=str(e))
        #
        #     # Truncate excessively large results to prevent memory issues
        #     max_result_size = 10 * 1024 * 1024  # 10MB
        #     if len(result_str) > max_result_size:
        #         logger.warning("Tool result truncated due to size", tool=tool_name, size=len(result_str))
        #         return {"truncated": True, "original_size": len(result_str), "data": str(result)[:max_result_size]}
        #
        #     return result
        #
        # validated_result = validate_tool_result(result, definition.name)

        # Inspect for retryable dynamic-props errors and auto retry once via sub-agent
        try:
            messages = self._extract_error_messages(result)
            if messages:
                logger.info(
                    "Detected integration error from tools-only execution",
                    integration=self.integration_name,
                    tool=definition.name,
                    error_excerpt=_truncate_text("; ".join(messages), 200),
                )
            if messages and self._is_retryable_dynamic_error(messages):
                logger.info(
                    "Auto-retrying via sub-agent due to validation/runtime error",
                    integration=self.integration_name,
                    tool=definition.name,
                    error_excerpt=_truncate_text("; ".join(messages), 200),
                )
                raw_result = self._execute_via_sub_agent(definition, instruction)
                return postprocess_tool_result(
                    result=raw_result,
                    instruction=instruction,
                    integration_name=self.integration_name,
                    tool_name=definition.name,
                    external_user_id=self._external_user_id,
                    full_payload=full_payload,
                )
            elif messages:
                # Non-retryable integration error: normalise for FE handling
                normalised_error: Dict[str, Any] = {
                    "integration": self.integration_name,
                    "tool": definition.name,
                    "type": "integration-error",
                    "error_message": messages[0],
                }
                # Attach the first error object if present
                try:
                    os_events = result.get("os") if isinstance(result, dict) else None
                    if isinstance(os_events, list):
                        for evt in os_events:
                            if (
                                isinstance(evt, dict)
                                and str(evt.get("k") or "").lower() == "error"
                            ):
                                err_obj = evt.get("err")
                                if isinstance(err_obj, dict):
                                    # Trim overly long stacks to keep payload tidy
                                    stack = err_obj.get("stack")
                                    if isinstance(stack, str) and len(stack) > 1000:
                                        err_obj = dict(err_obj)
                                        err_obj["stack"] = stack[:997] + "..."
                                    normalised_error["error_details"] = err_obj
                                    break
                except Exception:
                    pass

                logger.info(
                    "Returning normalised integration error payload",
                    integration=self.integration_name,
                    tool=definition.name,
                    error_excerpt=_truncate_text(messages[0], 200),
                )
                return postprocess_tool_result(
                    result=normalised_error,
                    instruction=instruction,
                    integration_name=self.integration_name,
                    tool_name=definition.name,
                    external_user_id=self._external_user_id,
                    full_payload=full_payload,
                )
        except Exception:
            # Defensive: if inspection throws, proceed with normal result
            pass

        execution_duration = time.time() - execution_start
        logger.info(
            "TOOL_EXECUTION_SUCCESS: Tools-only execution succeeded",
            integration=self.integration_name,
            tool=definition.name,
            execution_id=execution_id,
            execution_duration_ms=round(execution_duration * 1000, 2),
            result_size_bytes=len(str(result)) if result else 0,
        )

        # Post-process results
        postprocessing_start = time.time()
        processed_result = postprocess_tool_result(
            result=result,
            instruction=instruction,
            integration_name=self.integration_name,
            tool_name=definition.name,
            external_user_id=self._external_user_id,
            full_payload=full_payload,
        )
        postprocessing_duration = time.time() - postprocessing_start

        total_duration = time.time() - execution_start
        logger.info(
            "TOOL_EXECUTION_COMPLETE: Full tool execution completed",
            integration=self.integration_name,
            tool=definition.name,
            execution_id=execution_id,
            total_duration_ms=round(total_duration * 1000, 2),
            postprocessing_duration_ms=round(postprocessing_duration * 1000, 2),
            final_result_size_bytes=(
                len(str(processed_result)) if processed_result else 0
            ),
            full_payload_returned=full_payload,
        )

        return processed_result

    def _ensure_llm(self):
        if self._llm is None:
            if BedrockClaude3Model is None:
                raise RuntimeError("BedrockClaude3Model library is unavailable")
            self._llm = BedrockClaude3Model(enable_fallback=True, claude_only=True)
        return self._llm

    def _build_user_prompt(
        self,
        definition: PipedreamToolDefinition,
        instruction: str,
        prior_feedback: List[str],
    ) -> str:
        template = self.prompt
        schema_json = json.dumps(definition.schema or {}, indent=2, ensure_ascii=False)
        feedback_section = ""
        if prior_feedback:
            bullet_feedback = "\n".join(f"- {item}" for item in prior_feedback[-3:])
            feedback_section = (
                "Previous attempt feedback to address:\n" + bullet_feedback
            )

        rendered = template.format(
            INTEGRATION_NAME=self.integration_name,
            ACTION_NAME=definition.name,
            ACTION_DESCRIPTION=definition.description or "No description provided.",
            SCHEMA_JSON=schema_json,
            INSTRUCTION=instruction.strip(),
            FEEDBACK_SECTION=feedback_section,
        )

        logger.info(
            "Rendered tools-only prompt",
            integration=self.integration_name,
            tool=definition.name,
            prompt_length=len(rendered),
            prompt_preview=_truncate_text(rendered, 1000),
        )

        return rendered

    def _invoke_model(self, prompt_text: str, definition: PipedreamToolDefinition):
        llm = self._ensure_llm()
        logger.info(
            "Invoking Bedrock model for tools-only router",
            integration=self.integration_name,
            tool=definition.name,
            prompt=prompt_text,
        )
        return llm.run_with_messages(
            [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt_text}],
                }
            ],
            name_for_logging=f"pipedream.{self.integration_namespace}.{definition.name}",
        )

    def _parse_json_response(self, response: Any) -> Dict[str, Any]:
        content = getattr(response, "response", [])
        for block in content:
            btype = (
                getattr(block, "type", None)
                if not isinstance(block, dict)
                else block.get("type")
            )
            text = (
                getattr(block, "text", None)
                if not isinstance(block, dict)
                else block.get("text")
            )
            if btype == "text" and text:
                s = str(text).strip()
                if s.startswith("```"):
                    lines = s.splitlines()[1:]
                    while lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    s = "\n".join(lines).strip()
                try:
                    parsed = json.loads(s)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Model output was not valid JSON: {exc}") from exc
                if not isinstance(parsed, dict):
                    raise ValueError("Model output must be a JSON object")
                return parsed
        raise ValueError("Model response did not contain a text block")

    def _validate_payload(
        self, definition: PipedreamToolDefinition, payload: Dict[str, Any]
    ) -> List[str]:
        schema = definition.schema or {}
        if not schema:
            return []
        validator = self._validator_cache.get(definition.name)
        if validator is None:
            try:
                validator = Draft7Validator(schema)
            except Exception:
                validator = None
            self._validator_cache[definition.name] = validator
        if validator is None:
            return []
        errors = []
        for error in validator.iter_errors(payload):
            path = "/".join(str(piece) for piece in error.path) or "<root>"
            errors.append(f"{path}: {error.message}")
        return errors

    def _generate_payload(
        self,
        definition: PipedreamToolDefinition,
        instruction: str,
    ) -> Dict[str, Any]:
        payload_generation_start = time.time()
        generation_id = str(uuid.uuid4())[:8]

        logger.info(
            "PAYLOAD_GENERATION_START: Beginning AI payload generation",
            integration=self.integration_name,
            tool=definition.name,
            instruction_length=len(instruction),
            has_schema=bool(definition.schema),
            generation_id=generation_id,
        )

        logger.debug(
            "PAYLOAD_GENERATION_CONTEXT: Full generation context",
            integration=self.integration_name,
            tool=definition.name,
            tool_description=(
                definition.description[:200] + "..."
                if len(definition.description) > 200
                else definition.description
            ),
            schema_keys=(
                list(definition.schema.get("properties", {}).keys())
                if definition.schema
                else []
            ),
            model_id=self._model_id,
            generation_id=generation_id,
        )

        feedback: List[str] = []
        last_error: Optional[Exception] = None

        logger.critical(
            (
                "RELIABILITY_CRITICAL: Severely limited retry logic - HIGH RISK of "
                "unnecessary failures"
            ),
            integration=self.integration_name,
            tool=definition.name,
            max_attempts=2,
            generation_id=generation_id,
            risk_level="CRITICAL",
            reliability_concerns=[
                "only_2_attempts_before_giving_up",
                "no_adaptive_retry_logic_based_on_schema_complexity",
                "insufficient_for_complex_schemas_with_nested_objects",
                "no_exponential_backoff_causing_rapid_successive_failures",
                "no_jitter_to_prevent_thundering_herd_effects",
                "fixed_retry_count_ignores_error_types",
            ],
            potential_failures=[
                "intermittent_json_parsing_errors_from_model_variability",
                "schema_validation_failures_on_complex_nested_schemas",
                "model_response_variability_causing_inconsistent_behavior",
                "network_induced_parsing_issues_during_high_latency",
                "complex_integrations_appearing_unreliable_to_users",
                "same_request_works_sometimes_fails_other_times",
            ],
            schema_complexity_factors={
                "properties_count": (
                    len(definition.schema.get("properties", {}))
                    if definition.schema
                    else 0
                ),
                "has_nested_objects": (
                    bool(self._has_nested_objects(definition.schema))
                    if definition.schema
                    else False
                ),
                "has_arrays": (
                    bool(self._has_arrays(definition.schema))
                    if definition.schema
                    else False
                ),
                "estimated_complexity": (
                    "HIGH"
                    if (
                        definition.schema
                        and len(definition.schema.get("properties", {})) > 10
                    )
                    else "MEDIUM"
                ),
            },
        )

        # ADAPTIVE RETRY LOGIC FIX - COMMENTED OUT BUT READY FOR IMPLEMENTATION
        # import random
        #
        # def calculate_adaptive_retry_attempts(definition: PipedreamToolDefinition, base_attempts: int = 2) -> int:
        #     """Calculate retry attempts based on schema complexity and error patterns."""
        #     schema = definition.schema or {}
        #     properties = schema.get("properties", {})
        #
        #     # Start with base attempts
        #     attempts = base_attempts
        #
        #     # Increase attempts for complex schemas
        #     if isinstance(properties, dict):
        #         property_count = len(properties)
        #         if property_count > 15:  # Very complex
        #             attempts += 3
        #         elif property_count > 10:  # Complex
        #             attempts += 2
        #         elif property_count > 5:  # Moderate
        #             attempts += 1
        #
        #     # Check for complex nested structures
        #     nested_complexity = 0
        #     array_complexity = 0
        #     if isinstance(properties, dict):
        #         for prop_name, prop_def in properties.items():
        #             if isinstance(prop_def, dict):
        #                 prop_type = prop_def.get("type")
        #                 if prop_type == "object":
        #                     nested_complexity += 1
        #                 elif prop_type == "array":
        #                     array_complexity += 1
        #                     # Arrays with object items are especially complex
        #                     items = prop_def.get("items", {})
        #                     if isinstance(items, dict) and items.get("type") == "object":
        #                         nested_complexity += 1
        #
        #     # Add attempts for high complexity
        #     if nested_complexity > 3 or array_complexity > 2:
        #         attempts += 2
        #     elif nested_complexity > 1 or array_complexity > 1:
        #         attempts += 1
        #
        #     # Cap at reasonable maximum
        #     return min(attempts, 6)
        #
        # def execute_with_exponential_backoff_and_jitter(max_attempts: int, definition: PipedreamToolDefinition, instruction: str, feedback: list):
        #     """Execute payload generation with exponential backoff and jitter."""
        #     last_error = None
        #
        #     for attempt in range(max_attempts):
        #         attempt_start = time.time()
        #
        #         logger.info(
        #             "RELIABILITY_IMPROVEMENT: Adaptive retry attempt with exponential backoff",
        #             integration=self.integration_name,
        #             tool=definition.name,
        #             attempt=attempt + 1,
        #             max_attempts=max_attempts,
        #             backoff_enabled=attempt > 0,
        #             jitter_enabled=True
        #         )
        #
        #         try:
        #             # Attempt payload generation
        #             prompt_text = self._build_user_prompt(definition, instruction, feedback)
        #             response = self._invoke_model(prompt_text, definition)
        #             candidate = self._parse_json_response(response)
        #             validation_errors = self._validate_payload(definition, candidate)
        #
        #             if not validation_errors:
        #                 logger.info(
        #                     "RELIABILITY_SUCCESS: Adaptive retry succeeded",
        #                     integration=self.integration_name,
        #                     tool=definition.name,
        #                     successful_attempt=attempt + 1,
        #                     total_attempts=max_attempts
        #                 )
        #                 return candidate
        #
        #             # Validation failed, add feedback
        #             feedback.append("Schema validation issues: " + "; ".join(validation_errors))
        #             last_error = ValueError("; ".join(validation_errors))
        #
        #         except Exception as e:
        #             feedback.append(f"Attempt {attempt + 1}: {str(e)}")
        #             last_error = e
        #
        #         # Apply exponential backoff with jitter if not the last attempt
        #         if attempt < max_attempts - 1:
        #             base_delay = 0.5 * (2 ** attempt)  # Exponential backoff
        #             jitter = random.uniform(0, 0.3)    # Up to 300ms jitter
        #             delay = min(base_delay + jitter, 5.0)  # Cap at 5 seconds
        #
        #             logger.info(
        #                 "RELIABILITY_BACKOFF: Applying exponential backoff with jitter",
        #                 integration=self.integration_name,
        #                 tool=definition.name,
        #                 attempt=attempt + 1,
        #                 delay_seconds=delay,
        #                 base_delay=base_delay,
        #                 jitter_seconds=jitter
        #             )
        #
        #             time.sleep(delay)
        #
        #     # All attempts failed
        #     logger.error(
        #         "RELIABILITY_FAILURE: All adaptive retry attempts failed",
        #         integration=self.integration_name,
        #         tool=definition.name,
        #         total_attempts=max_attempts,
        #         final_error=str(last_error) if last_error else "unknown"
        #     )
        #     raise last_error or ValueError("Payload generation failed after all adaptive retry attempts")
        #
        # # Calculate adaptive retry attempts based on schema complexity
        # adaptive_max_attempts = calculate_adaptive_retry_attempts(definition)
        # logger.info(
        #     "RELIABILITY_IMPROVEMENT: Using adaptive retry logic based on schema complexity",
        #     integration=self.integration_name,
        #     tool=definition.name,
        #     schema_properties_count=len(definition.schema.get("properties", {})) if definition.schema else 0,
        #     adaptive_max_attempts=adaptive_max_attempts,
        #     improvement_enabled=True
        # )
        #
        # # Use adaptive retry logic instead of fixed 2 attempts
        # return execute_with_exponential_backoff_and_jitter(adaptive_max_attempts, definition, instruction, feedback)

        # RELIABILITY IMPROVEMENT NEEDED: Implement adaptive retry logic with exponential backoff
        # RATIONALE: The current implementation only attempts payload generation 2 times before giving up,
        # which is insufficient for complex schemas or when model responses vary. This causes intermittent
        # failures where the same request works sometimes but fails other times, depending on model
        # response variability, schema complexity, or transient network issues affecting JSON parsing.
        # CONSEQUENCE OF NOT FIXING: Users experience inconsistent behavior where:
        # - Simple requests work but complex schemas fail unpredictably
        # - Same integration requests succeed on retry but fail initially
        # - Model response variations cause intermittent JSON parsing failures
        # - Complex tools appear "unreliable" due to insufficient retry attempts
        # CONSEQUENCE OF FIXING: With adaptive retry logic, the system would have:
        # - Higher success rates for complex schema generation
        # - More consistent behavior regardless of model response variation
        # - Better handling of transient network or parsing issues
        # - Improved user experience with reliable tool execution
        #
        # PROPOSED ADAPTIVE RETRY FIX:
        # def get_adaptive_retry_attempts(definition: PipedreamToolDefinition, base_attempts: int = 2) -> int:
        #     """Calculate adaptive retry attempts based on schema complexity."""
        #     schema = definition.schema or {}
        #     properties = schema.get("properties", {})
        #
        #     # Base retry attempts
        #     attempts = base_attempts
        #
        #     # Increase attempts for complex schemas
        #     if isinstance(properties, dict):
        #         property_count = len(properties)
        #         if property_count > 10:  # Complex schema
        #             attempts += 2
        #         elif property_count > 5:  # Moderate schema
        #             attempts += 1
        #
        #     # Check for complex property types that often cause issues
        #     complex_types = ["object", "array"]
        #     nested_complexity = 0
        #     if isinstance(properties, dict):
        #         for prop_def in properties.values():
        #             if isinstance(prop_def, dict):
        #                 prop_type = prop_def.get("type")
        #                 if prop_type in complex_types:
        #                     nested_complexity += 1
        #
        #     if nested_complexity > 3:  # High nesting
        #         attempts += 1
        #
        #     return min(attempts, 5)  # Cap at 5 attempts
        #
        # adaptive_max_attempts = get_adaptive_retry_attempts(definition)
        # logger.info(
        #     "RELIABILITY_IMPROVEMENT: Using adaptive retry attempts based on schema complexity",
        #     integration=self.integration_name,
        #     tool=definition.name,
        #     schema_properties_count=len(definition.schema.get("properties", {})) if definition.schema else 0,
        #     adaptive_max_attempts=adaptive_max_attempts,
        #     generation_id=generation_id
        # )

        for attempt in range(2):
            attempt_start = time.time()
            logger.info(
                "PAYLOAD_GENERATION_ATTEMPT: Starting generation attempt",
                integration=self.integration_name,
                tool=definition.name,
                attempt=attempt + 1,
                max_attempts=2,
                has_feedback=len(feedback) > 0,
                generation_id=generation_id,
            )

            prompt_text = self._build_user_prompt(definition, instruction, feedback)
            logger.debug(
                "PAYLOAD_GENERATION_PROMPT: Built user prompt",
                integration=self.integration_name,
                tool=definition.name,
                attempt=attempt + 1,
                prompt_length=len(prompt_text),
                feedback_count=len(feedback),
                generation_id=generation_id,
            )

            response = self._invoke_model(prompt_text, definition)
            attempt_duration = time.time() - attempt_start
            logger.info(
                "PAYLOAD_GENERATION_LLM_COMPLETE: LLM invocation completed",
                integration=self.integration_name,
                tool=definition.name,
                attempt=attempt + 1,
                attempt_duration_ms=round(attempt_duration * 1000, 2),
                response_type=type(response).__name__,
                generation_id=generation_id,
            )

            # Parse JSON response
            try:
                parse_start = time.time()
                candidate = self._parse_json_response(response)
                parse_duration = time.time() - parse_start
                logger.debug(
                    "PAYLOAD_GENERATION_PARSE: JSON parsing successful",
                    integration=self.integration_name,
                    tool=definition.name,
                    attempt=attempt + 1,
                    parse_duration_ms=round(parse_duration * 1000, 2),
                    candidate_keys=(
                        list(candidate.keys()) if isinstance(candidate, dict) else []
                    ),
                    generation_id=generation_id,
                )
            except ValueError as exc:
                logger.warning(
                    "PAYLOAD_GENERATION_PARSE_FAILED: JSON parsing failed",
                    integration=self.integration_name,
                    tool=definition.name,
                    attempt=attempt + 1,
                    error=str(exc),
                    attempt_duration_ms=round(attempt_duration * 1000, 2),
                    generation_id=generation_id,
                )
                feedback.append(f"Attempt {attempt + 1}: {str(exc)}")
                last_error = exc
                continue

            # Validate payload against schema
            validation_start = time.time()
            validation_errors = self._validate_payload(definition, candidate)
            validation_duration = time.time() - validation_start

            if validation_errors:
                logger.warning(
                    "PAYLOAD_GENERATION_VALIDATION_FAILED: Schema validation failed",
                    integration=self.integration_name,
                    tool=definition.name,
                    attempt=attempt + 1,
                    validation_errors=validation_errors,
                    validation_duration_ms=round(validation_duration * 1000, 2),
                    attempt_duration_ms=round(attempt_duration * 1000, 2),
                    generation_id=generation_id,
                )
                feedback.append(
                    "Schema validation issues: " + "; ".join(validation_errors)
                )
                last_error = ValueError("; ".join(validation_errors))
                continue

            # Success!
            total_generation_duration = time.time() - payload_generation_start
            logger.info(
                "PAYLOAD_GENERATION_SUCCESS: Payload generation completed successfully",
                integration=self.integration_name,
                tool=definition.name,
                successful_attempt=attempt + 1,
                total_generation_duration_ms=round(total_generation_duration * 1000, 2),
                validation_duration_ms=round(validation_duration * 1000, 2),
                final_payload_keys=(
                    list(candidate.keys()) if isinstance(candidate, dict) else []
                ),
                generation_id=generation_id,
            )
            return dict(candidate)

        # All attempts failed
        total_generation_duration = time.time() - payload_generation_start
        logger.error(
            "PAYLOAD_GENERATION_FAILED: All payload generation attempts failed",
            integration=self.integration_name,
            tool=definition.name,
            total_attempts=2,
            total_generation_duration_ms=round(total_generation_duration * 1000, 2),
            last_error=(
                str(last_error) if last_error else "model did not return valid JSON"
            ),
            feedback_history=feedback,
            generation_id=generation_id,
        )
        raise ValueError(
            f"Unable to construct parameters for {definition.name}: {last_error or 'model did not return valid JSON'}"
        )

    def _call_mcp_tool(
        self, definition: PipedreamToolDefinition, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        request_id = str(uuid.uuid4())
        mcp_call_start = time.time()

        logger.info(
            "MCP_CALL_START: Invoking Pipedream MCP action (tools-only)",
            integration=self.integration_name,
            tool=definition.name,
            payload_keys=_sorted_keys(payload),
            payload_size_bytes=len(str(payload)),
            request_id=request_id,
            client_type=type(self._mcp_client).__name__,
        )

        logger.debug(
            "MCP_CALL_DETAILS: Full MCP call context",
            integration=self.integration_name,
            tool=definition.name,
            payload=payload,
            request_id=request_id,
            client_id=id(self._mcp_client),
            has_backup_client=bool(self._backup_client),
        )
        try:
            tool_use_id = str(uuid.uuid4())

            logger.critical(
                (
                    "RELIABILITY_CRITICAL: MCP tool execution proceeding WITHOUT connection "
                    "health verification - HIGH RISK of random failures"
                ),
                integration=self.integration_name,
                tool=definition.name,
                request_id=request_id,
                tool_use_id=tool_use_id,
                client_type=type(self._mcp_client).__name__,
                client_id=id(self._mcp_client),
                client_created_at=getattr(self._mcp_client, "_created_at", "unknown"),
                reliability_status="UNVERIFIED_HIGH_RISK",
                risk_level="CRITICAL",
                connection_state="UNKNOWN",
                authentication_state="UNVERIFIED",
                network_conditions="UNMONITORED",
                failure_probability="HIGH_ON_STALE_CONNECTIONS",
                user_experience_impact=[
                    "same_action_works_sometimes_fails_other_times",
                    "unpredictable_timeouts_appear_random_to_users",
                    "difficult_to_reproduce_connection_issues",
                    "poor_error_messages_when_connections_fail",
                    "wasted_compute_on_doomed_operations",
                ],
                recommended_health_checks=[
                    "list_tools_operation_for_basic_connectivity",
                    "response_time_monitoring_for_network_issues",
                    "authentication_token_validation",
                    "connection_pool_health_status",
                ],
            )

            # RELIABILITY IMPROVEMENT NEEDED: Implement MCP connection health check before tool execution
            # RATIONALE: The current implementation directly calls MCP tools without verifying
            # the connection is healthy, authenticated, or the client is still valid. This causes
            # intermittent failures that appear random to users - the same action works sometimes
            # but fails other times depending on connection timing, network conditions, and client state.
            # CONSEQUENCE OF NOT FIXING: Without health checks, users experience:
            # - Intermittent tool execution failures that seem random and inconsistent
            # - Unpredictable timeouts and connection drops during tool execution
            # - Poor user experience where identical actions work sometimes but fail other times
            # - Difficult-to-debug connection issues that depend on network timing
            # - Wasted compute resources on operations doomed to fail due to stale connections
            # CONSEQUENCE OF FIXING: With health checks, the system would have:
            # - Predictable behavior with clear error messages about connection issues
            # - Early detection and graceful handling of connection problems
            # - Consistent user experience regardless of connection timing
            # - Better resource utilization by avoiding doomed operations
            # - Improved debugging with clear connection state information
            #
            # PROPOSED RELIABILITY FIX:
            # def verify_mcp_connection_health(client, integration_name: str, timeout_seconds: float = 3.0) -> tuple[bool, str]:
            #     """Verify MCP client connection is healthy before tool execution."""
            #     health_check_start = time.time()
            #     try:
            #         logger.info(
            #             "CONNECTION_HEALTH_CHECK_START: Starting MCP connection health verification",
            #             integration=integration_name,
            #             timeout_seconds=timeout_seconds,
            #             client_type=type(client).__name__
            #         )
            #
            #         # Use a simple, fast operation to verify connection health
            #         # Most MCP clients should support list_tools as a basic health check
            #         with timeout_context(timeout_seconds):
            #             tools = client.list_tools_sync()
            #             health_check_duration = time.time() - health_check_start
            #
            #             # Check if connection is responding too slowly (potential network issues)
            #             if health_check_duration > timeout_seconds * 0.8:  # 80% of timeout threshold
            #                 logger.warning(
            #                     "CONNECTION_HEALTH_CHECK_SLOW: MCP connection responding slowly - potential network issues",
            #                     integration=integration_name,
            #                     duration_ms=round(health_check_duration * 1000, 2),
            #                     threshold_ms=round(timeout_seconds * 800, 2),
            #                     reliability_status="DEGRADED"
            #                 )
            #                 return False, f"Connection slow ({health_check_duration:.2f}s > {timeout_seconds*0.8:.2f}s threshold)"
            #
            #             # Check if connection returns empty or invalid tool list
            #             if not tools or len(tools) == 0:
            #                 logger.error(
            #                     "CONNECTION_HEALTH_CHECK_FAILED: MCP connection returned no tools - connection may be invalid",
            #                     integration=integration_name,
            #                     tools_returned=tools,
            #                     health_check_duration_ms=round(health_check_duration * 1000, 2),
            #                     reliability_status="FAILED"
            #                 )
            #                 return False, "Connection returned no tools - may be invalid or unauthorized"
            #
            #             logger.info(
            #                 "CONNECTION_HEALTH_CHECK_PASS: MCP connection is healthy and responsive",
            #                 integration=integration_name,
            #                 tools_count=len(tools),
            #                 health_check_duration_ms=round(health_check_duration * 1000, 2),
            #                 reliability_status="HEALTHY"
            #             )
            #             return True, f"Connection healthy ({len(tools)} tools available)"
            #
            #     except TimeoutError:
            #         health_check_duration = time.time() - health_check_start
            #         logger.error(
            #             "CONNECTION_HEALTH_CHECK_TIMEOUT: MCP health check timed out - connection unresponsive",
            #             integration=integration_name,
            #             timeout_seconds=timeout_seconds,
            #             elapsed_ms=round(health_check_duration * 1000, 2),
            #             reliability_status="TIMEOUT"
            #         )
            #         return False, f"Health check timeout after {health_check_duration:.2f}s"
            #     except Exception as e:
            #         health_check_duration = time.time() - health_check_start
            #         logger.error(
            #             "CONNECTION_HEALTH_CHECK_ERROR: MCP connection health check failed with exception",
            #             integration=integration_name,
            #             error_type=type(e).__name__,
            #             error=str(e),
            #             health_check_duration_ms=round(health_check_duration * 1000, 2),
            #             reliability_status="ERROR"
            #         )
            #         return False, f"Health check error: {type(e).__name__}: {str(e)}"
            #
            # # Verify connection health before attempting tool execution
            # connection_healthy, health_message = verify_mcp_connection_health(self._mcp_client, self.integration_name)
            # if not connection_healthy:
            #     logger.error(
            #         "RELIABILITY_FAILURE: MCP connection health check failed - aborting tool execution to prevent intermittent failure",
            #         integration=self.integration_name,
            #         tool=definition.name,
            #         request_id=request_id,
            #         tool_use_id=tool_use_id,
            #         health_failure_reason=health_message
            #     )
            #     raise RuntimeError(f"MCP connection health check failed for {self.integration_name}: {health_message}")

            # CURRENT RELIABILITY RISK: Proceeding with tool execution without connection health verification
            logger.warning(
                "RELIABILITY_RISK: Proceeding with MCP tool execution without connection health check",
                integration=self.integration_name,
                tool=definition.name,
                request_id=request_id,
                tool_use_id=tool_use_id,
                risk_factors=[
                    "connection_health_unverified",
                    "potential_stale_connection",
                    "network_conditions_unknown",
                    "client_validity_unchecked",
                ],
                potential_failure_modes=[
                    "intermittent_connection_drops",
                    "unpredictable_timeouts",
                    "inconsistent_user_experience",
                    "random_execution_failures",
                ],
                reliability_status="AT_RISK",
            )

            # RELIABILITY IMPROVEMENT NEEDED: Add timeout control to MCP calls
            # RATIONALE: The current implementation makes MCP calls with no timeout controls,
            # which can cause the call to hang indefinitely if the remote service becomes
            # unresponsive. This leads to Lambda timeouts and poor user experience.
            # CONSEQUENCE OF NOT FIXING: Tool calls can hang indefinitely causing:
            # - Lambda function timeouts that appear as random failures to users
            # - Resource waste from hanging connections that consume memory and CPU
            # - Poor user experience with no feedback when calls are stuck
            # - Difficult debugging of timeout-related intermittent issues
            # CONSEQUENCE OF FIXING: With timeout controls, the system would have:
            # - Predictable failure modes with clear timeout error messages
            # - Better resource utilization by terminating hanging operations
            # - Improved user experience with timely error feedback
            # - Easier debugging of network and service issues
            #
            # PROPOSED TIMEOUT FIX:
            # MCP_CALL_TIMEOUT = 30.0  # seconds
            # with timeout_context(MCP_CALL_TIMEOUT):
            #     result = self._mcp_client.call_tool_sync(
            #         tool_use_id=tool_use_id,
            #         name=definition.name,
            #         arguments=payload,
            #     )

            logger.critical(
                (
                    "RELIABILITY_CRITICAL: MCP tool call executing without timeout "
                    "protection - HIGH RISK of indefinite hang"
                ),
                integration=self.integration_name,
                tool=definition.name,
                request_id=request_id,
                tool_use_id=tool_use_id,
                payload_size_bytes=len(str(payload)),
                timeout_protection="NONE",
                reliability_status="UNPROTECTED",
                risk_level="CRITICAL",
                failure_scenarios=[
                    "indefinite_hang_causing_lambda_timeout",
                    "resource_exhaustion_from_hanging_connections",
                    "user_experience_degradation_with_no_feedback",
                    "difficult_debugging_of_hanging_operations",
                ],
                recommended_timeout_seconds=30,
            )

            # TIMEOUT CONTROL FIX - COMMENTED OUT BUT READY FOR IMPLEMENTATION
            # import signal
            # from contextlib import contextmanager
            #
            # @contextmanager
            # def timeout_context(timeout_seconds: float):
            #     """Context manager for timing out operations."""
            #     def timeout_handler(signum, frame):
            #         raise TimeoutError(f"Operation timed out after {timeout_seconds} seconds")
            #
            #     old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            #     signal.alarm(int(timeout_seconds))
            #     try:
            #         yield
            #     finally:
            #         signal.alarm(0)
            #         signal.signal(signal.SIGALRM, old_handler)
            #
            # MCP_CALL_TIMEOUT_SECONDS = 30.0
            # logger.info(
            #     "RELIABILITY_FIX: Executing MCP call with timeout protection",
            #     integration=self.integration_name,
            #     tool=definition.name,
            #     timeout_seconds=MCP_CALL_TIMEOUT_SECONDS,
            #     reliability_improvement="TIMEOUT_PROTECTION_ENABLED"
            # )
            #
            # try:
            #     with timeout_context(MCP_CALL_TIMEOUT_SECONDS):
            #         result = self._mcp_client.call_tool_sync(
            #             tool_use_id=tool_use_id,
            #             name=definition.name,
            #             arguments=payload,
            #         )
            # except TimeoutError:
            #     logger.error(
            #         "MCP_CALL_TIMEOUT: MCP tool call timed out - connection may be unresponsive",
            #         integration=self.integration_name,
            #         tool=definition.name,
            #         timeout_seconds=MCP_CALL_TIMEOUT_SECONDS,
            #         request_id=request_id,
            #         tool_use_id=tool_use_id
            #     )
            #     raise RuntimeError(f"MCP tool call timed out after {MCP_CALL_TIMEOUT_SECONDS}s")

            # CURRENT IMPLEMENTATION - NO TIMEOUT PROTECTION
            logger.error(
                "EXECUTING_WITHOUT_TIMEOUT: MCP call proceeding without timeout - may hang indefinitely",
                integration=self.integration_name,
                tool=definition.name,
                current_time=time.time(),
                risk_assessment="HIGH",
            )

            result = self._mcp_client.call_tool_sync(
                tool_use_id=tool_use_id,
                name=definition.name,
                arguments=payload,
            )
            mcp_call_duration = time.time() - mcp_call_start

            logger.warning(
                "SECURITY_RISK: Direct MCP tool execution - no connection health check",
                integration=self.integration_name,
                tool=definition.name,
                request_id=request_id,
                tool_use_id=tool_use_id,
                client_type=type(self._mcp_client).__name__,
                security_concerns="Connection could be stale, client could be compromised",
            )

            result_dict = dict(result)
            logger.info(
                "MCP_CALL_SUCCESS: Pipedream MCP action completed successfully",
                integration=self.integration_name,
                tool=definition.name,
                result_keys=_sorted_keys(result_dict),
                result_size_bytes=len(str(result_dict)),
                mcp_call_duration_ms=round(mcp_call_duration * 1000, 2),
                request_id=request_id,
                tool_use_id=tool_use_id,
            )

            logger.debug(
                "MCP_CALL_RESULT: Full MCP call result",
                integration=self.integration_name,
                tool=definition.name,
                result=result_dict,
                request_id=request_id,
                tool_use_id=tool_use_id,
            )

            return result_dict
        except Exception as exc:
            mcp_call_duration = time.time() - mcp_call_start
            logger.error(
                "MCP_CALL_FAILED: MCP tool call failed with exception",
                integration=self.integration_name,
                tool=definition.name,
                request_id=request_id,
                tool_use_id=tool_use_id,
                error_type=type(exc).__name__,
                error_message=str(exc),
                mcp_call_duration_ms=round(mcp_call_duration * 1000, 2),
                client_type=type(self._mcp_client).__name__,
            )
            raise RuntimeError(str(exc)) from exc

    def _extract_error_messages(self, result: Dict[str, Any]) -> List[str]:
        messages: List[str] = []

        def _collect_from_os_container(container: Any) -> None:
            try:
                os_events = container.get("os") if isinstance(container, dict) else None
                if isinstance(os_events, list):
                    for evt in os_events:
                        if not isinstance(evt, dict):
                            continue
                        kind = str(evt.get("k") or "").lower()
                        if kind != "error":
                            continue
                        err = evt.get("err") or {}
                        if isinstance(err, dict):
                            msg = err.get("message")
                            if isinstance(msg, str) and msg.strip():
                                messages.append(msg.strip())
            except Exception:
                return

        # 1) Top-level OS (rare)
        _collect_from_os_container(result)

        # 2) Inspect content blocks for embedded JSON
        try:
            content_blocks = result.get("content") if isinstance(result, dict) else None
            if isinstance(content_blocks, list):
                for blk in content_blocks:
                    if not isinstance(blk, dict):
                        continue
                    txt = blk.get("text")
                    if isinstance(txt, str):
                        s = txt.strip()
                        if s.startswith("```"):
                            lines = s.splitlines()[1:]
                            while lines and lines[-1].startswith("```"):
                                lines = lines[:-1]
                            s = "\n".join(lines).strip()
                        try:
                            parsed = json.loads(s)
                            if isinstance(parsed, dict):
                                _collect_from_os_container(parsed)
                        except Exception:
                            pass
                    j = blk.get("json")
                    if isinstance(j, dict):
                        _collect_from_os_container(j)
        except Exception:
            pass

        # Fallbacks
        if not messages:
            top_error = result.get("error") or result.get("message")
            if isinstance(top_error, str) and top_error.strip():
                messages.append(top_error.strip())
        return messages

    def _is_retryable_dynamic_error(self, messages: List[str]) -> bool:
        if not messages:
            logger.info(
                "RETRY_DECISION: No error messages to evaluate - not retryable",
                integration=self.integration_name,
                retry_decision="NOT_RETRYABLE",
                reason="no_error_messages",
            )
            return False

        logger.info(
            "RETRY_DECISION_START: Evaluating error messages for retry eligibility",
            integration=self.integration_name,
            error_messages=messages,
            message_count=len(messages),
        )

        denylist = (
            "permissiondenied",
            "permission denied",
            "unauthorized",
            "unauthorised",
            "401",
            "403",
            "404",
            "not found",
            "invalid attachment token",
            "invalidargument",
            "quota",
            "rate limit",
            "too many requests",
            "429",
            "timeout",
            "deadline",
            "network",
            "econn",
            "enotfound",
            "eai_again",
        )

        logger.warning(
            "RELIABILITY_RISK: Using hardcoded error pattern denylist - may miss new error types causing intermittent retry failures",
            integration=self.integration_name,
            denylist_patterns=len(denylist),
            reliability_concerns=[
                "hardcoded_patterns_may_miss_new_errors",
                "no_smart_pattern_detection",
                "potential_false_negatives_on_retryable_errors",
                "no_learning_from_retry_outcomes",
            ],
        )

        # RELIABILITY IMPROVEMENT NEEDED: Implement adaptive error pattern recognition
        # RATIONALE: The current implementation uses a hardcoded denylist of error patterns that
        # may miss new types of errors, leading to incorrect retry decisions. New error types
        # from evolving APIs may not be caught, causing the system to retry on permanent failures
        # or skip retries on transient issues, both leading to inconsistent user experience.
        # CONSEQUENCE OF NOT FIXING: The system will experience:
        # - Incorrect retry decisions on new types of errors not in the denylist
        # - Wasted resources retrying permanent failures that should be caught
        # - Missed opportunities to retry transient errors that could succeed
        # - Degraded reliability as API error messages evolve over time
        # CONSEQUENCE OF FIXING: With adaptive error recognition, the system would have:
        # - Better accuracy in retry decisions based on error characteristics
        # - Automatic adaptation to new error types from evolving APIs
        # - Improved resource utilization by avoiding futile retries
        # - Enhanced reliability that improves over time with learning
        #
        # PROPOSED ADAPTIVE ERROR RECOGNITION FIX:
        # def categorize_error_type(error_message: str) -> tuple[str, bool]:
        #     """Categorize error type and determine if retryable using intelligent pattern matching."""
        #     error_lower = error_message.lower()
        #
        #     # Permanent failure indicators (never retry)
        #     permanent_patterns = [
        #         r'\b(unauthorized|permission\s+denied|403|401)\b',
        #         r'\b(not\s+found|404|invalid\s+.*token)\b',
        #         r'\b(quota|rate\s+limit|429|too\s+many\s+requests)\b'
        #     ]
        #     for pattern in permanent_patterns:
        #         if re.search(pattern, error_lower):
        #             return "permanent", False
        #
        #     # Transient failure indicators (good retry candidates)
        #     transient_patterns = [
        #         r'\b(timeout|deadline|503|502|500)\b',
        #         r'\b(connection|network|temporary|transient)\b',
        #         r'\b(retry|again|busy|overloaded)\b'
        #     ]
        #     for pattern in transient_patterns:
        #         if re.search(pattern, error_lower):
        #             return "transient", True
        #
        #     # Unknown errors - use conservative heuristics
        #     if any(word in error_lower for word in ["invalid", "malformed", "syntax"]):
        #         return "validation", False  # Usually permanent
        #
        #     return "unknown", True  # Default to retryable for unknown errors
        #
        # retry_eligible_count = 0
        # permanent_error_count = 0
        # for i, message in enumerate(messages):
        #     error_type, is_retryable = categorize_error_type(message)
        #     if is_retryable:
        #         retry_eligible_count += 1
        #     else:
        #         permanent_error_count += 1
        #
        #     logger.info(
        #         f"ERROR_ANALYSIS: Analyzed error message {i+1}",
        #         integration=self.integration_name,
        #         error_message=message[:100] + "..." if len(message) > 100 else message,
        #         error_type=error_type,
        #         is_retryable=is_retryable
        #     )
        #
        # # Decision: retry if any errors are retryable and no permanent errors
        # should_retry = retry_eligible_count > 0 and permanent_error_count == 0

        # If any error message clearly indicates auth/resource/quota/network, do not retry
        for i, m in enumerate(messages):
            lm = m.lower()
            matching_patterns = [tok for tok in denylist if tok in lm]
            if matching_patterns:
                logger.info(
                    "RETRY_DECISION: Error message matches non-retryable patterns - will NOT retry",
                    integration=self.integration_name,
                    error_message_index=i,
                    error_message=m[:100] + "..." if len(m) > 100 else m,
                    matching_denylist_patterns=matching_patterns,
                    retry_decision="NOT_RETRYABLE",
                    reason="matches_permanent_failure_patterns",
                )
                return False

        # Otherwise, treat as retryable once (broad, as agreed)
        logger.info(
            "RETRY_DECISION: No error messages match permanent failure patterns - will retry",
            integration=self.integration_name,
            retry_decision="RETRYABLE",
            reason="no_permanent_failure_indicators",
            retry_attempts_allowed=1,
            error_messages_analyzed=len(messages),
        )
        return True

    def _execute_via_sub_agent(
        self, definition: PipedreamToolDefinition, instruction: str
    ) -> Dict[str, Any]:
        request_id = str(uuid.uuid4())
        logger.info(
            "Routing tool via backup sub-agent",
            integration=self.integration_name,
            tool=definition.name,
            request_id=request_id,
            arguments={"instruction": instruction},
        )
        try:
            client = self._backup_client or self._mcp_client
            result = client.call_tool_sync(
                tool_use_id=str(uuid.uuid4()),
                name=definition.name,
                arguments={"instruction": instruction},
            )
            result_dict = dict(result)
            logger.info(
                "Backup sub-agent execution completed",
                integration=self.integration_name,
                tool=definition.name,
                result_keys=_sorted_keys(result_dict),
                request_id=request_id,
            )
            return result_dict
        except Exception as exc:
            logger.error(
                "Backup sub-agent execution failed",
                integration=self.integration_name,
                tool=definition.name,
                error=str(exc),
                request_id=request_id,
                exc_info=True,
            )
            raise RuntimeError(str(exc)) from exc


def build_tool_definitions(tools: Iterable[Any]) -> List[PipedreamToolDefinition]:
    """
    Convert MCPAgentTool wrappers into lightweight definitions for the router.
    """
    definitions: List[PipedreamToolDefinition] = []
    for tool in tools:
        mcp_tool = getattr(tool, "mcp_tool", None)
        if mcp_tool is None:
            logger.warning(
                "Skipping MCP tool without mcp_tool attribute",
                tool_type=type(tool).__name__,
            )
            continue

        name = getattr(mcp_tool, "name", None) or getattr(tool, "tool_name", None)
        if not name:
            logger.warning(
                "Skipping MCP tool lacking a name", tool_type=type(tool).__name__
            )
            continue

        description = getattr(mcp_tool, "description", "") or getattr(
            tool, "description", ""
        )
        schema = _extract_input_schema(
            getattr(mcp_tool, "inputSchema", None)
            or getattr(mcp_tool, "input_schema", None)
        )

        if not schema:
            tool_spec = getattr(tool, "tool_spec", None)
            spec_dict = _normalise_json_dict(tool_spec)
            schema = _extract_input_schema(spec_dict.get("inputSchema"))
            if not description:
                description = spec_dict.get("description", "")

        annotations = _normalise_json_dict(getattr(mcp_tool, "annotations", None))

        definitions.append(
            PipedreamToolDefinition(
                name=name,
                description=description or f"Pipedream action {name}",
                schema=schema,
                annotations=annotations,
            )
        )

    return definitions


def definition_requires_backup(definition: PipedreamToolDefinition) -> bool:
    """Detect if a tool definition depends on dynamic props or remote options."""
    schema = definition.schema or {}
    properties = schema.get("properties", {})
    if isinstance(properties, dict):
        for _, prop_meta in properties.items():
            if not isinstance(prop_meta, dict):
                continue
            if prop_meta.get("reloadProps") or prop_meta.get("remoteOptions"):
                return True
    annotations = definition.annotations or {}
    if annotations.get("reloadProps") or annotations.get("remoteOptions"):
        return True
    return False


__all__ = [
    "ToolsOnlyIntegrationRouter",
    "PipedreamToolDefinition",
    "build_tool_definitions",
    "definition_requires_backup",
    "load_prompt_for_integration",
    "normalise_integration_name",
]
