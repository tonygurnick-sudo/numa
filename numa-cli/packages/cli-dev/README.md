# @numa/cli-dev

Developer-only addon for [`@numa/cli`](../cli/). Provides the `numa-dev` binary with bypass flags, self-tests, dev-context manipulation, and the HTML reference launcher.

> **⚠️ NEVER install this in a workspace MicroVM.** The whole point of the package split is to keep dev tools off the LLM's PATH. The workspace Docker image should only `npm install @numa/cli`. See [`../../README.md`](../../README.md) for the security model.

## Install

```bash
# In the monorepo (yarn workspaces auto-link)
yarn install
yarn build

# Symlink the dev binary onto your $PATH
ln -sf "$(pwd)/packages/cli-dev/dist/cli/numa-dev.js" ~/.local/bin/numa-dev
```

`@numa/cli` is a workspace dependency — installing this package also pulls in the prod binary, so you get both `numa` and `numa-dev` on PATH.

## What it adds on top of @numa/cli

| Surface                           | Effect                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Root flag `--d-hum`               | Auto-approve HITL prompts globally. Rejected outside a TTY or inside a workspace context (defence in depth).                           |
| Per-command flag `-y, --yes`      | Skip the local terminal confirmation prompt. Only skips the prompt — server-side approval still gates.                                 |
| `numa-dev <cat> test`             | Per-category roundtrip self-tests. Auth → bootstrap → invoke → assert → cleanup.                                                       |
| `numa-dev context set/show/clear` | Manipulate a fake dev-context override at `~/.config/numa/dev-context-<account>.json`. Lets you test workspace-style scoping locally.  |
| `numa-dev reference`              | Opens the bundled HTML reference doc in your default browser. `--section <id>` deep-links, `--print-path` prints the file:// URL only. |

Everything else (`numa-dev integrations list`, `numa-dev files show`, ...) calls into the same `@numa/cli/commands` factories the prod binary uses. The dev binary IS the prod binary with extras layered on top.

## Self-tests

```bash
numa-dev files test           # 12 steps — full files roundtrip
numa-dev docs test            # 6  steps — PDF extract + convert
numa-dev memory test          # 5  steps — full CRUD
numa-dev agents test          # 10 steps — full CRUD + patch-prompt + duplicate
numa-dev web test             # 4  steps — search + fetch + summarised
numa-dev integrations test    # 5–7 steps (conditional on gmail / native presence)
numa-dev ops test             # 23 steps (5 reads + 9-step ticket roundtrip + 5-step customer roundtrip + 4-step project roundtrip; ticket steps skip if no boards)

# Run all in parallel
for cat in files docs memory agents web integrations ops; do
  numa-dev $cat test &
done
wait
```

Each test:

- Logs `[N/M] step name ... ok|FAIL (duration)`
- Exits 0 on full pass, 1 on any failure
- Cleans up its artifacts in `finally` unless `--keep-artefacts` is passed

## Dev context (`numa-dev context`)

Useful for testing workspace-style scoping (where the frontend gates `enabled_tools` / `enabled_integrations` / `allowed_kbs`) without actually running inside a MicroVM:

```bash
numa-dev context set --conversation-id abc-123 --enabled-tools "web_search,memories_tool"
numa-dev context show
numa-dev context clear
```

The override file at `~/.config/numa/dev-context-<account>.json` takes precedence over the bootstrap-default scope.

## How the binary composes

```typescript
// packages/cli-dev/src/cli/numa-dev.ts
import {
  createLoginCommand,
  createIntegrationsCommand,
  // ... every prod factory
} from '@numa/cli/commands';

import { createIntegrationsTestCommand } from '../commands/dev/integrations-test.js';
// ... every dev-only test runner

const integrationsCmd = createIntegrationsCommand();
integrationsCmd.addCommand(createIntegrationsTestCommand()); // bolt on `numa-dev integrations test`
program.addCommand(integrationsCmd);
```

Pattern repeats for every category. Prod factories build the Commander subtree; dev binary adds its `*Test` subcommand under each. Same composition for the rest of the dev surface.

## Build / dev scripts

```bash
yarn build         # tsc → dist/
yarn dev           # tsc --watch
yarn typecheck     # tsc --noEmit
yarn clean         # rm -rf dist
```
