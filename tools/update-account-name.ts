import { temporaryCredentials } from './utils';
import { AccountClient, GetAccountInformationCommand, PutAccountNameCommand } from '@aws-sdk/client-account';
import { getClientConfig } from '@arcanumai/client-config';
import { ClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';

// todo: refactor to make usable by other tools
// todo: ask for confirmation...

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const clientId = args[0];

  const clientInfo = await getClientConfig<ClientConfig>(clientId, clientConfigSchema);

  const accountClient = new AccountClient({
    region: clientInfo.region,
    credentials: temporaryCredentials(clientInfo.clientAccountId),
  });

  const accountName = (await accountClient.send(new GetAccountInformationCommand())).AccountName;
  await accountClient.send(new PutAccountNameCommand({ AccountName: clientId }));
  console.log(`Account name updated from ${accountName} to ${clientId}`);
}
