"""
Workspace management module for Numa Workspace Agent.

Handles local directory structure for ephemeral AgentCore storage.
Session is tied to conversation - each conversation gets its own MicroVM container.
"""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, TypedDict

import structlog

from .atomic_io import atomic_write_text
from .sdk_config import LOCAL_ROOT

logger = structlog.get_logger()


class WorkspacePaths(TypedDict):
    """Type definition for workspace path structure.

    AgentCore sets LOCAL_WORKSPACE_ROOT=/workdir - AI uses absolute paths under /workdir.
    """

    root: Path  # /workdir - workspace root (Claude's CWD)
    system_dir: Path  # /workdir/.system - internal system files (hidden from AI)
    claude_dir: Path  # /workdir/.system/.claude - CLI settings
    trace_file: Path  # /workdir/.system/trace.jsonl - current conversation trace
    conv_meta: Path  # /workdir/.system/current_conv.json - active conversation tracking
    workflows: Path  # /workdir/chat-workflows - persistent workflows (GLOBAL)
    uploads: Path  # /workdir/uploads - conversation uploads
    outputs: Path  # /workdir/outputs - conversation output files
    agent_files: Path  # /workdir/agent-files - agent reference files (per-conversation)


def get_workspace_paths() -> WorkspacePaths:
    """
    Get all workspace paths.

    Directory structure (AgentCore sets LOCAL_WORKSPACE_ROOT=/workdir):
    /workdir/                   # Root IS the workspace (Claude's CWD)
    ├── .system/                # Hidden from AI (deny rules)
    │   ├── .claude/            # Claude CLI settings
    │   ├── current_conv.json   # Tracks active conversation ID
    │   └── trace.jsonl         # Current conversation trace
    ├── chat-workflows/         # Persistent workflows (GLOBAL)
    ├── uploads/                # Current conversation uploads
    ├── outputs/                # Current conversation output files
    ├── agent-files/            # Agent reference files (per-conversation)
    └── (root files)            # Per-conversation (cleared on switch)

    Returns:
        WorkspacePaths dictionary with all path references
    """
    root = LOCAL_ROOT
    system_dir = root / ".system"

    return WorkspacePaths(
        root=root,
        system_dir=system_dir,
        claude_dir=system_dir / ".claude",
        trace_file=system_dir / "trace.jsonl",
        conv_meta=system_dir / "current_conv.json",
        workflows=root / "chat-workflows",
        uploads=root / "uploads",
        outputs=root / "outputs",
        agent_files=root / "agent-files",
    )


def ensure_directories() -> WorkspacePaths:
    """
    Ensure all workspace directories exist.

    Returns:
        WorkspacePaths with all directories created
    """
    paths = get_workspace_paths()

    # Create all directories
    paths["system_dir"].mkdir(parents=True, exist_ok=True)
    paths["claude_dir"].mkdir(parents=True, exist_ok=True)
    # DISABLED: chat-workflows feature temporarily disabled
    # paths["workflows"].mkdir(parents=True, exist_ok=True)
    paths["uploads"].mkdir(parents=True, exist_ok=True)
    paths["outputs"].mkdir(parents=True, exist_ok=True)

    logger.debug("Ensured workspace directories")
    return paths


def get_active_conversation() -> Optional[str]:
    """
    Get the currently active conversation ID.

    Returns:
        Conversation ID or None if no active conversation
    """
    paths = get_workspace_paths()
    meta_file = paths["conv_meta"]

    if not meta_file.exists():
        return None

    try:
        data = json.loads(meta_file.read_text())
        return data.get("conversationId")
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("Failed to read conversation meta", error=str(e))
        return None


def set_active_conversation(
    conversation_id: str, session_id: Optional[str] = None
) -> None:
    """
    Set the active conversation ID and optionally the SDK session ID.

    Args:
        conversation_id: The conversation ID to set as active
        session_id: Optional SDK session ID for resuming the conversation
    """
    paths = get_workspace_paths()
    meta_file = paths["conv_meta"]

    # Read existing data to preserve session_id if not provided
    existing_data = {}
    if meta_file.exists():
        try:
            existing_data = json.loads(meta_file.read_text())
        except (json.JSONDecodeError, IOError):
            pass

    data = {
        "conversationId": conversation_id,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }

    # Preserve or update session_id
    if session_id is not None:
        data["sessionId"] = session_id
    elif existing_data.get("conversationId") == conversation_id:
        # Keep existing session_id if same conversation
        if "sessionId" in existing_data:
            data["sessionId"] = existing_data["sessionId"]

    atomic_write_text(json.dumps(data, indent=2), meta_file)
    logger.debug(
        "Set active conversation",
        conversation_id=conversation_id,
        session_id=session_id[:8] + "..." if session_id else None,
    )


def get_active_session_id() -> Optional[str]:
    """
    Get the SDK session ID for the active conversation.

    Returns:
        Session ID or None if not set
    """
    paths = get_workspace_paths()
    meta_file = paths["conv_meta"]

    if not meta_file.exists():
        return None

    try:
        data = json.loads(meta_file.read_text())
        return data.get("sessionId")
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("Failed to read session ID from meta", error=str(e))
        return None


def clear_conversation_files() -> int:
    """
    Clear conversation-specific files for conversation switch.

    Clears:
    - /uploads/ contents
    - /outputs/ contents
    - /agent-files/ contents
    - Root-level files (not in protected dirs)
    - /.system/trace.jsonl

    Preserves:
    - /.system/ (except trace)
    - /chat-workflows/ (GLOBAL persistent)
    - /tools/ (baked into container image)

    Returns:
        Number of files deleted
    """
    paths = get_workspace_paths()
    deleted = 0

    # Clear uploads, outputs, and agent-files directories
    for dir_path in [paths["uploads"], paths["outputs"], paths["agent_files"]]:
        if not dir_path.exists():
            continue

        for file_path in dir_path.rglob("*"):
            if file_path.is_file():
                try:
                    file_path.unlink()
                    deleted += 1
                except Exception as e:
                    logger.warning(
                        "Failed to delete file", path=str(file_path), error=str(e)
                    )

    # Clear trace file
    if paths["trace_file"].exists():
        try:
            paths["trace_file"].unlink()
            deleted += 1
        except Exception as e:
            logger.warning("Failed to delete trace", error=str(e))

    # Clear root-level files and non-protected directories
    # Protected: .system, chat-workflows, uploads, outputs, agent-files, tools
    protected_dirs = {
        ".system",
        "chat-workflows",
        "uploads",
        "outputs",
        "agent-files",
        "tools",
        "numa-codebase",
    }
    root = paths["root"]

    try:
        for item in root.iterdir():
            if item.name in protected_dirs:
                continue
            # Skip hidden files that might be system-related
            if item.name.startswith(".") and item.name != ".system":
                continue
            if item.is_file():
                try:
                    item.unlink()
                    deleted += 1
                except Exception as e:
                    logger.warning(
                        "Failed to delete file", path=str(item), error=str(e)
                    )
            elif item.is_dir():
                # Recursively delete non-protected directories created by AI
                for file_path in item.rglob("*"):
                    if file_path.is_file():
                        try:
                            file_path.unlink()
                            deleted += 1
                        except Exception as e:
                            logger.warning(
                                "Failed to delete file",
                                path=str(file_path),
                                error=str(e),
                            )
    except PermissionError as e:
        logger.warning("Cannot iterate root directory", error=str(e))

    logger.info("Cleared conversation files", deleted=deleted)
    return deleted


def get_workspace_files(max_files: int = 100) -> list[dict]:
    """
    List files in the persistent chat-workflows directory.

    Only chat-workflows/ is globally persistent. Other directories
    (uploads, outputs, root files) are per-conversation.

    Args:
        max_files: Maximum number of files to return

    Returns:
        List of file info dictionaries
    """
    paths = get_workspace_paths()
    workflows_dir = paths["workflows"]

    if not workflows_dir.exists():
        return []

    files = []
    for file_path in workflows_dir.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.name.startswith("."):
            continue
        if len(files) >= max_files:
            break

        rel_path = file_path.relative_to(workflows_dir)
        stat = file_path.stat()

        files.append(
            {
                "path": f"chat-workflows/{rel_path}",
                "name": file_path.name,
                "size": stat.st_size,
                "modifiedAt": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat(),
            }
        )

    return files


def cleanup_session_files() -> int:
    """
    Clean up output files.

    Returns:
        Number of files deleted
    """
    paths = get_workspace_paths()
    outputs_dir = paths["outputs"]

    if not outputs_dir.exists():
        return 0

    deleted = 0
    for file_path in outputs_dir.rglob("*"):
        if file_path.is_file():
            try:
                file_path.unlink()
                deleted += 1
            except Exception as e:
                logger.warning(
                    "Failed to delete output file", path=str(file_path), error=str(e)
                )

    logger.info("Cleaned up output files", deleted=deleted)
    return deleted


# ── Selective Tool Copy ───────────────────────────────────────────────────────

# Source directory where all tool scripts are baked into the Docker image
# (read-only, copied from tools/ at build time via Dockerfile)
_TOOLS_IMAGE_ROOT = (
    Path("/app/tools") if Path("/app/tools").exists() else Path("/workdir/tools")
)

# Destination directory where Claude can access tools
_TOOLS_WORKSPACE_ROOT = LOCAL_ROOT / "tools"


def setup_agent_tools(
    enabled_numa_tools: list[str],
    tools_source_dirs: list[str],
    tool_file_map: dict[str, list[str]],
    always_copy: list[str],
) -> dict:
    """
    Selectively copy tool reference docs to /workdir/tools/ based on agent type config.

    Only docs for tools listed in enabled_numa_tools get copied. Claude reads
    these for parameter reference when using the numa_tool MCP tool. The files
    are documentation only — direct bash execution is blocked by security hooks.

    The Dockerfile bakes ALL tool docs into the image (at /workdir/tools/ with
    chmod 555). This function clears /workdir/tools/ and re-copies only what
    the agent type needs.

    Args:
        enabled_numa_tools: List of tool names to enable (e.g. ["web_search", "knowledge_search"])
        tools_source_dirs: Source directories under /app/tools/ (e.g. ["numa", "quoting"])
        tool_file_map: Maps tool names to file paths relative to source dir
        always_copy: Paths that are always copied when any tool is enabled (e.g. ["helpers/"])

    Returns:
        Dict with summary: {"copied": [...], "skipped": [...], "source": str}
    """
    copied: list[str] = []
    skipped: list[str] = []

    # Determine source root - in production /app/tools/ is separate from /workdir/tools/
    # In current Docker setup, tools are baked directly into /workdir/tools/
    # We work with the existing /workdir/tools/ contents
    source_root = _TOOLS_IMAGE_ROOT

    # If no tools are enabled, clear the tools workspace entirely
    if not enabled_numa_tools and not tools_source_dirs:
        if _TOOLS_WORKSPACE_ROOT.exists():
            # Remove entire tools dir and recreate empty
            shutil.rmtree(_TOOLS_WORKSPACE_ROOT, ignore_errors=True)
            _TOOLS_WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
        logger.info(
            "Agent tools cleared (no tools enabled)",
            _name="AGENT_TOOLS_CLEARED",
            phase="init",
        )
        return {"copied": [], "skipped": [], "source": str(source_root)}

    # For each source directory, rebuild dest with only enabled tools.
    # Strategy: remove dest dir entirely, then copy only what's needed from source.
    # This avoids chmod issues (Dockerfile bakes tools with chmod 555).
    for source_dir_name in tools_source_dirs:
        source_dir = source_root / source_dir_name
        dest_dir = _TOOLS_WORKSPACE_ROOT / source_dir_name

        if not source_dir.exists():
            logger.warning(
                "Tools source directory not found",
                source_dir=str(source_dir),
            )
            continue

        # Build the set of files/dirs to copy
        files_to_keep: set[str] = set()

        # Always copy shared utilities (e.g. helpers/)
        for always_path in always_copy:
            files_to_keep.add(always_path.rstrip("/"))

        # Add files for each enabled tool
        for tool_name in enabled_numa_tools:
            tool_files = tool_file_map.get(tool_name, [])
            for tf in tool_files:
                files_to_keep.add(tf)

        # Determine what exists at source to know what we're skipping
        source_items = (
            {item.name for item in source_dir.iterdir()}
            if source_dir.exists()
            else set()
        )
        skipped.extend(
            f"{source_dir_name}/{name}" for name in source_items - files_to_keep
        )

        # Remove existing dest dir (handles chmod 555 files from Dockerfile)
        if dest_dir.exists():
            shutil.rmtree(dest_dir, ignore_errors=True)

        # Recreate and selectively copy from source
        dest_dir.mkdir(parents=True, exist_ok=True)
        for item_name in files_to_keep:
            src = source_dir / item_name
            dst = dest_dir / item_name
            if src.exists():
                if src.is_dir():
                    shutil.copytree(src, dst, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, dst)
                copied.append(f"{source_dir_name}/{item_name}")

    # Remove source dirs that aren't in the config
    if _TOOLS_WORKSPACE_ROOT.exists():
        enabled_dirs = set(tools_source_dirs)
        for child in list(_TOOLS_WORKSPACE_ROOT.iterdir()):
            if child.is_dir() and child.name not in enabled_dirs:
                # Don't remove integrations dir (managed separately by _sync_integration_schemas)
                if child.name == "integrations":
                    continue
                shutil.rmtree(child, ignore_errors=True)
                skipped.append(f"{child.name}/ (entire directory)")

    logger.info(
        "Agent tools configured",
        _name="AGENT_TOOLS_SETUP",
        phase="init",
        enabled_tools=enabled_numa_tools,
        copied=copied,
        skipped=skipped,
        source_dirs=tools_source_dirs,
    )

    return {"copied": copied, "skipped": skipped, "source": str(source_root)}
