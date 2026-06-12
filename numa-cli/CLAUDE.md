# Numa CLI — package dev guide

The `numa` CLI is the workspace agent's entire platform tool surface (it replaced the MCP layer). The agent invokes it over Bash: `numa <category> <command> ... -m "caption"`. Categories: `files`, `web`, `docs`, `agents`, `memory`, `integrations`, `ops`, `render`.

> **For the architecture & the "why" (transports, identity model, the three gates, the permission model, the hooks, rate limit, saved workflows), read [`documentation/numa-cli/README.md`](../documentation/numa-cli/README.md) — the canonical design doc.** This file is just the package dev guide.
>
> **Maintenance:** when an architecture/security/design decision changes, update `documentation/numa-cli/README.md` (the source of truth) — not just this file. When commands or flags change, also regenerate the human reference `numa-cli/docs/numa-cli-reference-internal.html`.

## Layout

Two npm packages, one workspace:

- `packages/cli` → **`@numa/cli`** (binary `numa`) — production-safe commands. Ships in the workspace agent image. **No bypass/auto-approve flags in its import graph.**
- `packages/cli-dev` → **`@numa/cli-dev`** (binary `numa-dev`) — laptop only. Everything in `numa` + `--d-hum`/`--yes` bypass, `*-test` self-tests, `reference`, `whoami`.

```
packages/cli/src/
  cli/numa.ts            # prod entrypoint — registers commands, preAction (output mode, rate-limit counter)
  cli/rate-limit.ts      # per-command call cap (counts <tmp>/.numa-call-count)
  commands/actions/      # files, web, docs, agents, memory, integrations, ops, render
  commands/auth/         # login (Cognito SRP), logout, profile  (whoami is dev-only)
  api/tools.ts           # invokeTool — the single chokepoint POSTing to numa-cli-api (+ stamps agent_type)
  api/client.ts          # transport: HTTPS (laptop) vs lambda:Invoke (workspace-IAM)
  context/resolve.ts     # scoping context from env (NUMA_*) / dev-override / bootstrap
  metadata/              # tool-types.ts (param/result types) + tool-display.ts (category + render hint)
  output/                # pretty / standard (_summary envelope + spill) / json
```

## Adding a command

1. Add the subcommand in `commands/actions/<category>.ts`: define flags, build `params`, **require `-m/--user-message`**, call `invokeTool(account, accessToken, { tool, params, context, user_message })`. Write ops go through `gateWriteOp()` (`commands/actions/_hitl.ts`).
2. Add typed metadata: `metadata/tool-types.ts` (tool → params + result shape) and `metadata/tool-display.ts` (tool → category + frontend renderer hint).
3. Server side: most tools land in `lambdas/python/workspace-chat-tools/` (the default route — **no** `numa-cli-api` registry entry needed). Only register in `lambdas/node/numa-cli-api/src/tools/registry.ts` if it's a `kb_manager` (REST) or `oauth_workspace_tools` (native connector) tool.
4. Teach the agent: a skill in `services/numa-workspace-agent/plugins/numa/skills/` and/or the CLI section in `prompts.py`.
5. Agent-type config: the type needs `Bash(numa:*)` in `allowed_tools`; set `allowed_cli_commands` to restrict categories per type.

Full flow with examples: the [`extending-numa-chat` skill](../.claude/skills/extending-numa-chat/SKILL.md).

## Conventions / gotchas

- **`-m "..."` is required** on every API-hitting command (the user-visible caption + approval-card text).
- **`agent_type` is stamped once** in `invokeTool` from `NUMA_AGENT_TYPE` (the Phase-5 chokepoint) — don't re-thread it through command sites.
- Default output is the `--standard` `_summary` envelope in-workspace, `--json` when piped; big results spill to `/workdir/tmp/numa-cli/`. Keep new tools returning JSON that the envelope/`jq` can handle.
- Gate denials (ops / Phase-5) arrive as `{status:'error', message}` — `invokeTool` normalises `message → error` so don't double-handle.
- `whoami` is **dev-only** (registered in `numa-dev.ts`, not `numa.ts`) — the workspace agent has its identity from env/prompt.

## Build & test

```bash
# from numa-cli/packages/cli
yarn build        # tsc → dist/
yarn typecheck    # tsc --noEmit

# the workspace image bundles the CLI automatically:
cd ../../../services && ./package-service.sh numa-workspace-agent
```

The laptop binaries: `node numa-cli/packages/cli/dist/cli/numa.js <cmd>` (prod) / `dist/cli/numa-dev.js` from the dev package. `numa login <client>` (Cognito SRP) caches tokens at `~/.config/numa/tokens-<client>.json`. The HTML reference is at `numa-cli/docs/numa-cli-reference-internal.html` (`numa-dev reference`).
