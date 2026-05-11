"""
Claude Agent SDK runner module for Numa Workspace Agent.

Replaces cli_runner.py with native SDK-based execution.
Streams SDK message types directly for frontend consumption.
"""

import asyncio
import errno
import json
import os
import re
import time
import uuid as uuid_mod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator, Awaitable, Callable, Optional

if TYPE_CHECKING:
    from numa_workspace_agent.agent_types import AgentTypeConfig

import boto3
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
from numa_workspace_agent.quota_fallback import (
    is_daily_quota_error,
    mark_quota_exhausted,
    resolve_model_with_fallback,
)
from numa_workspace_agent.s3_workspace import (
    archive_claude_session,
    restore_claude_session,
    restore_trace_from_s3,
)
from numa_workspace_agent.sdk_config import (
    DEFAULT_MODEL,
    FALLBACK_MODEL,
    LOCAL_ROOT,
    _regionalize,
    _strip_prefix,
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


async def has_active_run(user_sub: str, conversation_id: str) -> bool:
    """Check if any active run exists for a given user + conversation (any request_id)."""
    async with _active_runs_lock:
        return any(k[0] == user_sub and k[1] == conversation_id for k in _active_runs)


async def request_stop(key: RunKey, reason: str = "user_requested") -> bool:
    """
    Request a graceful stop for an active run.

    Sets the stop event and interrupts the SDK client so the stream loop
    exits cleanly, writes the completion event to the trace, and lets
    the finally block sync to S3.  We intentionally do NOT cancel the
    asyncio task -- task.cancel() raises CancelledError which races with
    the graceful shutdown path and can kill the task before the trace is
    written and synced.
    """
    async with _active_runs_lock:
        handle = _active_runs.get(key)
        if not handle:
            logger.info(
                "Stop requested but no active run found",
                _name="STOP_NO_RUN",
                conversation_id=key[1],
                request_id=key[2],
            )
            return False
        handle.stop_reason = reason
        handle.stop_event.set()
        client = handle.client

    logger.info(
        "Stop event set, interrupting SDK client",
        _name="STOP_INTERRUPT",
        conversation_id=key[1],
        request_id=key[2],
        reason=reason,
    )

    try:
        await client.interrupt()
        logger.info(
            "SDK client interrupted successfully",
            _name="STOP_INTERRUPTED",
            conversation_id=key[1],
            request_id=key[2],
        )
    except Exception as e:
        logger.warning(
            "Failed to interrupt SDK client",
            _name="STOP_INTERRUPT_FAILED",
            error=str(e),
            conversation_id=key[1],
            request_id=key[2],
        )

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


def _transcribe_audio_file(file_path: str) -> dict[str, Any]:
    """Invoke the workspace-chat-tools Lambda to transcribe an audio file.

    Uses the default boto3 credentials (local account) since this runs
    in the main process before cross-account assume.

    Args:
        file_path: Workspace path (e.g., /workdir/uploads/recording.ogg)

    Returns:
        Dict with text, language, duration_seconds
    """
    from botocore.config import Config

    lambda_name = os.environ.get("WORKSPACE_TOOLS_LAMBDA_NAME", "")
    if not lambda_name:
        raise ValueError("WORKSPACE_TOOLS_LAMBDA_NAME not configured")

    region = os.environ.get("AWS_REGION", "us-east-1")
    lambda_client = boto3.client(
        "lambda",
        region_name=region,
        config=Config(read_timeout=120),
    )

    event = {
        "tool": "transcribe",
        "user_sub": os.environ.get("NUMA_USER_SUB", ""),
        "conversation_id": os.environ.get("NUMA_CONVERSATION_ID", ""),
        "params": {"file_path": file_path},
    }

    response = lambda_client.invoke(
        FunctionName=lambda_name,
        Payload=json.dumps(event),
        InvocationType="RequestResponse",
    )

    payload = json.loads(response["Payload"].read())

    if response.get("FunctionError"):
        raise Exception(f"Transcribe Lambda failed: {payload}")

    if payload.get("status") == "error":
        raise Exception(f"Transcription error: {payload.get('error', 'Unknown')}")

    return payload.get("result", {})


# ── Background-bash watching state ────────────────────────────────────
# When the model launches a Bash command with run_in_background=True, the
# task runs inside the MicroVM after the model's turn would otherwise end.
# The watching state holds the SSE stream open so the frontend can render a
# "background task running" chip and the composer stays enabled. Every poll,
# the harness checks each tracked shell's output file: if mtime is stable for
# _BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS, the task is marked completed
# and a `state: "completed"` SSE event fires. The chip transitions to
# "✓ done — send a message to see the result". The user explicitly drives
# the next turn (no harness-initiated model re-invocation), which is much
# cheaper than a synthetic-message approach.

# Max wall-clock the harness will sit in the watching state. After this,
# we emit a timeout event and close the SSE. Next user message picks back
# up. 10 min covers most "I'll walk away and come back" patterns.
_BACKGROUND_WATCH_MAX_SECONDS = 600

# How often we emit a chip-pulse SSE event with updated elapsed_seconds.
# Light — no model invocation, just a server-push for the UI tick.
_BACKGROUND_WATCH_PULSE_INTERVAL = 5

# Treat a shell as completed when its output file's mtime has been stable
# for this many seconds. Heuristic — false-positives recover (user pings,
# model calls BashOutput, sees actual state). 30s is conservative enough
# to absorb most legitimate quiet periods (compute-bound work, API polling).
_BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS = 30

# Regex for parsing the SDK's `run_in_background: true` tool-result message.
# Format observed in the bundled SDK binary:
#   "Command running in background with ID: <shell_id>. Output is being written to: <path>"
# We accept either the regular ID form or the "manually backgrounded" form
# the SDK emits when the user moves a foreground command to background via
# Ctrl+B (`Command was manually backgrounded by user with ID: ...`).
_BG_BASH_RESULT_RE = re.compile(
    r"(?:Command running in background with ID|"
    r"Command was manually backgrounded by user with ID|"
    r"Command exceeded the assistant-mode blocking budget .*? "
    r"and was moved to the background with ID): "
    r"(?P<shell_id>[A-Za-z0-9_\-]+)\. .*?"
    r"Output is being written to: (?P<path>[^\s,]+)",
    re.DOTALL,
)


def _parse_background_bash_result(
    content: Any,
) -> Optional[tuple[str, str]]:
    """Extract (shell_id, output_path) from a Bash tool_result when the
    corresponding Bash tool_use had run_in_background=true.

    The SDK encodes a standard sentence into the tool_result content.
    Returns None if the content doesn't match the expected format
    (e.g. the bash was foreground after all, or the SDK emitted an error
    instead of the success message).
    """
    if content is None:
        return None
    # ToolResultBlock.content may be a str or a list of {type, text} blocks.
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
            elif isinstance(item, str):
                parts.append(item)
        text = "\n".join(parts)
    else:
        return None
    match = _BG_BASH_RESULT_RE.search(text)
    if not match:
        return None
    return match.group("shell_id"), match.group("path")


def _check_shell_completion(
    output_path: str,
    state: dict[str, Any],
) -> bool:
    """Return True if the shell at `output_path` looks completed.

    Heuristic: file mtime hasn't changed for
    _BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS. `state` is per-shell scratch
    storage carried across polls; the caller passes the same dict in each
    iteration.

    Returns False (still running) if the file doesn't yet exist, has been
    modified within the stability window, or we can't stat it for any reason.
    """
    try:
        stat = os.stat(output_path)
    except FileNotFoundError:
        # File hasn't been created yet — bash started but no output yet.
        # Treat as still running; reset stability tracking.
        state["last_mtime"] = None
        state["last_size"] = None
        state["stable_since"] = None
        return False
    except OSError as e:
        logger.warning(
            "Could not stat background-bash output file; treating as running",
            output_path=output_path,
            error=str(e),
        )
        return False

    now = time.time()
    current_mtime = stat.st_mtime
    current_size = stat.st_size

    if (
        state.get("last_mtime") == current_mtime
        and state.get("last_size") == current_size
    ):
        # Unchanged since last poll. Has it been stable long enough?
        stable_since = state.get("stable_since") or now
        state["stable_since"] = stable_since
        return (now - stable_since) >= _BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS

    # Changed (or first observation) — reset the stability clock.
    state["last_mtime"] = current_mtime
    state["last_size"] = current_size
    state["stable_since"] = now
    return False


def _read_output_preview(output_path: str, max_bytes: int = 2048) -> str:
    """Read up to the last `max_bytes` of a shell's output file for a chip
    preview. Best-effort — returns empty string on any error."""
    try:
        size = os.path.getsize(output_path)
        with open(output_path, "rb") as f:
            if size > max_bytes:
                f.seek(-max_bytes, os.SEEK_END)
            data = f.read()
        return data.decode("utf-8", errors="replace")
    except (FileNotFoundError, OSError) as e:
        logger.warning(
            "Could not read background-bash output preview",
            output_path=output_path,
            error=str(e),
        )
        return ""


async def _emit_background_watching_state(
    *,
    trace_path: Path,
    stop_event: asyncio.Event,
    disconnect_checker: Optional[Callable[[], Awaitable[bool]]],
    request_id: Optional[str],
    conversation_id: str,
    background_shells: dict[str, dict[str, Any]],
) -> AsyncIterator[bytes]:
    """Hold the SSE stream open after a turn ends with live background bash shells.

    Emits:
      - turn_state="watching" once on entry (signals frontend to mark assistant
        message complete + enable composer + render chip)
      - background_task_status="running" pulses every _BACKGROUND_WATCH_PULSE_INTERVAL
        seconds, with updated elapsed_seconds, while shells are still running
      - background_task_status="completed" with shell_id + output_preview when
        a shell's output file goes stable for _BACKGROUND_WATCH_COMPLETION_STABLE_SECONDS
      - background_task_status terminal event on exit, with state =
        "timeout" / "stop_event" / "client_disconnect" / "all_completed"

    Detection of completion is harness-side mtime polling — no model invocation.
    Aborts on stop_event, client disconnect, all shells completed, or 10-min cap.
    """
    started_at = datetime.now(timezone.utc)
    # Per-shell scratch state for completion detection.
    # shell_id -> {last_mtime, last_size, stable_since}
    completion_state: dict[str, dict[str, Any]] = {sid: {} for sid in background_shells}
    # Shells we've already emitted a "completed" event for.
    completed_shell_ids: set[str] = set()

    logger.info(
        "Entering background-bash watching state",
        _name="BACKGROUND_WATCH_START",
        conversation_id=conversation_id,
        request_id=request_id,
        max_seconds=_BACKGROUND_WATCH_MAX_SECONDS,
        tracked_shells=list(background_shells.keys()),
    )

    entry_event = {
        "type": "turn_state",
        "state": "watching",
        "timestamp": started_at.isoformat(),
        "request_id": request_id or "",
        "shells": [
            {"shell_id": sid, "command": info.get("command", "")}
            for sid, info in background_shells.items()
        ],
    }
    with trace_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry_event) + "\n")
    yield format_sse_event(entry_event)

    exit_reason = "timeout"
    while True:
        elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
        if elapsed >= _BACKGROUND_WATCH_MAX_SECONDS:
            exit_reason = "timeout"
            break
        if stop_event.is_set():
            exit_reason = "stop_event"
            break
        if disconnect_checker and await disconnect_checker():
            exit_reason = "client_disconnect"
            break

        # Check each shell for completion (file mtime stability).
        for shell_id, info in background_shells.items():
            if shell_id in completed_shell_ids:
                continue
            output_path = info.get("output_path", "")
            if not output_path:
                continue
            if _check_shell_completion(output_path, completion_state[shell_id]):
                # Newly detected completion — emit and remember.
                completed_shell_ids.add(shell_id)
                completion_event = {
                    "type": "background_task_status",
                    "state": "completed",
                    "shell_id": shell_id,
                    "command": info.get("command", ""),
                    "elapsed_seconds": int(elapsed),
                    "output_preview": _read_output_preview(output_path),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "request_id": request_id or "",
                }
                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(completion_event) + "\n")
                yield format_sse_event(completion_event)
                logger.info(
                    "Background shell completed (mtime stability)",
                    _name="BG_SHELL_COMPLETED",
                    shell_id=shell_id,
                    elapsed_seconds=int(elapsed),
                    conversation_id=conversation_id,
                    request_id=request_id,
                )

        # If every tracked shell is now complete, exit the watching state.
        if completed_shell_ids and completed_shell_ids == set(background_shells.keys()):
            exit_reason = "all_completed"
            break

        # Chip pulse — frontend uses elapsed_seconds to render "running… (1m 23s)"
        pulse_event = {
            "type": "background_task_status",
            "state": "running",
            "elapsed_seconds": int(elapsed),
            "active_shells": len(background_shells) - len(completed_shell_ids),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": request_id or "",
        }
        # Don't trace pulses (noisy) — only stream to client
        yield format_sse_event(pulse_event)

        # Sleep in 1s slices so stop_event / disconnect are responsive
        for _ in range(_BACKGROUND_WATCH_PULSE_INTERVAL):
            if stop_event.is_set() or (
                disconnect_checker and await disconnect_checker()
            ):
                break
            await asyncio.sleep(1)

    elapsed_final = int((datetime.now(timezone.utc) - started_at).total_seconds())
    terminal_event = {
        "type": "background_task_status",
        "state": exit_reason,
        "elapsed_seconds": elapsed_final,
        "completed_shells": list(completed_shell_ids),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "request_id": request_id or "",
    }
    with trace_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(terminal_event) + "\n")
    yield format_sse_event(terminal_event)

    logger.info(
        "Exited background-bash watching state",
        _name="BACKGROUND_WATCH_END",
        conversation_id=conversation_id,
        request_id=request_id,
        elapsed_seconds=elapsed_final,
        reason=exit_reason,
        completed_shells=list(completed_shell_ids),
    )


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
    available_integrations: Optional[list[dict]] = None,
    connected_data_connectors: Optional[list[dict]] = None,
    approval_mode: str = "always",
    numa_tool_approval_mode: Optional[dict[str, str]] = None,
    email_signature: Optional[dict] = None,
    agent_type_config: Optional["AgentTypeConfig"] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[dict | str] = None,
    feature_flags: Optional[dict[str, bool]] = None,
    voice_recordings: Optional[list[str]] = None,
    thinking_override: Optional[str] = None,
) -> AsyncIterator[bytes]:
    """
    Stream Claude SDK output for a conversation.

    This:
    1. Restores Claude session if conversation changed
    2. Creates SDK options with hooks
    3. Transcribes voice recordings (if any)
    4. Augments prompt with context
    5. Streams SDK message events
    6. Writes events to trace.jsonl
    7. Captures session_id from result
    8. Archives Claude session to S3

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

    # Background-bash watching state. Tracks shells the model launched with
    # `run_in_background: true` so the watching loop can poll their output files
    # for completion (mtime stability) without re-invoking the model.
    #
    # Two-stage capture:
    #   1. AssistantMessage with Bash tool_use (run_in_background=True) → record
    #      tool_use_id in `pending_bg_tool_uses`. We know the model started
    #      something but don't yet have the shell_id / output path.
    #   2. UserMessage with ToolResultBlock matching that tool_use_id → parse
    #      the SDK's standard result message ("Command running in background
    #      with ID: <X>. Output is being written to: <path>") to extract the
    #      shell_id and output file path. Move into `background_shells`.
    #
    # If a tool_use never gets a matching tool_result (e.g. model interrupted
    # mid-tool-call), the entry stays in `pending_bg_tool_uses` and is ignored
    # by the watching state.
    pending_bg_tool_uses: dict[str, str] = {}  # tool_use_id -> command (for logs)
    background_shells: dict[str, dict[str, Any]] = (
        {}
    )  # shell_id -> {command, output_path}

    # Initialize stream log for verbose debugging
    stream_log = StreamLog(
        conversation_id=conversation_id,
        user_sub=user_sub,
        prompt=prompt,
    )

    # 1. Determine session_id and download files
    # Parallelize S3 operations where possible to reduce cold-start latency.
    if is_cold_start:
        logger.info(
            "Restoring session from S3 (cold start)",
            conversation_id=conversation_id,
        )

        async def _restore_session():
            return await asyncio.to_thread(
                restore_claude_session, user_sub, conversation_id, paths["system_dir"]
            )

        async def _restore_trace():
            await asyncio.to_thread(restore_trace_from_s3, user_sub, conversation_id)

        restore_result, _ = await asyncio.gather(_restore_session(), _restore_trace())

        if restore_result and restore_result.get("session_id"):
            session_id = restore_result["session_id"]
            logger.debug(
                "Restored session_id from S3",
                phase="init",
                session_id=session_id,
            )
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

            restore_trace_from_s3(user_sub, conversation_id)

    # 2. Transcribe voice recordings (voice input pre-processing)
    # Only transcribes files explicitly marked as voice recordings by the frontend.
    # Regular audio file uploads (e.g., user uploading an mp3) are left as-is.
    if voice_recordings:
        # Emit transcribing event so frontend shows indicator
        yield format_sse_event(
            {
                "type": "transcribing",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "files": voice_recordings,
                "request_id": request_id or "",
            }
        )

        transcriptions: list[str] = []
        for voice_file in voice_recordings:
            # Resolve to full workspace path
            file_path = (
                f"/workdir/{voice_file}"
                if not voice_file.startswith("/")
                else voice_file
            )
            try:
                result = await asyncio.to_thread(
                    _transcribe_audio_file,
                    file_path,
                )
                text = result.get("text", "").strip()
                if text:
                    transcriptions.append(text)
                logger.info(
                    "Voice recording transcribed",
                    file=voice_file,
                    text_length=len(text),
                    language=result.get("language"),
                    duration=result.get("duration_seconds"),
                )
            except Exception as e:
                logger.error(
                    "Failed to transcribe voice recording",
                    file=voice_file,
                    error=str(e),
                )
            finally:
                # Remove voice recording (ephemeral -- don't sync back to S3)
                try:
                    Path(file_path).unlink()
                except OSError:
                    pass

        if transcriptions:
            transcribed_text = " ".join(transcriptions)
            if not prompt.strip():
                prompt = transcribed_text
            else:
                prompt = f"{transcribed_text}\n\n{prompt}"
            # Update original_prompt too so the trace shows the transcribed text
            original_prompt = prompt

    # 3. List uploaded files for context (after audio files removed)
    uploaded_files: list[str] = []
    if paths["uploads"].exists():
        uploaded_files = [f.name for f in paths["uploads"].iterdir() if f.is_file()]

    # 4. Augment user prompt with upload context, folder info, KB info, and V1 migration context.
    # today_string is prepended here (not in system prompt) to keep the system prompt
    # stable for prompt caching -- each user message gets a timestamp instead.
    augmented_prompt = augment_prompt_with_context(
        prompt,
        uploaded_files,
        available_kbs,
        kb_listings,
        attached_folders,
        v1_migration_context,
        today_string=today_string,
    )

    # 4. Create SDK options with validated model (with quota fallback pre-check)
    # Precedence: request override > agent_type_config.default_model > DEFAULT_MODEL.
    # The type-config consultation is also done inside create_agent_options, but
    # we need a concrete model here to feed resolve_model_with_fallback.
    validated_model = validate_model_id(model_id)
    if (
        validated_model is None
        and agent_type_config
        and agent_type_config.default_model
    ):
        validated_model = _regionalize(_strip_prefix(agent_type_config.default_model))
    effective_model = validated_model or DEFAULT_MODEL
    effective_model, _is_fallback = resolve_model_with_fallback(effective_model)
    validated_model = effective_model

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
        available_integrations=available_integrations,
        connected_data_connectors=connected_data_connectors,
        request_id=request_id,
        email_signature=email_signature,
        agent_type_config=agent_type_config,
        user_profile=user_profile,
        company_profile=company_profile,
        feature_flags=feature_flags,
        thinking_override=thinking_override,
    )

    logger.info(
        "Starting Claude SDK",
        _name="SDK_START",
        phase="sdk",
        conversation_id=conversation_id,
        user_sub=user_sub,
        session_id=session_id,
        model_id=options.model,
        has_uploads=len(uploaded_files) > 0,
        has_attachments=bool(attached_files),
        has_folders=bool(attached_folders),
        request_id=request_id,
        system_prompt_length=len(options.system_prompt) if options.system_prompt else 0,
        has_company_profile="**Company Profile:**" in (options.system_prompt or ""),
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
    _daily_quota_hit = False  # Set when 429 "per day" detected on ResultMessage
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
            _stop_interrupt_sent = False
            async for message in client.receive_response():
                # External stop request -- interrupt but DON'T break.
                # We let receive_response() finish naturally so the SDK
                # commits the partial response to its conversation history
                # (via the ResultMessage).  We just stop yielding SSE to
                # the frontend.
                if not _stop_interrupt_sent and stop_event.is_set():
                    if handle and not stop_reason:
                        stop_reason = handle.stop_reason or "user_requested"
                    elif not stop_reason:
                        stop_reason = "user_requested"
                    logger.info(
                        "Stop event detected, interrupting SDK (draining response)",
                        _name="STOP_STREAM_BREAK",
                        conversation_id=conversation_id,
                        request_id=request_id,
                        stop_reason=stop_reason,
                        messages_received=message_count,
                    )
                    try:
                        await client.interrupt()
                    except Exception:
                        pass
                    _stop_interrupt_sent = True
                    # Continue iterating -- don't break

                # Client disconnect stop path
                if (
                    not _stop_interrupt_sent
                    and disconnect_checker
                    and await disconnect_checker()
                ):
                    stop_reason = "client_disconnect"
                    stop_event.set()
                    if handle:
                        handle.stop_reason = stop_reason
                    try:
                        await client.interrupt()
                    except Exception:
                        pass
                    _stop_interrupt_sent = True
                    # Continue iterating -- don't break

                # After interrupt, still write to trace and capture session
                # state, but skip SSE streaming, approval checks, etc.
                if _stop_interrupt_sent:
                    serialized = serialize_message(message)
                    if isinstance(message, ResultMessage):
                        captured_session_id = message.session_id
                        serialized["session_id"] = captured_session_id
                        stream_log.finalize(message)
                        logger.info(
                            "SDK result received after stop (drain complete)",
                            _name="STOP_DRAIN_RESULT",
                            conversation_id=conversation_id,
                            session_id=message.session_id,
                            request_id=request_id,
                        )
                    trace_line = json.dumps(serialized) + "\n"
                    with trace_path.open("a", encoding="utf-8") as f:
                        f.write(trace_line)
                    continue

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
                            # Watch for background-bash launches. The matching
                            # tool_result (captured below) will give us the
                            # shell_id and output file path.
                            if (
                                block.name == "Bash"
                                and isinstance(block.input, dict)
                                and block.input.get("run_in_background") is True
                            ):
                                pending_bg_tool_uses[block.id] = str(
                                    block.input.get("command", "")
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
                                # If this result is for a tracked background
                                # Bash tool_use, parse the SDK's message to
                                # extract the shell_id and output file path.
                                if block.tool_use_id in pending_bg_tool_uses:
                                    cmd = pending_bg_tool_uses.pop(block.tool_use_id)
                                    parsed = _parse_background_bash_result(
                                        block.content
                                    )
                                    if parsed:
                                        shell_id, output_path = parsed
                                        background_shells[shell_id] = {
                                            "command": cmd,
                                            "output_path": output_path,
                                            "tool_use_id": block.tool_use_id,
                                        }
                                        logger.info(
                                            "Tracked background shell for watching state",
                                            _name="BG_SHELL_TRACKED",
                                            shell_id=shell_id,
                                            output_path=output_path,
                                            tool_use_id=block.tool_use_id,
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

                    # Detect daily quota exhaustion (429 "per day")
                    if message.is_error:
                        # Check ResultMessage.result and stream_log text entries
                        _error_texts = [message.result or ""]
                        _error_texts.extend(
                            e.text or ""
                            for e in stream_log.entries
                            if e.entry_type == "text"
                        )
                        if any(is_daily_quota_error(t) for t in _error_texts):
                            _daily_quota_hit = True

                # Capture session_id from system init message
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    if "session_id" in message.data:
                        captured_session_id = message.data["session_id"]
                        logger.debug(
                            "SDK session initialized",
                            phase="sdk",
                            session_id=captured_session_id,
                        )

                if (
                    isinstance(message, SystemMessage)
                    and message.subtype == "compact_boundary"
                ):
                    logger.warning(
                        "Context compaction occurred",
                        _name="SDK_COMPACTION",
                        phase="sdk",
                        conversation_id=conversation_id,
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
                APPROVAL_REQUIRED_TOOLS = (
                    "run_action",
                    "proxy_request",
                    "numa_ops_tool",
                    "numa_tool",
                    "connectors",
                )
                # Numa tool write operations that require approval
                _NUMA_TOOL_WRITE_OPS: dict[str, set[str]] = {
                    "agents": {"create", "update", "duplicate"},
                    "memories": {"add", "update"},
                    "knowledgeBases": {"upload"},
                }
                _NUMA_TOOL_SAFE_OPS: dict[str, set[str]] = {
                    "agents": {"list", "get"},
                    "memories": {"list"},
                    "knowledgeBases": {"query", "list", "download", "download_folder"},
                }
                _nt_modes = numa_tool_approval_mode or {}
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

                            # ── Branch: Numa tool vs Ops / Connectors / Integration tool ──
                            # All compute _approval_key and auto_approved,
                            # then share the common approval event emission below.
                            auto_approved = False
                            _props_preview_override: dict[str, Any] | None = None

                            if (
                                "numa_tool" in block.name
                                and "numa_ops_tool" not in block.name
                            ):
                                # ── Numa tool approval (agents/memories/KB) ──
                                _nt_name = tool_input.get("name", "")
                                _nt_operation = tool_input.get("params", {}).get(
                                    "operation", ""
                                )
                                # Map tool names to category keys
                                _nt_category = {
                                    "agents": "agents",
                                    "memories": "memories",
                                    "numa_files": "knowledgeBases",
                                    "knowledge_base": "knowledgeBases",
                                }.get(_nt_name, "")
                                if not _nt_category:
                                    continue

                                _write_ops = _NUMA_TOOL_WRITE_OPS.get(
                                    _nt_category, set()
                                )
                                _safe_ops = _NUMA_TOOL_SAFE_OPS.get(_nt_category, set())
                                _is_write = _nt_operation in _write_ops
                                _is_safe = _nt_operation in _safe_ops

                                # Look up per-category mode
                                _cat_mode = _nt_modes.get(_nt_category, "never")

                                if _cat_mode == "never":
                                    auto_approved = True
                                elif _cat_mode == "non_destructive":
                                    auto_approved = _is_safe
                                else:  # "always"
                                    auto_approved = False

                                # Skip if this is a safe op and auto-approved
                                if auto_approved and not _is_write:
                                    continue

                                _approval_key = f"numa_{_nt_category}_{_nt_operation}"

                                # Build structured props preview
                                _nt_params = tool_input.get("params", {})
                                _props_preview_dict: dict[str, Any] = {}
                                if _nt_category == "agents":
                                    _props_preview_dict = {
                                        "title": _nt_params.get("title", ""),
                                        "operation": _nt_operation,
                                        "visibility": _nt_params.get(
                                            "visibility", "personal"
                                        ),
                                        "systemPrompt": (
                                            _nt_params.get("systemPrompt", "") or ""
                                        )[:200],
                                    }
                                    if _nt_operation in ("update", "duplicate"):
                                        _props_preview_dict["agent_id"] = (
                                            _nt_params.get("agent_id", "")
                                        )
                                elif _nt_category == "memories":
                                    _props_preview_dict = {
                                        "content": (
                                            _nt_params.get("content", "") or ""
                                        )[:200],
                                        "operation": _nt_operation,
                                        "scope": _nt_params.get("scope", "general"),
                                    }
                                    if _nt_operation == "update":
                                        _props_preview_dict["memory_id"] = (
                                            _nt_params.get("memory_id", "")
                                        )
                                elif _nt_category == "knowledgeBases":
                                    _props_preview_dict = {
                                        "operation": _nt_operation,
                                        "kb_id": _nt_params.get("kb_id", ""),
                                        "file_path": _nt_params.get("file_path", ""),
                                    }
                                _props_preview_override = _props_preview_dict

                                logger.info(
                                    "Numa tool approval decision",
                                    _name="APPROVAL_DECISION",
                                    phase="numa_tool",
                                    tool_name=block.name,
                                    numa_tool_name=_nt_name,
                                    category=_nt_category,
                                    operation=_nt_operation,
                                    action_key=_approval_key,
                                    category_mode=_cat_mode,
                                    auto_approved=auto_approved,
                                )

                            elif "numa_ops_tool" in block.name:
                                # ── Ops tool approval ──
                                operation = tool_input.get("operation", "")
                                _approval_key = f"ops-{operation.replace('_', '-')}"

                                # Safe ops: list_*, get_*, search_*
                                _ops_safe = operation.startswith(
                                    ("list_", "get_", "search_")
                                )

                                _ops_mode = _nt_modes.get("ops", "never")
                                if _ops_mode == "never":
                                    auto_approved = True
                                elif _ops_mode == "non_destructive":
                                    auto_approved = _ops_safe
                                # else "always" → auto_approved stays False

                                logger.info(
                                    "Ops tool approval decision",
                                    _name="APPROVAL_DECISION",
                                    phase="ops",
                                    tool_name=block.name,
                                    operation=operation,
                                    action_key=_approval_key,
                                    ops_mode=_ops_mode,
                                    auto_approved=auto_approved,
                                )
                            elif "connectors" in block.name:
                                # ── Connectors tool approval ──
                                from numa_workspace_agent.mcp_tools.connect import (
                                    is_safe_connector_operation,
                                )

                                operation = tool_input.get("name", "")
                                connector = (
                                    tool_input.get("params", {}).get("connector", "")
                                    if isinstance(tool_input.get("params"), dict)
                                    else ""
                                )
                                _approval_key = (
                                    f"connector-{connector}-{operation}"
                                    if connector
                                    else f"connector-{operation}"
                                )

                                _connector_safe = is_safe_connector_operation(operation)
                                _conn_mode = _nt_modes.get(
                                    "connectors", "non_destructive"
                                )

                                if _conn_mode == "never":
                                    auto_approved = True
                                elif _conn_mode == "non_destructive":
                                    auto_approved = _connector_safe
                                # else "always" → auto_approved stays False

                                logger.info(
                                    "Connectors tool approval decision",
                                    _name="APPROVAL_DECISION",
                                    phase="connectors",
                                    tool_name=block.name,
                                    operation=operation,
                                    connector=connector,
                                    action_key=_approval_key,
                                    connector_mode=_conn_mode,
                                    auto_approved=auto_approved,
                                )
                            else:
                                # ── Integration tool approval ──
                                # Only show approval if the integration is actually enabled.
                                # run_action has action_key like "google_drive-get-current-user";
                                # proxy_request has integration_slug directly.
                                action_key = tool_input.get("action_key", "")
                                integration_slug = tool_input.get(
                                    "integration_slug"
                                ) or (action_key.split("-")[0] if action_key else "")
                                if integration_slug and (
                                    not enabled_integrations
                                    or integration_slug not in enabled_integrations
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
                                    # proxy_request with no schema file: infer
                                    # safety from HTTP method. GET/HEAD are read-only.
                                    if not schema_found and not action_key:
                                        http_method = tool_input.get(
                                            "method", ""
                                        ).upper()
                                        if http_method in ("GET", "HEAD"):
                                            schema_annotations = {
                                                "readOnlyHint": True,
                                                "destructiveHint": False,
                                            }
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

                            # ── Common: emit approval event (ops + integrations + numa_tool) ──

                            # Set NUMA_APPROVAL_MODE env var so the tools Lambda
                            # knows whether to skip DynamoDB polling.
                            os.environ["NUMA_APPROVAL_MODE"] = (
                                "auto" if auto_approved else "manual"
                            )

                            # Generate a per-tool-call approval ID and store in
                            # NUMA_REQUEST_ID_MAP (JSON dict of action_key -> list of IDs).
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

                            # Use structured props preview for numa_tool, else existing logic
                            _event_props = (
                                _props_preview_override
                                if _props_preview_override is not None
                                else tool_input.get(
                                    "props", tool_input.get("upstream_url", "")
                                )
                            )

                            # Determine approval category for frontend label rendering
                            _approval_category = (
                                "numa_tool"
                                if _props_preview_override is not None
                                else "integration"
                            )

                            approval_event = {
                                "type": "tool_approval",
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "created_at": int(time.time()),
                                "tool_use_id": block.id,
                                "tool_name": block.name,
                                "action_key": _approval_key,
                                "description": tool_input.get("description", ""),
                                "props_preview": _event_props,
                                "request_id": approval_id,
                                "auto_approved": auto_approved,
                                "approval_category": _approval_category,
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
                logger.info(
                    "Stop completion event written to trace",
                    _name="STOP_TRACE_WRITTEN",
                    conversation_id=conversation_id,
                    request_id=request_id,
                    stop_reason=stop_reason,
                    messages_received=message_count,
                )
                yield format_sse_event(stop_event_payload)

        # ── Daily quota fallback retry ────────────────────────────────────
        # If the primary model hit a daily token quota (429 "per day"),
        # cache the exhaustion and retry immediately with fallback model.
        if _daily_quota_hit and _strip_prefix(options.model) != _strip_prefix(
            FALLBACK_MODEL
        ):
            mark_quota_exhausted(options.model)
            logger.warning(
                "Retrying with fallback model after daily quota exhaustion",
                _name="QUOTA_FALLBACK_RETRY",
                phase="fallback",
                original_model=options.model,
                fallback_model=FALLBACK_MODEL,
                conversation_id=conversation_id,
            )

            # Build fresh options with fallback model (no session resume --
            # the errored session is not usable)
            fallback_options = create_agent_options(
                session_id=None,
                conversation_id=conversation_id,
                user_sub=user_sub,
                user_email=user_email,
                user_timezone=timezone_str,
                today_string=today_string,
                allowed_kb_ids=available_kbs,
                enabled_tools=enabled_tools,
                model=FALLBACK_MODEL,
                agent_config=agent_config,
                agent_file_paths=agent_file_paths,
                external_user_id=external_user_id,
                enabled_integrations=enabled_integrations,
                available_integrations=available_integrations,
                connected_data_connectors=connected_data_connectors,
                request_id=request_id,
                email_signature=email_signature,
                agent_type_config=agent_type_config,
                user_profile=user_profile,
                company_profile=company_profile,
                feature_flags=feature_flags,
                thinking_override=thinking_override,
            )

            async with ClaudeSDKClient(options=fallback_options) as retry_client:
                await retry_client.query(augmented_prompt)
                async for message in retry_client.receive_response():
                    serialized = serialize_message(message)
                    if isinstance(message, ResultMessage):
                        captured_session_id = message.session_id
                        serialized["session_id"] = captured_session_id
                        stream_log.finalize(message)
                        logger.info(
                            "Fallback SDK result summary",
                            _name="SDK_RESULT_FALLBACK",
                            phase="fallback",
                            conversation_id=conversation_id,
                            session_id=message.session_id,
                            duration_ms=message.duration_ms,
                            num_turns=message.num_turns,
                            total_cost_usd=message.total_cost_usd,
                            is_error=message.is_error,
                            request_id=request_id,
                        )
                    if isinstance(message, SystemMessage) and message.subtype == "init":
                        if "session_id" in message.data:
                            captured_session_id = message.data["session_id"]
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                stream_log.record_text(block.text)
                    with trace_path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(serialized) + "\n")
                    yield format_sse_event(serialized)

        # ── Background-bash watching state ────────────────────────────
        # If this turn launched any run_in_background shells we managed to
        # track (got the tool_result with shell_id + output_path), hold the
        # SSE open so the frontend can render a "background task running"
        # chip next to the composer. The composer stays enabled — the user
        # can type a new message (which closes this stream and starts a
        # fresh turn) or click Stop. Harness polls each shell's output file
        # for completion (mtime stability); on completion we emit a
        # `state: "completed"` event with a short preview, frontend shows
        # "✓ done, send a message to see the result", and the user drives
        # the next turn (model calls BashOutput for the actual result).
        if background_shells and not stop_reason:
            async for sse_chunk in _emit_background_watching_state(
                trace_path=trace_path,
                stop_event=stop_event,
                disconnect_checker=disconnect_checker,
                request_id=request_id,
                conversation_id=conversation_id,
                background_shells=background_shells,
            ):
                yield sse_chunk

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

        # Cache quota exhaustion if the raised error looks like a daily 429.
        # Without this, the next request won't know to skip the exhausted model
        # via the pre-check and will burn the SDK's full retry budget again.
        if any(
            is_daily_quota_error(s)
            for s in (error_str, extra_info.get("stderr"), extra_info.get("stdout"))
        ) and _strip_prefix(options.model) != _strip_prefix(FALLBACK_MODEL):
            mark_quota_exhausted(options.model)

        # If the disk filled mid-stream, surface a friendlier message so the
        # user knows what to do (delete files / new conversation) rather than
        # seeing a raw `[Errno 28] No space left on device:` traceback.
        display_error = error_str
        if isinstance(e, OSError) and getattr(e, "errno", None) == errno.ENOSPC:
            display_error = (
                f"Workspace storage is full ({error_str}). "
                "Free space by deleting files in the workspace settings panel "
                "(uploads/outputs tabs), or start a new conversation."
            )

        error_event = {
            "type": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": display_error,
            "error_type": type(e).__name__,
            "errno": getattr(e, "errno", None),
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
    available_integrations: Optional[list[dict]] = None,
    connected_data_connectors: Optional[list[dict]] = None,
    approval_mode: str = "always",
    numa_tool_approval_mode: Optional[dict[str, str]] = None,
    email_signature: Optional[dict] = None,
    agent_type_config: Optional["AgentTypeConfig"] = None,
    user_profile: Optional[dict] = None,
    company_profile: Optional[dict | str] = None,
    feature_flags: Optional[dict[str, bool]] = None,
    system_dir: Optional[Path] = None,
    thinking_override: Optional[str] = None,
) -> dict[str, Any]:
    """Run Claude SDK to completion and return the collected result.

    This is the non-streaming counterpart of :func:`stream_claude_sdk`.
    Instead of yielding SSE events, it runs the full agent loop, writes the
    trace to disk (same NDJSON format), and returns a result dict with the
    final assistant text, artifacts list, and usage metadata.

    Used by the ``sync`` and ``fire-and-forget`` response modes where the
    caller does not need incremental SSE events — just the final answer.

    Args:
        system_dir: Optional isolated system directory for this invocation.
            When provided, the SDK session database (.claude/), trace file,
            and HOME env var are scoped to this directory instead of the
            shared /workdir/.system/. Used by pipeline orchestrators to
            prevent session cross-contamination between steps.

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
    # Allow pipeline orchestrators to isolate SDK session state per step
    effective_system_dir = system_dir or paths["system_dir"]
    if system_dir:
        effective_system_dir.mkdir(parents=True, exist_ok=True)
        (effective_system_dir / ".claude").mkdir(parents=True, exist_ok=True)
    trace_path = (
        effective_system_dir / "trace.jsonl" if system_dir else paths["trace_file"]
    )
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
            user_sub, conversation_id, effective_system_dir
        )
        if restore_result and restore_result.get("session_id"):
            session_id = restore_result["session_id"]
        # Skip trace restore for isolated pipeline steps (cold-start only, no prior trace)
        if not system_dir:
            restore_trace_from_s3(user_sub, conversation_id)
    else:
        session_id = get_active_session_id()
        if not session_id:
            restore_result = restore_claude_session(
                user_sub, conversation_id, effective_system_dir
            )
            if restore_result and restore_result.get("session_id"):
                session_id = restore_result["session_id"]
            restore_trace_from_s3(user_sub, conversation_id)

    # 2. Uploaded files for prompt context
    uploaded_files: list[str] = []
    if paths["uploads"].exists():
        uploaded_files = [f.name for f in paths["uploads"].iterdir() if f.is_file()]

    # 3. Augment prompt (today_string prepended here, not in system prompt, for caching)
    augmented_prompt = augment_prompt_with_context(
        prompt,
        uploaded_files,
        available_kbs,
        kb_listings,
        attached_folders,
        v1_migration_context,
        today_string=today_string,
    )

    # 3b. Default approval mode env var — overridden per tool call in the
    # message loop below (same as the streaming path in stream_claude_sdk).
    os.environ["NUMA_APPROVAL_MODE"] = "manual"

    # 4. Create SDK options (with quota fallback pre-check)
    # Precedence: request override > agent_type_config.default_model > DEFAULT_MODEL.
    # The type-config consultation is also done inside create_agent_options, but
    # we need a concrete model here to feed resolve_model_with_fallback.
    validated_model = validate_model_id(model_id)
    if (
        validated_model is None
        and agent_type_config
        and agent_type_config.default_model
    ):
        validated_model = _regionalize(_strip_prefix(agent_type_config.default_model))
    effective_model = validated_model or DEFAULT_MODEL
    effective_model, _is_fallback = resolve_model_with_fallback(effective_model)
    validated_model = effective_model

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
        available_integrations=available_integrations,
        connected_data_connectors=connected_data_connectors,
        request_id=request_id,
        email_signature=email_signature,
        agent_type_config=agent_type_config,
        user_profile=user_profile,
        company_profile=company_profile,
        feature_flags=feature_flags,
        home_dir=system_dir,
        thinking_override=thinking_override,
    )

    logger.info(
        "Starting Claude SDK (non-streaming)",
        _name="SDK_RUN_START",
        phase="sdk",
        conversation_id=conversation_id,
        user_sub=user_sub,
        session_id=session_id,
        model_id=options.model,
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
    _daily_quota_hit = False

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
                            logger.debug(
                                "Assistant text",
                                _name="SDK_LIVE_TEXT",
                                phase="sdk",
                                conversation_id=conversation_id,
                                text=block.text[:300],
                            )
                        elif isinstance(block, ThinkingBlock):
                            stream_log.record_thinking(block.thinking)
                            logger.debug(
                                "Assistant thinking",
                                _name="SDK_LIVE_THINKING",
                                phase="sdk",
                                conversation_id=conversation_id,
                                thinking=block.thinking[:200],
                            )
                        elif isinstance(block, ToolUseBlock):
                            stream_log.record_tool_start(
                                block.id,
                                block.name,
                                block.input if isinstance(block.input, dict) else None,
                            )
                            logger.debug(
                                "Tool call",
                                _name="SDK_LIVE_TOOL",
                                phase="sdk",
                                conversation_id=conversation_id,
                                tool_name=block.name,
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

                # Per-tool-call approval mode for integration, ops, and connector tools.
                # Identical to stream_claude_sdk: checks approval_mode,
                # sets NUMA_APPROVAL_MODE env var, and generates
                # NUMA_REQUEST_ID_MAP entries. No SSE events in non-streaming mode.
                APPROVAL_REQUIRED_TOOLS = (
                    "run_action",
                    "proxy_request",
                    "numa_ops_tool",
                    "numa_tool",
                    "connectors",
                )
                _NUMA_TOOL_WRITE_OPS_SYNC: dict[str, set[str]] = {
                    "agents": {"create", "update", "duplicate"},
                    "memories": {"add", "update"},
                    "knowledgeBases": {"upload"},
                }
                _NUMA_TOOL_SAFE_OPS_SYNC: dict[str, set[str]] = {
                    "agents": {"list", "get"},
                    "memories": {"list"},
                    "knowledgeBases": {"query", "list", "download", "download_folder"},
                }
                _nt_modes_sync = numa_tool_approval_mode or {}
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ToolUseBlock) and any(
                            t in block.name for t in APPROVAL_REQUIRED_TOOLS
                        ):
                            tool_input = (
                                block.input if isinstance(block.input, dict) else {}
                            )

                            # ── Branch: Numa tool vs Ops / Connectors / Integration tool ──
                            auto_approved = False

                            if (
                                "numa_tool" in block.name
                                and "numa_ops_tool" not in block.name
                            ):
                                _nt_name = tool_input.get("name", "")
                                _nt_operation = tool_input.get("params", {}).get(
                                    "operation", ""
                                )
                                _nt_category = {
                                    "agents": "agents",
                                    "memories": "memories",
                                    "numa_files": "knowledgeBases",
                                    "knowledge_base": "knowledgeBases",
                                }.get(_nt_name, "")
                                if not _nt_category:
                                    continue
                                _write_ops = _NUMA_TOOL_WRITE_OPS_SYNC.get(
                                    _nt_category, set()
                                )
                                _safe_ops = _NUMA_TOOL_SAFE_OPS_SYNC.get(
                                    _nt_category, set()
                                )
                                _is_safe = _nt_operation in _safe_ops
                                _cat_mode = _nt_modes_sync.get(_nt_category, "never")
                                if _cat_mode == "never":
                                    auto_approved = True
                                elif _cat_mode == "non_destructive":
                                    auto_approved = _is_safe
                                if auto_approved and _nt_operation not in _write_ops:
                                    continue
                                _approval_key = f"numa_{_nt_category}_{_nt_operation}"

                            elif "numa_ops_tool" in block.name:
                                # ── Ops tool approval ──
                                operation = tool_input.get("operation", "")
                                _approval_key = f"ops-{operation.replace('_', '-')}"
                                _ops_safe = operation.startswith(
                                    ("list_", "get_", "search_")
                                )
                                _ops_mode = _nt_modes_sync.get("ops", "never")
                                if _ops_mode == "never":
                                    auto_approved = True
                                elif _ops_mode == "non_destructive":
                                    auto_approved = _ops_safe
                            elif "connectors" in block.name:
                                # ── Connectors tool approval ──
                                from numa_workspace_agent.mcp_tools.connect import (
                                    is_safe_connector_operation,
                                )

                                operation = tool_input.get("name", "")
                                connector = (
                                    tool_input.get("params", {}).get("connector", "")
                                    if isinstance(tool_input.get("params"), dict)
                                    else ""
                                )
                                _approval_key = (
                                    f"connector-{connector}-{operation}"
                                    if connector
                                    else f"connector-{operation}"
                                )

                                _connector_safe = is_safe_connector_operation(operation)
                                _conn_mode_sync = _nt_modes_sync.get(
                                    "connectors", "non_destructive"
                                )

                                if _conn_mode_sync == "never":
                                    auto_approved = True
                                elif _conn_mode_sync == "non_destructive":
                                    auto_approved = _connector_safe
                            else:
                                # ── Integration tool approval ──
                                action_key = tool_input.get("action_key", "")
                                integration_slug = tool_input.get(
                                    "integration_slug"
                                ) or (action_key.split("-")[0] if action_key else "")
                                if integration_slug and (
                                    not enabled_integrations
                                    or integration_slug not in enabled_integrations
                                ):
                                    continue

                                _approval_key = (
                                    action_key
                                    or f"{integration_slug}-{tool_input.get('method', 'request')}"
                                )

                                schema_found = False
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
                                    # proxy_request with no schema file: infer
                                    # safety from HTTP method. GET/HEAD are read-only.
                                    if not schema_found and not action_key:
                                        http_method = tool_input.get(
                                            "method", ""
                                        ).upper()
                                        if http_method in ("GET", "HEAD"):
                                            schema_annotations = {
                                                "readOnlyHint": True,
                                                "destructiveHint": False,
                                            }
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

                            # ── Common: set env vars and approval ID ──
                            os.environ["NUMA_APPROVAL_MODE"] = (
                                "auto" if auto_approved else "manual"
                            )

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
                    usage = getattr(message, "usage", {}) or {}
                    result_meta = {
                        "num_turns": message.num_turns,
                        "total_cost_usd": message.total_cost_usd,
                        "duration_ms": message.duration_ms,
                        "is_error": message.is_error,
                        "input_tokens": usage.get("input_tokens", 0) or 0,
                        "output_tokens": usage.get("output_tokens", 0) or 0,
                        "cache_read_tokens": usage.get("cache_read_input_tokens", 0)
                        or 0,
                        "cache_creation_tokens": usage.get(
                            "cache_creation_input_tokens", 0
                        )
                        or 0,
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

                    # Detect daily quota exhaustion (429 "per day")
                    if message.is_error:
                        _error_texts = [message.result or ""]
                        _error_texts.extend(
                            e.text or ""
                            for e in stream_log.entries
                            if e.entry_type == "text"
                        )
                        if any(is_daily_quota_error(t) for t in _error_texts):
                            _daily_quota_hit = True

                if isinstance(message, SystemMessage) and message.subtype == "init":
                    if "session_id" in message.data:
                        captured_session_id = message.data["session_id"]

                if (
                    isinstance(message, SystemMessage)
                    and message.subtype == "compact_boundary"
                ):
                    logger.warning(
                        "Context compaction occurred",
                        _name="SDK_COMPACTION",
                        phase="sdk",
                        conversation_id=conversation_id,
                    )

                with trace_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(serialized) + "\n")

        # ── Daily quota fallback retry ────────────────────────────────────
        if _daily_quota_hit and _strip_prefix(options.model) != _strip_prefix(
            FALLBACK_MODEL
        ):
            mark_quota_exhausted(options.model)
            logger.warning(
                "Retrying with fallback model after daily quota exhaustion (sync)",
                _name="QUOTA_FALLBACK_RETRY",
                phase="fallback",
                original_model=options.model,
                fallback_model=FALLBACK_MODEL,
                conversation_id=conversation_id,
            )

            # Reset state for retry
            collected_text.clear()
            result_meta.clear()
            captured_session_id = None

            fallback_options = create_agent_options(
                session_id=None,
                conversation_id=conversation_id,
                user_sub=user_sub,
                user_email=user_email,
                user_timezone=timezone_str,
                today_string=today_string,
                allowed_kb_ids=available_kbs,
                enabled_tools=enabled_tools,
                model=FALLBACK_MODEL,
                agent_config=agent_config,
                agent_file_paths=agent_file_paths,
                external_user_id=external_user_id,
                enabled_integrations=enabled_integrations,
                available_integrations=available_integrations,
                connected_data_connectors=connected_data_connectors,
                request_id=request_id,
                email_signature=email_signature,
                agent_type_config=agent_type_config,
                user_profile=user_profile,
                company_profile=company_profile,
                feature_flags=feature_flags,
                home_dir=system_dir,
                thinking_override=thinking_override,
            )

            async with ClaudeSDKClient(options=fallback_options) as retry_client:
                await retry_client.query(augmented_prompt)
                async for message in retry_client.receive_response():
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                stream_log.record_text(block.text)
                                collected_text.append(block.text)
                            elif isinstance(block, ThinkingBlock):
                                stream_log.record_thinking(block.thinking)
                    serialized = serialize_message(message)
                    if isinstance(message, ResultMessage):
                        captured_session_id = message.session_id
                        serialized["session_id"] = captured_session_id
                        stream_log.finalize(message)
                        usage = getattr(message, "usage", {}) or {}
                        result_meta = {
                            "num_turns": message.num_turns,
                            "total_cost_usd": message.total_cost_usd,
                            "duration_ms": message.duration_ms,
                            "is_error": message.is_error,
                            "input_tokens": usage.get("input_tokens", 0) or 0,
                            "output_tokens": usage.get("output_tokens", 0) or 0,
                            "cache_read_tokens": usage.get("cache_read_input_tokens", 0)
                            or 0,
                            "cache_creation_tokens": usage.get(
                                "cache_creation_input_tokens", 0
                            )
                            or 0,
                        }
                        logger.info(
                            "Fallback SDK run result",
                            _name="SDK_RUN_RESULT_FALLBACK",
                            phase="fallback",
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
        error_str = str(e)
        stream_log.is_error = True
        stream_log.error_message = error_str

        logger.error(
            "Claude SDK run error",
            _name="SDK_RUN_ERROR",
            phase="sdk",
            error=error_str,
            error_type=type(e).__name__,
            traceback=error_tb,
            conversation_id=conversation_id,
        )

        # Cache quota exhaustion if the raised error looks like a daily 429,
        # so subsequent requests skip the exhausted model via the pre-check.
        if any(
            is_daily_quota_error(s)
            for s in (
                error_str,
                getattr(e, "stderr", None),
                getattr(e, "stdout", None),
            )
        ) and _strip_prefix(options.model) != _strip_prefix(FALLBACK_MODEL):
            mark_quota_exhausted(options.model)

        # If the disk filled mid-run, surface a friendlier message (matches
        # the streaming path).
        display_error = error_str
        if isinstance(e, OSError) and getattr(e, "errno", None) == errno.ENOSPC:
            display_error = (
                f"Workspace storage is full ({error_str}). "
                "Free space by deleting files in the workspace settings panel "
                "(uploads/outputs tabs), or start a new conversation."
            )

        error_event = {
            "type": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": display_error,
            "error_type": type(e).__name__,
            "errno": getattr(e, "errno", None),
        }
        with trace_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(error_event) + "\n")

        return {
            "status": "error",
            "text": "",
            "artifacts": [],
            "usage": result_meta,
            "session_id": captured_session_id or session_id or "",
            "error": display_error,
        }

    finally:
        # Pipeline steps with isolated system_dir should not mutate shared conv state
        if captured_session_id and not system_dir:
            set_active_conversation(conversation_id, session_id=captured_session_id)

        archive_claude_session(
            user_sub,
            conversation_id,
            effective_system_dir,
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
        "text": "\n\n".join(collected_text),
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
