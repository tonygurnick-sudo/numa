import io
import json
import os
import random
import shutil
import subprocess
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, TypedDict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers
import s3_helpers
from prompts import SYSTEM_PROMPT
from settings import SETTINGS_JSON

logger = structlog.get_logger()

# pylint: disable=broad-exception-caught,consider-using-with,too-many-arguments,too-many-positional-arguments,too-many-branches,too-many-locals,too-many-statements


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
        return

    try:
        helpers.append_event(
            message=event_msg,
            job_id=job_id,
            user_id=user_id,
            app_id=app_id,
            use_dynamodb=app_context.get("use_dynamodb", False),
            bucket=app_context.get("bucket"),
        )
    except Exception:
        logger.warning("Failed to append event", msg=event_msg)


def _s3_key(prefix: str, *parts: str | None) -> str:
    cleaned = "/".join(p.strip("/") for p in parts if p is not None)
    return f"{prefix}/{cleaned}" if cleaned else prefix


def _ensure_dirs(workdir: Path) -> Dict[str, Path]:
    inputs = workdir / "user-inputs"
    outputs = workdir / "outputs"
    tmp = workdir / "tmp"
    for d in (inputs, outputs, tmp):
        d.mkdir(parents=True, exist_ok=True)
    return {"inputs": inputs, "outputs": outputs, "tmp": tmp}


def _truthy(val: Optional[str | bool]) -> bool:
    """Interpret common truthy/falsey values from env/event overrides.

    Accepts bool or string. Strings like '0', 'false', 'no', 'off' are false; otherwise true.
    None defaults to True (feature enabled by default).
    """
    if isinstance(val, bool):
        return val
    if val is None:
        return True
    s = str(val).strip().lower()
    if s in {"0", "false", "no", "off"}:
        return False
    return True


def _list_user_input_files(
    inputs_dir: Path, max_files: int = 50, skip_hidden: bool = True
) -> Tuple[List[str], int]:
    """Return up to max_files file names in ./user-inputs and count of any extras.

    - Skips directories; returns base names only.
    - Optionally skips dotfiles.
    - Sorts case-insensitively for deterministic ordering.
    """
    if not inputs_dir.exists():
        return [], 0

    names: List[str] = []
    try:
        for p in inputs_dir.iterdir():
            if not p.is_file():
                continue
            name = p.name
            if skip_hidden and name.startswith("."):
                continue
            # Truncate extremely long file names for prompt readability
            if len(name) > 200:
                name = name[:197] + "..."
            names.append(name)
    except Exception:
        # On any listing error, fail gracefully
        return [], 0

    names.sort(key=lambda x: x.lower())
    if len(names) <= max_files:
        return names, 0
    return names[:max_files], len(names) - max_files


def _augment_prompt_with_uploads(
    user_prompt: str, inputs_dir: Path, include: bool = True
) -> Tuple[str, int, int]:
    """Build a composite prompt that prefaces the user's message with uploaded files.

    Returns: (final_prompt, included_count, extra_count)
    """
    if not include:
        return user_prompt, 0, 0

    files, extra = _list_user_input_files(inputs_dir)
    if not files:
        return user_prompt, 0, 0

    lines: List[str] = []
    lines.append("User uploaded files (available under ./user-inputs/):")
    for n in files:
        lines.append(f"- {n}")
    if extra:
        lines.append(f"... and {extra} more")
    lines.append("")
    lines.append("User prompt:")
    lines.append(user_prompt.strip())

    return "\n".join(lines), len(files), extra


def _check_cli_or_fail(bin_path: str) -> str:
    try:
        proc = subprocess.run(
            [bin_path, "--version"],
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                proc.stderr.strip() or proc.stdout.strip() or "unknown error"
            )
        version = (proc.stdout or proc.stderr or "").strip()
        logger.info("Claude CLI detected", version=version)
        return version
    except FileNotFoundError as e:
        logger.error("Claude CLI not found in PATH", error=str(e))
        raise RuntimeError("Claude CLI not available in runtime") from e
    except Exception as e:
        logger.error("Claude CLI version check failed", error=str(e))
        raise


def _hydrate_inputs(
    bucket: str, uploaded_files: List[Dict[str, Any]], inputs_dir: Path
) -> List[str]:
    downloaded: List[str] = []
    for item in uploaded_files or []:
        key = item.get("s3_key") or item.get("key")
        if not key:
            continue
        data = s3_helpers.read(key, bucket=bucket)
        name = os.path.basename(key)
        dest = inputs_dir / name
        dest.write_bytes(data)
        downloaded.append(name)
    return downloaded


def _hydrate_prior_outputs(bucket: str, prefix: str, outputs_dir: Path) -> int:
    """Download prior outputs from S3 so the agent can read its previous artifacts."""
    count = 0
    try:
        keys = s3_helpers.list_objects(prefix=f"{prefix}/outputs/", bucket=bucket)
        for key in keys:
            # skip folders and ensure relative name
            rel = key.split(f"{prefix}/outputs/")[-1]
            if not rel or rel.endswith("/"):
                continue
            target = outputs_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            data = s3_helpers.read(key, bucket=bucket)
            target.write_bytes(data)
            count += 1
        if count:
            logger.info("Hydrated prior outputs", files=count)
    except Exception:
        logger.warning("Failed hydrating prior outputs")
    return count


def _guess_content_type(p: Path) -> str:
    ext = p.suffix.lower()
    return {
        ".md": "text/markdown",
        ".csv": "text/csv",
        ".json": "application/json",
        ".html": "text/html",
        ".txt": "text/plain",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")


def _append_conversation(
    prefix: str, prompt: Optional[str], results_key: Optional[str]
) -> None:
    conv_key = _s3_key(prefix, "history", "conversation.md")
    try:
        existing = s3_helpers.read(conv_key).decode("utf-8")
    except Exception:
        existing = ""

    lines: List[str] = []
    if existing:
        lines.append(existing.rstrip() + "\n")
    if prompt:
        lines += ["User:", prompt.strip(), ""]
    if results_key:
        lines += ["Assistant:", f"See outputs/results.md ({results_key})", ""]
    s3_helpers.write(
        conv_key, "\n".join(lines).encode("utf-8"), content_type="text/markdown"
    )


def _session_archive_key(prefix: str) -> str:
    return _s3_key(prefix, "sessions", "claude-home.tar.gz")


def _restore_session_from_s3(bucket: str, prefix: str, home: Path) -> bool:
    key = _session_archive_key(prefix)
    try:
        blob = s3_helpers.read(key, bucket=bucket)
    except Exception:
        return False
    # Extract tar.gz into home (expects to contain a .claude/ tree)
    home.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        tf.extractall(path=home)
    return True


def _archive_session_to_s3(bucket: str, prefix: str, home: Path) -> None:
    key = _session_archive_key(prefix)
    buf = io.BytesIO()
    # Archive the entire .claude dir under home
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        base = home / ".claude"
        if base.exists():
            tf.add(base, arcname=base.name)
    s3_helpers.write(
        key, buf.getvalue(), content_type="application/gzip", bucket=bucket
    )


## SETTINGS_JSON moved to settings.py to keep config centralized


def _ensure_settings_json(home: Path) -> None:
    settings_dir = home / ".claude"
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_path = settings_dir / "settings.json"
    try:
        settings_path.write_text(json.dumps(SETTINGS_JSON, indent=2), encoding="utf-8")
    except Exception:
        logger.warning("Failed writing .claude/settings.json")


def _extract_tool_event(tool_name: str, tool_input: dict) -> Optional[str]:
    """Extract event message for a specific tool use."""

    def format_bash_command(inp: dict) -> Optional[str]:
        """Format a bash command with truncation."""
        command = inp.get("command", "")
        if not command:
            return None
        cmd_preview = command[:60] + "..." if len(command) > 60 else command
        return f"Running: {cmd_preview}"

    tool_events = {
        "Read": lambda inp: (
            f"Reading file: {inp.get('file_path', '')}"
            if inp.get("file_path")
            else None
        ),
        "Write": lambda inp: (
            f"Writing file: {inp.get('file_path', '')}"
            if inp.get("file_path")
            else None
        ),
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
            return random.choice(thinking_variants)
        except Exception:
            return "Numa: Thinking..."

    return None


def _extract_meaningful_event(obj: Any) -> Optional[str]:
    """
    Extract meaningful event messages from Claude CLI trace events.

    Filters for events that provide useful status information to the user.

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

    # Assistant messages with nested content blocks
    if event_type == "assistant":
        content_array = obj.get("message", {}).get("content") or obj.get("content")

        if content_array and isinstance(content_array, list):
            for block in content_array:
                event_msg = _extract_content_block_event(block)
                if event_msg:
                    return event_msg

    return None


def _run_claude_stream(
    bin_path: str,
    workdir: Path,
    cc_session_id: Optional[str],
    prompt: str,
    append_system: str,
    trace_path: Path,
    stream_events: bool = False,
    app_context: Optional[AppContext] = None,
) -> Tuple[Optional[str], int]:
    # Use verbose mode when printing with stream-json output per CLI requirements
    args = [bin_path, "-p", "--verbose"]
    # Resolve permission mode from settings.json as the single source of truth
    permission_mode = (SETTINGS_JSON.get("permissions", {}) or {}).get("defaultMode")
    if not permission_mode:
        raise RuntimeError("SETTINGS_JSON.permissions.defaultMode is required")
    # Build allowed tools from settings (single source of truth)
    allowed_tools: List[str] = []
    tools_cfg = SETTINGS_JSON.get("tools", {})
    allow_categories = tools_cfg.get("allow", []) or []
    bash_patterns = tools_cfg.get("bash_allow", []) or []
    # Enable core tool categories (Read/Write/Glob/Grep/Edit)
    for t in allow_categories:
        if isinstance(t, str) and t:
            allowed_tools.append(t)
    # Add Bash patterns
    for pat in bash_patterns:
        if isinstance(pat, str) and pat:
            allowed_tools.append(f"Bash({pat})")
    if not allowed_tools:
        raise RuntimeError(
            "SETTINGS_JSON.tools must define at least one allowed tool or bash pattern"
        )
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
        append_system,
    ]

    with trace_path.open("w", encoding="utf-8") as trace_file:
        proc = subprocess.Popen(
            args,
            cwd=str(workdir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            # Ensure child Python sees layer/site-packages
            env={
                **os.environ,
                "HOME": os.environ.get("HOME", "/tmp"),
                "PYTHONPATH": ":".join(
                    filter(
                        None,
                        [
                            os.environ.get("PYTHONPATH"),
                            "/opt/python",  # Lambda layers (e.g., awswrangler/pandas)
                            "/var/task",  # Packaged dependencies with the function
                        ],
                    )
                ),
            },
        )
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

                    # Emit meaningful events if streaming is enabled
                    if stream_events:
                        event_msg = _extract_meaningful_event(obj)
                        if event_msg:
                            _try_append_event(event_msg, app_context)
                except Exception:
                    # Ignore non-JSON lines or partials that fail to parse
                    pass

            # No buffer to flush; events appended immediately

        finally:
            proc.wait(timeout=840)

        if proc.returncode != 0:
            err = (proc.stderr.read() if proc.stderr else "")[:1024]
            logger.error("Claude CLI failed", returncode=proc.returncode, stderr=err)
            raise RuntimeError(f"Claude CLI failed: {err}")

        return new_session_id, proc.returncode


def _ensure_claude_cli_available(bucket: str) -> str:
    """Ensure the Claude CLI is present at CLAUDE_BIN. If missing, download from S3 and extract."""
    bin_path = os.environ.get("CLAUDE_BIN", "/opt/bin/claude")
    target = Path(bin_path)
    if target.exists():
        return bin_path

    s3_key = os.environ.get("CLAUDE_CLI_S3_KEY")
    if not s3_key:
        raise RuntimeError("CLAUDE_CLI_S3_KEY not set; cannot fetch Claude CLI")

    # Download the layer ZIP and extract bin/claude -> /tmp/claude
    try:
        blob = s3_helpers.read(s3_key, bucket=bucket)
    except Exception as e:
        logger.error(
            "Failed to download Claude CLI zip from S3", key=s3_key, error=str(e)
        )
        raise

    zip_tmp = Path("/tmp/claude-cli.zip")
    try:
        zip_tmp.write_bytes(blob)
        with zipfile.ZipFile(zip_tmp, "r") as zf:
            # Extract only the claude binary if present under bin/
            member = None
            for info in zf.infolist():
                name = info.filename
                if name.endswith("/"):
                    continue
                # Normalize and match bin/claude regardless of leading ./
                norm = name.lstrip("./")
                if norm == "bin/claude":
                    member = info
                    break
            if not member:
                raise RuntimeError(
                    "claude binary not found in layer zip (expected bin/claude)"
                )
            # Extract to /tmp and move/rename to target
            extract_dir = Path("/tmp/claude-extract")
            extract_dir.mkdir(parents=True, exist_ok=True)
            zf.extract(member, path=extract_dir)
            src = extract_dir / "bin" / "claude"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            os.chmod(target, 0o755)
    finally:
        try:
            if zip_tmp.exists():
                zip_tmp.unlink()
        except Exception:
            pass

    return bin_path


def _extract_result_from_trace(trace_path: Path) -> str | None:
    """
    Extract the result field from the final result event in the trace.

    Parses the trace NDJSON file and looks for the last event with type="result",
    returning its "result" field value. This is useful when Claude completes
    successfully but doesn't write a results.md file.

    Args:
        trace_path: Path to the trace.jsonl file

    Returns:
        The result text from the trace, or None if not found or trace doesn't exist
    """
    if not trace_path.exists():
        return None

    result_text = None
    try:
        with trace_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    event = json.loads(line)
                    if event.get("type") == "result":
                        result_text = event.get("result")
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.warning("Error reading trace file", error=str(e))
        return None

    return result_text


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    helpers.setup_step_function_lambda_logging(event, context)

    app_id = event["app_id"]
    job_id = event["job_id"]
    user_id = event["user_id"]
    prompt = (
        event.get("prompt") or "Perform an initial EDA and create outputs/results.md."
    )
    uploaded_files = event.get("uploaded_files") or []
    # Future functionality: when true, restore prior session and pass --resume to CLI
    resume_session = event.get("resume_session", False)
    # Stream events to status while running (default: false for backwards compatibility)
    stream_events = event.get("stream_events", False)

    bucket = os.environ["BUCKET"]
    prefix = f"{app_id}/{user_id}/{job_id}"

    # Determine if we should use DynamoDB for status (check if DYNAMODB_TABLE env var exists)
    use_dynamodb = bool(os.environ.get("DYNAMODB_TABLE"))

    # Working directories
    os.environ.setdefault("HOME", "/tmp")
    workdir = Path("/tmp") / "cc_ws" / job_id
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    workdir.mkdir(parents=True, exist_ok=True)
    dirs = _ensure_dirs(workdir)

    # Hydrate user inputs
    _hydrate_inputs(bucket, uploaded_files, dirs["inputs"])

    # Optionally augment the agent prompt with a preface listing uploaded files
    user_prompt_for_log = prompt  # keep original for conversation history
    ev_override = event.get("include_uploads_in_prompt")
    if ev_override is None:
        include_uploads = _truthy(os.environ.get("INCLUDE_UPLOADS_IN_PROMPT"))
    else:
        include_uploads = _truthy(ev_override)

    final_prompt, inc_count, extra_count = _augment_prompt_with_uploads(
        user_prompt_for_log, dirs["inputs"], include=include_uploads
    )
    if inc_count:
        logger.info(
            "Augmented prompt with uploaded files",
            included=inc_count,
            extra=extra_count,
        )
    else:
        logger.info("No uploaded files to include in prompt or feature disabled")

    # Session continuity: restoration phase (future functionality, gated by resume_session)
    # NOTE: Session artifacts are always SAVED (below), but only RESTORED when resume_session=true.
    # This ensures one-off runs still persist state for potential future resumed runs.
    home = Path(os.environ.get("HOME", "/tmp"))
    cc_session_id: Optional[str] = None

    if resume_session:
        logger.info("Session continuity enabled; attempting restoration", job_id=job_id)
        # Hydrate prior outputs so agent can reference previous work
        _hydrate_prior_outputs(bucket, prefix, dirs["outputs"])
        # Restore Claude session archive from S3
        restored = _restore_session_from_s3(bucket, prefix, home)
        if restored:
            logger.info("Restored Claude home from session archive")
        # Load previous ccSessionId to pass --resume to CLI
        try:
            meta = json.loads(
                s3_helpers.read(_s3_key(prefix, "meta", "session.json")).decode("utf-8")
            )
            cc_session_id = meta.get("ccSessionId") or cc_session_id
            if cc_session_id:
                logger.info(
                    "Loaded prior session ID for resume", session_id=cc_session_id
                )
        except Exception:
            logger.warning("No prior session metadata found; starting fresh")
    else:
        logger.info("Starting fresh session (resume_session=false)", job_id=job_id)

    # Ensure strict settings.json exists
    _ensure_settings_json(home)

    # System prompt contract
    system_rules = SYSTEM_PROMPT

    # Ensure Claude CLI is available (download from S3 to /tmp if needed), then invoke.
    results_md = dirs["outputs"] / "results.md"
    bin_path = _ensure_claude_cli_available(bucket)
    trace_local = workdir / "trace.jsonl"
    ran_cli = False

    # Prepare app context for event streaming if enabled
    app_context: Optional[AppContext] = None
    if stream_events:
        app_context = {
            "job_id": job_id,
            "user_id": user_id,
            "app_id": app_id,
            "use_dynamodb": use_dynamodb,
            "bucket": bucket,
        }
        # Emit initial event
        try:
            helpers.append_event(
                message="Starting analysis...",
                job_id=job_id,
                user_id=user_id,
                app_id=app_id,
                use_dynamodb=use_dynamodb,
                bucket=bucket,
            )
        except Exception:
            logger.warning("Failed to append initial event")

    try:
        _check_cli_or_fail(bin_path)
        new_cc_session_id, _ = _run_claude_stream(
            bin_path,
            workdir,
            cc_session_id,
            final_prompt,
            system_rules,
            trace_local,
            stream_events=stream_events,
            app_context=app_context,
        )
        cc_session_id = new_cc_session_id or cc_session_id
        ran_cli = True
    except FileNotFoundError as e:
        logger.error("Claude CLI not found", error=str(e))
        raise RuntimeError("Claude CLI not available in runtime") from e
    except Exception:
        logger.exception("Claude CLI execution error")
        raise

    # Ensure required results.md exists; create fallback if missing
    if not results_md.exists():
        logger.warning("results.md was not created by agent; checking trace for result")
        trace_result = _extract_result_from_trace(trace_local)

        if trace_result:
            logger.info("Found result in trace; using as fallback results.md")
            results_md.write_text(trace_result, encoding="utf-8")
        else:
            logger.warning("No result found in trace; generating error fallback")
            fallback_content = "# Error\n\nThe agent did not generate results. Please review the trace for details.\n"
            results_md.write_text(fallback_content, encoding="utf-8")

    # Rename results.md to results-<timestamp>.md
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    results_filename = f"results-{timestamp}.md"
    results_timestamped = dirs["outputs"] / results_filename
    results_md.rename(results_timestamped)
    logger.info("Renamed results file", original="results.md", new=results_filename)

    # Upload outputs
    outputs_list: List[str] = []
    for root, _, files in os.walk(dirs["outputs"]):
        for name in files:
            p = Path(root) / name
            key = _s3_key(prefix, "outputs", str(p.relative_to(dirs["outputs"])))
            s3_helpers.write(key, p.read_bytes(), content_type=_guess_content_type(p))
            outputs_list.append(key)

    # Upload trace file if present
    try:
        if trace_local.exists():
            s3_helpers.write(
                _s3_key(prefix, "trace", "trace.jsonl"),
                trace_local.read_bytes(),
                content_type="application/x-ndjson",
            )
            logger.info("Uploaded trace file")
    except Exception:
        logger.warning("Failed to upload trace.jsonl")

    # Session continuity: persistence phase (always runs to prepare for potential future resumes)
    # NOTE: These artifacts are saved even when resume_session=false so they're available
    # if the same job_id is invoked again with resume_session=true in the future.
    if ran_cli:
        try:
            _archive_session_to_s3(bucket, prefix, home)
            logger.info("Archived Claude session to S3")
        except Exception as e:
            logger.warning("Failed archiving session", error=str(e))

    # Write manifest (always includes ccSessionId for future resume capability)
    manifest = {
        "jobId": job_id,
        "ccSessionId": cc_session_id,
        "outputs": outputs_list,
    }
    s3_helpers.write(
        _s3_key(prefix, "meta", "manifest.json"),
        json.dumps(manifest).encode("utf-8"),
        content_type="application/json",
    )
    logger.info("Wrote manifest", job_id=job_id, output_count=len(outputs_list))

    if cc_session_id:
        s3_helpers.write(
            _s3_key(prefix, "meta", "session.json"),
            json.dumps({"ccSessionId": cc_session_id}).encode("utf-8"),
            content_type="application/json",
        )
        logger.info("Persisted session metadata", session_id=cc_session_id)

    # Conversation log for UI continuity (always maintained)
    results_key = _s3_key(prefix, "outputs", results_filename)
    _append_conversation(prefix, user_prompt_for_log, results_key)
    logger.info("Updated conversation history")

    # AppOutput payload
    app_output = {
        "results": [
            {
                "input_reference": None,
                "outputs": [
                    {
                        "content_type": "text/markdown",
                        "title": "Analysis Results",
                        "data": {"bucket": bucket, "key": results_key},
                        "location": "S3",
                    }
                ],
            }
        ]
    }

    # Emit final completion event if streaming
    if stream_events and app_context:
        try:
            helpers.append_event(
                message="Analysis complete",
                job_id=job_id,
                user_id=user_id,
                app_id=app_id,
                use_dynamodb=use_dynamodb,
                bucket=bucket,
            )
        except Exception:
            logger.warning("Failed to append completion event")

    return app_output
