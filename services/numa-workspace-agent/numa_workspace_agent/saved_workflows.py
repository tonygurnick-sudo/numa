"""
Saved Workflows — user-level, persistent reusable scripts.

A per-conversation workspace is ephemeral, so anything Numa figures out how to
do is lost at the end of the chat. Saved Workflows fix that: scripts written to
``/workdir/chat-workflows/`` sync to a **user-level** S3 prefix
(``{user_sub}/chat-workflows/``) and are synced back into every future
conversation. Over time this becomes the way Numa tunes itself to one user —
the recurring jobs they like done, captured as runnable scripts.

Each workflow is an ordinary executable script (Python by default, Bash works
too) with a ``#``-comment frontmatter block at the top. ``#`` is a comment in
both languages, so the file stays directly runnable while we can read its
metadata WITHOUT executing it. The **filename** is the workflow's identifier;
the header carries the human metadata:

    #!/usr/bin/env python3              # optional shebang
    # --- numa-workflow ---
    # title: Weekly Finance Summary
    # description: Pull this week's transactions from the finance folder,
    #   categorise them, and render a summary. Use when the user asks for
    #   their weekly finance update.
    # created: 2026-06-10
    # updated: 2026-06-10
    # required_integrations: gmail        # optional, comma-separated slugs
    # --- end ---
    \"\"\"Longer human notes can live here.\"\"\"
    ...real code that calls `numa` via subprocess (see prompts.py for an example).

Required header fields: title, description, created, updated.
Optional: required_integrations (comma-separated integration slugs the workflow
needs — lets the agent pre-check availability before running).

This module is the single source of truth for the format — both the dynamic
prompt section (``prompts.py``) and the Write/Edit validation hook
(``hooks/workflow_guard.py``) parse/validate through here.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional, TypedDict

WORKFLOWS_DIR = Path("/workdir/chat-workflows")
# FEAT-243 — agent-scoped library (per-user-per-agent). Same format/validation
# as the user-level library; only the directory + S3 prefix differ. Present
# only for agent conversations with the feature enabled.
AGENT_WORKFLOWS_DIR = Path("/workdir/agent-workflows")

_FENCE_START = "--- numa-workflow ---"
_FENCE_END = "--- end ---"
# A header line inside the fence: `# key: value`
_KV_RE = re.compile(r"^#\s*([a-zA-Z_]+)\s*:\s*(.*)$")
# A folded continuation line: `#   more text` (indented, no `key:`)
_CONT_RE = re.compile(r"^#\s{2,}(\S.*)$")
# How many leading lines we'll scan for the fence (tolerates a shebang + blanks).
_MAX_HEADER_SCAN = 60
# Keys we recognise in the header.
_KNOWN_KEYS = ("title", "description", "created", "updated", "required_integrations")
# Fields every saved workflow must declare. required_integrations is optional.
REQUIRED_FIELDS = ("title", "description", "created", "updated")
# Keys whose value may be folded across indented continuation lines.
_FOLDABLE = ("title", "description")


class WorkflowHeader(TypedDict, total=False):
    title: str
    description: str
    created: str
    updated: str
    required_integrations: list[str]
    path: str  # filename, set by list_saved_workflows


def parse_workflow_header(text: str) -> Optional[WorkflowHeader]:
    """Parse the ``# --- numa-workflow ---`` frontmatter from a script.

    Returns the header dict (with title/description/created/updated, plus an
    optional required_integrations list) or None if the fence is absent or a
    required field is missing. Pure / no I/O.
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines[:_MAX_HEADER_SCAN]):
        if _FENCE_START in line and line.lstrip().startswith("#"):
            start = i + 1
            break
    if start is None:
        return None

    raw: dict[str, str] = {}
    last_key: Optional[str] = None
    for line in lines[start : start + _MAX_HEADER_SCAN]:
        if _FENCE_END in line and line.lstrip().startswith("#"):
            break
        if not line.lstrip().startswith("#"):
            break  # frontmatter must be a contiguous comment block
        kv = _KV_RE.match(line.strip())
        if kv:
            key, value = kv.group(1).lower(), kv.group(2).strip()
            if key in _KNOWN_KEYS:
                raw[key] = value
                last_key = key
            continue
        cont = _CONT_RE.match(line.strip()) or _CONT_RE.match(line)
        if cont and last_key in _FOLDABLE:
            raw[last_key] = (
                raw.get(last_key, "") + " " + cont.group(1).strip()
            ).strip()

    if not all(raw.get(f) for f in REQUIRED_FIELDS):
        return None

    header: WorkflowHeader = {
        "title": raw["title"],
        "description": raw["description"],
        "created": raw["created"],
        "updated": raw["updated"],
    }
    if raw.get("required_integrations"):
        header["required_integrations"] = [
            s.strip().lower()
            for s in raw["required_integrations"].split(",")
            if s.strip()
        ]
    return header


def validate_workflow_content(text: str) -> tuple[bool, Optional[str]]:
    """Validate a would-be workflow file. Returns ``(ok, error_message)``.

    Used by the Write/Edit guard to reject malformed saved workflows at
    authoring time, with a message that tells the model exactly how to fix it.
    """
    header = parse_workflow_header(text)
    if header is None:
        return False, (
            "Saved workflows in /workdir/chat-workflows/ need a frontmatter header so "
            "they show up in future conversations. Add this comment block at the very "
            "top (before the code), filling in all four required fields:\n"
            "# --- numa-workflow ---\n"
            "# title: <human-readable title>\n"
            "# description: <what it does + when to use it>\n"
            "# created: <YYYY-MM-DD>\n"
            "# updated: <YYYY-MM-DD>\n"
            "# required_integrations: <comma-separated slugs, or omit if none>\n"
            "# --- end ---"
        )
    if len(header.get("title", "")) < 3:
        return (
            False,
            "Workflow 'title' is too short — give it a clear human-readable title.",
        )
    if len(header.get("description", "")) < 10:
        return (
            False,
            "Workflow 'description' is too short — describe what it does and when to use it.",
        )
    return True, None


def _list_workflows(base_dir: Path, max_workflows: int = 20) -> list[WorkflowHeader]:
    """Read parsed headers of all valid saved workflows under ``base_dir``.

    Best-effort: unreadable/malformed files are skipped (they just don't appear
    in the prompt). No S3 round-trip — reads the synced local folder.
    """
    if not base_dir.exists():
        return []
    out: list[WorkflowHeader] = []
    try:
        files = sorted(base_dir.rglob("*"))
    except OSError:
        return []
    for path in files:
        if not path.is_file() or path.name.startswith("."):
            continue
        try:
            header = parse_workflow_header(
                path.read_text(encoding="utf-8", errors="replace")
            )
        except OSError:
            continue
        if header is None:
            continue
        header["path"] = str(path.relative_to(base_dir))
        out.append(header)
        if len(out) >= max_workflows:
            break
    return out


def list_saved_workflows(max_workflows: int = 20) -> list[WorkflowHeader]:
    """User-level saved workflows (``/workdir/chat-workflows``)."""
    return _list_workflows(WORKFLOWS_DIR, max_workflows)


def list_agent_workflows(max_workflows: int = 20) -> list[WorkflowHeader]:
    """Agent-scoped saved workflows (``/workdir/agent-workflows``, FEAT-243).

    Empty unless this is an agent conversation with the feature enabled (the
    directory only exists then)."""
    return _list_workflows(AGENT_WORKFLOWS_DIR, max_workflows)


# ── Secret heuristics (warn-only) ─────────────────────────────────────────────
# Numa chat shouldn't contain secrets — integration credentials are injected
# OUTSIDE the workspace, never into scripts. So a hardcoded-looking secret in a
# saved workflow is almost certainly a mistake. We WARN (not block) so the model
# can self-correct (use the runtime credential layer) without being hard-stopped.
_SECRET_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),  # AWS access key id
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),  # OpenAI-style key
    re.compile(r"\bghp_[A-Za-z0-9]{30,}\b"),  # GitHub token
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),  # Slack token
    re.compile(
        r"(?i)\b(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{12,}['\"]"
    ),
]


def scan_for_secrets(text: str) -> bool:
    """True if the content looks like it hardcodes a secret. Heuristic — used
    only to surface a non-blocking warning to the model."""
    return any(p.search(text) for p in _SECRET_PATTERNS)
