import { argv } from 'node:process';
import { QBusinessClient, ListDataSourceSyncJobsCommand, DataSourceSyncJob } from '@aws-sdk/client-qbusiness';
import { temporaryCredentials, getQInstanceDetails } from './utils';

const args = argv.slice(2);
const region = 'us-east-1';

async function findSyncJobs(credentials, applicationId: string, indexId: string, dataSourceId: string): Promise<DataSourceSyncJob[]> {
  const qbusiness = new QBusinessClient({ region, credentials });
  const response = await qbusiness.send(new ListDataSourceSyncJobsCommand({
    applicationId, dataSourceId, indexId,
  }));
  return response.history;
}

if (import.meta.filename === process?.argv[1]) {
  const credentials = temporaryCredentials(args[0]);
  console.log('Gathering account details...');
  const accountDetails = await getQInstanceDetails(credentials);
  console.log(accountDetails);
  console.log('Finding sync jobs...');
  const syncJobs = await findSyncJobs(credentials, accountDetails.qApplicationId, accountDetails.qIndexId, accountDetails.qDataSourceId);
  console.log(JSON.stringify(syncJobs[0]));
}
