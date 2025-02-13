import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { parse } from 'csv-parse';
import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { argv, exit } from 'node:process';
import chalk from 'chalk';
import { getQUserPool, temporaryCredentials, AwsCredentialIdentityProvider } from './utils';
import clientConfigProd from '../clientConfigProd.json';

const region = 'us-east-1';
const inputFile = 'input.csv';

export async function deleteQUsers(
  credentials: AwsCredentialIdentityProvider,
  userPool: string,
  dryRun: boolean,
): Promise<void> {
  const client = new CognitoIdentityProviderClient({ region, credentials });

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
          }),
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

  const accountId = clientConfigProd[args[0]].clientAccountId;
  const credentials = temporaryCredentials(accountId);
  const userPool = await getQUserPool(credentials);
  const dryRun = args[1] != 'live';

  await deleteQUsers(credentials, userPool, dryRun);
})();
