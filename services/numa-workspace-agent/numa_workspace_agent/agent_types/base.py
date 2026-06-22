"""
Base configuration dataclass and constants for the agent type system.

This module defines `AgentTypeConfig` — the single configuration object that controls
how the workspace agent engine behaves for a given agent type. Different agent types
(e.g. "numa-chat", "research-agent", "quoting-agent") are just different instances of
this dataclass: same engine, different knobs.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class AgentTypeConfig:
    """Configuration for a workspace agent type.

    Each agent type is a different configuration of the same workspace agent engine.
    It controls which tools are available, what system prompt is used, and how
    responses are delivered.

    The two tool layers:
        1. **Claude SDK tools** — built-in SDK capabilities (Read, Write, Bash, etc.)
           controlled by `tools`, `allowed_tools`, and `disallowed_tools`.
        2. **MCP tools** — server-side tool endpoints (execute_script, integration
           actions, numa_tool) controlled by `enable_scripts_mcp`,
           `enable_integrations_mcp`, and `enable_numa_mcp`.

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
        enable_numa_mcp: Whether to enable the unified Numa MCP tool.
        allowed_numa_operations: Which operations within the numa_tool are
            permitted.  ``None`` (default) means all operations are allowed.
            A list restricts to only those names (e.g.
            ``["knowledge_base", "web_search"]``).  Valid names:
            knowledge_base, web_search, extract_content,
            convert_document, agents, memories.
        plugins_path: Filesystem path to skills/plugins that teach Claude how
            to use the Numa MCP tools. Read-only (outside workspace).
        default_kbs: Pre-configured knowledge bases. Overrides KBs from the
            request if set.
        restrict_kbs: When True, ignore any KBs sent in the request and only
            use default_kbs. Useful for locked-down agent types.
        allowed_kb_operations: Which sub-operations within knowledge_base are
            permitted. ``None`` (default) means all operations are allowed.
            A list restricts to only those names (e.g.
            ``["query", "list", "download", "download_folder"]`` for read-only).
            Valid names: query, upload, download, list, download_folder, delete.
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
            to /workdir/outputs/research.json").
        pipeline_result_mode: How to extract the final result from a pipeline.
            - "last_step_text": Return the last step's text response (default).
            - "result_file": Read /workdir/outputs/result.json and return it.
              The pipeline's prompts instruct the agent to write this file.
        pipeline_orchestrator: Optional async callable that replaces the
            default sequential pipeline loop. When set, the engine calls
            this instead of ``run_pipeline()``. Receives the same kwargs
            as ``run_pipeline()`` plus ``request_metadata`` (a dict of
            custom fields from the request body). Used for complex
            pipelines that need parallel execution, conditional steps,
            or custom orchestration logic. When ``None`` (default), the
            engine uses ``pipeline_steps`` for sequential execution.
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

    # ── Layer 2: MCP Tools (legacy — being retired) ───────────────────────
    # Default OFF since the full CLI cutover. The Numa platform tool surface
    # (numa / integrations / connectors / ops), code execution, and vault all
    # run through the `numa` CLI + Write/Bash now — NOT MCP. No agent type
    # enables these anymore; the flags + mcp_tools/ wrappers remain only until
    # Phase 6 deletes them. A type must explicitly opt back in to register an
    # MCP server (nothing does today).
    enable_scripts_mcp: bool = False
    enable_integrations_mcp: bool = False
    enable_numa_mcp: bool = False
    allowed_numa_operations: Optional[list[str]] = None  # None = all, list = only these
    enable_connect_mcp: bool = False
    enable_vault_mcp: bool = False

    # Per-agent-type allow-list of numa CLI categories (Phase 5). ``None``
    # (default) = unrestricted — the type may run any `numa <category>`. A list
    # restricts to only those categories, e.g. ``["docs"]`` for the Nolia
    # phases (which should only `numa docs extract/convert`, never touch ops /
    # agents / memory). This drives the dynamic prompt (only permitted
    # categories are described) AND is enforced server-side in numa-cli-api,
    # keyed on the agent type conveyed via NUMA_AGENT_TYPE. The authoritative
    # server policy lives in numa-cli-api's policy map; a parity test keeps the
    # two in sync. Categories use the CLI command names: files, web, docs,
    # agents, memory, integrations, ops, render.
    allowed_cli_commands: Optional[list[str]] = None

    # ── Skills / Plugins ──────────────────────────────────────────────────
    plugins_path: str = "/app/plugins/numa"

    # ── Knowledge Base ────────────────────────────────────────────────────
    default_kbs: Optional[list[dict]] = None
    restrict_kbs: bool = False
    allowed_kb_operations: Optional[list[str]] = (
        None  # None = all, list = only these (e.g. ["query", "list", "download", "download_folder"])
    )

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
    pipeline_orchestrator: Optional[Callable[..., Any]] = None

    # ── Limits ────────────────────────────────────────────────────────────
    max_turns: int = 200
    max_thinking_tokens: int = 10_000

    # ── Thinking ───────────────────────────────────────────────────────────
    # Passed as the ``thinking`` option to ClaudeAgentOptions. Overrides the
    # deprecated ``max_thinking_tokens`` env var on 4.x models.
    # Accepted values:
    #   {"type": "adaptive"}                      – model decides when/how
    #                                               much (default; pair with
    #                                               ``effort`` to bias depth)
    #   {"type": "enabled"}                       – extended thinking on,
    #                                               model picks budget
    #                                               (Sonnet 4.6 / Opus 4.6)
    #   {"type": "enabled", "budget_tokens": N}   – fixed budget (still
    #                                               required by Haiku 4.5)
    #   {"type": "disabled"}                      – no extended thinking
    #                                               (Sonnet 4.6 / Opus 4.6)
    # Note: ``budget_tokens`` is dropped on Sonnet 4.6 / Opus 4.6; Haiku 4.5
    # still requires it. Use ``effort`` ("low" | "medium" | "high" | "max")
    # to shape depth on the newer models.
    thinking: Optional[dict] = field(default_factory=lambda: {"type": "adaptive"})
    # Effort level for the model. Controls reasoning depth.
    # "low", "medium", "high", "max". None = SDK default.
    effort: Optional[str] = "medium"

    # ── Security ──────────────────────────────────────────────────────────
    enable_security_hooks: bool = True

    # ── Model ─────────────────────────────────────────────────────────────
    default_model: Optional[str] = None

    # ── Sub-agents ─────────────────────────────────────────────────────────
    # Pre-defined sub-agents (AgentDefinition) for the Task tool.
    # When set, the SDK routes Task calls to these named agents with their
    # own model, prompt, and tools. Use for cost optimisation (e.g. Haiku
    # sub-agents for bulk work).
    agents: Optional[dict[str, Any]] = None
