import { CognitoIdentityProviderClient, ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  ListApplicationsCommand,
  ListDataSourcesCommand,
  ListIndicesCommand,
  ListRetrieversCommand,
  QBusinessClient,
} from '@aws-sdk/client-qbusiness';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@smithy/types';
export { type AwsCredentialIdentityProvider } from '@smithy/types';

export interface AWSClientConfig {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}

export function temporaryCredentials(accountId: string): AwsCredentialIdentityProvider {
  return fromTemporaryCredentials({
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
    },
  });
}

export interface QInstanceDetails {
  qDataBucket: string;
  qApplicationId: string;
  qIndexId: string;
  qDataSourceId: string;
  qUserPool: string;
  qRetrieverId: string;
}

export async function getQInstanceDetails(
  awsClientConfig: AWSClientConfig,
  customerName?: string,
): Promise<QInstanceDetails> {
  const applicationId = await getQApplicationId(awsClientConfig, customerName);
  const indexId = await getQIndexId(awsClientConfig, applicationId);
  const dataSourceId = await getQDataSourceId(awsClientConfig, applicationId, indexId);
  const qUserPool = await getQUserPool(awsClientConfig, customerName);
  const qRetrieverId = await getRetrieverId(awsClientConfig, applicationId);
  return {
    qDataBucket: await getQDataBucket(awsClientConfig, customerName),
    qApplicationId: applicationId,
    qIndexId: indexId,
    qDataSourceId: dataSourceId,
    qUserPool,
    qRetrieverId: qRetrieverId,
  };
}

async function getQApplicationId(awsClientConfig: AWSClientConfig, customerName?: string): Promise<string> {
  console.log('Get Q application ID');
  const qBusiness = new QBusinessClient(awsClientConfig);
  const applications = (await qBusiness.send(new ListApplicationsCommand())).applications;
  return (
    await customerNameFilter({
      collection: applications,
      customerName,
      resource: 'application',
      nameName: 'displayName',
    })
  ).applicationId;
}

async function getQIndexId(awsClientConfig: AWSClientConfig, applicationId: string): Promise<string> {
  console.log('Get Q index ID');
  const qBusiness = new QBusinessClient(awsClientConfig);
  const indices = (
    await qBusiness.send(
      new ListIndicesCommand({
        applicationId,
      }),
    )
  ).indices;
  if (hasExactlyOne(indices, 'index')) {
    return indices[0].indexId;
  }
}

async function getQDataSourceId(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  indexId: string,
): Promise<string> {
  console.log('Get Q data source ID');
  const qBusiness = new QBusinessClient(awsClientConfig);
  const dataSources = (
    await qBusiness.send(
      new ListDataSourcesCommand({
        applicationId,
        indexId,
      }),
    )
  ).dataSources.filter((dataSource) => dataSource.type == 'S3');
  if (hasExactlyOne(dataSources, 'data source')) {
    return dataSources[0].dataSourceId;
  }
}

async function getQDataBucket(awsClientConfig: AWSClientConfig, customerName?: string): Promise<string> {
  const s3 = new S3Client(awsClientConfig);
  const buckets = (await s3.send(new ListBucketsCommand())).Buckets.filter((bucket) =>
    bucket.Name.match(/^numa-.*-data$/),
  );
  if (customerName) customerName += '-data';
  return (
    await customerNameFilter({
      collection: buckets,
      customerName,
      resource: 'bucket',
      nameName: 'Name',
    })
  ).Name;
}

export async function getQUserPool(awsClientConfig: AWSClientConfig, customerName?: string): Promise<string> {
  console.log('Get Q user pool');
  const client = new CognitoIdentityProviderClient(awsClientConfig);
  const userPools = (
    await client.send(
      new ListUserPoolsCommand({
        MaxResults: 60,
      }),
    )
  ).UserPools;
  return (
    await customerNameFilter({
      collection: userPools,
      customerName,
      resource: 'user pool',
      nameName: 'Name',
    })
  ).Id;
}

async function getRetrieverId(awsClientConfig: AWSClientConfig, appId: string): Promise<string> {
  console.log('Get retriever ID');
  const client = new QBusinessClient(awsClientConfig);
  try {
    const result = await client.send(new ListRetrieversCommand({ applicationId: appId }));
    const retrievers = result.retrievers ?? [];
    if (retrievers.length === 0) {
      throw new Error(`No retrievers found for application ${appId}`);
    }
    // If multiple retrievers exist, pick the one that's ACTIVE
    const activeRetriever = retrievers.find((r) => r.status === 'ACTIVE') || retrievers[0];
    return activeRetriever.retrieverId!;
  } catch (error) {
    console.error('Error retrieving retriever ID:', error);
    throw error;
  }
}

interface FilterProps<T> {
  collection: Array<T>;
  customerName?: string;
  resource: string;
  nameName: string;
}
async function customerNameFilter<T>(props: FilterProps<T>): Promise<T> {
  if (props.customerName) {
    const filteredCollection = await props.collection.filter((collectionObject) =>
      collectionObject[props.nameName].match(`^numa-${props.customerName}$`),
    );
    if (hasExactlyOne(filteredCollection, props.resource)) {
      return filteredCollection[0];
    }
  }
  if (hasExactlyOne(props.collection, props.resource)) {
    return props.collection[0];
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
