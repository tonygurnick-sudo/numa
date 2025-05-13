import { listClients } from '@arcanumai/client-config';

async function main(): Promise<string[]> {
  try {
    return await listClients();
  } catch (error) {
    return Promise.reject(error);
  }
}

if (import.meta.filename === process.argv[1]) {
  main()
    .then((output) => output.sort().map((client) => console.log(client)))
    .catch((error) => console.error('Error:', error));
}
