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
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("Failed to read prompt file", path=str(path), error=str(exc))
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
        time = str(ti.get("time") or "").strip()
        tz = str(ti.get("timezone") or "").strip()
        day_of_week = str(ti.get("dayOfWeek") or "").strip()

        # Format: "Local date: {dayOfWeek}, {date}, Local time: {time} ({timezone})"
        if day_of_week and date and time and tz:
            return f"Local date: {day_of_week}, {date}, Local time: {time} ({tz})"

        # Fallback to partial info if not all fields available
        pieces = []
        if day_of_week and date:
            pieces.append(f"Local date: {day_of_week}, {date}")
        elif date:
            pieces.append(f"Local date: {date}")
        if time:
            pieces.append(f"Local time: {time}")
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

    def execute(
        self,
        tool_name: str,
        instruction: str,
        full_payload: bool = False,
    ) -> Dict[str, Any]:
        if not instruction or not instruction.strip():
            raise ValueError("instruction must be a non-empty string")
        definition = self._definitions.get(tool_name)
        if not definition:
            raise ValueError(
                f"Unknown Pipedream tool '{tool_name}'. Available: {', '.join(sorted(self._definitions))}"
            )

        # Check if this is a material tool requiring explicit user confirmation
        if _is_material_tool(tool_name):
            user_auth = get_current_user_auth() or {}
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

        payload = self._generate_payload(definition, instruction)
        logger.info(
            "Prepared payload for tools-only execution",
            integration=self.integration_name,
            tool=definition.name,
            payload_json=payload,
        )
        result = self._call_mcp_tool(definition, payload)

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

        logger.info(
            "Tools-only execution succeeded",
            integration=self.integration_name,
            tool=definition.name,
        )
        return postprocess_tool_result(
            result=result,
            instruction=instruction,
            integration_name=self.integration_name,
            tool_name=definition.name,
            external_user_id=self._external_user_id,
            full_payload=full_payload,
        )

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
        feedback: List[str] = []
        last_error: Optional[Exception] = None
        for attempt in range(2):
            prompt_text = self._build_user_prompt(definition, instruction, feedback)
            response = self._invoke_model(prompt_text, definition)
            logger.info(
                "LLM invocation completed",
                integration=self.integration_name,
                tool=definition.name,
                attempt=attempt + 1,
                response_json=response,
            )
            try:
                candidate = self._parse_json_response(response)
            except ValueError as exc:
                feedback.append(f"Attempt {attempt + 1}: {str(exc)}")
                last_error = exc
                continue
            validation_errors = self._validate_payload(definition, candidate)
            if validation_errors:
                feedback.append(
                    "Schema validation issues: " + "; ".join(validation_errors)
                )
                last_error = ValueError("; ".join(validation_errors))
                logger.info(
                    "LLM payload validation failed",
                    integration=self.integration_name,
                    tool=definition.name,
                    attempt=attempt + 1,
                    errors=validation_errors,
                )
                continue
            return dict(candidate)
        raise ValueError(
            f"Unable to construct parameters for {definition.name}: {last_error or 'model did not return valid JSON'}"
        )

    def _call_mcp_tool(
        self, definition: PipedreamToolDefinition, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        request_id = str(uuid.uuid4())
        logger.info(
            "Invoking Pipedream MCP action (tools-only)",
            integration=self.integration_name,
            tool=definition.name,
            payload_keys=_sorted_keys(payload),
            request_id=request_id,
        )
        try:
            tool_use_id = str(uuid.uuid4())
            result = self._mcp_client.call_tool_sync(
                tool_use_id=tool_use_id,
                name=definition.name,
                arguments=payload,
            )
            result_dict = dict(result)
            logger.info(
                "Pipedream MCP action completed (tools-only)",
                integration=self.integration_name,
                tool=definition.name,
                result_keys=_sorted_keys(result_dict),
                request_id=request_id,
            )
            return result_dict
        except Exception as exc:
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
            return False
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
        # If any error message clearly indicates auth/resource/quota/network, do not retry
        for m in messages:
            lm = m.lower()
            if any(tok in lm for tok in denylist):
                return False
        # Otherwise, treat as retryable once (broad, as agreed)
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
