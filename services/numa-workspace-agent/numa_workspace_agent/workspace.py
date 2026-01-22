"""
Workspace management module for Numa Workspace Agent.

Handles local directory structure for ephemeral AgentCore storage.
Session is tied to user (not conversation) - same MicroVM reused across conversations.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, TypedDict

import structlog

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
    session: Path  # /workdir/session - conversation session files
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
    ├── session/                # Current conversation session files
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
        session=root / "session",
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
    paths["session"].mkdir(parents=True, exist_ok=True)

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

    meta_file.write_text(json.dumps(data, indent=2))
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
    - /session/ contents
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

    # Clear uploads, session, and agent-files directories
    for dir_path in [paths["uploads"], paths["session"], paths["agent_files"]]:
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
    # Protected: .system, chat-workflows, uploads, session, agent-files, tools
    protected_dirs = {
        ".system",
        "chat-workflows",
        "uploads",
        "session",
        "agent-files",
        "tools",
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
    (uploads, session, root files) are per-conversation.

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
    Clean up session files.

    Returns:
        Number of files deleted
    """
    paths = get_workspace_paths()
    session_dir = paths["session"]

    if not session_dir.exists():
        return 0

    deleted = 0
    for file_path in session_dir.rglob("*"):
        if file_path.is_file():
            try:
                file_path.unlink()
                deleted += 1
            except Exception as e:
                logger.warning(
                    "Failed to delete session file", path=str(file_path), error=str(e)
                )

    logger.info("Cleaned up session files", deleted=deleted)
    return deleted
