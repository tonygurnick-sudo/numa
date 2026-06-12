#!/usr/bin/env node
/**
 * `numa-dev` — dev-only binary, packaged as `@numa/cli-dev`.
 *
 * Adds developer affordances on top of the prod surface:
 *   --d-hum         Auto-approve HITL prompts (Phase 3+)
 *   --yes / -y      Skip confirmation prompts (Phase 3+)
 *   <cat> test      Per-category roundtrip self-tests
 *   context set/... Mock frontend payload mgmt
 *   reference       Open the HTML reference doc in a browser
 *
 * Hermetic by package boundary: `@numa/cli-dev` is a separate npm package
 * from `@numa/cli`. The workspace Docker image installs only `@numa/cli`,
 * so this entire file (and the dev/* subcommands it pulls in) is never on
 * disk inside the MicroVM. Numa-the-LLM literally cannot invoke `numa-dev`
 * — it doesn't exist there.
 *
 * Belt-and-suspenders: even locally, the bypass flags are rejected when
 * running without a TTY or with NUMA_CONVERSATION_ID set, so a
 * misconfigured local env can't slip through.
 */

import { Command } from 'commander';

// Prod command factories — imported from @numa/cli through its `./commands`
// subpath. numa-dev composes the same Commander trees as the prod binary and
// adds dev-only subcommands (--yes flags, *Test runners) under each.
import {
  createLoginCommand,
  createLogoutCommand,
  createWhoamiCommand,
  createProfileCommand,
  createBootstrapCommand,
  createFilesCommand,
  createDocsCommand,
  createMemoryCommand,
  createAgentsCommand,
  createWebCommand,
  createIntegrationsCommand,
  createOpsCommand,
  createRenderCommand,
} from '@numa/cli/commands';

// Dev-only commands — live in this package, relative imports stay local.
import { createDevContextCommand } from '../commands/dev/context.js';
import { createFilesTestCommand } from '../commands/dev/files-test.js';
import { createDocsTestCommand } from '../commands/dev/docs-test.js';
import { createMemoryTestCommand } from '../commands/dev/memory-test.js';
import { createAgentsTestCommand } from '../commands/dev/agents-test.js';
import { createWebTestCommand } from '../commands/dev/web-test.js';
import { createIntegrationsTestCommand } from '../commands/dev/integrations-test.js';
import { createOpsTestCommand } from '../commands/dev/ops-test.js';
import { createReferenceCommand } from '../commands/dev/reference.js';

const program = new Command();

program
  .name('numa-dev')
  .description('Numa CLI — dev-only variant (adds --d-hum, per-command --yes, debug commands)')
  .version('0.1.0')
  .option('--debug', 'Enable verbose debug output (sets NUMA_DEBUG=1)')
  .option('--d-hum', 'Auto-approve HITL prompts globally (rejected outside dev context — the dangerous bypass)')
  .option('--pretty', 'Human-readable output (default in a TTY)')
  .option('--standard', 'LLM-friendly _summary envelope (default in workspace)')
  .option('--json', 'Raw JSON passthrough (default when piped)')
  .hook('preAction', (thisCommand) => {
    let cmd = thisCommand;
    while (cmd.parent) cmd = cmd.parent;
    const opts = cmd.opts();

    if (opts['debug']) {
      process.env['NUMA_DEBUG'] = '1';
    }

    // Stash root-level output-mode choice in env for the emitter layer.
    // Per-command flags still win (emitter checks them first).
    if (opts['json']) process.env['NUMA_OUTPUT_MODE'] = 'json';
    else if (opts['standard']) process.env['NUMA_OUTPUT_MODE'] = 'standard';
    else if (opts['pretty']) process.env['NUMA_OUTPUT_MODE'] = 'pretty';

    // --d-hum is the only root-level "danger" flag — it auto-approves
    // HITL gates globally. Rejected when no-TTY or in-workspace so a
    // misconfigured env can't accidentally bypass approvals.
    //
    // `--yes` is per-command (e.g. `numa-dev files delete X --yes`) and
    // doesn't need the same guard — it just skips the local terminal
    // prompt, doesn't bypass server-side enforcement.
    if (opts['dHum']) {
      const insideWorkspace = !!process.env['NUMA_CONVERSATION_ID'];
      const noTTY = !process.stdout.isTTY;
      if (insideWorkspace || noTTY) {
        process.stderr.write(
          'numa-dev: --d-hum is a dev-only flag and requires an interactive terminal outside of a workspace context\n'
        );
        process.exit(2);
      }
      process.env['NUMA_DEV_AUTO_APPROVE'] = '1';
    }
  });

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createWhoamiCommand());
program.addCommand(createProfileCommand());
program.addCommand(createBootstrapCommand());
// Files command tree with the dev-only `test` subcommand bolted on.
// Prod `numa.ts` registers `createFilesCommand()` without this addition,
// so `numa files test` exists only on numa-dev.
const filesCmd = createFilesCommand();
filesCmd.addCommand(createFilesTestCommand());
program.addCommand(filesCmd);
// Docs command tree with the dev-only `test` subcommand bolted on. Prod
// `numa.ts` registers `createDocsCommand()` without this addition.
const docsCmd = createDocsCommand();
docsCmd.addCommand(createDocsTestCommand());
program.addCommand(docsCmd);
// Same shape for memory — prod gets the four CRUD ops; numa-dev adds
// the roundtrip self-test.
const memoryCmd = createMemoryCommand();
memoryCmd.addCommand(createMemoryTestCommand());
program.addCommand(memoryCmd);
// Same shape for agents — prod gets the seven ops, numa-dev adds test.
const agentsCmd = createAgentsCommand();
agentsCmd.addCommand(createAgentsTestCommand());
program.addCommand(agentsCmd);
// Same shape for web (search + fetch) — numa-dev adds test.
const webCmd = createWebCommand();
webCmd.addCommand(createWebTestCommand());
program.addCommand(webCmd);
// Same shape for ops (single generic command) — numa-dev adds test.
const opsCmd = createOpsCommand();
opsCmd.addCommand(createOpsTestCommand());
program.addCommand(opsCmd);
// Same shape for integrations (8 commands) — numa-dev adds test.
const integrationsCmd = createIntegrationsCommand();
integrationsCmd.addCommand(createIntegrationsTestCommand());
program.addCommand(integrationsCmd);
// Render has no roundtrip self-test — it requires a live SSE stream to push
// into, which the dev harness can't fake. Registered plainly (like auth cmds).
program.addCommand(createRenderCommand());
program.addCommand(createDevContextCommand());
program.addCommand(createReferenceCommand());

program.parseAsync().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`numa-dev: error — ${err.message}\n`);
    if (process.env['NUMA_DEBUG'] === '1' && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
  } else {
    process.stderr.write(`numa-dev: error — ${String(err)}\n`);
  }
  process.exit(1);
});
