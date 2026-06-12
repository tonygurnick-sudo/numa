/**
 * `numa-dev reference` — opens the bundled HTML reference doc in your
 * default browser.
 *
 * The doc lives at `numa-cli/docs/numa-cli-reference-internal.html` (committed
 * to the repo). This command just resolves that path relative to the dev
 * binary's install location and shells out to the platform's "open this
 * file" command (`open` on macOS, `xdg-open` on Linux, `start` on Windows).
 *
 * Optional `--section <id>` jumps directly to a section (uses URL hash):
 *   numa-dev reference --section integrations
 */

import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, info } from '@numa/cli/output';

/**
 * Pick the right "open this file" command for the platform.
 *   - macOS:   `open`
 *   - Linux:   `xdg-open`
 *   - Windows: `cmd /c start ""` (start is a cmd builtin)
 */
function platformOpenCommand(): { cmd: string; args: string[] } | undefined {
  if (process.platform === 'darwin') return { cmd: 'open', args: [] };
  if (process.platform === 'linux') return { cmd: 'xdg-open', args: [] };
  if (process.platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return undefined;
}

/**
 * Resolve the HTML file path. This module lives at
 * `numa-cli/packages/cli-dev/{dist,src}/commands/dev/reference.{js,ts}` —
 * climb five levels up (dev → commands → dist|src → cli-dev → packages) to
 * land at `numa-cli/`, then join `docs/`. The doc itself is checked into
 * the repo at the workspace root (`numa-cli/docs/`), shared between both
 * packages.
 */
function resolveDocPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'docs', 'numa-cli-reference-internal.html');
}

export function createReferenceCommand(): Command {
  return new Command('reference')
    .description('Open the bundled HTML reference doc in your default browser')
    .option('--section <id>', 'Jump to a section (e.g. overview, files, integrations, output)')
    .option('--print-path', 'Just print the file path — do not open')
    .action((options: { section?: string; printPath?: boolean }) => {
      const docPath = resolveDocPath();
      if (!existsSync(docPath)) {
        fail(`reference doc not found at ${docPath} — rebuild the CLI workspace`);
      }

      const url = options.section ? `file://${docPath}#${options.section}` : `file://${docPath}`;

      if (options.printPath) {
        process.stdout.write(`${url}\n`);
        return;
      }

      const opener = platformOpenCommand();
      if (!opener) {
        info(`unsupported platform '${process.platform}' — open this URL manually:`);
        process.stdout.write(`${url}\n`);
        return;
      }

      const res = spawnSync(opener.cmd, [...opener.args, url], { stdio: 'inherit' });
      if (res.error || (res.status ?? 0) !== 0) {
        fail(`failed to open browser (${opener.cmd}): ${res.error?.message ?? `exit ${res.status}`}`);
      }
      info(`opened ${url}`);
    });
}
