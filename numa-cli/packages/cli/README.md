# @numa/cli

Production binary for the Numa CLI. Tool-execution interface used by Numa-the-LLM inside workspace MicroVMs and by humans for scripting.

**Contains NO bypass flags or test runners.** Those live in [`@numa/cli-dev`](../cli-dev/). Keeping them in a separate package is what makes the workspace install hermetic — the dev code physically isn't present on disk inside the MicroVM.

## Install

```bash
# In the monorepo
yarn install
yarn build

# Standalone (once published)
npm install @numa/cli
```

## Binary

```
numa <category> <command> [options]
```

Eight categories, ~40 commands. See the [HTML reference](../../docs/numa-cli-reference-internal.html) (open via `numa-dev reference`) for the full surface with worked examples.

```
auth          login / logout / whoami / profile / bootstrap
files         12 commands (list/show/search/find/download/upload/mv/rename/mkdir/rmdir/delete/download-folder)
docs          extract / transcribe / convert
memory        list / show / add / update / delete
agents        list / show / create / update / patch-prompt / duplicate / delete
web           search / fetch
integrations  list / docs / search / pipedream-actions / pipedream-props / pipedream-props-options / pipedream-call / request
ops           single generic command (58 operations — tickets, boards, customers, suppliers, projects, etc.)
```

## Library exports

`@numa/cli` exposes its internals through subpath exports so `@numa/cli-dev` (and any future consumer) can compose against them:

| Subpath              | Surface                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@numa/cli`          | Root barrel — re-exports every subpath. Use when you don't care about the boundary.                                                                                    |
| `@numa/cli/api`      | `invokeTool`, `fetchBootstrap`, `fetchIntegrationDocs`, `apiCall`                                                                                                      |
| `@numa/cli/auth`     | `getValidTokens`, `loadTokens`, `saveTokens`, `clearTokens`, `decodeJwtClaims`                                                                                         |
| `@numa/cli/commands` | Every `createXxxCommand()` factory + `runBootstrap`, `tryBootstrapAfterLogin`, `prompt`                                                                                |
| `@numa/cli/context`  | `activeProfile`, `setActiveProfile`, `loadContext`, `resolveScopingContext`, `ScopingContext`, dev-context helpers, `requiresLocalApproval`, integration cache helpers |
| `@numa/cli/metadata` | Tool types (`ToolCall`, `ToolName`, `ParamsForTool<T>`, `ToolResult<T>`) + `TOOL_DISPLAY` registry                                                                     |
| `@numa/cli/output`   | `emitResult`, `prettyOrSpill`, `buildEnvelope`, `info/success/warn/fail`, `printJson`, `confirm`, mode resolver                                                        |

Prefer narrow subpath imports over the root barrel — keeps the bundle graph readable when someone reads the import statements alone.

## Output modes

Every data-returning command supports three modes. The right one is picked automatically based on context; explicit flags override.

| Mode         | Shape                                                                  | Default when                                  |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------- |
| `--pretty`   | Per-command human formatting (tables, status lines, truncated content) | TTY                                           |
| `--standard` | `_summary` envelope: schema + sample + file path **or** inline data    | Inside workspace (`NUMA_CONVERSATION_ID` set) |
| `--json`     | Raw passthrough — exactly what the tool returned                       | Non-TTY pipes / scripts                       |

Resolution priority (highest wins): per-command flag → root-level flag → `NUMA_OUTPUT_MODE` env → context default.

### `--standard` envelope

Designed for LLM consumers — keeps context lean by spilling results > 4 KB to a file and returning a schema + bounded sample in the envelope.

```jsonc
{
  "_summary": {
    "tool": "user_profile_list_memories",
    "count": 47,                            // largest array in the result
    "size": "12.3 KB",
    "schema": { ... },                      // type-name shape
    "sample": { ... },                      // arrays truncated to 2, strings to 200ch, depth to 8
    "path": "./tmp/numa-cli/numa-...json",  // file path | null if inlined
    "inlined": false
  },
  "result": null                            // populated iff inlined
}
```

When the serialized result is ≤ 4 KB, `path: null`, `inlined: true`, and the full data lives in `result`.

### Spill location

| Context                                       | Path                                                 |
| --------------------------------------------- | ---------------------------------------------------- |
| Inside workspace (`NUMA_CONVERSATION_ID` set) | `/workdir/tmp/numa-cli/numa-<tool>-<timestamp>.json` |
| Outside workspace                             | `./tmp/numa-cli/numa-<tool>-<timestamp>.json` (cwd)  |
| Override                                      | `NUMA_CLI_TMP_DIR=<path>` env var                    |

The workspace MicroVM auto-syncs `/workdir/` to S3 so spill files persist and are readable via the SDK's Read tool. Outside the workspace, the spill directory is gitignored at the repo root.

## State files

```
~/.config/numa/profile                # active account name
~/.config/numa/tokens-<account>.json  # access/id/refresh tokens (chmod 600)
~/.config/numa/context-<account>.json # bootstrap response — KBs, integrations, enabled_tools, user groups
~/.cache/numa/integrations/<slug>/    # cached Pipedream action indexes
```

## Build / dev scripts

```bash
yarn build         # tsc → dist/
yarn dev           # tsc --watch
yarn typecheck     # tsc --noEmit
yarn clean         # rm -rf dist
```
