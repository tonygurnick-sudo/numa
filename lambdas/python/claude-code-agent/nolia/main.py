# pylint: disable=too-many-statements
"""
Main implementation for the Nolia Claude Code Agent.

This agent specializes in document analysis using knowledge base files.
It processes uploaded documents alongside selected knowledge base content.
"""

import importlib
import json
import os
import platform
import random
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union, cast
from zoneinfo import ZoneInfo

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from typing_extensions import TypedDict

import helpers
import s3_helpers
from utils import (
    appoutput,
    cli_runner,
    get_cross_account_bedrock_credentials,
    s3_operations,
    session,
    trace_parser,
)

from . import conversation, workspace
from .prompts import SYSTEM_PROMPT
from .settings import ENV_VARS, SETTINGS_JSON

logger = structlog.get_logger()


# =============================================================================
# EVENT STREAMING (moved back from utils for simpler debugging)
# =============================================================================


class AppContext(TypedDict, total=False):
    """Context for event streaming."""

    job_id: str
    user_id: str
    app_id: str
    use_dynamodb: bool
    bucket: Optional[str]


def _try_append_event(event_msg: str, app_context: Optional[AppContext]) -> None:
    """
    Attempt to append an event using the app context.

    Safely handles missing required fields in app_context.
    """
    if not app_context:
        return

    job_id = app_context.get("job_id")
    user_id = app_context.get("user_id")
    app_id = app_context.get("app_id")

    # All three IDs are required for event appending
    if not (job_id and user_id and app_id):
        logger.warning(
            "Missing required IDs for event append",
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
        )
        return

    try:
        logger.debug("Appending event", event_msg=event_msg, job_id=job_id)
        helpers.append_event(
            message=event_msg,
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=app_context.get("use_dynamodb", True),
            bucket=app_context.get("bucket"),
        )
    except Exception as e:
        logger.warning(
            "Failed to append event", msg=event_msg, error=str(e), exc_info=True
        )


def _extract_tool_event(tool_name: str, tool_input: dict) -> Optional[str]:
    """Extract event message for a specific tool use."""

    # --- Minimal tool command narrator using Bedrock Claude 3 Haiku ---
    _narrator_model: Optional[Any] = None

    def _get_narrator_model() -> Optional[Any]:
        nonlocal _narrator_model
        if _narrator_model is not None:
            return _narrator_model
        try:
            bedrock_mod = importlib.import_module("bedrock")
            cfg_mod = importlib.import_module("bedrock.bedrock_model_config")
            bedrock_model_cls = getattr(bedrock_mod, "BedrockClaude3Model")
            model_types = getattr(cfg_mod, "ModelTypes")
            _narrator_model = bedrock_model_cls(
                model_type=model_types.CLAUDE_HAIKU,
                model_args={
                    "max_tokens": 100,
                    "temperature": 0.2,
                },
                enable_fallback=True,
                claude_only=True,
            )
            return _narrator_model
        except Exception as e:
            logger.warning(
                "Failed to initialize narrator model",
                error=str(e),
                exc_info=True,
            )
            return None

    def _summarize_tool_command(command: str) -> Optional[str]:
        try:
            model = _get_narrator_model()
            if not model:
                return None
            truncated = (command or "").strip()
            if len(truncated) > 600:
                truncated = truncated[:600] + "..."
            prompt = (
                "Write a brief, human-friendly doing phrase that describes the intent of the command. "
                "Start with a present-participle verb ending in 'ing' (e.g., Analyzing, Filtering, "
                "Downloading, Installing). "
                "Use 12 words or fewer. No code, shell terms, IDs, or URLs. "
                "Respond with only the phrase, no extra punctuation.\n\n"
                f"Command:\n{truncated}\n"
            )
            result = model.run(prompt, name_for_logging="tool_narration")
            for item in result.response:
                if isinstance(item, dict) and item.get("type") == "text":
                    summary = (item.get("text") or "").strip()
                    if summary:
                        return summary
            logger.debug(
                "No text found in narrator model response", response=result.response
            )
            return None
        except Exception as e:
            logger.warning(
                "Failed to summarize tool command",
                error=str(e),
                exc_info=True,
            )
            return None

    def format_bash_command(inp: dict) -> Optional[str]:
        """Summarize a bash command to a human-friendly message, with fallback."""
        # First priority: Use Claude's own description if provided
        description = inp.get("description", "")
        if description:
            return f"Numa: {description}"

        # Second priority: Try LLM summary (for cases without description)
        command = inp.get("command", "")
        if command:
            summary = _summarize_tool_command(command)
            if summary:
                return f"Numa: {summary}"

        # Final fallback: Show command preview
        if command:
            cmd_preview = command[:60] + "..." if len(command) > 60 else command
            return f"Running: {cmd_preview}"

        return None

    def format_read_event(inp: dict) -> Optional[str]:
        """Format read event with simplified path."""
        file_path = inp.get("file_path", "")
        if not file_path:
            return None
        # Show just the filename to reduce noise
        filename = Path(file_path).name
        return f"Reading file: {filename}"

    def format_write_event(inp: dict) -> Optional[str]:
        """Summarize a file write, with LLM summary for code files."""
        file_path = inp.get("file_path", "")
        if not file_path:
            return None
        content = inp.get("content", "")
        # Check if this is a code file that should be summarized
        code_extensions = {".py", ".js", ".ts", ".sh", ".bash", ".r", ".R", ".sql"}
        if any(file_path.endswith(ext) for ext in code_extensions) and content:
            summary = _summarize_tool_command(content)
            if summary:
                return f"Numa: {summary}"
        # Fallback to basic message
        return f"Writing file: {file_path}"

    tool_events = {
        "Read": format_read_event,
        "Write": format_write_event,
        "Edit": lambda inp: (
            f"Editing file: {inp.get('file_path', '')}"
            if inp.get("file_path")
            else None
        ),
        "Bash": format_bash_command,
        "Glob": lambda _: "Searching files (Glob)",
        "Grep": lambda _: "Searching files (Grep)",
    }

    tool_handler = tool_events.get(tool_name)
    if tool_handler:
        return tool_handler(tool_input)
    if tool_name:
        return f"Using tool: {tool_name}"
    return None


def _extract_content_block_event(block: dict) -> Optional[str]:
    """Extract event message from a content block."""
    if not isinstance(block, dict):
        return None

    block_type = block.get("type")

    if block_type == "tool_use":
        return _extract_tool_event(block.get("name", ""), block.get("input", {}))

    if block_type == "text":
        text = block.get("text", "").strip()
        if text:
            truncated = text[:80] + "..." if len(text) > 80 else text
            return f"Numa: {truncated}"

    if block_type == "thinking":
        thinking_variants = [
            "Numa: Thinking...",
            "Numa: Analysing...",
            "Numa: Digging deeper...",
            "Numa: Exploring options...",
            "Numa: Reviewing data...",
            "Numa: Processing...",
            "Numa: Evaluating inputs...",
            "Numa: Reasoning...",
            "Numa: Planning steps...",
            "Numa: Working...",
        ]
        try:
            return random.choice(thinking_variants)  # nosec B311
        except IndexError:
            return "Numa: Thinking..."

    return None


def _extract_meaningful_event(obj: Any) -> Optional[str]:
    """
    Extract meaningful event messages from Claude CLI trace events.

    Filters for events that provide useful status information to the user.
    Uses the CORRECT event types that Claude CLI actually emits.

    Args:
        obj: Parsed JSON object from trace line

    Returns:
        Event message string if meaningful, None otherwise
    """
    if not isinstance(obj, dict):
        return None

    event_type = obj.get("type")

    # Map simple event types to messages
    simple_events = {
        "session_init": "Session initialized",
        "result": "Task completed successfully",
    }

    if event_type in simple_events:
        return simple_events[event_type]

    # Error events with dynamic message
    if event_type == "error":
        error_msg = obj.get("error", "Unknown error")
        return f"Error: {error_msg}"

    # Assistant messages with nested content blocks - THIS IS THE KEY EVENT TYPE
    if event_type == "assistant":
        content_array = obj.get("message", {}).get("content") or obj.get("content")

        if content_array and isinstance(content_array, list):
            for block in content_array:
                event_msg = _extract_content_block_event(block)
                if event_msg:
                    return event_msg

    return None


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================


def _setup_event_context(event: Dict[str, Any], bucket: str) -> Optional[AppContext]:
    """Setup app context for event streaming if enabled."""
    stream_events = _truthy(event.get("stream_events", True))
    if not stream_events:
        logger.info("Event streaming disabled")
        return None

    use_dynamodb = _truthy(event.get("use_dynamodb", True))
    logger.info("Event streaming enabled", use_dynamodb=use_dynamodb)
    return AppContext(
        job_id=event["job_id"],
        user_id=event["user_id"],
        app_id=event["app_id"],
        use_dynamodb=use_dynamodb,
        bucket=bucket if not use_dynamodb else None,
    )


def _restore_session_if_resuming(
    event: Dict[str, Any], bucket: str, prefix: str, outputs_dir: Path, home: Path
) -> Optional[str]:
    """
    Restore Claude session state if resuming.

    This follows the original pattern where resume_session=True means:
    1. Hydrate prior outputs from the SAME job prefix
    2. Restore .claude directory from S3
    3. Load ccSessionId from meta/session.json

    Args:
        event: Lambda event
        bucket: S3 bucket
        prefix: S3 prefix for current job
        outputs_dir: Directory to restore outputs to
        home: Home directory for .claude

    Returns:
        ccSessionId if found, None otherwise
    """
    resume_session = _truthy(event.get("resume_session", False))

    if not resume_session:
        logger.info("Starting fresh session (resume_session=false)")
        return None

    logger.info("Session continuity enabled; attempting restoration")

    # Hydrate prior outputs so agent can reference previous work
    workspace.hydrate_prior_outputs(bucket, prefix, outputs_dir)

    # Restore Claude session archive from S3
    restored = session.restore_session(bucket, prefix, home)
    if restored:
        logger.info("Restored Claude home from session archive")

    # Load previous ccSessionId to pass --resume to CLI
    cc_session_id = None
    try:
        session_meta_key = s3_operations.safe_s3_key(prefix, "meta", "session.json")
        meta = json.loads(
            s3_helpers.read(session_meta_key, bucket=bucket).decode("utf-8")
        )
        cc_session_id = meta.get("ccSessionId")
        if cc_session_id:
            logger.info("Loaded prior session ID for resume", session_id=cc_session_id)
    except Exception:
        logger.warning("No prior session metadata found; starting fresh")

    return cc_session_id


def _finalize_job_artifacts(
    bucket: str,
    prefix: str,
    outputs_dir: Path,
    trace_path: Path,
    new_session_id: Optional[str],
    job_id: str,
) -> None:
    """Upload trace, write manifest, and persist session metadata."""
    # Upload trace for debugging
    trace_key = s3_operations.safe_s3_key(prefix, "trace", "trace.jsonl")
    s3_helpers.write(
        trace_key,
        trace_path.read_bytes(),
        content_type="application/x-ndjson",
        bucket=bucket,
    )

    # Collect output file keys for manifest
    outputs_list = []
    if outputs_dir.exists():
        for file_path in outputs_dir.rglob("*"):
            if file_path.is_file() and not file_path.name.startswith("."):
                rel_path = file_path.relative_to(outputs_dir)
                s3_key = s3_operations.safe_s3_key(prefix, "outputs", str(rel_path))
                outputs_list.append(s3_key)

    # Write manifest for job metadata
    manifest = {
        "jobId": job_id,
        "ccSessionId": new_session_id,
        "outputs": outputs_list,
    }
    s3_helpers.write(
        s3_operations.safe_s3_key(prefix, "meta", "manifest.json"),
        json.dumps(manifest).encode("utf-8"),
        content_type="application/json",
        bucket=bucket,
    )
    logger.info("Wrote manifest", job_id=job_id, output_count=len(outputs_list))

    # Write session metadata for resume capability
    if new_session_id:
        s3_helpers.write(
            s3_operations.safe_s3_key(prefix, "meta", "session.json"),
            json.dumps({"ccSessionId": new_session_id}).encode("utf-8"),
            content_type="application/json",
            bucket=bucket,
        )
        logger.info("Persisted session metadata", session_id=new_session_id)


def run(
    event: Dict[str, Any], context: LambdaContext
) -> Dict[str, Any]:  # pylint: disable=too-many-statements
    """
    Main entry point for the Nolia agent.

    Handles the complete lifecycle of a Nolia analysis task:
    1. Setup workspace and hydrate inputs (extracted content + KB files)
    2. Restore session if resuming
    3. Run Claude CLI with Nolia prompts
    4. Stream events for real-time updates
    5. Process and upload outputs
    6. Maintain conversation history

    Args:
        event: Lambda event with job parameters (extracted_content_key, kb_selection)
        context: Lambda context

    Returns:
        AppOutput dictionary with results
    """
    helpers.setup_step_function_lambda_logging(event, context)

    # Extract core identifiers
    app_id, job_id, user_id = event["app_id"], event["job_id"], event["user_id"]
    extracted_content_key = event.get("extracted_content_key", "")
    kb_selection = event.get("kb_selection", "global")
    user_prompt = event.get(
        "prompt", "Analyze this document using the knowledge base files."
    ).strip()

    # Setup workspace and S3 paths
    workdir = Path(f"/tmp/cc_ws/{job_id}")
    dirs = workspace.setup_workspace(workdir)
    bucket = os.environ["OUTPUTS_BUCKET_NAME"]
    prefix = s3_operations.safe_s3_key(app_id, user_id, job_id)

    # Setup event streaming context
    app_context = _setup_event_context(event, bucket)

    # Download extracted content from previous step
    if extracted_content_key:
        try:
            _try_append_event("Downloading extracted document content...", app_context)
            extracted_data = s3_helpers.read(extracted_content_key, bucket=bucket)
            # Parse the extracted JSON to get the text content
            extracted_json = json.loads(extracted_data.decode("utf-8"))
            extracted_text = extracted_json.get("extracted_text", "")
            # Save as a text file in input_files
            extracted_file_path = dirs["inputs"] / "uploaded-document.txt"
            extracted_file_path.write_text(extracted_text, encoding="utf-8")
            logger.info("Downloaded extracted content", key=extracted_content_key)
        except Exception as e:
            logger.warning("Failed to download extracted content", error=str(e))
            _try_append_event(
                f"Warning: Could not download extracted content: {e}", app_context
            )

    # Download knowledge base files based on selection(s)
    kb_dir = dirs["inputs"] / "knowledge_base"
    kb_dir.mkdir(parents=True, exist_ok=True)

    # Support either a single selection (string) or multiple (list)
    # Normalize kb_selection to a flat list of strings
    def _flatten(items):
        for it in items:
            if isinstance(it, (list, tuple)):
                yield from _flatten(it)
            elif it is not None:
                yield str(it)

    selections: List[str]
    if isinstance(kb_selection, (list, tuple)):
        selections = list(_flatten(kb_selection))
    else:
        # Support comma-separated strings as a convenience
        if isinstance(kb_selection, str) and "," in kb_selection:
            selections = [s.strip() for s in kb_selection.split(",") if s.strip()]
        else:
            selections = [str(kb_selection)] if kb_selection else []

    total_kb_files = 0
    for sel in selections:
        # Normalize to path-safe name (e.g., "Global" -> "global")
        kb_name = sel.lower().replace(" ", "-")
        kb_prefix = f"{app_id}/knowledge-bases/{kb_name}/"

        try:
            _try_append_event(f"Loading knowledge base: {sel}...", app_context)
            kb_keys = s3_helpers.list_objects(prefix=kb_prefix, bucket=bucket)
            kb_count = 0
            for key in kb_keys:
                if key.endswith("/"):
                    continue
                filename = key.split(kb_prefix)[-1]
                if not filename:
                    continue
                # Keep KBs separate to avoid filename collisions
                kb_file_data = s3_helpers.read(key, bucket=bucket)
                kb_file_path = kb_dir / kb_name / filename
                kb_file_path.parent.mkdir(parents=True, exist_ok=True)
                kb_file_path.write_bytes(kb_file_data)
                kb_count += 1
                total_kb_files += 1

            logger.info("Downloaded KB files", kb_name=kb_name, count=kb_count)
            _try_append_event(f"Loaded {kb_count} files from KB: {sel}", app_context)
        except Exception as e:
            logger.warning("Failed to download KB files", kb_name=kb_name, error=str(e))
            _try_append_event(
                f"Warning: Could not load knowledge base files for {sel}: {e}",
                app_context,
            )

    # Setup home directory
    home = Path(os.environ.get("HOME", "/tmp"))

    # Restore session if resuming (loads ccSessionId, hydrates prior outputs)
    # Note: This restores the entire .claude directory from S3, including old settings.json
    cc_session_id = _restore_session_if_resuming(
        event, bucket, prefix, dirs["outputs"], home
    )

    # Write fresh settings AFTER session restore to ensure current config takes precedence
    # (session archive may contain outdated settings.json)
    session.ensure_settings(SETTINGS_JSON, home)

    # Augment prompt with file inventory
    augment_uploads = _truthy(event.get("augment_uploads", True))
    if augment_uploads:
        # Build custom prompt showing both document and KB files
        prompt_lines = []
        if (dirs["inputs"] / "uploaded-document.txt").exists():
            prompt_lines.append(
                "Uploaded document: uploaded-document.txt (in ./user-inputs/)"
            )

        kb_files = list(kb_dir.glob("**/*"))
        kb_file_names = [f.relative_to(kb_dir) for f in kb_files if f.is_file()]
        if kb_file_names:
            prompt_lines.append(
                "\nKnowledge base files (in ./user-inputs/knowledge_base/):"
            )
            for kb_file in sorted(kb_file_names):
                prompt_lines.append(f"- {kb_file}")

        if prompt_lines:
            final_prompt = "\n".join(prompt_lines) + f"\n\nUser prompt:\n{user_prompt}"
            logger.info(
                "Augmented prompt with file inventory",
                doc=bool((dirs["inputs"] / "uploaded-document.txt").exists()),
                kb_files=len(kb_file_names),
            )
        else:
            final_prompt = user_prompt
    else:
        final_prompt = user_prompt

    # Ensure Claude CLI is available
    bin_path = cli_runner.ensure_claude_cli(bucket)
    cli_runner.check_cli_version(bin_path)

    # Build system prompt with runtime context
    system_prompt = _build_runtime_system_prompt(
        workdir, event.get("user_timezone", "UTC")
    )

    # Run Claude CLI with streaming
    trace_path = workdir / "trace.jsonl"
    new_session_id, _ = _run_claude_with_streaming(
        bin_path=bin_path,
        workdir=workdir,
        cc_session_id=cc_session_id,
        prompt=final_prompt,
        system_prompt=system_prompt,
        trace_path=trace_path,
        stream_events=bool(app_context),
        app_context=app_context,
    )

    # Update ccSessionId if we got a new one
    cc_session_id = new_session_id or cc_session_id

    # Process outputs and get result text
    result_text = _process_outputs_and_get_result(
        workdir=workdir,
        outputs_dir=dirs["outputs"],
        trace_path=trace_path,
        bucket=bucket,
        prefix=prefix,
    )

    # Maintain conversation history
    _update_conversation_history(
        bucket=bucket,
        prefix=prefix,
        user_prompt=user_prompt,
        result_text=result_text,
        outputs_dir=dirs["outputs"],
    )

    # Archive session for next run (always save for future resume capability)
    if cc_session_id:
        try:
            session.archive_session(bucket, prefix, home)
            logger.info("Archived Claude session to S3", session_id=cc_session_id)
        except Exception as e:
            logger.warning("Failed archiving session", error=str(e))

    # Finalize job artifacts (trace, manifest, session metadata)
    _finalize_job_artifacts(
        bucket, prefix, dirs["outputs"], trace_path, cc_session_id, job_id
    )

    # Return formatted output with proper structure for frontend
    inline_base_key = s3_operations.safe_s3_key(prefix, "outputs", ".assistant.md")
    return appoutput.format_inline_result(
        title="Analysis Results", content=result_text, s3_key=inline_base_key
    )


def _build_runtime_system_prompt(workdir: Path, user_tz: str) -> str:
    """Build system prompt with current date and platform info."""
    tz: Union[ZoneInfo, timezone]
    try:
        tz = ZoneInfo(user_tz)
    except Exception:
        logger.warning(f"Invalid timezone '{user_tz}', using UTC")
        tz = timezone.utc

    today_date = datetime.now(tz).strftime("%A, %B %d, %Y")
    return build_system_prompt(
        working_directory=str(workdir),
        platform_info=_get_platform_info(),
        today_date=today_date,
    )


# =============================================================================
# NOLIA SPECIFIC FUNCTIONS
# =============================================================================


def build_system_prompt(
    working_directory: str, platform_info: str, today_date: str
) -> str:
    """
    Build the complete system prompt with runtime context for Nolia.

    Args:
        working_directory: Current working directory path
        platform: Platform information string
        today_date: Formatted current date

    Returns:
        Formatted system prompt with context
    """
    return SYSTEM_PROMPT.format(
        working_directory=working_directory,
        platform=platform_info,
        today_date=today_date,
    )


def _run_claude_with_streaming(
    bin_path: str,
    workdir: Path,
    cc_session_id: Optional[str],
    prompt: str,
    system_prompt: str,
    trace_path: Path,
    stream_events: bool,
    app_context: Optional[AppContext],
) -> Tuple[Optional[str], int]:
    """
    Run Claude CLI with event streaming support for data analysis.

    Args:
        bin_path: Path to Claude CLI binary
        workdir: Working directory
        cc_session_id: Optional session ID for resuming
        prompt: User prompt
        system_prompt: System prompt
        trace_path: Path to write trace output
        stream_events: Whether to stream events
        app_context: Context for event streaming

    Returns:
        Tuple of (new_session_id, return_code)
    """
    # Build command arguments from settings
    permission_mode = (SETTINGS_JSON.get("permissions", {}) or {}).get("defaultMode")
    if not permission_mode:
        raise RuntimeError("SETTINGS_JSON.permissions.defaultMode is required")

    # Build allowed tools list
    allowed_tools: List[str] = []
    tools_cfg = SETTINGS_JSON.get("tools", {})
    for t in tools_cfg.get("allow", []) or []:
        if isinstance(t, str) and t:
            allowed_tools.append(t)
    for pat in tools_cfg.get("bash_allow", []) or []:
        if isinstance(pat, str) and pat:
            allowed_tools.append(f"Bash({pat})")
    if not allowed_tools:
        raise RuntimeError("SETTINGS_JSON.tools must define at least one allowed tool")

    # Build CLI command
    args = [bin_path, "-p", "--verbose"]
    if cc_session_id:
        args += ["--resume", cc_session_id, prompt]
    else:
        args += [prompt]
    args += [
        "--output-format",
        "stream-json",
        "--permission-mode",
        permission_mode,
        "--allowedTools",
        ",".join(allowed_tools),
        "--append-system-prompt",
        system_prompt,
    ]

    # Get cross-account credentials if BEDROCK_ACCOUNT is configured
    bedrock_creds = get_cross_account_bedrock_credentials()

    # Prepare environment
    env: dict[str, str] = {
        **os.environ,
        **ENV_VARS,
        "HOME": os.environ.get("HOME", "/tmp"),
        "PYTHONPATH": ":".join(
            filter(
                None,
                [
                    os.environ.get("PYTHONPATH"),
                    "/opt/python",
                    "/var/task",
                ],
            )
        ),
    }
    # Inject cross-account creds if available
    if bedrock_creds:
        env.update(cast(dict[str, str], bedrock_creds))

    # Execute CLI and stream output
    with trace_path.open("w", encoding="utf-8") as trace_file:
        with subprocess.Popen(
            args,
            cwd=str(workdir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        ) as proc:
            new_session_id: Optional[str] = None

            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    trace_file.write(line)
                    trace_file.flush()
                    try:
                        obj = json.loads(line)
                        if isinstance(obj, dict) and obj.get("session_id"):
                            new_session_id = obj.get("session_id")

                        # Stream events if enabled
                        if stream_events and app_context:
                            event_msg = _extract_meaningful_event(obj)
                            if event_msg:
                                logger.info(
                                    "Extracted event from trace", event_msg=event_msg
                                )
                                _try_append_event(event_msg, app_context)
                            elif isinstance(obj, dict) and obj.get("type"):
                                logger.debug(
                                    "Trace event (no message)",
                                    event_type=obj.get("type"),
                                )
                    except json.JSONDecodeError:
                        pass  # Ignore non-JSON lines

            finally:
                proc.wait(timeout=840)

        if proc.returncode != 0:
            err = (proc.stderr.read() if proc.stderr else "")[:1024]
            logger.error("Claude CLI failed", returncode=proc.returncode, stderr=err)
            raise RuntimeError(f"Claude CLI failed: {err}")

        return new_session_id, proc.returncode


def _process_outputs_and_get_result(
    workdir: Path,
    outputs_dir: Path,
    trace_path: Path,
    bucket: str,
    prefix: str,
) -> str:
    """
    Process Claude outputs and extract the result for data analysis.

    Handles:
    - Finding and reading results files
    - Uploading output artifacts to S3
    - Extracting results from trace if no file

    Args:
        workdir: Working directory
        outputs_dir: Outputs directory
        trace_path: Path to trace file
        bucket: S3 bucket
        prefix: S3 prefix for outputs

    Returns:
        Result text to return to user
    """
    # Look for results files (Claude's output)
    results_files = list(outputs_dir.glob("results*.md")) + list(
        workdir.glob("results*.md")
    )
    result_text: str

    if results_files:
        # Use the most recent results file
        results_file = max(results_files, key=lambda p: p.stat().st_mtime)
        result_text = results_file.read_text(encoding="utf-8")

        # Upload the results file
        results_key = s3_operations.safe_s3_key(prefix, results_file.name)
        s3_helpers.write(
            results_key,
            result_text.encode("utf-8"),
            content_type="text/markdown",
            bucket=bucket,
        )
    else:
        # Try to extract from trace
        trace_result = trace_parser.extract_result_from_trace(trace_path)
        if trace_result:
            result_text = trace_result
        else:
            result_text = "# Analysis Complete\n\nThe analysis has completed but no specific results were generated."

    # Upload all output artifacts
    _upload_output_artifacts(outputs_dir, bucket, prefix)

    return result_text


def _upload_output_artifacts(outputs_dir: Path, bucket: str, prefix: str) -> None:
    """
    Upload all artifacts from outputs directory to S3.

    This includes generated charts, processed data files, reports, etc.

    Args:
        outputs_dir: Directory containing output files
        bucket: S3 bucket
        prefix: S3 prefix for outputs
    """
    if not outputs_dir.exists():
        return

    for file_path in outputs_dir.rglob("*"):
        if file_path.is_file() and not file_path.name.startswith("."):
            rel_path = file_path.relative_to(outputs_dir)
            s3_key = s3_operations.safe_s3_key(prefix, "outputs", str(rel_path))
            content_type = s3_operations.guess_content_type(file_path)

            try:
                s3_helpers.write(
                    s3_key,
                    file_path.read_bytes(),
                    content_type=content_type,
                    bucket=bucket,
                )
                logger.info(f"Uploaded output: {rel_path}")
            except Exception as e:
                logger.warning(f"Failed to upload {rel_path}: {e}")


def _update_conversation_history(
    bucket: str,
    prefix: str,
    user_prompt: str,
    result_text: str,
    outputs_dir: Path,
) -> None:
    """
    Update conversation history for the data analysis session.

    Args:
        bucket: S3 bucket
        prefix: S3 prefix
        user_prompt: Original user prompt
        result_text: Result text from Claude
        outputs_dir: Directory to save conversation
    """
    try:
        # Save to conversation.json
        conversation.append_conversation_from_text(
            bucket=bucket,
            prefix=prefix,
            prompt=user_prompt,
            assistant_text=result_text,
        )

        # Also save locally for reference
        local_conversation = outputs_dir / "conversation.json"
        local_conversation.parent.mkdir(parents=True, exist_ok=True)
        local_conversation.write_text(
            json.dumps(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "user": user_prompt,
                    "assistant": result_text,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning(f"Failed to update conversation history: {e}")


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _get_platform_info() -> str:
    """
    Get platform information string for the system prompt.

    Returns:
        Platform information string
    """
    try:
        return f"{platform.system()} {platform.release()}"
    except Exception:
        return "Lambda Runtime"


def _truthy(val: Optional[str | bool]) -> bool:
    """
    Interpret common truthy/falsey values from env/event overrides.

    Accepts bool or string. Strings like '0', 'false', 'no', 'off' are false; otherwise true.
    None defaults to True (feature enabled by default).

    Args:
        val: Value to interpret

    Returns:
        Boolean interpretation
    """
    if isinstance(val, bool):
        return val
    if val is None:
        return True
    s = str(val).strip().lower()
    if s in {"0", "false", "no", "off"}:
        return False
    return True
