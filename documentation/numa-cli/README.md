# Numa CLI — architecture & design reference

**The canonical, committed record of how the `numa` CLI works and why it's built the way it is.** This is the "why" doc — the durable home for the architecture and the security/design decisions. For _how to add a tool_, see [`documentation/extending-numa-chat/`](../extending-numa-chat/) and the package dev guide at [`numa-cli/CLAUDE.md`](../../numa-cli/CLAUDE.md). For the package mechanics (two-npm-package split, build), see [`numa-cli/README.md`](../../numa-cli/README.md).

---

## 1. What it is, and why

The workspace chat agent used to expose its platform capabilities as **MCP servers** (`numa`, `integrations`, `connectors`, `vault`, `scripts`). That whole layer was **deleted** and replaced by a single **`numa` CLI** the agent invokes over Bash:

```
Bash("numa <category> <command> ... -m \"user-visible caption\"")
```

The agent now runs with **zero MCP servers** (`sdk_config.py` builds `mcp_servers = {}`). Categories: `files`, `web`, `docs`, `agents`, `memory`, `integrations`, `ops`, `render`.

**Why the CLI beats the MCP layer:**

1. **Hermetic security** — the prod binary ships in the workspace image; the dev binary is physically absent from the MicroVM.
2. **An evolvable surface** — changing the CLI doesn't require an SDK upgrade or an MCP-server redeploy; it ships with the agent image.
3. **Composability** — the agent can pipe CLI commands through Bash (`numa files search … --json | jq …`), branch on output, and call `numa` from a Python script (`subprocess`) — things the MCP transport couldn't express.

The server-side Python handlers (`lambdas/python/workspace-chat-tools/tools/`) were **kept** — they're now reached through the `numa-cli-api` Lambda instead of an MCP transport.

## 2. The two binaries

Two npm packages from one workspace (`numa-cli/`):

| Binary     | Package                              | Where it runs                                                     | Surface                                                                                                                            |
| ---------- | ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `numa`     | `@numa/cli` (`packages/cli`)         | Bundled into the workspace agent image; also usable from a laptop | Production-safe commands only. Bypass/auto-approve flags are **not** in its import graph.                                          |
| `numa-dev` | `@numa/cli-dev` (`packages/cli-dev`) | Laptop only — never in the MicroVM                                | Everything in `numa` **plus** `--d-hum`/`--yes` bypass flags, `*-test` self-tests, `reference` (opens the HTML doc), and `whoami`. |

`whoami` lives on `numa-dev` only: inside the workspace the agent already knows its identity (env + prompt), and the laptop-oriented token decode errors under workspace-IAM auth.

## 3. How a command flows

```
Agent (Bash)                                         Browser
  │  numa <cat> <cmd> ... -m "caption"                  ▲
  ▼                                                     │ SSE tool card / approval card
numa CLI  (numa-cli/packages/cli)                       │
  │  POST /cli/tools/invoke {tool, params, context}     │
  ▼                                                     │
numa-cli-api Lambda  (lambdas/node/numa-cli-api)        │
  │  gates: ops entitlement → Phase-5 allow-list → HITL │
  │  route (registry.ts):                               │
  │    • workspace_chat_tools (default)  ───────────►   Python handler
  │    • kb_manager   (REST file ops)                   (lambdas/python/workspace-chat-tools/tools/)
  │    • oauth_workspace_tools (native connectors)
  ▼
result → CLI → stdout (JSON) → agent
```

`render` is the one exception — it does **not** hit `numa-cli-api`. It pushes a `tool_render` event onto the agent's localhost SSE queue (the same rail as HITL approvals), and the frontend draws it inline (see §8).

**Result integrity (the consumer side of dev's workdir-boundary hardening).** Handlers cap synchronous Lambda responses ~5 MiB (AWS's hard 6 MB invoke limit); larger structured results are spilled to S3 in full and arrive as a `{oversized: true, result_url, result_sha256, result_size}` envelope. `invokeTool` resolves the envelope at its single chokepoint — streamed download, sha256-verified, parsed — so every command sees the COMPLETE result; an unverifiable spill becomes a tool error, never partial data. File-bearing commands use the same primitives (`api/integrity.ts`): downloads stream to a same-directory temp file, hash as they go, and only `rename` into place once sha256/size checks pass — nothing unverified or truncated ever sits at a destination path. Specifics: `files download` verifies `size_bytes` (presigned) / `download_sha256` (inline); `files download-folder` verifies `download_sha256` on both; `web fetch` delivers `result_type: "binary_file"` results (PDFs/zips at extensionless URLs, sniffed by browser-lambda) into `/workdir/uploads/web/` verifying `download_sha256`.

**Dual-method routing.** A slug must reach a conversation under exactly ONE method — `sdk_config.py` dedupes the `NUMA_ENABLED_INTEGRATIONS` / `NUMA_ENABLED_NATIVE_CONNECTORS` env vars (pipedream wins, `DUAL_METHOD_SLUG_DEDUP` warning). If a stale context still presents both, the CLI refuses to pick silently and asks for `--via pipedream|native` (`integrations docs` / `integrations request`); `pipedream-*` commands match the pipedream entry directly.

## 4. Auth & identity model

The CLI presents a **cryptographically verified token** to `numa-cli-api`; identity is derived only from verified claims, never a self-asserted `sub`. Three caller classes:

| Caller                                            | Transport                                           | Token presented                                                                                                                                      | Verified by             |
| ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Laptop dev**                                    | HTTPS → CloudFront → API GW                         | Cognito **access** token (from `numa login`, SRP)                                                                                                    | Cognito JWKS, in-Lambda |
| **Interactive workspace chat**                    | direct `lambda:InvokeFunction` (workspace IAM role) | Cognito **id** token, handed down through the proxy                                                                                                  | Cognito JWKS, in-Lambda |
| **Non-interactive** (scheduled / V2 apps / Nolia) | direct invoke                                       | **proxy-minted HS256 service token** (`iss: numa-workspace-proxy`), signed with a secret only the proxy + `numa-cli-api` hold (never in the MicroVM) | HMAC, in-Lambda         |

The workspace IAM signature is a _second factor_ (proves the call came from a real MicroVM), **not** the identity source. Direct Lambda invoke (vs. SigV4 to API GW) was chosen for the workspace path to avoid API Gateway's 30s timeout on slow ops. Full rationale: `dev-notes/tasks/numa-cli/identity-model.md` (and the migration handovers).

> ⚠️ Correction to an earlier assumption: **Nolia / V2 apps authenticate with the user's Cognito token, not the minted service token** — `v2-apps-api` forwards the user's auth header. Only _scheduled_ runs use the minted token. This is why the Phase-5 control (§5) is conveyed via the trusted-env channel, not a token claim.

## 5. The three gates in `numa-cli-api`

Enforced in order, at the top of `handleToolInvoke` (`src/tools/index.ts`):

1. **Ops entitlement** — `ops_*` is rejected unless `NUMA_OPS_ENABLED` (restores what the `numa_ops` MCP registration used to gate; the broad `Bash(numa:*)` permission would otherwise let any client call `numa ops`).
2. **Phase-5 per-agent-type CLI allow-list** (`src/tools/policy.ts`) — restricts which CLI _categories_ an agent type may use. Driving case: **Nolia processes untrusted documents**, so every `nolia*` type is limited to `docs` (extract/convert) and can't reach `ops`/`agents`/`memory`. The agent type arrives as `context.agent_type`, sourced from the **trusted `NUMA_AGENT_TYPE` env** the agent injects (we rely on the agent not overwriting its own env; only the opaque type travels, not the allow-list). Parity with the Python source of truth (`agent_types/__init__.py` stamps `nolia* → ["docs"]`) is pinned by `policy.test.ts` + a Python parity test.
3. **HITL approval** — for write ops the CLI generates a `request_id` (`gateWriteOp`); the Lambda creates a DDB approval record and polls until the user approves/denies/times out, dispatching downstream only on approval. The frontend shows the approval card.

Gate denials return `{status:'error', message}`; `invokeTool` normalises `message → error` so the reason reaches the model (instead of `<no message>`).

### Whether a write op needs the card: approval modes

The _decision_ to gate (gate 3 above) lives CLI-side in `context/approval.ts` and follows the user's per-category approval settings (`never` / `non_destructive` / `always` — the "Auto-approve all / Approve writes / Always approve" UI). The mode source depends on auth mode:

- **Workspace-IAM** — the agent resolves the modes **per turn** in `main.py` (`resolve_all_approval_modes`: agent-level override > user chat-settings > default, incl. the TASK-127 per-slug integration overrides, which arrive pre-suppressed when an agent sets an explicit Integrations mode) and injects them into the CLI subprocess env as **`NUMA_APPROVAL_MODES`** (`sdk_config.create_agent_options`): `{"categories": {agents, memories, knowledgeBases, ops, connectors, integrations}, "integration_overrides": {slug → mode}}`. Threaded through all paths — stream, sync, fire-and-forget, and `pipeline.py` steps. Absent/malformed env **fails safe to `non_destructive`** (write ops gate).
- **Laptop** — read from the bootstrap context file (`chat_settings.user`); absent values default to `never` (a dev at their own terminal).

Per category, `non_destructive` consults a safe-op set (e.g. `memories: {list}`); **integrations** consult chain is slug override → `integrations` category mode, with safety judged like the pre-CLI SDK runner did: action schema annotations on disk (`/workdir/tools/integrations/{slug}/{action_key}.json` — `readOnlyHint`, draft + `destructiveHint:false`; missing schema fails closed) and GET/HEAD for raw proxy requests.

> ⚠️ This is a **UX layer, not a security boundary** — the env is model-visible, and a CLI that decides "no approval needed" never sends a `request_id`, so the Lambda-side polling never engages. Gate-grade enforcement would need `numa-cli-api` to resolve the modes server-side from chat-settings (it has the verified `user_sub`) and return `approval_required` to the CLI. Tracked as a follow-up; same trust trade as `NUMA_AGENT_TYPE`.

## 6. Permission model (acceptEdits vs bypassPermissions)

The agent's `permission_mode` (set in `sdk_config.py`) is **conditional**:

- **`bypassPermissions`** for interactive, unrestricted types (numa-chat, etc.). The `acceptEdits`-with-allowlist model was silently _denying_ any Bash command not on the `allowed_tools` allowlist (a `bash` script, a `seq` loop, an uncommon tool) — and Numa has no SDK-permission card (only HITL write-op cards), so the command just dead-ended. Bypass lets legitimate shell work run.
- **`acceptEdits` + the tight allowlist** for locked-down / hooks-off types — the **Nolia / nolia-funding pipeline phases** (untrusted documents; 7 run with security hooks off), kept as defence-in-depth.

The gating rule: **bypass only when `enable_security_hooks` AND `allowed_cli_commands is None`.** Bypass is only safe where the security hook is active (it's the guard), and locked-down pipelines keep the allowlist.

**What still guards in bypass mode:** the **security hook** denylist (a PreToolUse hook, independent of permission_mode — blocks `rm -rf` of protected paths, `curl`/`wget`/`nc`, `/proc/*/environ`, path traversal, dangerous python/node), **`disallowed_tools`**, and the **MicroVM sandbox** (non-root UID 1000, per-conversation, ephemeral). HITL write-op cards are unaffected.

## 7. Agent-side hooks

PreToolUse hooks (`services/numa-workspace-agent/numa_workspace_agent/hooks/`), registered in `sdk_config.py`:

| Hook                                      | Fires on    | Does                                                                                              |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `security_hook`                           | all         | Denylist — dangerous commands/paths/patterns. Can be disabled per type (`enable_security_hooks`). |
| `numa_call_counter_reset_hook`            | Bash        | Resets the per-command call counter (§9). A **side effect** — never modifies the command.         |
| `workflow_guard_hook`                     | Write/Edit  | Validates saved-workflow writes (§10).                                                            |
| `param_aliases_hook`, `image_resize_hook` | Grep / Read | Rewrite tool input (param slips, oversized images).                                               |

## 8. Output modes, render, and the envelope

**Output modes** (global flags): `--pretty` (TTY default), `--standard` (LLM `_summary` envelope — default in workspace), `--json` (raw, default when piped). Big results spill to `/workdir/tmp/numa-cli/<tool>-<ts>.json` and return a schema preview + path (the agent `jq`/`cat`s the spill) — the TS port of the old `_kb_overflow_response` pattern.

**`numa render`** displays HTML/SVG/images inline. It pushes a `tool_render` SSE event (localhost `/internal/emit-render`) → the frontend's `RenderToolRenderer`. The iframe **auto-sizes to its content height up to ~600px** (the bridge posts `scrollHeight`); taller content scrolls; `--height` raises the cap. **Render survives a page reload**: the live `tool_render` event isn't in `trace.jsonl`, so the frontend reconstructs the visual from the `numa render` bash call already in the trace (`parseNumaRenderCommand`), re-fetching a `--file-path` from S3 if needed.

## 9. Per-command rate limit (cost guard)

A friendly cap on `numa` calls **per Bash command** (default 500, `NUMA_CALL_LIMIT`), to stop a runaway loop (`for f in *.pdf; do numa …`) from running up cost. It is a **count cap, not a throttle** — no per-call delay.

Mechanism (the first design, which injected an ID into the command, broke the `Bash(numa:*)` allowlist and was reverted):

- `numa_call_counter_reset_hook` **truncates** `<tmp>/.numa-call-count` at the start of each Bash command — a side effect, so no allowlist conflict.
- The CLI appends one byte per invocation and reads the file size; past the limit it exits non-zero **without doing the work**, so cost stops even if the loop keeps spinning. The next command's reset gives a fresh budget.

Soft guard (honest-runaway, not adversarial). Workspace-only. The real runaway path it protects is a **Python script calling `numa` in a loop** (`python3` is pre-approved, so it runs unattended — e.g. a saved workflow); a _bash_ loop is separately gated by the permission system. A server-side per-conversation hard ceiling in `numa-cli-api` is a possible future backstop (not built).

## 10. Saved Workflows

User-level persistent reusable scripts in `/workdir/chat-workflows/` (synced to `{user_sub}/chat-workflows/`, restored into every future conversation) — the mechanism by which Numa tunes itself to a user's recurring jobs over time. An executable script (Python by default) with a `#`-comment frontmatter fence; **required: `title`, `description`, `created`, `updated`; optional: `required_integrations`**. The filename is the identifier. `saved_workflows.py` is the single source of truth for the format; `workflow_guard_hook` **denies** a malformed write and **warns** (allows) on a hardcoded-looking secret. The `## Saved Workflows` prompt section lists them. Long-term vision (publish → schedule/trigger → token-free "mini-apps"): `dev-notes/research/scripts-workflows-etc/workflows-as-mini-apps-vision.md`.

## 11. Adding a command

See [`documentation/extending-numa-chat/`](../extending-numa-chat/) and the [`extending-numa-chat` skill](../../.claude/skills/extending-numa-chat/SKILL.md) for the full flow. In short: a CLI command (`numa-cli/packages/cli/src/commands/actions/`) + metadata (`src/metadata/`) → a `workspace-chat-tools` Lambda handler (default route; only register in `numa-cli-api/src/tools/registry.ts` if it lives elsewhere) → a skill/prompt → agent-type config (`Bash(numa:*)` + optional `allowed_cli_commands`).

## 12. Build, deploy, test

- **CLI:** `cd numa-cli/packages/cli && yarn build` (tsc). Bundled into the agent image by `services/package-service.sh` (it `npm pack`s `@numa/cli`). Tests: `yarn test` (`node --test test/` — integrity layer + dual-method routing against the built binary).
- **Lambda:** `cd lambdas/node/numa-cli-api && yarn bundle`. Tests: `yarn test` (`tsx --test` — includes `policy.test.ts`).
- **Agent image:** `cd services && ./package-service.sh numa-workspace-agent` (Docker; includes the CLI). Python tests: `cd services/numa-workspace-agent && poetry run pytest`.
- A deploy is a normal `yarn cdktf deploy numa-<stack>` once the image, frontend, and lambda artifacts are built. **No infra/CDKTF changes** were needed for the CLI features (env vars are injected by `sdk_config` / already wired).

## 13. Key files

| Component                                      | Path                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| CLI commands                                   | `numa-cli/packages/cli/src/commands/actions/`                           |
| CLI tool metadata / types                      | `numa-cli/packages/cli/src/metadata/`                                   |
| CLI → API invoke (agent_type chokepoint)       | `numa-cli/packages/cli/src/api/tools.ts`                                |
| CLI integrity (atomic downloads + oversized)   | `numa-cli/packages/cli/src/api/integrity.ts`                            |
| CLI HITL gate                                  | `numa-cli/packages/cli/src/commands/actions/_hitl.ts`                   |
| CLI rate-limit counter                         | `numa-cli/packages/cli/src/cli/rate-limit.ts`                           |
| Lambda dispatch + gates                        | `lambdas/node/numa-cli-api/src/tools/index.ts`                          |
| Phase-5 policy                                 | `lambdas/node/numa-cli-api/src/tools/policy.ts`                         |
| Tool routing registry                          | `lambdas/node/numa-cli-api/src/tools/registry.ts`                       |
| Verified-token auth                            | `lambdas/node/numa-cli-api/src/shared/auth.ts`                          |
| Downstream handlers                            | `lambdas/python/workspace-chat-tools/tools/`                            |
| Agent SDK config (permission mode, hooks, env) | `services/numa-workspace-agent/numa_workspace_agent/sdk_config.py`      |
| Hooks                                          | `services/numa-workspace-agent/numa_workspace_agent/hooks/`             |
| Saved-workflows format                         | `services/numa-workspace-agent/numa_workspace_agent/saved_workflows.py` |
| System prompt (CLI section, render, workflows) | `services/numa-workspace-agent/numa_workspace_agent/prompts.py`         |
| Agent types + Phase-5 stamp                    | `services/numa-workspace-agent/numa_workspace_agent/agent_types/`       |
| Frontend render                                | `numa-frontend/src/toolRenderers/RenderToolRenderer.tsx`                |
| Frontend replay / render reconstruction        | `numa-frontend/src/utils/workspaceChatEventHandlers.ts`                 |

## 14. History

The migration and the design decisions were worked out across `dev-notes/tasks/numa-cli/` (handovers `handover-1`…`7`, `identity-model.md`, `cli-followups-scope.md`, the test plans). Those are a personal/gitignored workspace — **this doc is the committed, team-facing distillation.** When a decision changes, update _this_ file.
