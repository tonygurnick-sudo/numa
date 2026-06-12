#!/usr/bin/env node
/**
 * `numa` — production binary.
 *
 * Ships in the workspace agent Docker image. Contains *only* user-facing,
 * production-safe commands. Bypass / auto-approve flags (--d-hum, --yes)
 * are registered only in `numa-dev.ts` — they are not in this file's import
 * graph, so they are not present in the prod bundle.
 */

// Suppress recurring stderr noise (Node deprecations + AWS SDK support-policy
// notices) — every byte of it lands in tool results the model pays for. First
// import on purpose: ESM executes imports in declaration order, so the filter
// is installed before anything else loads. Prod binary only; numa-dev keeps
// warnings visible for debugging.
import './suppress-noise.js';

import { Command } from 'commander';
import { createLoginCommand } from '../commands/auth/login.js';
import { createLogoutCommand } from '../commands/auth/logout.js';
import { createProfileCommand } from '../commands/auth/profile.js';
import { createBootstrapCommand } from '../commands/bootstrap.js';
import { createFilesCommand } from '../commands/actions/files.js';
import { createDocsCommand } from '../commands/actions/docs.js';
import { createMemoryCommand } from '../commands/actions/memory.js';
import { createAgentsCommand } from '../commands/actions/agents.js';
import { createWebCommand } from '../commands/actions/web.js';
import { createIntegrationsCommand } from '../commands/actions/integrations.js';
import { createOpsCommand } from '../commands/actions/ops.js';
import { createRenderCommand } from '../commands/actions/render.js';
import { enforceNumaCallLimit } from './rate-limit.js';

const program = new Command();

program
  .name('numa')
  .description('Numa CLI — tool-execution interface for the Numa platform')
  .version('0.1.0')
  .option('--debug', 'Enable verbose debug output (sets NUMA_DEBUG=1)')
  .option('--pretty', 'Human-readable output (default in a TTY)')
  .option('--standard', 'LLM-friendly _summary envelope (default in workspace)')
  .option('--json', 'Raw JSON passthrough (default when piped)')
  .hook('preAction', (thisCommand) => {
    // Friendly per-command cost cap (workspace-only). Counts against the
    // current Bash command's budget (reset by the agent's PreToolUse hook) and
    // self-aborts past the limit so a runaway loop stops spending.
    enforceNumaCallLimit();
    let cmd = thisCommand;
    while (cmd.parent) cmd = cmd.parent;
    const opts = cmd.opts();
    if (opts['debug']) process.env['NUMA_DEBUG'] = '1';
    // Stash the root-level output-mode choice in an env var so the
    // emitter layer can read it without us threading the program ref
    // through every command. Per-command flags still win because the
    // emitter checks them first.
    if (opts['json']) process.env['NUMA_OUTPUT_MODE'] = 'json';
    else if (opts['standard']) process.env['NUMA_OUTPUT_MODE'] = 'standard';
    else if (opts['pretty']) process.env['NUMA_OUTPUT_MODE'] = 'pretty';
  });

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createProfileCommand());
// Note: `whoami` is intentionally NOT registered on the prod binary. Inside the
// workspace the agent already has its identity (NUMA_USER_SUB / email in env +
// prompt), and the laptop-oriented token-decode errors in workspace-IAM mode.
// It remains available in `numa-dev` for local dev.
program.addCommand(createBootstrapCommand());
program.addCommand(createFilesCommand());
program.addCommand(createDocsCommand());
program.addCommand(createMemoryCommand());
program.addCommand(createAgentsCommand());
program.addCommand(createWebCommand());
program.addCommand(createIntegrationsCommand());
program.addCommand(createOpsCommand());
program.addCommand(createRenderCommand());

program.parseAsync().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`numa: error — ${err.message}\n`);
    if (process.env['NUMA_DEBUG'] === '1' && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
  } else {
    process.stderr.write(`numa: error — ${String(err)}\n`);
  }
  process.exit(1);
});
