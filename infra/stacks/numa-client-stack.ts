import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Construct } from 'constructs';
import _clientConfigDev from '../../clientConfigDev.json';
import _clientConfigProd from '../../clientConfigProd.json';
import { CoreNumaApp, ExampleNumaApp } from '../constructs/apps';
import { BaseNumaApp, BaseNumaAppProps } from '../constructs/apps/base-numa-app-construct';
import { NZSBAPolicyBuilder } from '../constructs/apps/nzsba-policy-builder-construct';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';

export class NumaClientStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    const defaults = {
      domainSuffix: props.domainSuffix,
    };
    props.config ??= lookupConfigForClient(props.client, props.environmentName as EnvironmentName, defaults);
    const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    const clientRole = `arn:aws:iam::${props.config.clientAccountId}:role/ArcanumAIAccess`;
    super(scope, name, {
      ...props,
      assumeRoleList: [{ roleArn: deployerRole }, { roleArn: clientRole }],
    });

    const hostedZoneProvider = new AwsProvider(this, 'hosted-zone-provider', {
      assumeRole: [
        {
          roleArn: deployerRole,
        },
      ],
      alias: 'dns-provider',
      defaultTags: this.provider.defaultTags,
    });
    const certificateProvider = new AwsProvider(this, 'certificate-provider', {
      region: 'us-east-1', // Needs to be us-east-1 to work with Cloudfront.
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      alias: 'certificate-provider',
      defaultTags: this.provider.defaultTags,
    });

    const core = new CoreNumaInfra(this, 'numa', {
      ...props.config,
      environmentName: props.environmentName,
    });

    const fe = new NumaFrontendInfra(this, 'numa-frontend', {
      ...props.config,
      environmentName: props.environmentName,
      zoneId: props.hostedZone,
      hostedZoneProvider,
      certificateProvider,
      webExUrl: core.webExUrl,
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
    });

    new S3Object(this, 'config-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'config.json',
      content: JSON.stringify({
        cognito: {
          userPoolId: core.userPoolId,
          userPoolWebClientId: core.userPoolClient?.id,
          identityPoolId: core.identityPoolId,
          region: 'us-east-1', // TODO: Dynamic.
        },
        roleArn: core.webExperienceRoleArn,
        apiEndpoint: '/api',
      }),
      contentType: 'application/json',
    });
    // TODO: Invalidation cloudfront.

    const outputsBucket = new PrivateBucket(this, 'outputs-bucket', {
      bucket: `numa-${props.client}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}` + '-outputs',
    });

    // Resources can't start with a number, so prefix with an underscore if required.
    const coreAppId = props.client.replace(/^(?=[0-9])/, '_') + '-core';
    new CoreNumaApp(this, coreAppId, {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      outputsBucket: outputsBucket.bucket,
      clientId: core.userPoolClient?.id ?? '',
      clientSecret: core.userPoolClient?.clientSecret ?? '',
    });

    Object.entries(props.config.apps ?? {}).forEach(([appId, appConfig]) => {
      const app = lookupAppFromId(appId);
      new app(this, `${props.client}-${appId}`, {
        ...appConfig,
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        outputsBucket: outputsBucket.bucket,
      });
    });
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  customDomain?: string;
  apps?: Record<string, Omit<BaseNumaAppProps, 'apiGatewayId' | 'apiGatewayAuthorizerId' | 'outputsBucket'>>;
}
type InputConfig = Omit<ClientConfig, 'client' | 'domainName'>;
const clientConfigDev = _clientConfigDev as Record<string, InputConfig>;
const clientConfigProd = _clientConfigProd as Record<string, InputConfig>;

export function listNumaClients(environmentName?: EnvironmentName): string[] {
  return Object.keys(environmentName == EnvironmentName.prod ? clientConfigProd : clientConfigDev);
}

function lookupConfigForClient(
  client: string,
  environmentName: EnvironmentName,
  defaults: Record<string, string>,
): ClientConfig {
  if (!listNumaClients(environmentName).includes(client)) throw new Error('Invalid client.');
  const config = (environmentName == EnvironmentName.prod ? clientConfigProd : clientConfigDev)[client];
  const domainName = config.customDomain ?? `${client}.${defaults.domainSuffix}`;
  return { client, domainName, ...config };
}

export interface NumaClientStackProps extends ArcanumStackProps {
  client: string;
  config?: ClientConfig;
  domainSuffix: string;
  hostedZone: string;
  arcanumNumaAccount: string;
}

const apps: Record<string, typeof BaseNumaApp> = {
  'example-app': ExampleNumaApp,
  'nzsba-policy-builder': NZSBAPolicyBuilder,
};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  const app = apps[id];
  if (!app) throw new Error('Unknown app: ' + id);
  return app;
}
