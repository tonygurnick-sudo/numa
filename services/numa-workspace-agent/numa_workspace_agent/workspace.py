"""
Workspace management module for Numa Workspace Agent.

Handles local directory structure for ephemeral AgentCore storage.
Session is tied to conversation - each conversation gets its own MicroVM container.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, TypedDict

import structlog

from .atomic_io import atomic_write_text
from .sdk_config import LOCAL_ROOT

logger = structlog.get_logger()

# FEAT-243 — agent-scoped saved-workflow library. The active agent_id for this
# request is captured once at request entry (MicroVMs are conversation-pinned,
# so it's constant for the container's life) and read by the S3 sync layer +
# prompt builder, avoiding threading agent_id through every sync signature.
_active_agent_id: Optional[str] = None


def set_active_agent_id(agent_id: Optional[str]) -> None:
    """Record the agent_id for the current request (None for agent-less chat).

    Called at request entry, before any S3 sync, so the agent-workflows scope is
    available to ``get_agent_workflows_scope()`` for the whole request.
    """
    global _active_agent_id
    _active_agent_id = agent_id or None


def get_active_agent_id() -> Optional[str]:
    """The agent_id captured for the current request, or None."""
    return _active_agent_id


def get_agent_workflows_scope() -> Optional[str]:
    """The agent_id to scope the agent-workflow library under, or None when this
    isn't an agent conversation. When None, the agent-workflows directory is
    neither created nor synced — callers fall back to the user-level
    chat-workflows library. Agent-scoped workflows are always on for agent
    conversations — the same primitive as user-level chat-workflows."""
    return get_active_agent_id()


class WorkspacePaths(TypedDict):
    """Type definition for workspace path structure.

    AgentCore sets LOCAL_WORKSPACE_ROOT=/workdir - AI uses absolute paths under /workdir.
    """

    root: Path  # /workdir - workspace root (Claude's CWD)
    system_dir: Path  # /workdir/.system - internal system files (hidden from AI)
    claude_dir: Path  # /workdir/.system/.claude - CLI settings
    trace_file: Path  # /workdir/.system/trace.jsonl - current conversation trace
    conv_meta: Path  # /workdir/.system/current_conv.json - active conversation tracking
    workflows: (
        Path  # /workdir/chat-workflows - persistent workflows (GLOBAL, user-level)
    )
    agent_workflows: (
        Path  # /workdir/agent-workflows - per-(user,agent) workflows (FEAT-243)
    )
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
        agent_workflows=root / "agent-workflows",
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
    # chat-workflows/ — user-level persistent saved workflows (Saved Workflows
    # feature). Globally persistent across the user's conversations.
    paths["workflows"].mkdir(parents=True, exist_ok=True)
    paths["uploads"].mkdir(parents=True, exist_ok=True)
    paths["outputs"].mkdir(parents=True, exist_ok=True)
    # agent-workflows/ — created ONLY for agent conversations with FEAT-243 on.
    # Its mere existence is the signal (to the agent + scheduled-run preamble)
    # that an agent-scoped library is available, so don't create it otherwise.
    if get_agent_workflows_scope():
        paths["agent_workflows"].mkdir(parents=True, exist_ok=True)

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
    # Protected: .system, chat-workflows, agent-workflows, uploads, outputs,
    # agent-files, tools
    protected_dirs = {
        ".system",
        "chat-workflows",
        "agent-workflows",
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
