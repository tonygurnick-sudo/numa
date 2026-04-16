import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';
import { ClientConfig, clientConfigSchema, NumaClientStack } from './stacks/numa-client-stack';
import { PipedreamProxyStack } from './stacks/pipedream-proxy-stack';
import { getClientConfig, listClients } from '@arcanumai/client-config';
import { NextGenRootStack } from './stacks/nextgen-root-stack';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

const override = process.env['CLIENT_OVERRIDE'];
const deployerRole = 'arn:aws:iam::207567759910:role/admin-delegated-access';

const app = new App();
const bucketSuffix = ''; // we are only deploying `prod` this used to be `-dev` for other environments
const environmentConfig = {
  arcanumNumaAccount: '207567759910',
  domainSuffix: 'numa.arcanum.ai',
  environmentName: EnvironmentName.prod,
  hostedZone: 'Z05615802D0KHGAAOFX9U',
};
const users = [
  {
    email: 'dave@arcanum.ai',
    givenName: 'Dave',
    familyName: 'Ball',
    rootAccess: true,
  },
  {
    email: 'nick@arcanum.ai',
    givenName: 'Nick',
    familyName: 'Walton',
    rootAccess: true,
  },
  {
    email: 'nathan@arcanum.ai',
    givenName: 'Nathan',
    familyName: 'Douglas',
  },
  {
    email: 'hamish@arcanum.ai',
    givenName: 'Hamish',
    familyName: 'Wadham',
  },
  {
    email: 'sam@arcanum.ai',
    givenName: 'Sam',
    familyName: 'Bentley',
  },
];

if (override === undefined || override === 'none') {
  new QAppsDeployerStack(app, 'q-apps-deployer', {
    client: 'arcanum',
    serviceName: 'q-apps-deployer',
    templateBucketName: 'arcanum-numa-templates' + bucketSuffix,
    appsBucketName: 'numa-qapps' + bucketSuffix,
    enableCustomerSuccessPortal: true, // Enable POC Customer Success Portal
    enableQuotaReportDaily: true,
    hqAccountId: '619071323471',
    hqDataBucket: 'numa-hq-data',
    ...environmentConfig,
  });

  new NextGenRootStack(app, 'next-gen-root', {
    ...environmentConfig,
    users,
    configTable: 'numa-client-config',
  });

  // Pipedream Proxy Stack - deployed to dedicated pipedream proxy account
  new PipedreamProxyStack(app, 'pipedream-proxy', {
    ...environmentConfig,
    region: 'us-east-1',
  });
} else if (override !== 'none') {
  // creds
  const credentials = fromTemporaryCredentials({
    params: {
      RoleArn: deployerRole,
      RoleSessionName: 'client-config',
    },
  });
  // Read platform-level settings (global defaults for all clients)
  let globalSchedulingMinIntervalMinutes: number | undefined;
  try {
    const platformSettings = await getClientConfig<{ schedulingMinIntervalMinutes?: number }>({
      clientName: 'platform-settings',
      credentials,
    });
    globalSchedulingMinIntervalMinutes = platformSettings?.schedulingMinIntervalMinutes;
  } catch {
    // platform-settings record may not exist yet — fall back to platform default (5 min)
  }

  const allClients = override ? [override] : await listClients({ credentials });
  // Filter out the platform-settings pseudo-record — it stores global defaults, not a real client
  for (const clientName of allClients.filter((name) => name !== 'platform-settings')) {
    const clientConfig = await getClientConfig<ClientConfig>({ clientName, schema: clientConfigSchema, credentials });
    new NumaClientStack(app, `numa-${clientName}`, {
      clientName,
      ...environmentConfig,
      clientConfig,
      globalSchedulingMinIntervalMinutes,
    });
  }
}
app.synth();
