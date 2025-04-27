import {
  DataSource,
  DataSourceSyncJob,
  ListDataSourcesCommand,
  ListDataSourceSyncJobsCommand,
  QBusinessClient,
  StartDataSourceSyncJobCommand,
} from '@aws-sdk/client-qbusiness';
import { argv } from 'node:process';
import clientConfigProd from '../clientConfigProd.json';
import { AWSClientConfig, getQInstanceDetails, temporaryCredentials } from './utils';

const args = argv.slice(2);

async function listDataSources(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  indexId: string,
): Promise<DataSource[]> {
  const qbusiness = new QBusinessClient(awsClientConfig);
  const response = await qbusiness.send(
    new ListDataSourcesCommand({
      applicationId,
      indexId,
    }),
  );
  return response.dataSources;
}

async function findSyncJobs(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  indexId: string,
  dataSourceId: string,
): Promise<DataSourceSyncJob[]> {
  const qbusiness = new QBusinessClient(awsClientConfig);
  const response = await qbusiness.send(
    new ListDataSourceSyncJobsCommand({
      applicationId,
      dataSourceId,
      indexId,
    }),
  );
  return response.history;
}

async function startSync(
  awsClientConfig: AWSClientConfig,
  applicationId: string,
  indexId: string,
  dataSourceId: string,
): Promise<void> {
  const qbusiness = new QBusinessClient(awsClientConfig);
  await qbusiness.send(
    new StartDataSourceSyncJobCommand({
      applicationId,
      indexId,
      dataSourceId,
    }),
  );
  console.log(`Started sync for data source: ${dataSourceId}`);
}

if (import.meta.filename === process?.argv[1]) {
  const clientName = args[0];
  const dataSourceIdIndex = args.indexOf('--data-source-id');
  const dataSourceId = dataSourceIdIndex !== -1 ? args[dataSourceIdIndex + 1] : null;
  const startSyncFlag = args.includes('--start-sync');
  const showList = args.includes('--list');
  const showAll = args.includes('--all');
  const showSyncStatus = args.includes('--sync-status');

  if (!clientConfigProd[clientName]) {
    console.error(`Client ${clientName} not found in configuration`);
    process.exit(1);
  }

  const accountId = clientConfigProd[clientName].clientAccountId;
  const awsClientConfig = {
    region: clientConfigProd[clientName].region,
    credentials: temporaryCredentials(accountId),
  };

  console.log('Gathering account details...');
  const accountDetails = await getQInstanceDetails(awsClientConfig);
  console.log(accountDetails);

  const dataSources = await listDataSources(awsClientConfig, accountDetails.qApplicationId, accountDetails.qIndexId);

  if (showList) {
    console.log('\nAvailable data sources:');
    dataSources.forEach((ds) => {
      console.log(`\nName: ${ds.displayName}`);
      console.log(`ID: ${ds.dataSourceId}`);
      console.log(`Type: ${ds.type}`);
      console.log(`Status: ${ds.status}`);
    });
  } else if (startSyncFlag) {
    if (dataSourceId) {
      await startSync(awsClientConfig, accountDetails.qApplicationId, accountDetails.qIndexId, dataSourceId);
    } else if (showAll) {
      for (const dataSource of dataSources) {
        await startSync(
          awsClientConfig,
          accountDetails.qApplicationId,
          accountDetails.qIndexId,
          dataSource.dataSourceId,
        );
      }
    } else {
      const s3DataSource = dataSources.find((ds) => ds.type === 'S3');
      if (s3DataSource) {
        await startSync(
          awsClientConfig,
          accountDetails.qApplicationId,
          accountDetails.qIndexId,
          s3DataSource.dataSourceId,
        );
      }
    }
  } else if (showSyncStatus) {
    if (dataSourceId) {
      const dataSource = dataSources.find((ds) => ds.dataSourceId === dataSourceId);
      if (dataSource) {
        const syncJobs = await findSyncJobs(
          awsClientConfig,
          accountDetails.qApplicationId,
          accountDetails.qIndexId,
          dataSource.dataSourceId,
        );
        console.log(`\nSync Status for ${dataSource.displayName}:`);
        console.log(JSON.stringify(syncJobs[0], null, 2));
      }
    } else {
      for (const dataSource of dataSources) {
        const syncJobs = await findSyncJobs(
          awsClientConfig,
          accountDetails.qApplicationId,
          accountDetails.qIndexId,
          dataSource.dataSourceId,
        );
        console.log(`\nSync Status for ${dataSource.displayName}:`);
        if (syncJobs.length > 0) {
          console.log(JSON.stringify(syncJobs[0], null, 2));
        } else {
          console.log('No sync jobs found');
        }
      }
    }
  } else {
    const syncJobs = await findSyncJobs(
      awsClientConfig,
      accountDetails.qApplicationId,
      accountDetails.qIndexId,
      accountDetails.qDataSourceId,
    );
    console.log(JSON.stringify(syncJobs[0]));
  }
}
