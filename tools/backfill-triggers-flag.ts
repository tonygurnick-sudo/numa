/**
 * Backfill `eventTriggers: true` for existing clients with `scheduling: true`,
 * and remove the legacy `triggers` key wherever it survives.
 *
 * Context: this flag has had two names. The pre-rebase FEAT-105 work added
 * a `triggers` sub-flag (default true) that we later flipped to default
 * false. Post-rebase, dev's authoritative name is `eventTriggers` (same
 * semantics, different key). Records currently on disk may have:
 *   - `triggers: true` (from the original backfill run)
 *   - `triggers: false` (someone deliberately disabled them)
 *   - `eventTriggers: true` (set via the post-rebase CSP form)
 *   - both keys (mid-migration)
 *   - neither (new clients with default false)
 *
 * This tool consolidates onto `eventTriggers` and removes any lingering
 * `triggers` key:
 *   1. If `triggers === true` and `eventTriggers` is absent → set
 *      `eventTriggers = true`, remove `triggers`.
 *   2. If `triggers === false` and `eventTriggers` is absent → set
 *      `eventTriggers = false`, remove `triggers`.
 *   3. If both keys are set → keep `eventTriggers`, remove `triggers`.
 *   4. If `eventTriggers` is set and `triggers` absent → no-op.
 *   5. If neither set and `scheduling === true` → set `eventTriggers = true`
 *      to preserve pre-flip behaviour for clients that pre-date both
 *      flags. (Mirror of the original backfill rule.)
 *
 * Idempotent — re-runs are safe; second run will find nothing to update.
 *
 * Usage:
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn backfill-triggers-flag                       # dry run, all tenants
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn backfill-triggers-flag --client nd-labs      # dry run, one tenant
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn backfill-triggers-flag --apply               # writes, all tenants
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn backfill-triggers-flag --client nd-labs --apply
 *   AWS_PROFILE=arcanum-q-deployer-prod yarn backfill-triggers-flag --apply --max-changes 3
 *
 * Flags:
 *   --client <name>      Restrict to a single client (recommended for first run).
 *   --apply              Actually write. Without this, dry run prints planned changes.
 *   --max-changes N      Refuse if more than N writes would happen. Safety cap.
 */

import { getAllClientConfigs, putClientConfig } from '@arcanumai/client-config';
import { clientConfigSchema, type ClientConfig } from '../infra/stacks/numa-client-stack';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';

interface PlannedChange {
  clientName: string;
  currentConfig: ClientConfig;
  /** New value for `eventTriggers`. */
  newEventTriggers: boolean;
  /** True when the legacy `triggers` key was present on the record. */
  removingLegacy: boolean;
  /** Human-readable reason — printed in the dry-run output. */
  reason: string;
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return undefined;
  const next = args[idx + 1];
  if (next.startsWith('--')) return undefined;
  return next;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const clientFilter = parseFlagValue(args, '--client');
  const maxChangesRaw = parseFlagValue(args, '--max-changes');
  const maxChanges = maxChangesRaw ? parseInt(maxChangesRaw, 10) : undefined;
  if (maxChangesRaw && (!Number.isFinite(maxChanges) || maxChanges! <= 0)) {
    console.error(chalk.red(`Invalid --max-changes value: ${maxChangesRaw}`));
    process.exit(1);
  }

  console.log(chalk.bold(`\nFEAT-105 — migrate triggers → eventTriggers and clean up legacy key`));
  console.log(`Mode:        ${apply ? chalk.red('APPLY (writes will happen)') : chalk.green('DRY RUN')}`);
  console.log(`Client:      ${clientFilter ? chalk.cyan(clientFilter) : chalk.dim('(all tenants)')}`);
  console.log(`Max changes: ${maxChanges ? chalk.cyan(String(maxChanges)) : chalk.dim('(no cap)')}\n`);

  const allConfigs = await getAllClientConfigs<ClientConfig>();
  console.log(`Loaded ${Object.keys(allConfigs).length} client configs from Dynamo.`);

  if (clientFilter) {
    if (!(clientFilter in allConfigs)) {
      console.error(chalk.red(`Client "${clientFilter}" not found in numa-client-config.`));
      process.exit(1);
    }
    console.log(chalk.dim(`Filtering to single client: ${clientFilter}`));
  }
  console.log('');

  const changes: PlannedChange[] = [];
  const noOp: string[] = []; // eventTriggers already set, no legacy `triggers`

  for (const [clientName, config] of Object.entries(allConfigs)) {
    if (clientFilter && clientName !== clientFilter) continue;
    const cfg = config as ClientConfig & { scheduling?: boolean; triggers?: boolean; eventTriggers?: boolean };
    const schedulingOn = cfg.scheduling === true;
    const legacyTriggers = cfg.triggers; // boolean | undefined
    const eventTriggers = cfg.eventTriggers; // boolean | undefined
    const hasLegacy = legacyTriggers !== undefined;

    // Decide the new eventTriggers value:
    //   - eventTriggers already set → keep it (just clean up legacy if present)
    //   - eventTriggers absent + legacy set → adopt legacy value
    //   - both absent + scheduling on → backfill true (preserve pre-flip behaviour)
    //   - both absent + scheduling off → leave alone (no-op)
    let nextEventTriggers: boolean | undefined;
    let reason = '';
    if (eventTriggers !== undefined) {
      nextEventTriggers = eventTriggers;
      reason = `eventTriggers=${eventTriggers} kept`;
    } else if (legacyTriggers !== undefined) {
      nextEventTriggers = legacyTriggers;
      reason = `migrate triggers=${legacyTriggers} -> eventTriggers=${legacyTriggers}`;
    } else if (schedulingOn) {
      nextEventTriggers = true;
      reason = 'scheduling on, no flag set -> eventTriggers=true (preserve pre-flip behaviour)';
    } else {
      // Neither flag set and scheduling off — no work to do.
      noOp.push(clientName);
      continue;
    }

    const needsEventTriggersWrite = eventTriggers !== nextEventTriggers;
    const needsLegacyRemove = hasLegacy;
    if (!needsEventTriggersWrite && !needsLegacyRemove) {
      noOp.push(clientName);
      continue;
    }

    changes.push({
      clientName,
      currentConfig: config,
      newEventTriggers: nextEventTriggers,
      removingLegacy: needsLegacyRemove,
      reason,
    });
  }

  // Sort for stable output
  changes.sort((a, b) => a.clientName.localeCompare(b.clientName));
  noOp.sort();

  console.log(chalk.bold(`Summary:`));
  console.log(`  ${chalk.yellow(changes.length)} clients will be updated`);
  console.log(`  ${chalk.dim(noOp.length)} already on the new flag with no legacy key (no change)\n`);

  if (changes.length) {
    console.log(chalk.bold('Planned updates:'));
    for (const c of changes) {
      const action = c.removingLegacy
        ? `${chalk.cyan(`eventTriggers=${c.newEventTriggers}`)} ${chalk.dim('+ remove legacy triggers')}`
        : chalk.cyan(`eventTriggers=${c.newEventTriggers}`);
      console.log(`  ${c.clientName.padEnd(35)} ${action}  ${chalk.dim(`(${c.reason})`)}`);
    }
    console.log('');
  }

  if (!apply) {
    console.log(chalk.green.bold(`Dry run complete. Re-run with --apply to write changes.`));
    return;
  }

  if (!changes.length) {
    console.log(chalk.green.bold('Nothing to apply.'));
    return;
  }

  // Safety cap. Without --client, this script touches every tenant — easy to
  // misuse. The cap is a tripwire forcing the operator to acknowledge the
  // blast radius before proceeding.
  if (maxChanges !== undefined && changes.length > maxChanges) {
    console.error(
      chalk.red(
        `Refusing to apply: ${changes.length} planned changes exceed --max-changes ${maxChanges}. ` +
          `Re-run with a higher cap or use --client to scope.`
      )
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(chalk.yellow(`Apply ${changes.length} updates? [y/N] `));
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    return;
  }

  let successes = 0;
  let failures = 0;
  for (const c of changes) {
    // Build the new config: copy current, set eventTriggers, drop legacy
    // `triggers` if present. putClientConfig replaces the whole record so
    // omitting `triggers` from the spread is sufficient — no explicit
    // delete needed.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { triggers: _legacyTriggers, ...rest } = c.currentConfig as ClientConfig & { triggers?: boolean };
    const newConfig: ClientConfig = { ...rest, eventTriggers: c.newEventTriggers };
    try {
      const ok = await putClientConfig(c.clientName, newConfig, clientConfigSchema);
      if (ok) {
        successes++;
        const tail = c.removingLegacy ? ' + removed legacy triggers' : '';
        console.log(`  ${chalk.green('OK')}   ${c.clientName}: eventTriggers <- ${c.newEventTriggers}${tail}`);
      } else {
        failures++;
        console.log(`  ${chalk.red('FAIL')} ${c.clientName}`);
      }
    } catch (err) {
      failures++;
      console.log(`  ${chalk.red('ERR')}  ${c.clientName}: ${(err as Error).message}`);
    }
  }

  console.log('');
  console.log(chalk.green.bold(`Done. ${successes} updated, ${failures} failed.`));
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
