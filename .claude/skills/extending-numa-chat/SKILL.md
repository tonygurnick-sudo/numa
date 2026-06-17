---
name: extending-numa-chat
description: Extend Numa chat with new tools and capabilities. Use when adding a new numa CLI command, wiring HITL approvals, adding frontend tool rendering, writing tool skills/prompts, configuring agent types for tools, or building Lambda tool handlers.
---

# Extending Numa Chat with New Tools

This skill covers everything needed to add new capabilities to Numa's chat agent. Read `documentation/extending-numa-chat/README.md` for the full guide with code examples.

> **Architecture note:** Numa's chat tools are no longer MCP servers. The whole `numa`/`integrations`/`connectors`/`vault`/`scripts` MCP layer was replaced by a unified **`numa` CLI** that the agent invokes via `Bash("numa <category> <command> ... -m \"caption\"")`. The agent runs with **zero MCP servers** (`mcp_servers = {}`). The server-side Python handlers still exist (in `lambdas/python/workspace-chat-tools/`), but they're now reached through the **`numa-cli-api` Lambda** instead of an MCP transport. "Adding a tool" means **adding a CLI command + (usually) a Lambda handler + a skill**, not registering an MCP tool.

## Architecture: How a `numa` command flows

```
Agent (Bash)                                      Browser
  │  numa <cat> <cmd> ... -m "caption"               ▲
  ▼                                                  │ SSE tool card / approval
numa CLI  (numa-cli/packages/cli)                    │
  │  POST /cli/tools/invoke {tool, params, context}  │
  ▼                                                  │
numa-cli-api Lambda  (lambdas/node/numa-cli-api)     │
  │  routes by registry.ts:                          │
  │   • workspace_chat_tools (default)  ──────────►  Python handler
  │   • kb_manager (REST file ops)                   (lambdas/python/workspace-chat-tools/tools/)
  │   • oauth_workspace_tools (native connectors)
  │  + ops gate + Phase-5 CLI allow-list + HITL approval poll
  ▼
result → CLI → stdout (JSON) → agent
```

Three trust/enforcement gates live in `numa-cli-api` (`src/tools/index.ts`), in order: the **Ops entitlement gate** (`ops_*` blocked unless `NUMA_OPS_ENABLED`), the **Phase-5 per-agent-type CLI allow-list** (`src/tools/policy.ts` — e.g. Nolia → `docs` only), then the **HITL approval gate** (create DDB record + poll).

## Five Systems to Consider

When adding a new tool, you touch up to five systems. Not all apply to every tool.

### 1. The CLI command (the agent-facing surface)

**Files:** `numa-cli/packages/cli/src/commands/actions/<category>.ts` + `numa-cli/packages/cli/src/metadata/` (`tool-types.ts`, `tool-display.ts`)

A `numa <category> <command>` invocation is a Commander subcommand that maps to a `{tool, params}` and calls `invokeTool()` (`src/api/tools.ts`), which POSTs to `numa-cli-api`.

**Decision:** add a `command` to an existing category file (preferred for related ops) or create a new `actions/<category>.ts` for a new top-level category.

**Steps:**

1. Add the subcommand in `actions/<category>.ts`: define flags, build `params`, require `-m/--user-message` (the user-visible caption), call `invokeTool(account, accessToken, { tool, params, context, user_message })`.
2. For **write ops**, gate via `gateWriteOp()` (`src/commands/actions/_hitl.ts`) — it generates a `request_id` so the server emits an approval card and blocks on the user's decision.
3. Add typed metadata so TS narrows params and the frontend can render the result:
   - `src/metadata/tool-types.ts` — extend the `ToolCall` union: `tool` name → params shape and result shape.
   - `src/metadata/tool-display.ts` — `tool` → `category` + frontend render hint.

**Key rules:**

- `-m "..."` (`user_message`) is REQUIRED on every API-hitting command — it's the approval-card / inline-tool caption.
- Default output is the `--standard` `_summary` envelope in-workspace and `--json` when piped; big results spill to `/workdir/tmp/numa-cli/` and return a schema preview + path (the LLM `jq`/`cat`s the spill).
- The prod binary (`numa`) ships only user-safe commands; bypass/auto-approve flags live in `numa-dev` only (not in the prod import graph).

### 2. Lambda handler (server-side execution)

**Files:**

- `lambdas/python/workspace-chat-tools/` (primary tools Lambda — the default dispatch target)
- `lambdas/python/oauth-workspace-tools/` (native OAuth connectors)
- `lambdas/python/kb-manager/` (file-management REST ops)

**When to use a Lambda:** when the tool needs IAM permissions or user credentials the agent shouldn't have. Pure in-workspace computation just runs as a script the agent writes to `/workdir/tmp/` and executes with Bash — no Lambda needed.

**Most tools** land in `workspace-chat-tools` (the default route). Add a handler keyed on the `tool` name:

```python
def handle_my_operation(params, *, user_sub, **_):
    # Validate, execute, return result
    return {"status": "success", "data": {...}}

TOOL_HANDLERS["my_operation"] = handle_my_operation
```

`numa-cli-api` forwards the CLI request to this Lambda as an event `{tool, params, user_sub, user_email, user_groups, allowed_kbs, enabled_tools, conversation_id, id_token, user_message, request_id}`. `user_sub` is server-trusted (derived from the verified token in `numa-cli-api`); scoping hints (`allowed_kbs`, `enabled_tools`) can only narrow, never grant — enforce ownership in the handler.

**Security gates (fail-closed):** validate `enabled_tools`/`allowed_kbs` allowlists; check `user_sub` ownership; server-side DynamoDB verification as defense-in-depth.

### 3. numa-cli-api routing (only if NOT the default Lambda)

**File:** `lambdas/node/numa-cli-api/src/tools/registry.ts`

Anything not registered defaults to `workspace_chat_tools` — so a new chat-tools handler needs **no** registry entry. Add an entry only if the tool lives elsewhere:

- **kb_manager** (REST-shaped file ops) → `KbManagerRoute` with `method` + `pathTemplate` (`{kb_id}` placeholders substituted from params).
- **oauth_workspace_tools** (native connectors) → `OauthWorkspaceToolsRoute`.

If the tool is `ops_*` or needs a per-agent-type restriction, also update the gates in `src/tools/index.ts` / `src/tools/policy.ts`.

### 4. Prompting & Skills (so the agent knows the command exists)

**Files:**

- `services/numa-workspace-agent/plugins/numa/skills/<tool-name>/SKILL.md`
- `services/numa-workspace-agent/numa_workspace_agent/prompts.py` (`build_numa_cli_section`)
- `services/numa-workspace-agent/integration-prompts/<slug>.md`

The CLI doesn't self-document the way MCP injected schemas did, so the **prompt must teach it**. For a new top-level category, add it to `build_numa_cli_section()` in `prompts.py` (which is included only for types with `Bash(numa:*)`, and whose Ops subsection is gated on `NUMA_OPS_ENABLED`). For richer guidance, add a skill:

```markdown
---
name: my-tool
description: When to use this tool
---

# My Tool

## Commands

- `numa <category> <command> --flag <v> --json -m "..."` — does X

## Examples

Bash: numa <category> <command> --foo bar --json -m "Doing X for the user"
```

Teach `--help` discovery (`numa <category> --help`) and Bash composition (`numa ... --json | jq ...`). **For integrations:** add per-integration prompt files (`integration-prompts/<slug>.md`), injected when the integration is enabled.

### 5. HITL Approvals (Backend + Frontend)

**Files:**

- `numa-cli/packages/cli/src/commands/actions/_hitl.ts` (`gateWriteOp` — CLI side)
- `lambdas/node/numa-cli-api/src/tools/index.ts` (`createApprovalRequest` + `pollApproval`)
- `lambdas/python/workspace-chat-tools/tools/approval.py` (downstream handler honours `auto_approved`)
- `numa-frontend/src/Pages/Settings.tsx`, `Components/Agents/AgentCreateModal.tsx`, `Components/WorkspaceChat/WorkspaceChatToolApproval.tsx`

**Three approval modes:** `always`, `non_destructive` (auto-approve reads), `never`. **Five categories:** `integrations`, `agents`, `memories`, `knowledgeBases`, `ops`.

**To add HITL for a new write command:**

1. Classify operations as read (no approval) or write (approval).
2. In the CLI command, route writes through `gateWriteOp({...})` — it returns a `request_id` and `auto_approved`, forwarded on the invoke.
3. `numa-cli-api` creates the DDB approval record (action_key from `deriveActionKey`) and polls until approve/deny/timeout — only dispatching downstream on approval (with `auto_approved=true` so the Python handler skips its own approval block).
4. Add the category to `numaToolApprovalMode` in Settings.tsx + the approval grid in AgentCreateModal.tsx if it's a new category.

**Flow:** CLI sets `request_id` → `numa-cli-api` emits/records approval + polls → frontend shows card with countdown → user decides → DDB update → poll resolves → result returns to the agent.

### 6. Frontend Rendering & Agent Type Config

**Frontend** (`numa-frontend/src/`): the agent emits a `Bash` tool call; a PostToolUse reframe / the CLI metadata gives it a synthetic `tool_name` (`numa_<category>_<command>`) so the existing per-tool renderers pick it up. Touchpoints: `utils/workspaceChatEventHandlers.ts` (routing/display), `utils/ToolConfig.ts` (icons/metadata), `toolRenderers/` (result cards), `Components/UnifiedToolCard.tsx`.

**Agent type config** (`services/numa-workspace-agent/numa_workspace_agent/agent_types/`):

- `allowed_tools` must include `Bash(numa:*)` for the type to use the CLI at all.
- `allowed_cli_commands` (Phase 5) restricts which CLI categories the type may use (`None` = all; e.g. Nolia phases = `["docs"]`). Enforced server-side in `numa-cli-api` keyed on `NUMA_AGENT_TYPE`.
- `enabled_numa_tools` — which tool reference docs to copy into the workspace.

## Quick Reference: Key Files

| Component                       | Path                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| CLI commands (agent surface)    | `numa-cli/packages/cli/src/commands/actions/`                                    |
| CLI tool metadata / types       | `numa-cli/packages/cli/src/metadata/` (`tool-types.ts`, `tool-display.ts`)       |
| CLI → API invoke                | `numa-cli/packages/cli/src/api/tools.ts`                                         |
| CLI HITL gate                   | `numa-cli/packages/cli/src/commands/actions/_hitl.ts`                            |
| Dispatch / gates (ops, Phase 5) | `lambdas/node/numa-cli-api/src/tools/index.ts`                                   |
| Tool routing registry           | `lambdas/node/numa-cli-api/src/tools/registry.ts`                                |
| Per-agent CLI allow-list policy | `lambdas/node/numa-cli-api/src/tools/policy.ts`                                  |
| Auth (verified-token identity)  | `lambdas/node/numa-cli-api/src/shared/auth.ts`                                   |
| Primary tools Lambda            | `lambdas/python/workspace-chat-tools/`                                           |
| OAuth/native connectors Lambda  | `lambdas/python/oauth-workspace-tools/`                                          |
| Approval polling (downstream)   | `lambdas/python/workspace-chat-tools/tools/approval.py`                          |
| Agent type configs              | `services/numa-workspace-agent/numa_workspace_agent/agent_types/`                |
| System prompt builder           | `services/numa-workspace-agent/numa_workspace_agent/prompts.py`                  |
| SDK config builder              | `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py`               |
| Skills/plugins                  | `services/numa-workspace-agent/plugins/numa/skills/`                             |
| Integration prompts             | `services/numa-workspace-agent/integration-prompts/`                             |
| Frontend tool routing           | `numa-frontend/src/utils/workspaceChatEventHandlers.ts`                          |
| Tool result renderers           | `numa-frontend/src/toolRenderers/`                                               |
| Approval UI component           | `numa-frontend/src/Components/WorkspaceChat/WorkspaceChatToolApproval.tsx`       |
| Settings / agent-builder HITL   | `numa-frontend/src/Pages/Settings.tsx`, `Components/Agents/AgentCreateModal.tsx` |
| Full documentation              | `documentation/extending-numa-chat/README.md`                                    |
