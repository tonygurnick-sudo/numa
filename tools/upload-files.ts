import { argv } from 'node:process';
import { default as AdmZip } from 'adm-zip';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { QBusinessClient, StartDataSourceSyncJobCommand } from '@aws-sdk/client-qbusiness';
import { temporaryCredentials, getQInstanceDetails } from './utils';
import clientConfigProd from '../clientConfigProd.json';

const args = argv.slice(2);
const region = 'us-east-1';

export async function uploadFiles(credentials, zipFile: string, bucket: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 's3Upload-'));
  const zip = new AdmZip(zipFile);
  zip.extractAllTo(tmp);
  const s3 = new S3Client({ region, credentials });
  for (const fileName of await readdir(tmp)) {
    console.log(join(tmp, fileName));
    const readStream = createReadStream(join(tmp, fileName));
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: fileName,
        Body: readStream,
      },
    });
    await upload.done();
  }
  await rm(tmp, { recursive: true });
}
export async function startSync(credentials, applicationId: string, indexId: string, dataSourceId): Promise<void> {
  const qbusiness = new QBusinessClient({ region, credentials });
  const response = await qbusiness.send(
    new StartDataSourceSyncJobCommand({
      applicationId,
      dataSourceId,
      indexId,
    }),
  );
  console.log(response.executionId);
}

if (import.meta.filename === process?.argv[1]) {
  const accountId = clientConfigProd[args[1]].clientAccountId;
  const credentials = temporaryCredentials(accountId);
  console.log('Gathering account details...');
  const accountDetails = await getQInstanceDetails(credentials);
  console.log(accountDetails);
  console.log('Uploading files...');
  await uploadFiles(credentials, args[0], accountDetails.qDataBucket);
  console.log('Beginning sync...');
  await startSync(credentials, accountDetails.qApplicationId, accountDetails.qIndexId, accountDetails.qDataSourceId);
}
