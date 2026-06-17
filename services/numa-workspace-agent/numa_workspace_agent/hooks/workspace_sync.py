"""PreToolUse hook: eagerly flush the workspace to S3 before a ``numa`` command
whose server-side handler reads the target file from S3.

Several numa CLI tools — ``docs convert`` / ``docs extract`` / ``docs transcribe``,
``integrations`` (attach a file / upload to Drive / email it), ``agents``
(reference files), and ``vision`` — read the file from the conversation's
workspace S3 prefix inside their Lambda. But agent-GENERATED files only reach S3
at the post-turn sync, so the Lambda 404s on a file the model just created
(classic case: "convert the .pptx you just made to PDF"). This hook flushes the
workspace to S3 first, so the file is there when the handler reads it.

It's cheap: a stat-only dirty check (``workspace_is_dirty``) gates the real sync,
so when nothing has been written since the last sync it's a handful of ``stat()``
calls. When a file did change, the incremental ``sync_to_s3`` uploads only that
file. Best-effort — any failure is swallowed and the authoritative post-turn
sync remains the backstop.
"""

import os
import re
from typing import Any

import structlog

try:
    from claude_agent_sdk import HookContext
except ImportError:  # pragma: no cover - SDK always present at runtime
    HookContext = Any  # type: ignore[misc,assignment]

logger = structlog.get_logger()

# numa commands whose handler reads the file server-side (so a freshly generated
# file must be in S3 first). Matches `numa <…>` and the dev binary `numa-dev`.
_FILE_PATH_NUMA = re.compile(
    r"\bnuma(?:-dev)?\s+(?:docs\s+(?:convert|extract|transcribe)|integrations|agents|vision)\b"
)


async def workspace_sync_hook(
    input_data: dict[str, Any],
    tool_use_id: str | None,
    context: HookContext,
) -> dict[str, Any]:
    if input_data.get("tool_name") != "Bash":
        return {}
    command = (input_data.get("tool_input") or {}).get("command") or ""
    if not _FILE_PATH_NUMA.search(command):
        return {}

    try:
        # Lazy imports: s3_workspace -> sdk_config -> hooks would be circular at
        # import time, so pull these in only when the hook actually fires.
        from numa_workspace_agent import main
        from numa_workspace_agent.s3_workspace import (
            get_local_checksums,
            sync_to_s3,
            workspace_is_dirty,
        )
        from numa_workspace_agent.workspace import get_active_conversation

        conversation_id = get_active_conversation()
        user_sub = os.environ.get("NUMA_USER_SUB", "")
        if not conversation_id or not user_sub:
            return {}

        baseline = main._checksums_cache
        if not workspace_is_dirty(baseline):
            return {}  # nothing written since the last sync — skip

        result = sync_to_s3(user_sub, conversation_id, baseline)
        # Refresh the baseline so the post-turn sync doesn't re-upload what we
        # just pushed, and the next eager check compares against the new state.
        main._checksums_cache = get_local_checksums(conversation_id)
        logger.info(
            "Eager workspace sync before file-path numa command",
            _name="EAGER_SYNC",
            conversation_id=conversation_id,
            files_uploaded=result.get("files_uploaded", 0),
        )
    except Exception as e:  # best-effort — must never break the command
        logger.warning("Eager workspace sync failed (non-fatal)", error=str(e))
    return {}
