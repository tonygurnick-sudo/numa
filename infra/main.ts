import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';
import { NumaClientStack, listNumaClients } from './stacks/numa-client-stack';

const environmentName = process.env['TF_ENVIRONMENT'] as EnvironmentName;

const app = new App();
const bucketSuffix = environmentName == 'prod' ? '' : '-dev';
const environmentConfig =
  environmentName == EnvironmentName.prod
    ? {
        arcanumNumaAccount: '207567759910',
        domainSuffix: 'numa.arcanum.ai',
        hostedZone: 'Z05615802D0KHGAAOFX9U',
      }
    : {
        arcanumNumaAccount: '324037291751',
        domainSuffix: 'numa-dev.arcanum.ai',
        hostedZone: 'Z01700621EGTW85OJXXO7',
      };
new QAppsDeployerStack(app, 'q-apps-deployer', {
  environmentName,
  client: 'arcanum',
  serviceName: 'q-apps-deployer',
  templateBucketName: 'arcanum-numa-templates' + bucketSuffix,
  appsBucketName: 'numa-qapps' + bucketSuffix,
  ...environmentConfig,
});
for (const client of listNumaClients(environmentName)) {
  new NumaClientStack(app, `numa-${client}`, {
    environmentName,
    client,
    serviceName: 'numa',
    ...environmentConfig,
  });
}
app.synth();
