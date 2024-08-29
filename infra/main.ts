import { App } from 'cdktf';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { QAppsDeployerStack } from './stacks/q-apps-deployer-stack';

const environmentName = process.env['TF_ENVIRONMENT'] as EnvironmentName;

const client = 'arcanum';
const serviceName = 'q-apps-deployer';

const app = new App();
new QAppsDeployerStack(app, 'q-apps-deployer', {
  environmentName,
  client,
  serviceName,
  templateBucketName: 'arcanum-numa-templates' + (environmentName == 'prod' ? '' : '-dev'),
});
app.synth();
