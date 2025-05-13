import { listClients, getClientConfig, putClientConfig } from '@arcanumai/client-config';
import { ClientConfig } from '../infra/stacks/numa-client-stack';

const output: Record<string, ClientConfig> = {};

for (const clientName of await listClients()) {
  const config = await getClientConfig<ClientConfig>(clientName);
  if (config) {
    if (config.devInstance) {
      console.log('Skipping dev instance');
      output[clientName] = config;
      continue;
    }
    console.log(`Client: ${clientName}`);
    // console.log(JSON.stringify(config, null, 2));
    const result = putClientConfig(clientName, config);
    if (result) {
      console.log(`Client config for ${clientName} updated successfully.`);
    } else {
      console.log(`Failed to update client config for ${clientName}.`);
    }
  }
}

console.log('Client Configs:', JSON.stringify(output, null, 2));
