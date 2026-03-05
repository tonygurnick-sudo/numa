import { CloudFormationClient, CreateStackCommand, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { AwsCredentialIdentityProvider } from './utils';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

export function temporaryCredentials(accountId: string): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/OrganizationAccountAccessRole`,
    },
  });
}

const accounts = [
  // Arcanum
  '024697547528',
  '095683376841',
  '367597042838',
  '402054803997',
  '418274024729',
  '453606285073',
  '583163084794',
  '862714032426',
  '869176217217',
  '992059194101',
];

async function checkAccount(account: string): Promise<boolean> {
  const credentials = temporaryCredentials(account);
  const client = new CloudFormationClient({
    credentials,
  });
  try {
    const result = await client.send(new ListStacksCommand());
    return result.StackSummaries.filter((stack) => stack.StackName === 'ArcanaumAIInitialSetup').length > 0;
  } catch {
    return false;
  }
}

async function deployStack(account: string): Promise<string> {
  console.log('Deploying to ' + account);
  const credentials = temporaryCredentials(account);
  const client = new CloudFormationClient({
    credentials,
  });
  const result = await client.send(
    new CreateStackCommand({
      StackName: 'ArcanaumAIInitialSetup',
      TemplateURL: 'https://arcanum-numa-templates.s3.amazonaws.com/arcanum-ai-initial-setup.yaml',
      Capabilities: ['CAPABILITY_NAMED_IAM'],
    })
  );
  return result.StackId;
}

if (import.meta.filename == process.argv[1]) {
  const results = await Promise.all(accounts.map(async (acc) => ({ account: acc, status: await checkAccount(acc) })));
  for (const res of results) {
    console.log(res.account + ': ' + res.status);
  }
  const deployResults = await Promise.all(results.filter((res) => !res.status).map((res) => deployStack(res.account)));
  console.log(deployResults);
}
