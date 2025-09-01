import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { temporaryCredentials } from './utils';

const accounts = [
  '905418183804',
  // NextGen
  '006043185629',
  '042666117240',
  '377977678801',
  '382337760991',
  '392928624335',
  '760023434717',
  '776126713613',
  '805629929118',
  '858955002160',
  '950318176385',
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
  const client = new STSClient({
    credentials,
  });
  try {
    const result = await client.send(new GetCallerIdentityCommand());
    return result.Account == account;
  } catch {
    return false;
  }
}

if (import.meta.filename == process.argv[1]) {
  const results = await Promise.all(accounts.map(async (acc) => [acc, await checkAccount(acc)]));
  for (const [acc, res] of results) {
    console.log(acc + ': ' + res);
  }
}
