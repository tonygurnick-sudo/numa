import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import chalk from 'chalk';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { generate } from 'generate-password';
import { createReadStream, createWriteStream } from 'node:fs';
import { argv, exit } from 'node:process';
import { finished } from 'node:stream/promises';
import { webkit } from 'playwright';
import clientConfigProd from '../clientConfigProd.json';
import { AWSClientConfig, getQInstanceDetails, temporaryCredentials } from './utils';

const passwordConfig = {
  length: 12,
  numbers: true,
  lowercase: true,
  uppercase: true,
  symbols: true,
  exclude: ',"\'(){}[]<>',
  strict: true,
};
const inputFile = 'input.csv';
const outputFile = 'user-details.csv';
const activateLicences = false;

export async function createQUsers(
  awsClientConfig: AWSClientConfig,
  userPool: string,
  qUrl: string,
  dryRun: boolean,
): Promise<void> {
  const client = new CognitoIdentityProviderClient(awsClientConfig);

  if (dryRun) {
    console.log(chalk.green('Dry run is true, so not really doing anything. Give parameter "live" to disable.'));
  } else {
    console.log(chalk.red('Dry run is disabled, applying changes.'));
  }
  console.log(chalk.yellow('Userpool: ' + userPool));
  console.log(chalk.yellow('Q URL: ' + qUrl));
  if (!userPool || !qUrl) {
    console.log(chalk.red('One or more arguments is missing!'));
    exit(1);
  }
  const result: User[] = [];
  const readStream = createReadStream(inputFile)
    .pipe(parse({ from_line: 2 }))
    .on('data', (row) =>
      result.push({
        givenName: row[0].trim(),
        familyName: row[1].trim(),
        email: row[2].trim(),
        password: generate(passwordConfig),
      }),
    );
  result.push({
    givenName: 'Test',
    familyName: 'User',
    email: 'testuser@arcanum.ai',
    password: generate(passwordConfig),
  });
  await finished(readStream);
  console.log(chalk.green(`Creating ${result.length} users.`));
  for (const userDetails of result) {
    console.log(chalk.green(`Creating user: ${userDetails.givenName} ${userDetails.familyName} ${userDetails.email}`));
    if (!dryRun) await createQUser(client, qUrl, userDetails, userPool);
  }
  const writeStream = createWriteStream(outputFile);
  const stringifier = stringify({
    header: true,
    columns: Object.keys(result[0]),
  });
  result.forEach((row) => stringifier.write(row));
  stringifier.pipe(writeStream);
  console.log(chalk.green('Done.'));
}

type User = {
  givenName: string;
  familyName: string;
  email: string;
  password: string;
};

async function createQUser(
  client: CognitoIdentityProviderClient,
  qUrl: string,
  userDetails: User,
  userPool: string,
): Promise<void> {
  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPool,
        MessageAction: 'SUPPRESS',
        Username: userDetails.email,
        UserAttributes: [
          {
            Name: 'email',
            Value: userDetails.email,
          },
          {
            Name: 'given_name',
            Value: userDetails.givenName,
          },
          {
            Name: 'family_name',
            Value: userDetails.familyName,
          },
          {
            Name: 'email_verified',
            Value: 'true',
          },
        ],
      }),
    );
  } catch (e) {
    if (e instanceof UsernameExistsException) {
      console.log(
        chalk.yellow(
          `Username already exists: ${userDetails.givenName} ${userDetails.familyName} ${userDetails.email}`,
        ),
      );
    } else {
      throw e;
    }
  }
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPool,
      Username: userDetails.email,
      Password: userDetails.password,
      Permanent: true,
    }),
  );
  if (activateLicences) {
    try {
      await activateQLicence(qUrl, userDetails.email, userDetails.password);
    } catch {
      console.log(
        chalk.red(`Activation failed for: ${userDetails.givenName} ${userDetails.familyName} ${userDetails.email}`),
      );
      try {
        await activateQLicence(qUrl, userDetails.email, userDetails.password);
      } catch (e) {
        console.log(chalk.red('Activation failed again, forget it...'));
        console.log(chalk.red(e));
      }
    }
  }
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPool,
      Username: userDetails.email,
      Password: userDetails.password,
      Permanent: false,
    }),
  );
}

async function activateQLicence(qUrl, username: string, password: string): Promise<void> {
  const browser = await webkit.launch();
  const context = await browser.newContext({ baseURL: qUrl });
  const page = await context.newPage();
  await page.goto('./');
  await page.screenshot({ path: 'screenshot.png' });
  await page.getByRole('textbox', { name: 'name@host.com' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button').click();
  await page.getByTestId('prompt-textarea-field').waitFor();
  await page.screenshot({ path: 'screenshot-loaded.png' });
  await page.goto('./#/chat');
  await page.getByTestId('prompt-textarea-field').fill('Hello Q!');
  await page.getByTestId('submit-prompt-button').click();
  await page.getByTestId('copy-response-button').click();

  await browser.close();
}

(async (): Promise<void> => {
  console.log(chalk.green('Starting user creation'));
  const args = argv.slice(2);

  const accountId = clientConfigProd[args[0]].clientAccountId;
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region: clientConfigProd[args[0]].region,
  };
  const accountDetails = await getQInstanceDetails(awsClientConfig);
  const qUrl = args[1];
  const dryRun = args[2] != 'live';

  await createQUsers(awsClientConfig, accountDetails.qUserPool, qUrl, dryRun);
})();
