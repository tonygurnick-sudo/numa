import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';
import { ClientConfig, clientConfigSchema, NumaClientStack } from './stacks/numa-client-stack';
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
    ...environmentConfig,
  });

  new NextGenRootStack(app, 'next-gen-root', {
    ...environmentConfig,
    users,
    configTable: 'numa-client-config',
  });
} else if (override !== 'none') {
  // creds
  const credentials = fromTemporaryCredentials({
    params: {
      RoleArn: deployerRole,
      RoleSessionName: 'client-config',
    },
  });
  for (const clientName of override ? [override] : await listClients({ credentials })) {
    const clientConfig = await getClientConfig<ClientConfig>({ clientName, schema: clientConfigSchema, credentials });
    new NumaClientStack(app, `numa-${clientName}`, {
      clientName,
      ...environmentConfig,
      clientConfig,
    });
  }
}
app.synth();
