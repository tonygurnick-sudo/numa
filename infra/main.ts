import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';
import { NumaClientStack, listNumaClients } from './stacks/numa-client-stack';

const environmentName = process.env['TF_ENVIRONMENT'] as EnvironmentName;

const app = new App();
const bucketSuffix = environmentName == 'prod' ? '' : '-dev';
new QAppsDeployerStack(app, 'q-apps-deployer', {
  environmentName,
  client: 'arcanum',
  serviceName: 'q-apps-deployer',
  templateBucketName: 'arcanum-numa-templates' + bucketSuffix,
  appsBucketName: 'numa-qapps' + bucketSuffix,
});
for (const client of listNumaClients(environmentName)) {
  new NumaClientStack(app, `numa-${client}`, {
    environmentName,
    client,
    serviceName: 'numa',
  });
}
app.synth();
