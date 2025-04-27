import { QBusinessClient, StartDataSourceSyncJobCommand } from '@aws-sdk/client-qbusiness';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { default as AdmZip } from 'adm-zip';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import clientConfigProd from '../clientConfigProd.json';
import { AWSClientConfig, getQInstanceDetails, temporaryCredentials } from './utils';

const args = argv.slice(2);

export async function uploadFiles(awsClientConfig: AWSClientConfig, zipFile: string, bucket: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 's3Upload-'));
  const zip = new AdmZip(zipFile);
  zip.extractAllTo(tmp);
  const s3 = new S3Client(awsClientConfig);
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
export async function startSync(awsClientConfig, applicationId: string, indexId: string, dataSourceId): Promise<void> {
  const qbusiness = new QBusinessClient(awsClientConfig);
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
  const awsClientConfig = {
    credentials: temporaryCredentials(accountId),
    region: clientConfigProd[args[1]].region,
  };
  console.log('Gathering account details...');
  const accountDetails = await getQInstanceDetails(awsClientConfig);
  console.log(accountDetails);
  console.log('Uploading files...');
  await uploadFiles(awsClientConfig, args[0], accountDetails.qDataBucket);
  console.log('Beginning sync...');
  await startSync(
    awsClientConfig,
    accountDetails.qApplicationId,
    accountDetails.qIndexId,
    accountDetails.qDataSourceId,
  );
}
