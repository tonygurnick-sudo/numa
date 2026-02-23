"""
Base configuration dataclass and constants for the agent type system.

This module defines `AgentTypeConfig` — the single configuration object that controls
how the workspace agent engine behaves for a given agent type. Different agent types
(e.g. "numa-chat", "research-agent", "quoting-agent") are just different instances of
this dataclass: same engine, different knobs.

It also defines the `TOOL_FILE_MAP` and `ALWAYS_COPY` constants, which control the
selective copy of Numa CLI tool scripts from /app/tools/ into the workspace at
/workdir/tools/ during startup.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class AgentTypeConfig:
    """Configuration for a workspace agent type.

    Each agent type is a different configuration of the same workspace agent engine.
    It controls which tools are available, what system prompt is used, how responses
    are delivered, and which Numa CLI tools are copied to /workdir/tools/.

    The three tool layers:
        1. **Claude SDK tools** — built-in SDK capabilities (Read, Write, Bash, etc.)
           controlled by `tools`, `allowed_tools`, and `disallowed_tools`.
        2. **MCP tools** — server-side tool endpoints (execute_script, integration
           actions) controlled by `enable_scripts_mcp` and `enable_integrations_mcp`.
        3. **Numa CLI tools** — Python scripts copied into the workspace at
           /workdir/tools/ that the agent can invoke via Bash. Controlled by
           `enabled_numa_tools` and `tools_source_dirs`.

    Attributes:
        type_id: Unique identifier for this agent type (e.g. "numa-chat",
            "research-agent"). Used as a lookup key in the registry.
        display_name: Human-readable name shown in UIs and logs.
        response_mode: How the agent delivers its response. One of:
            - "stream": Server-Sent Events / NDJSON streaming (default).
            - "sync": Wait for full response then return it.
            - "fire-and-forget": Accept the request and return immediately;
              results are written to S3/DynamoDB asynchronously.
        tools: List of Claude SDK tool names to enable.
        allowed_tools: Granular allow-list for SDK tool permissions.
        disallowed_tools: Granular deny-list for SDK tool permissions.
        enable_scripts_mcp: Whether to enable the execute_script MCP tool,
            which provides sandboxed Python/Bash/Node execution.
        enable_integrations_mcp: Whether to enable integration MCP tools
            (run_action, configure_props, proxy_request).
        enabled_numa_tools: Which Numa CLI tool scripts to copy into the
            workspace. Names must be keys in TOOL_FILE_MAP.
        tools_source_dirs: Directories under /app/tools/ to copy scripts from.
            Defaults to ["numa"] for shared tools. Agent types can add their
            own (e.g. ["numa", "quoting"]).
        plugins_path: Filesystem path to skills/plugins that teach Claude how
            to call the Numa CLI tools. Read-only (outside workspace).
        default_kbs: Pre-configured knowledge bases. Overrides KBs from the
            request if set.
        restrict_kbs: When True, ignore any KBs sent in the request and only
            use default_kbs. Useful for locked-down agent types.
        default_integrations: Pre-configured integration IDs.
        restrict_integrations: When True, ignore integrations from the request.
        system_prompt_builder: Optional callable that builds the system prompt
            for this agent type. When None, uses the default
            ``build_workspace_system_prompt()``. Must accept the same keyword
            arguments as the default builder and return a string.
        identity_override: Optional string that replaces the default
            IDENTITY_AND_ROLE section in the system prompt. When set, the
            default Numa identity ("You are Numa, created by Arcanum AI...")
            is replaced with this text at prompt construction time. All other
            prompt sections (workspace, tools, style, etc.) remain unchanged.
            This avoids contradictory identity instructions that the model
            may interpret as prompt injection.
        workspace_setup: Optional callable invoked once before the agent (or
            pipeline) runs. Receives ``(user_sub, conversation_id)`` and can
            pre-populate /workdir with templates or reference data.
        s3_prefix_template: Template for the S3 workspace prefix. Supports
            {user_sub} and {conversation_id} placeholders.
        pipeline_steps: Optional ordered list of type_ids to chain as
            sequential agent steps within the same workspace. Each step runs
            to completion before the next starts. The system prompts for each
            step type handle inter-step coordination (e.g. "write your output
            to /workdir/session/research.json").
        pipeline_result_mode: How to extract the final result from a pipeline.
            - "last_step_text": Return the last step's text response (default).
            - "result_file": Read /workdir/session/result.json and return it.
              The pipeline's prompts instruct the agent to write this file.
        max_turns: Maximum number of agentic turns (tool-use loops) per
            request. Safety limit to prevent runaway agents.
        max_thinking_tokens: Maximum tokens allocated for extended thinking.
        default_model: Override the default Bedrock model ID. When None, the
            engine uses its configured default.
    """

    # ── Identity ──────────────────────────────────────────────────────────
    type_id: str
    display_name: str

    # ── Response mode ─────────────────────────────────────────────────────
    response_mode: str = "stream"

    # ── Layer 1: Claude SDK Tools ─────────────────────────────────────────
    tools: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    disallowed_tools: list[str] = field(default_factory=list)

    # ── Layer 2: MCP Tools ────────────────────────────────────────────────
    enable_scripts_mcp: bool = True
    enable_integrations_mcp: bool = True

    # ── Layer 3: Numa CLI Tools ───────────────────────────────────────────
    enabled_numa_tools: list[str] = field(default_factory=list)
    tools_source_dirs: list[str] = field(default_factory=lambda: ["numa"])

    # ── Skills / Plugins ──────────────────────────────────────────────────
    plugins_path: str = "/app/plugins/numa"

    # ── Knowledge Base ────────────────────────────────────────────────────
    default_kbs: Optional[list[dict]] = None
    restrict_kbs: bool = False

    # ── Integrations ──────────────────────────────────────────────────────
    default_integrations: Optional[list[str]] = None
    restrict_integrations: bool = False

    # ── System Prompt ──────────────────────────────────────────────────────
    system_prompt_builder: Optional[Callable[..., str]] = None
    identity_override: Optional[str] = None

    # ── Workspace ─────────────────────────────────────────────────────────
    s3_prefix_template: str = (
        "numa-chat/workspace/{user_sub}/conversations/{conversation_id}"
    )
    workspace_setup: Optional[Callable[[str, str], None]] = None

    # ── Pipeline ──────────────────────────────────────────────────────────
    pipeline_steps: Optional[list[str]] = None
    pipeline_result_mode: str = "last_step_text"

    # ── Limits ────────────────────────────────────────────────────────────
    max_turns: int = 50
    max_thinking_tokens: int = 10_000

    # ── Model ─────────────────────────────────────────────────────────────
    default_model: Optional[str] = None


# ---------------------------------------------------------------------------
# Numa CLI tool file mapping
# ---------------------------------------------------------------------------

# Maps tool names (used in `enabled_numa_tools`) to their script files,
# relative to the tools source directory (e.g. tools/numa/).
#
# When the workspace initialises, only the files for the tools listed in the
# agent type's `enabled_numa_tools` are copied into /workdir/tools/.  This
# keeps the workspace minimal and avoids exposing tools the agent should not
# have access to.
TOOL_FILE_MAP: dict[str, list[str]] = {
    "knowledge_search": ["knowledge_base.py"],
    "web_search": ["web_search.py"],
    "agents": ["numa-agents.py"],
    "convert_document": ["convert_document.py"],
    "extract_content": ["extract_content.py"],
    # helpers/ is always copied when any tool is enabled (see ALWAYS_COPY)
}

# Files/directories that are always copied when *any* tool from a source dir
# is enabled.  Typically shared helper modules that multiple tools depend on.
ALWAYS_COPY: list[str] = ["helpers/"]
