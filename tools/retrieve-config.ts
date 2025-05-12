import { getClientConfig } from '@arcanumai/client-config';
import { ClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';

async function main(client: string): Promise<ClientConfig> {
  try {
    return await getClientConfig<ClientConfig>(client, clientConfigSchema);
  } catch (error) {
    return Promise.reject(error.issues);
  }
}

if (import.meta.filename === process.argv[1]) {
  main(process.argv[2])
    .then((output) => console.log(JSON.stringify(output, null, 2)))
    .catch((error) => console.error('Error:', error));
}
