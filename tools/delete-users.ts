import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import chalk from 'chalk';
import { parse } from 'csv-parse';
import { createReadStream } from 'node:fs';
import { argv, exit } from 'node:process';
import { finished } from 'node:stream/promises';
import { AWSClientConfig, BasicClientConfig, getQUserPool, temporaryCredentials } from './utils';
import { getClientConfig } from '@arcanumai/client-config';

const inputFile = 'input.csv';

export async function deleteQUsers(awsClientConfig: AWSClientConfig, userPool: string, dryRun: boolean): Promise<void> {
  const client = new CognitoIdentityProviderClient(awsClientConfig);

  if (dryRun) {
    console.log(chalk.green('Dry run is true, so not really doing anything. Give parameter "live" to disable.'));
  } else {
    console.log(chalk.red('Dry run is disabled, applying changes.'));
  }

  console.log(chalk.yellow('Userpool: ' + userPool));
  if (!userPool) {
    console.log(chalk.red('UserPool is missing!'));
    exit(1);
  }

  const result: string[] = [];
  const readStream = createReadStream(inputFile)
    .pipe(parse({ from_line: 2 }))
    .on('data', (row) => result.push(row[2].trim()));

  await finished(readStream);

  console.log(`Deleting ${result.length} users.`);

  for (const email of result) {
    console.log(`Deleting user: ${email}`);
    if (!dryRun) {
      try {
        await client.send(
          new AdminDeleteUserCommand({
            UserPoolId: userPool,
            Username: email,
          })
        );
        console.log(chalk.green(`Successfully deleted: ${email}`));
      } catch (error) {
        console.log(chalk.red(`Failed to delete ${email}:`), error);
      }
    }
  }

  console.log(chalk.green('Done.'));
}

(async (): Promise<void> => {
  const args = argv.slice(2);
  const clientConfig = await getClientConfig<BasicClientConfig>(args[0]);
  const accountId = clientConfig.clientAccountId;
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region: clientConfig.region,
  };
  const userPool = await getQUserPool(awsClientConfig);
  const dryRun = args[1] != 'live';

  await deleteQUsers(awsClientConfig, userPool, dryRun);
})();
