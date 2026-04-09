import { AdminSetUserPasswordCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { getClientConfig } from '@arcanumai/client-config';
import { BasicClientConfig, getQUserPool, temporaryCredentials } from './utils';
import { argv, exit } from 'node:process';

// Helper function to temporarily switch AWS profile
async function withDeployerProfile<T>(fn: () => Promise<T>): Promise<T> {
  const originalProfile = process.env.AWS_PROFILE;
  process.env.AWS_PROFILE = 'arcanum-q-deployer-prod';
  try {
    return await fn();
  } finally {
    if (originalProfile) {
      process.env.AWS_PROFILE = originalProfile;
    } else {
      delete process.env.AWS_PROFILE;
    }
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const isTemporary = args.includes('--temporary');
  const positionalArgs = args.filter((a) => !a.startsWith('--'));

  if (positionalArgs.length < 3) {
    console.error('Usage: yarn reset-user-password <clientName> <username> <newPassword> [--temporary]');
    exit(1);
  }

  const [clientName, username, password] = positionalArgs;

  console.log(`Getting config for client: ${clientName}`);
  const clientConfig = await getClientConfig<BasicClientConfig>(clientName);

  const accountId = clientConfig.clientAccountId;
  if (!accountId) {
    console.error(`Account ID for ${clientName} not found in configuration`);
    exit(1);
  }

  const region = clientConfig.region;
  if (!region) {
    console.error(`Region for ${clientName} not found in configuration`);
    exit(1);
  }

  try {
    await withDeployerProfile(async () => {
      const awsClientConfig = {
        region,
        credentials: temporaryCredentials(accountId),
      };

      console.log('Finding user pool...');
      const userPoolId = await getQUserPool(awsClientConfig, clientName);
      if (!userPoolId) {
        throw new Error(`Could not find user pool for ${clientName}`);
      }

      console.log(`User pool found: ${userPoolId}`);
      console.log(`Setting ${isTemporary ? 'temporary' : 'permanent'} password for user: ${username}`);

      const cognito = new CognitoIdentityProviderClient(awsClientConfig);

      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
          Username: username,
          Password: password,
          Permanent: !isTemporary,
        })
      );

      console.log(`Successfully updated password for ${username} in ${clientName}.`);
    });
  } catch (error) {
    console.error('Failed to set user password:', error);
    exit(1);
  }
}

if (import.meta.filename === argv[1]) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    exit(1);
  });
}
