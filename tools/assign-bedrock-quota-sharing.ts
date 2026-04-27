import { getAllClientConfigs, putClientConfig } from '@arcanumai/client-config';
import { clientConfigSchema, type ClientConfig } from '../infra/stacks/numa-client-stack';
import { readFileSync } from 'node:fs';
import { parse } from 'csv/sync';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';

interface CsvRow {
  accountName: string;
  accountId: string;
  quota_sharing_account_name: string;
  quota_sharing_account_id: string;
}

interface PlannedChange {
  clientName: string;
  from: string | undefined;
  to: string;
  currentConfig: ClientConfig;
}

function loadCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf-8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvPath = args.find((a) => !a.startsWith('--')) ?? 'dev-notes/research/quota-sharing-assignments.csv';

  console.log(chalk.bold(`\nbedrockAccount bulk assignment`));
  console.log(`CSV:   ${csvPath}`);
  console.log(`Mode:  ${apply ? chalk.red('APPLY (writes will happen)') : chalk.green('DRY RUN')}\n`);

  const rows = loadCsv(csvPath);
  console.log(`Loaded ${rows.length} assignments from CSV.`);

  const allConfigs = await getAllClientConfigs<ClientConfig>();
  console.log(`Loaded ${Object.keys(allConfigs).length} client configs from Dynamo.\n`);

  const changes: PlannedChange[] = [];
  const noChange: string[] = [];
  const missingClient: CsvRow[] = [];
  const accountIdMismatch: Array<{ row: CsvRow; actualAccountId: string | undefined }> = [];

  for (const row of rows) {
    const config = allConfigs[row.accountName];
    if (!config) {
      missingClient.push(row);
      continue;
    }
    if (config.clientAccountId && config.clientAccountId !== row.accountId) {
      accountIdMismatch.push({ row, actualAccountId: config.clientAccountId });
      continue;
    }
    const current = config.bedrockAccount;
    const desired = row.quota_sharing_account_id;
    if (current === desired) {
      noChange.push(row.accountName);
    } else {
      changes.push({ clientName: row.accountName, from: current, to: desired, currentConfig: config });
    }
  }

  // Orphans: clients in Dynamo that already have bedrockAccount set but are not in the CSV
  const csvNames = new Set(rows.map((r) => r.accountName));
  const orphans: Array<{ clientName: string; current: string }> = [];
  for (const [clientName, config] of Object.entries(allConfigs)) {
    if (config.bedrockAccount && !csvNames.has(clientName)) {
      orphans.push({ clientName, current: config.bedrockAccount });
    }
  }

  // Report
  console.log(chalk.bold(`Summary:`));
  console.log(`  ${chalk.green(noChange.length)} already correct (skip)`);
  console.log(`  ${chalk.yellow(changes.length)} will be updated`);
  console.log(`  ${chalk.red(missingClient.length)} CSV rows have no matching Dynamo client`);
  console.log(`  ${chalk.red(accountIdMismatch.length)} CSV rows where accountId != clientAccountId`);
  console.log(`  ${chalk.red(orphans.length)} Dynamo clients with bedrockAccount set but not in CSV\n`);

  if (changes.length) {
    console.log(chalk.bold('Planned updates:'));
    for (const c of changes) {
      const fromStr = c.from ?? chalk.dim('<unset>');
      console.log(`  ${c.clientName.padEnd(35)} ${fromStr.padEnd(14)} -> ${chalk.cyan(c.to)}`);
    }
    console.log('');
  }
  if (missingClient.length) {
    console.log(chalk.bold.red('CSV rows with no matching client:'));
    for (const r of missingClient) console.log(`  ${r.accountName} (${r.accountId})`);
    console.log('');
  }
  if (accountIdMismatch.length) {
    console.log(chalk.bold.red('CSV rows with mismatched clientAccountId:'));
    for (const m of accountIdMismatch)
      console.log(`  ${m.row.accountName}: csv=${m.row.accountId}  dynamo=${m.actualAccountId ?? '<none>'}`);
    console.log('');
  }
  if (orphans.length) {
    console.log(chalk.bold.red('Clients with bedrockAccount set but not in CSV:'));
    for (const o of orphans) console.log(`  ${o.clientName} (current: ${o.current})`);
    console.log('');
  }

  if (!apply) {
    console.log(chalk.green.bold(`Dry run complete. Re-run with --apply to write changes.`));
    return;
  }

  if (missingClient.length || accountIdMismatch.length) {
    console.log(chalk.red.bold('Refusing to --apply while there are missing clients or accountId mismatches.'));
    console.log(chalk.red('Resolve the issues above first, or edit the CSV to remove bad rows.'));
    process.exit(1);
  }

  if (!changes.length) {
    console.log(chalk.green.bold('Nothing to apply.'));
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(chalk.yellow(`Apply ${changes.length} updates? [y/N] `));
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    return;
  }

  for (const c of changes) {
    const newConfig: ClientConfig = { ...c.currentConfig, bedrockAccount: c.to };
    try {
      const ok = await putClientConfig(c.clientName, newConfig, clientConfigSchema);
      console.log(
        `  ${ok ? chalk.green('OK') : chalk.red('FAIL')}  ${c.clientName}: ${c.from ?? '<unset>'} -> ${c.to}`
      );
    } catch (err) {
      console.log(`  ${chalk.red('ERR')} ${c.clientName}: ${(err as Error).message}`);
    }
  }

  console.log(chalk.green.bold('\nDone.'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
