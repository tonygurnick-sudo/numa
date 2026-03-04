"""
Claude Agent SDK runner module for Numa Workspace Agent.

Replaces cli_runner.py with native SDK-based execution.
Streams SDK message types directly for frontend consumption.
"""

import asyncio
import json
import os
import time
import uuid as uuid_mod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator, Awaitable, Callable, Optional

if TYPE_CHECKING:
    from numa_workspace_agent.agent_types import AgentTypeConfig

import structlog
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from numa_workspace_agent.agent_config import AgentConfig
from numa_workspace_agent.prompts import augment_prompt_with_context
from numa_workspace_agent.s3_workspace import (
    archive_claude_session,
    restore_claude_session,
    restore_trace_from_s3,
)
from numa_workspace_agent.sdk_config import (
    LOCAL_ROOT,
    create_agent_options,
    validate_model_id,
)
from numa_workspace_agent.stream_logger import StreamLog
from numa_workspace_agent.workspace import (
    get_active_session_id,
    get_workspace_paths,
    set_active_conversation,
)

logger = structlog.get_logger()

RunKey = tuple[str, str, str]


@dataclass
class RunHandle:
    """Track an in-flight SDK run for external interruption."""

    client: ClaudeSDKClient
    task: asyncio.Task
    stop_event: asyncio.Event
    request_id: str
    stop_reason: Optional[str] = None


# Registry of in-flight SDK runs, keyed by (user_sub, conversation_id, request_id).
# Used to support external stop requests from the /invocations?action=stop endpoint.
_active_runs: dict[RunKey, RunHandle] = {}
_active_runs_lock = asyncio.Lock()


async def register_run(key: RunKey, handle: RunHandle) -> None:
    """Register an active run so other requests can stop it."""
    async with _active_runs_lock:
        _active_runs[key] = handle


async def pop_run(key: RunKey) -> Optional[RunHandle]:
    """Remove and return an active run entry."""
    async with _active_runs_lock:
        return _active_runs.pop(key, None)


async def get_run(key: RunKey) -> Optional[RunHandle]:
    """Get an active run handle if present."""
    async with _active_runs_lock:
        return _active_runs.get(key)


async def request_stop(key: RunKey, reason: str = "user_requested") -> bool:
    """
    Request a stop for an active run by setting the stop event, interrupting the client,
    and cancelling the running task if needed.
    """
    async with _active_runs_lock:
        handle = _active_runs.get(key)
        if not handle:
            return False
        handle.stop_reason = reason
        handle.stop_event.set()
        client = handle.client
        task = handle.task

    try:
        await client.interrupt()
    except Exception as e:
        logger.warning(
            "Failed to interrupt SDK client",
            error=str(e),
            conversation_id=key[1],
            request_id=key[2],
        )

    if task and not task.done():
        task.cancel()
    return True


def format_sse_event(data: dict) -> bytes:
    """Format a dict as an SSE data event.

    SSE format: data: {json}\n\n
    The double newline signals end of event.
    """
    return f"data: {json.dumps(data)}\n\n".encode("utf-8")


def serialize_content_block(block: Any) -> dict[str, Any]:
    """Serialize a content block to a JSON-compatible dict."""
    if isinstance(block, TextBlock):
        return {"type": "text", "text": block.text}
    elif isinstance(block, ThinkingBlock):
        return {
            "type": "thinking",
            "thinking": block.thinking,
            "signature": block.signature,
        }
    elif isinstance(block, ToolUseBlock):
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": block.input,
        }
    elif isinstance(block, ToolResultBlock):
        return {
            "type": "tool_result",
            "tool_use_id": block.tool_use_id,
            "content": block.content,
            "is_error": block.is_error,
        }
    elif hasattr(block, "__dict__"):
        return {"type": type(block).__name__, **block.__dict__}
    else:
        return {"type": "unknown", "value": str(block)}


def serialize_message(message: Any) -> dict[str, Any]:
    """Serialize an SDK message to a JSON-compatible dict for trace storage."""
    timestamp = datetime.now(timezone.utc).isoformat()

    if isinstance(message, AssistantMessage):
        return {
            "type": "assistant",
            "timestamp": timestamp,
            "message": {
                "id": getattr(message, "id", None) or str(uuid_mod.uuid4()),
                "role": "assistant",
                "model": message.model,
                "content": [serialize_content_block(b) for b in message.content],
            },
            # Track subagent context: null = main agent, string = inside subagent
            "parent_tool_use_id": getattr(message, "parent_tool_use_id", None),
        }
    elif isinstance(message, UserMessage):
        content = message.content
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        elif isinstance(content, list):
            content = [serialize_content_block(b) for b in content]
        return {
            "type": "user",
            "timestamp": timestamp,
            "message": {
                "role": "user",
                "content": content,
            },
            # Track subagent context: null = main agent, string = inside subagent
            "parent_tool_use_id": getattr(message, "parent_tool_use_id", None),
        }
    elif isinstance(message, SystemMessage):
        return {
            "type": "system",
            "timestamp": timestamp,
            "subtype": message.subtype,
            "data": message.data,
        }
    elif isinstance(message, ResultMessage):
        return {
            "type": "result",
            "timestamp": timestamp,
            "subtype": message.subtype,
            "session_id": message.session_id,
            "duration_ms": message.duration_ms,
            "duration_api_ms": message.duration_api_ms,
            "is_error": message.is_error,
            "num_turns": message.num_turns,
            "total_cost_usd": message.total_cost_usd,
            "usage": message.usage,
            "result": message.result,
        }
    elif type(message).__name__ == "StreamEvent":
        # StreamEvent contains raw Anthropic API events (content_block_delta, etc.)
        # With fine-grained tool streaming enabled, this includes input_json_delta
        # for partial tool inputs that enable real-time Write tool preview
        # Note: StreamEvent is not exported from claude_agent_sdk, so we check by name
        event_data = getattr(message, "event", None)
        # Convert event to dict if it has __dict__, otherwise use as-is
        if event_data and hasattr(event_data, "__dict__"):
            event_dict = {
                k: v for k, v in event_data.__dict__.items() if not k.startswith("_")
            }
            # Handle nested objects (like delta) that may also need serialization
            for key, value in event_dict.items():
                if hasattr(value, "__dict__"):
                    event_dict[key] = {
                        k: v for k, v in value.__dict__.items() if not k.startswith("_")
                    }
        else:
            event_dict = event_data
        return {
            "type": "StreamEvent",
            "timestamp": timestamp,
            "event": event_dict,
            "parent_tool_use_id": getattr(message, "parent_tool_use_id", None),
        }
    elif hasattr(message, "__dict__"):
        return {
            "type": type(message).__name__,
            "timestamp": timestamp,
            **{k: v for k, v in message.__dict__.items() if not k.startswith("_")},
        }
    else:
        return {
            "type": "unknown",
            "timestamp": timestamp,
            "value": str(message),
        }


async def stream_claude_sdk(
    conversation_id: str,
    prompt: str,
    user_sub: str,
    timezone_str: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    available_kbs: Optional[list[dict]] = None,
    enabled_tools: Optional[list[str]] = None,
    is_cold_start: bool = False,
    attached_files: Optional[list[dict]] = None,
    attached_folders: Optional[list[dict]] = None,
    original_prompt: Optional[str] = None,
    model_id: Optional[str] = None,
    kb_listings: Optional[dict[str, dict]] = None,
    request_id: Optional[str] = None,
    disconnect_checker: Optional[Callable[[], Awaitable[bool]]] = None,
    v1_migration_context: Optional[str] = None,
    agent_config: Optional[AgentConfig] = None,
    agent_file_paths: Optional[list[str]] = None,
    external_user_id: Optional[str] = None,
    enabled_integrations: Optional[list[str]] = None,
    approval_mode: str = "always",
    email_signature: Optional[dict] = None,
    agent_type_config: Optional["AgentTypeConfig"] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[str] = None,
) -> AsyncIterator[bytes]:
    """
    Stream Claude SDK output for a conversation.

    This:
    1. Restores Claude session if conversation changed
    2. Creates SDK options with hooks
    3. Augments prompt with context
    4. Streams SDK message events
    5. Writes events to trace.jsonl
    6. Captures session_id from result
    7. Archives Claude session to S3

    Args:
        conversation_id: Conversation ID
        prompt: User prompt (may include assistant advice for Claude)
        user_sub: Cognito user sub for S3 session storage
        timezone_str: User timezone for date formatting
        user_email: User's email address for system prompt personalization
        today_string: Formatted date/time string for system prompt
        available_kbs: List of available knowledge bases for KB tool context
        enabled_tools: List of enabled tool names (e.g., ["web_search"])
        attached_files: List of file attachments [{path, filename, size}]
        attached_folders: List of folder attachments [{name, path, fileCount, totalSize}]
        original_prompt: Clean user prompt for trace storage (without advice tags)
        model_id: Optional model ID for Bedrock (global cross-region inference profile)
        kb_listings: Optional dict mapping kb_id -> {files, folders, total_count} for prompt context
        agent_config: Optional agent configuration for custom system prompts and restrictions
        agent_file_paths: Optional list of downloaded agent reference file paths
        user_profile: Optional user profile dict for AI personalisation

    Yields:
        SSE formatted events as bytes (SDK message types serialized)
    """
    paths = get_workspace_paths()
    trace_path = paths["trace_file"]
    session_id: Optional[str] = None
    captured_session_id: Optional[str] = None
    stop_reason: Optional[str] = None
    stop_event = asyncio.Event()
    handle: Optional[RunHandle] = None
    run_key: Optional[RunKey] = (
        (user_sub, conversation_id, request_id) if request_id else None
    )

    # Initialize stream log for verbose debugging
    stream_log = StreamLog(
        conversation_id=conversation_id,
        user_sub=user_sub,
        prompt=prompt,
    )

    # 1. Determine session_id for resumption
    # With per-conversation sessions, each container serves one conversation.
    # Cold start always restores from S3. Warm container uses local session_id.
    if is_cold_start:
        logger.info(
            "Restoring session from S3 (cold start)",
            conversation_id=conversation_id,
        )
        restore_result = restore_claude_session(
            user_sub, conversation_id, paths["system_dir"]
        )
        if restore_result and restore_result.get("session_id"):
            session_id = restore_result["session_id"]
            logger.debug(
                "Restored session_id from S3",
                phase="init",
                session_id=session_id,
            )

        # Restore the trace file to preserve conversation history.
        restore_trace_from_s3(user_sub, conversation_id)
    else:
        # Warm container: use locally stored session_id
        session_id = get_active_session_id()
        if session_id:
            logger.debug(
                "Using locally stored session_id",
                phase="init",
                session_id=session_id,
                conversation_id=conversation_id,
            )
        else:
            # Local files missing despite warm container - fallback to S3 restore
            # This can happen when:
            # - Container was warmed by a read-only request (GET /trace, /files)
            # - AgentCore cleared ephemeral storage between invocations
            logger.debug(
                "No local session_id, restoring from S3",
                phase="init",
                conversation_id=conversation_id,
            )
            restore_result = restore_claude_session(
                user_sub, conversation_id, paths["system_dir"]
            )
            if restore_result and restore_result.get("session_id"):
                session_id = restore_result["session_id"]

            # Also restore the trace file to preserve conversation history.
            restore_trace_from_s3(user_sub, conversation_id)

    # 2. List uploaded files for context
    uploaded_files: list[str] = []
    if paths["uploads"].exists():
        uploaded_files = [f.name for f in paths["uploads"].iterdir() if f.is_file()]

    # 3. Augment user prompt with upload context, folder info, KB info, and V1 migration context
    augmented_prompt = augment_prompt_with_context(
        prompt,
        uploaded_files,
        available_kbs,
        kb_listings,
        attached_folders,
        v1_migration_context,
    )

    # 4. Create SDK options with validated model
    validated_model = validate_model_id(model_id)
    options = create_agent_options(
        session_id=session_id,
        conversation_id=conversation_id,
        user_sub=user_sub,
        user_email=user_email,
        user_timezone=timezone_str,
        today_string=today_string,
        allowed_kb_ids=available_kbs,
        enabled_tools=enabled_tools,
        model=validated_model,
        agent_config=agent_config,
        agent_file_paths=agent_file_paths,
        external_user_id=external_user_id,
        enabled_integrations=enabled_integrations,
        request_id=request_id,
        email_signature=email_signature,
        agent_type_config=agent_type_config,
        user_profile=user_profile,
        company_profile=company_profile,
    )

    logger.info(
        "Starting Claude SDK",
        _name="SDK_START",
        phase="sdk",
        conversation_id=conversation_id,
        user_sub=user_sub,
        session_id=session_id,
        model_id=validated_model,
        has_uploads=len(uploaded_files) > 0,
        has_attachments=bool(attached_files),
        has_folders=bool(attached_folders),
        request_id=request_id,
        system_prompt_length=len(options.system_prompt) if options.system_prompt else 0,
        has_company_profile="**Company Information:**" in (options.system_prompt or ""),
    )

    # 5a. Write attachment event if files are attached (before user event)
    if attached_files:
        attachment_event: dict = {
            "type": "attachments",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "files": attached_files,
            "session_id": session_id or "",
            "request_id": request_id or "",
        }
        # Include folder metadata if folders were uploaded
        if attached_folders:
            attachment_event["folders"] = attached_folders
        with trace_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(attachment_event) + "\n")
        # Yield attachment event to frontend (SSE format)
        yield format_sse_event(attachment_event)

    # 5b. Write user prompt to trace BEFORE streaming SDK output
    # Use original_prompt (clean) for trace storage if provided,
    # otherwise fall back to prompt (which may include assistant advice tags)
    trace_prompt = original_prompt if original_prompt else prompt
    user_event = {
        "type": "user",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": trace_prompt}],
        },
        "session_id": session_id or "",
        "uuid": str(uuid_mod.uuid4()),
        "request_id": request_id or "",
    }
    with trace_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(user_event) + "\n")

    # Yield user event to frontend (SSE format)
    yield format_sse_event(user_event)

    message_count = 0
    # Track streaming tool_use blocks that may need approval.
    # When the SDK streams sub-agent tool calls, it yields StreamEvents
    try:
        # 6. Use ClaudeSDKClient for hooks support (query() doesn't fire hooks)
        async with ClaudeSDKClient(options=options) as client:
            if run_key:
                handle = RunHandle(
                    client=client,
                    task=asyncio.current_task(),  # type: ignore[arg-type]
                    stop_event=stop_event,
                    request_id=request_id or "",
                )
                await register_run(run_key, handle)

            # Send the query
            await client.query(augmented_prompt)

            # Stream responses - receive_response() completes when query finishes
            # (receive_messages() stays open for multi-turn and doesn't auto-end)
            async for message in client.receive_response():
                # External stop request
                if stop_event.is_set():
                    if handle and not stop_reason:
                        stop_reason = handle.stop_reason or "user_requested"
                    elif not stop_reason:
                        stop_reason = "user_requested"
                    try:
                        await client.interrupt()
                    except Exception:
                        pass
                    break

                # Client disconnect stop path
                if disconnect_checker and await disconnect_checker():
                    stop_reason = "client_disconnect"
                    stop_event.set()
                    if handle:
                        handle.stop_reason = stop_reason
                    try:
                        await client.interrupt()
                    except Exception:
                        pass
                    break

                message_count += 1
                msg_type = type(message).__name__

                # Log each message type (debug level to reduce noise)
                logger.debug(
                    "SDK message received",
                    message_type=msg_type,
                    message_num=message_count,
                    parent_tool_use_id=getattr(message, "parent_tool_use_id", None),
                )

                # Record events for verbose stream logging
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            stream_log.record_text(block.text)
                        elif isinstance(block, ThinkingBlock):
                            stream_log.record_thinking(block.thinking)
                        elif isinstance(block, ToolUseBlock):
                            stream_log.record_tool_start(
                                block.id,
                                block.name,
                                block.input if isinstance(block.input, dict) else None,
                            )
                elif isinstance(message, UserMessage):
                    # Check for tool results in user messages
                    content = message.content
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, ToolResultBlock):
                                stream_log.record_tool_result(
                                    block.tool_use_id,
                                    block.content,
                                    block.is_error,
                                )

                # Serialize message to JSON
                serialized = serialize_message(message)

                # Capture session_id and log summary from result message
                if isinstance(message, ResultMessage):
                    captured_session_id = message.session_id
                    serialized["session_id"] = captured_session_id
                    # Finalize stream log with result data
                    stream_log.finalize(message)
                    logger.info(
                        "SDK result summary",
                        _name="SDK_RESULT",
                        phase="sdk",
                        conversation_id=conversation_id,
                        session_id=message.session_id,
                        duration_ms=message.duration_ms,
                        num_turns=message.num_turns,
                        total_cost_usd=message.total_cost_usd,
                        is_error=message.is_error,
                        request_id=request_id,
                    )

                # Capture session_id from system init message
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    if "session_id" in message.data:
                        captured_session_id = message.data["session_id"]
                        logger.debug(
                            "SDK session initialized",
                            phase="sdk",
                            session_id=captured_session_id,
                        )

                # Write to trace file (NDJSON format for storage)
                trace_line = json.dumps(serialized) + "\n"
                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(trace_line)

                # Yield to caller (SSE format for streaming)
                yield format_sse_event(serialized)

                # Emit tool_approval SSE event for integration tools that need user approval.
                # This event is yielded AFTER the tool_use event but BEFORE the tool executes,
                # giving the frontend time to show an approval card while the tool polls DynamoDB.
                #
                # The approval_mode controls whether approval is required:
                # - 'always': every integration tool call needs manual approval (default)
                # - 'non_destructive': auto-approve read-only actions and draft actions,
                #   require approval for writes/deletes or unknown actions (fail-closed)
                # - 'never': auto-approve all integration tool calls
                APPROVAL_REQUIRED_TOOLS = ("run_action", "proxy_request")
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ToolUseBlock):
                            logger.info(
                                "ToolUseBlock seen",
                                _name="TOOL_USE_BLOCK_NAME",
                                tool_name=block.name,
                                matches_approval=any(
                                    t in block.name for t in APPROVAL_REQUIRED_TOOLS
                                ),
                            )
                        if isinstance(block, ToolUseBlock) and any(
                            t in block.name for t in APPROVAL_REQUIRED_TOOLS
                        ):
                            logger.info(
                                "AssistantMessage approval check",
                                _name="AM_APPROVAL_CHECK",
                                tool_name=block.name,
                                block_id=block.id,
                                parent_tool_use_id=getattr(
                                    message, "parent_tool_use_id", None
                                ),
                            )
                            tool_input = (
                                block.input if isinstance(block.input, dict) else {}
                            )
                            # Only show approval if the integration is actually enabled.
                            # run_action has action_key like "google_drive-get-current-user";
                            # proxy_request has integration_slug directly.
                            action_key = tool_input.get("action_key", "")
                            integration_slug = tool_input.get("integration_slug") or (
                                action_key.split("-")[0] if action_key else ""
                            )
                            if (
                                enabled_integrations
                                and integration_slug
                                and integration_slug not in enabled_integrations
                            ):
                                continue

                            # Compute the approval key early — needed for both
                            # schema lookup and the request ID map.
                            _approval_key = (
                                action_key
                                or f"{integration_slug}-{tool_input.get('method', 'request')}"
                            )

                            # Determine if this tool call should be auto-approved
                            # based on the resolved approval_mode.
                            auto_approved = False
                            schema_found = False
                            if approval_mode == "never":
                                auto_approved = True
                            elif approval_mode == "non_destructive":
                                # Read annotations from the action schema file on
                                # disk (not from tool input — Claude doesn't send
                                # annotations).  Schema path:
                                #   /workdir/tools/integrations/{slug}/{action_key}.json
                                schema_annotations = {}
                                try:
                                    schema_path = (
                                        Path("/workdir/tools/integrations")
                                        / integration_slug
                                        / f"{_approval_key}.json"
                                    )
                                    schema_found = schema_path.exists()
                                    if schema_found:
                                        schema_data = json.loads(
                                            schema_path.read_text(encoding="utf-8")
                                        )
                                        schema_annotations = schema_data.get(
                                            "annotations", {}
                                        )
                                except Exception as exc:
                                    logger.debug(
                                        "Could not read action schema for approval check",
                                        action_key=_approval_key,
                                        error=str(exc),
                                    )
                                # Auto-approve read-only actions and draft
                                # actions that are explicitly non-destructive.
                                # Drafts are saved locally and must be sent
                                # separately by the user, so they're safe.
                                # Missing annotations default to requiring
                                # approval (fail-closed).
                                if isinstance(schema_annotations, dict):
                                    read_only = schema_annotations.get(
                                        "readOnlyHint", False
                                    )
                                    is_draft = "draft" in _approval_key.lower()
                                    non_destructive = not schema_annotations.get(
                                        "destructiveHint", True
                                    )
                                    auto_approved = bool(
                                        read_only or (is_draft and non_destructive)
                                    )
                                else:
                                    auto_approved = False

                            logger.info(
                                "Integration tool approval decision",
                                _name="APPROVAL_DECISION",
                                phase="integrations",
                                tool_name=block.name,
                                action_key=_approval_key,
                                integration_slug=integration_slug,
                                approval_mode=approval_mode,
                                auto_approved=auto_approved,
                                schema_found=schema_found,
                            )

                            # Set NUMA_APPROVAL_MODE env var so the tools Lambda
                            # knows whether to skip DynamoDB polling.
                            os.environ["NUMA_APPROVAL_MODE"] = (
                                "auto" if auto_approved else "manual"
                            )

                            # Generate a per-tool-call approval ID and store in
                            # NUMA_REQUEST_ID_MAP (JSON dict of action_key → list of IDs).
                            # Each parallel tool pops its ID from the list in FIFO order,
                            # avoiding the race where a single env var gets overwritten.
                            approval_id = str(uuid_mod.uuid4())
                            try:
                                _id_map = json.loads(
                                    os.environ.get("NUMA_REQUEST_ID_MAP", "{}")
                                )
                            except (json.JSONDecodeError, TypeError):
                                _id_map = {}
                            _id_map.setdefault(_approval_key, []).append(approval_id)
                            os.environ["NUMA_REQUEST_ID_MAP"] = json.dumps(_id_map)
                            approval_event = {
                                "type": "tool_approval",
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "created_at": int(time.time()),
                                "tool_use_id": block.id,
                                "tool_name": block.name,
                                "action_key": action_key
                                or f"{integration_slug}-{tool_input.get('method', 'request')}",
                                "description": tool_input.get("description", ""),
                                "props_preview": tool_input.get(
                                    "props", tool_input.get("upstream_url", "")
                                ),
                                "request_id": approval_id,
                                "auto_approved": auto_approved,
                                "parent_tool_use_id": getattr(
                                    message, "parent_tool_use_id", None
                                ),
                            }
                            logger.info(
                                "AssistantMessage approval event emitting",
                                _name="AM_APPROVAL_EMIT",
                                tool_use_id=block.id,
                                tool_name=block.name,
                                action_key=approval_event["action_key"],
                                request_id=approval_id,
                                parent_tool_use_id=approval_event.get(
                                    "parent_tool_use_id"
                                ),
                                auto_approved=auto_approved,
                            )
                            with trace_path.open("a", encoding="utf-8") as f:
                                f.write(json.dumps(approval_event) + "\n")
                            yield format_sse_event(approval_event)

                            # Yield large SSE comment to force-flush the tool_approval
                            # through AgentCore's transport buffer. The buffer holds
                            # data until enough accumulates; 128KB of padding ensures
                            # any reasonable buffer is filled and flushed.
                            yield b": " + b"x" * 131072 + b"\n\n"

            # If we exited loop due to stop, emit a terminal event for the frontend/trace
            if stop_reason:
                stop_event_payload = {
                    "type": "completion",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "reason": "user_cancelled",
                    "stop_reason": stop_reason,
                    "session_id": captured_session_id or session_id or "",
                    "request_id": request_id or "",
                }
                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(stop_event_payload) + "\n")
                yield format_sse_event(stop_event_payload)

    except Exception as e:
        import traceback

        error_tb = traceback.format_exc()
        error_str = str(e)

        # Record error in stream log
        stream_log.is_error = True
        stream_log.error_message = error_str

        logger.error(
            "Claude SDK execution error",
            error=error_str,
            error_type=type(e).__name__,
            traceback=error_tb,
            conversation_id=conversation_id,
        )

        # Log the full error for debugging
        print(f"SDK_ERROR: {error_str}", flush=True)
        print(f"SDK_ERROR_TYPE: {type(e).__name__}", flush=True)
        print(f"SDK_ERROR_TRACEBACK:\n{error_tb}", flush=True)

        # Check if error has additional attributes (some SDK errors have more info)
        extra_info = {}
        if hasattr(e, "stderr"):
            extra_info["stderr"] = getattr(e, "stderr", "")
            print(f"SDK_ERROR_STDERR: {extra_info['stderr']}", flush=True)
        if hasattr(e, "stdout"):
            extra_info["stdout"] = getattr(e, "stdout", "")
            print(f"SDK_ERROR_STDOUT: {extra_info['stdout']}", flush=True)
        if hasattr(e, "returncode"):
            extra_info["returncode"] = getattr(e, "returncode", None)
        if hasattr(e, "cmd"):
            extra_info["cmd"] = str(getattr(e, "cmd", ""))

        error_event = {
            "type": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": error_str,
            "error_type": type(e).__name__,
            **extra_info,
        }
        # Write to trace file (NDJSON format for storage)
        trace_line = json.dumps(error_event) + "\n"
        with trace_path.open("a", encoding="utf-8") as f:
            f.write(trace_line)
        # Yield to caller (SSE format for streaming)
        yield format_sse_event(error_event)

    finally:
        # 7. Save session_id locally for warm container resumption
        if captured_session_id:
            set_active_conversation(conversation_id, session_id=captured_session_id)

        # 8. Archive Claude session to S3 at end of invocation
        archive_claude_session(
            user_sub,
            conversation_id,
            paths["system_dir"],
            session_id=captured_session_id,
        )

        # Remove run handle from registry
        if run_key:
            await pop_run(run_key)

        # 9. Log verbose stream summary for debugging
        stream_log.stop_reason = stop_reason
        stream_log.log_summary()

    logger.info(
        "Claude SDK completed",
        _name="SDK_COMPLETE",
        phase="sdk",
        conversation_id=conversation_id,
        user_sub=user_sub,
        session_id=captured_session_id,
        trace_size=trace_path.stat().st_size if trace_path.exists() else 0,
        request_id=request_id,
        stop_reason=stop_reason,
    )


async def run_claude_sdk(
    conversation_id: str,
    prompt: str,
    user_sub: str,
    timezone_str: Optional[str] = None,
    user_email: Optional[str] = None,
    today_string: Optional[str] = None,
    available_kbs: Optional[list[dict]] = None,
    enabled_tools: Optional[list[str]] = None,
    is_cold_start: bool = False,
    attached_files: Optional[list[dict]] = None,
    attached_folders: Optional[list[dict]] = None,
    original_prompt: Optional[str] = None,
    model_id: Optional[str] = None,
    kb_listings: Optional[dict[str, dict]] = None,
    request_id: Optional[str] = None,
    v1_migration_context: Optional[str] = None,
    agent_config: Optional[AgentConfig] = None,
    agent_file_paths: Optional[list[str]] = None,
    external_user_id: Optional[str] = None,
    enabled_integrations: Optional[list[str]] = None,
    approval_mode: str = "always",
    email_signature: Optional[dict] = None,
    agent_type_config: Optional["AgentTypeConfig"] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[str] = None,
) -> dict[str, Any]:
    """Run Claude SDK to completion and return the collected result.

    This is the non-streaming counterpart of :func:`stream_claude_sdk`.
    Instead of yielding SSE events, it runs the full agent loop, writes the
    trace to disk (same NDJSON format), and returns a result dict with the
    final assistant text, artifacts list, and usage metadata.

    Used by the ``sync`` and ``fire-and-forget`` response modes where the
    caller does not need incremental SSE events — just the final answer.

    Returns:
        {
            "status": "completed" | "error",
            "text": "<final assistant text>",
            "artifacts": [{"type": "file", "path": "..."}],
            "usage": {"num_turns": N, "total_cost_usd": X, "duration_ms": Y},
            "session_id": "...",
            "error": "..."  # only present when status == "error"
        }
    """
    paths = get_workspace_paths()
    trace_path = paths["trace_file"]
    session_id: Optional[str] = None
    captured_session_id: Optional[str] = None

    # Initialize stream log for debugging
    stream_log = StreamLog(
        conversation_id=conversation_id,
        user_sub=user_sub,
        prompt=prompt,
    )

    # 1. Restore session on cold start (same as streaming)
    if is_cold_start:
        restore_result = restore_claude_session(
            user_sub, conversation_id, paths["system_dir"]
        )
        if restore_result and restore_result.get("session_id"):
            session_id = restore_result["session_id"]
        restore_trace_from_s3(user_sub, conversation_id)
    else:
        session_id = get_active_session_id()
        if not session_id:
            restore_result = restore_claude_session(
                user_sub, conversation_id, paths["system_dir"]
            )
            if restore_result and restore_result.get("session_id"):
                session_id = restore_result["session_id"]
            restore_trace_from_s3(user_sub, conversation_id)

    # 2. Uploaded files for prompt context
    uploaded_files: list[str] = []
    if paths["uploads"].exists():
        uploaded_files = [f.name for f in paths["uploads"].iterdir() if f.is_file()]

    # 3. Augment prompt
    augmented_prompt = augment_prompt_with_context(
        prompt,
        uploaded_files,
        available_kbs,
        kb_listings,
        attached_folders,
        v1_migration_context,
    )

    # 3b. Default approval mode env var — overridden per tool call in the
    # message loop below (same as the streaming path in stream_claude_sdk).
    os.environ["NUMA_APPROVAL_MODE"] = "manual"

    # 4. Create SDK options
    validated_model = validate_model_id(model_id)
    options = create_agent_options(
        session_id=session_id,
        conversation_id=conversation_id,
        user_sub=user_sub,
        user_email=user_email,
        user_timezone=timezone_str,
        today_string=today_string,
        allowed_kb_ids=available_kbs,
        enabled_tools=enabled_tools,
        model=validated_model,
        agent_config=agent_config,
        agent_file_paths=agent_file_paths,
        external_user_id=external_user_id,
        enabled_integrations=enabled_integrations,
        request_id=request_id,
        email_signature=email_signature,
        agent_type_config=agent_type_config,
        user_profile=user_profile,
        company_profile=company_profile,
    )

    logger.info(
        "Starting Claude SDK (non-streaming)",
        _name="SDK_RUN_START",
        phase="sdk",
        conversation_id=conversation_id,
        user_sub=user_sub,
        session_id=session_id,
        model_id=validated_model,
        request_id=request_id,
    )

    # 5. Write user prompt to trace
    trace_prompt = original_prompt if original_prompt else prompt
    user_event = {
        "type": "user",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": trace_prompt}],
        },
        "session_id": session_id or "",
        "uuid": str(uuid_mod.uuid4()),
        "request_id": request_id or "",
    }
    with trace_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(user_event) + "\n")

    # Collect assistant text blocks and metadata
    collected_text: list[str] = []
    result_meta: dict[str, Any] = {}

    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(augmented_prompt)

            async for message in client.receive_response():
                msg_type = type(message).__name__

                # Record in stream log
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            stream_log.record_text(block.text)
                            collected_text.append(block.text)
                        elif isinstance(block, ThinkingBlock):
                            stream_log.record_thinking(block.thinking)
                        elif isinstance(block, ToolUseBlock):
                            stream_log.record_tool_start(
                                block.id,
                                block.name,
                                block.input if isinstance(block.input, dict) else None,
                            )
                elif isinstance(message, UserMessage):
                    content = message.content
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, ToolResultBlock):
                                stream_log.record_tool_result(
                                    block.tool_use_id,
                                    block.content,
                                    block.is_error,
                                )

                # Per-tool-call approval mode for integration tools.
                # Identical to stream_claude_sdk: checks approval_mode and
                # schema annotations, sets NUMA_APPROVAL_MODE env var, and
                # generates NUMA_REQUEST_ID_MAP entries.
                APPROVAL_REQUIRED_TOOLS = ("run_action", "proxy_request")
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ToolUseBlock) and any(
                            t in block.name for t in APPROVAL_REQUIRED_TOOLS
                        ):
                            tool_input = (
                                block.input if isinstance(block.input, dict) else {}
                            )
                            action_key = tool_input.get("action_key", "")
                            integration_slug = tool_input.get("integration_slug") or (
                                action_key.split("-")[0] if action_key else ""
                            )
                            if (
                                enabled_integrations
                                and integration_slug
                                and integration_slug not in enabled_integrations
                            ):
                                continue

                            _approval_key = (
                                action_key
                                or f"{integration_slug}-{tool_input.get('method', 'request')}"
                            )

                            # Determine if this tool call should be auto-approved
                            # based on the resolved approval_mode.
                            auto_approved = False
                            if approval_mode == "never":
                                auto_approved = True
                            elif approval_mode == "non_destructive":
                                schema_annotations = {}
                                try:
                                    schema_path = (
                                        Path("/workdir/tools/integrations")
                                        / integration_slug
                                        / f"{_approval_key}.json"
                                    )
                                    if schema_path.exists():
                                        schema_data = json.loads(
                                            schema_path.read_text(encoding="utf-8")
                                        )
                                        schema_annotations = schema_data.get(
                                            "annotations", {}
                                        )
                                except Exception as exc:
                                    logger.debug(
                                        "Could not read action schema for approval check",
                                        action_key=_approval_key,
                                        error=str(exc),
                                    )
                                if isinstance(schema_annotations, dict):
                                    read_only = schema_annotations.get(
                                        "readOnlyHint", False
                                    )
                                    is_draft = "draft" in _approval_key.lower()
                                    non_destructive = not schema_annotations.get(
                                        "destructiveHint", True
                                    )
                                    auto_approved = bool(
                                        read_only or (is_draft and non_destructive)
                                    )
                                else:
                                    auto_approved = False

                            # Set NUMA_APPROVAL_MODE env var so the tools Lambda
                            # knows whether to skip DynamoDB polling.
                            os.environ["NUMA_APPROVAL_MODE"] = (
                                "auto" if auto_approved else "manual"
                            )

                            # Generate a per-tool-call approval ID and store in
                            # NUMA_REQUEST_ID_MAP (JSON dict of action_key → list
                            # of IDs). Each parallel tool pops its ID from the
                            # list in FIFO order.
                            approval_id = str(uuid_mod.uuid4())
                            try:
                                _id_map = json.loads(
                                    os.environ.get("NUMA_REQUEST_ID_MAP", "{}")
                                )
                            except (json.JSONDecodeError, TypeError):
                                _id_map = {}
                            _id_map.setdefault(_approval_key, []).append(approval_id)
                            os.environ["NUMA_REQUEST_ID_MAP"] = json.dumps(_id_map)

                            logger.info(
                                "Non-streaming approval check",
                                _name="SYNC_APPROVAL_CHECK",
                                tool_name=block.name,
                                action_key=_approval_key,
                                auto_approved=auto_approved,
                                approval_mode=approval_mode,
                                request_id=approval_id,
                            )

                # Serialize and write to trace
                serialized = serialize_message(message)

                if isinstance(message, ResultMessage):
                    captured_session_id = message.session_id
                    serialized["session_id"] = captured_session_id
                    stream_log.finalize(message)
                    result_meta = {
                        "num_turns": message.num_turns,
                        "total_cost_usd": message.total_cost_usd,
                        "duration_ms": message.duration_ms,
                        "is_error": message.is_error,
                    }
                    logger.info(
                        "SDK run result",
                        _name="SDK_RUN_RESULT",
                        phase="sdk",
                        conversation_id=conversation_id,
                        duration_ms=message.duration_ms,
                        num_turns=message.num_turns,
                        total_cost_usd=message.total_cost_usd,
                        is_error=message.is_error,
                    )

                if isinstance(message, SystemMessage) and message.subtype == "init":
                    if "session_id" in message.data:
                        captured_session_id = message.data["session_id"]

                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(serialized) + "\n")

    except Exception as e:
        import traceback

        error_tb = traceback.format_exc()
        stream_log.is_error = True
        stream_log.error_message = str(e)

        logger.error(
            "Claude SDK run error",
            _name="SDK_RUN_ERROR",
            phase="sdk",
            error=str(e),
            error_type=type(e).__name__,
            traceback=error_tb,
            conversation_id=conversation_id,
        )

        error_event = {
            "type": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
            "error_type": type(e).__name__,
        }
        with trace_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(error_event) + "\n")

        return {
            "status": "error",
            "text": "",
            "artifacts": [],
            "usage": result_meta,
            "session_id": captured_session_id or session_id or "",
            "error": str(e),
        }

    finally:
        if captured_session_id:
            set_active_conversation(conversation_id, session_id=captured_session_id)

        archive_claude_session(
            user_sub,
            conversation_id,
            paths["system_dir"],
            session_id=captured_session_id,
        )

        stream_log.log_summary()

    # Gather artifacts from outputs directory
    artifacts: list[dict[str, str]] = []
    outputs_dir = paths["outputs"]
    if outputs_dir.exists():
        for f in outputs_dir.rglob("*"):
            if f.is_file():
                artifacts.append(
                    {
                        "type": "file",
                        "path": f"outputs/{f.relative_to(outputs_dir)}",
                    }
                )

    logger.info(
        "Claude SDK run completed",
        _name="SDK_RUN_COMPLETE",
        phase="sdk",
        conversation_id=conversation_id,
        text_length=sum(len(t) for t in collected_text),
        artifact_count=len(artifacts),
        request_id=request_id,
    )

    return {
        "status": "completed",
        "text": "".join(collected_text),
        "artifacts": artifacts,
        "usage": result_meta,
        "session_id": captured_session_id or session_id or "",
    }


def check_sdk_available() -> bool:
    """
    Check if Claude Agent SDK is available.

    Returns:
        True if SDK is available, False otherwise
    """
    try:
        from claude_agent_sdk import ClaudeSDKClient  # noqa: F401

        return True
    except ImportError:
        return False


async def get_sdk_version() -> Optional[str]:
    """
    Get Claude Agent SDK version.

    Returns:
        Version string or None if unavailable
    """
    try:
        import claude_agent_sdk

        return getattr(claude_agent_sdk, "__version__", "unknown")
    except Exception as e:
        logger.warning("Failed to get SDK version", error=str(e))
        return None
