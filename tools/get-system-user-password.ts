import { temporaryCredentials } from './utils';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getClientConfig } from '@arcanumai/client-config';
import { ClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';

// TODO: docs
// TODO: Refactor to allow use by other tools

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const clientId = args[0];

  const clientInfo = await getClientConfig<ClientConfig>(clientId, clientConfigSchema);

  const smClient = new SecretsManagerClient({
    region: clientInfo.region,
    credentials: temporaryCredentials(clientInfo.clientAccountId),
  });

  const secret = (
    await smClient.send(
      new GetSecretValueCommand({
        SecretId: `${clientId}-system-user-password`,
        VersionStage: 'AWSCURRENT',
      }),
    )
  ).SecretString;
  console.log(JSON.parse(secret).password);
}
