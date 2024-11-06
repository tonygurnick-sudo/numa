import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { ListApplicationsCommand, ListDataSourcesCommand, ListIndicesCommand, QBusinessClient } from '@aws-sdk/client-qbusiness';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { AwsCredentialIdentityProvider } from '@smithy/types';
export { AwsCredentialIdentityProvider } from '@smithy/types';
import { CognitoIdentityProviderClient, ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider';

const region = 'us-east-1';

export function temporaryCredentials(accountId: string): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
    },
  });
}

export interface QInstanceDetails {
  qDataBucket: string,
  qApplicationId: string,
  qIndexId: string,
  qDataSourceId: string,
  qUserPool: string,
}
export async function getQInstanceDetails(credentials): Promise<QInstanceDetails> {
  const applicationId = await getQApplicationId(credentials);
  const indexId = await getQIndexId(credentials, applicationId);
  const dataSourceId = await getQDataSourceId(credentials, applicationId, indexId);
  const qUserPool = await getQUserPool(credentials);
  return {
    qDataBucket: await getQDataBucket(credentials),
    qApplicationId: applicationId,
    qIndexId: indexId,
    qDataSourceId: dataSourceId,
    qUserPool,
  }
}

export async function getQApplicationId(credentials): Promise<string> {
  const qBusiness = new QBusinessClient({ region, credentials });
  const applications = (await qBusiness.send(new ListApplicationsCommand())).applications;
  if (hasExactlyOne(applications, 'application')) {
    return applications[0].applicationId;
  }
}

export async function getQIndexId(credentials, applicationId: string): Promise<string> {
  const qBusiness = new QBusinessClient({ region, credentials });
  const indices = (await qBusiness.send(new ListIndicesCommand({
    applicationId,
  }))).indices;
  if (hasExactlyOne(indices, 'index')) {
    return indices[0].indexId;
  }
}

export async function getQDataSourceId(credentials, applicationId: string, indexId: string): Promise<string> {
  const qBusiness = new QBusinessClient({ region, credentials });
  const dataSources = (await qBusiness.send(new ListDataSourcesCommand(
    {
      applicationId,
      indexId,
    }
  ))).dataSources.filter((dataSource) => dataSource.type == 'S3');
  if (hasExactlyOne(dataSources, 'data source')) {
    return dataSources[0].dataSourceId;
  }
}

export async function getQDataBucket(credentials): Promise<string> {
  const s3 = new S3Client({ region, credentials });
  const buckets = (await s3.send(new ListBucketsCommand())).Buckets.filter((bucket) => bucket.Name.match(/^numa-.*-data$/));
  if (hasExactlyOne(buckets, 'bucket')) {
    return buckets[0].Name;
  }
}

export async function getQUserPool(credentials): Promise<string> {
  const client = new CognitoIdentityProviderClient({ region, credentials });
  const userPools = (await client.send(new ListUserPoolsCommand({
    MaxResults: 60,
  }))).UserPools;
  if (hasExactlyOne(userPools, 'user pool')) {
    return userPools[0].Id;
  }
}

function hasExactlyOne(collection: Array<unknown>, resource: string): boolean {
  if (collection.length < 1) {
    throw `No ${resource}s found. Was infra correctly set up?`;
  } else if (collection.length > 1) {
    throw `More than one ${resource} found. Please specify ${resource} to use: ${collection}`;
  } else {
    return true;
  }
}
