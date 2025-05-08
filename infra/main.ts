import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';
import { InputConfig, NumaClientStack } from './stacks/numa-client-stack';
import { getClientConfig, listClients } from '@arcanumai/client-config';

const override = process.env['CLIENT_OVERRIDE'];

const app = new App();
const bucketSuffix = ''; // we are only deploying `prod` this used to be `-dev` for other environments
const environmentConfig = {
  arcanumNumaAccount: '207567759910',
  domainSuffix: 'numa.arcanum.ai',
  environmentName: EnvironmentName.prod,
  hostedZone: 'Z05615802D0KHGAAOFX9U',
};

if (override === undefined) {
  new QAppsDeployerStack(app, 'q-apps-deployer', {
    client: 'arcanum',
    serviceName: 'q-apps-deployer',
    templateBucketName: 'arcanum-numa-templates' + bucketSuffix,
    appsBucketName: 'numa-qapps' + bucketSuffix,
    ...environmentConfig,
  });
}

for (const clientName of override ? [override] : await listClients()) {
  const clientConfig = await getClientConfig<InputConfig>(clientName);
  new NumaClientStack(app, `numa-${clientName}`, {
    clientName,
    ...environmentConfig,
    clientConfig,
  });
}
app.synth();
