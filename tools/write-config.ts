import { getClientConfigFromDynamo, putClientConfig } from '@arcanumai/client-config';
import { clientConfigSchema } from '../infra/stacks/numa-client-stack';
import { readFileSync } from 'node:fs';
import { diff } from 'json-diff-ts';
import { createInterface } from 'node:readline/promises';
import { exit } from 'node:process';

async function main(client: string, inputFile: string): Promise<string> {
  const input = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const config = clientConfigSchema.parse(input);
  const currentConfig = await getClientConfigFromDynamo(client);
  const differences = diff(currentConfig, config);
  if (differences.length === 0) {
    console.log('No differences found.');
    exit(0);
  }
  console.log('Differences:', JSON.stringify(differences, null, 2));
  process.stdin.resume();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const approve = await rl.question('Approve changes? [y/N] ');
  if (approve.toLowerCase() !== 'y') {
    console.log('Changes not approved.');
    process.exit(0);
  }
  console.log('Changes approved.');
  rl.close();
  console.log('Writing new config...');
  await putClientConfig(client, config, clientConfigSchema);
  return JSON.stringify(config, null, 2);
}

if (import.meta.filename === process.argv[1]) {
  const client = process.argv[2];
  const inputFile = process.argv[3];
  main(client, inputFile)
    .then((output) => console.log(`Successfully wrote client config for ${client}:\n${output}`))
    .catch((error) => {
      console.error(error.issues ?? error);
      process.exit(1);
    });
}
