import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import _clientConfigDev from '../../clientConfigDev.json';
import _clientConfigProd from '../../clientConfigProd.json';
import { CoreNumaApp, ExampleNumaApp } from '../constructs/apps';
import { BaseNumaApp, BaseNumaAppProps } from '../constructs/apps/base-numa-app-construct';
import { NZSBAPolicyBuilder } from '../constructs/apps/nzsba-policy-builder-construct';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { InvalidateCloudfront } from '../constructs/invalidate-cloudfront-construct';
import { Fn } from 'cdktf';

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

    const apps = Object.entries(props.config.apps ?? {}).map(([appId, appConfig]) => {
      const app = lookupAppFromId(appId);
      return new app(this, `${props.client}-${appId}`, {
        ...appConfig,
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        outputsBucket: outputsBucket.bucket,
      });
    });

    if (props.config.uploadFrontend ?? true) {
      const folderPath = path.join(import.meta.dirname, '..', 'build', 'numa-frontend');
      const denyListedFiles = ['config.json', 'manifest.json'];
      try {
        const objects = fs
          .readdirSync(folderPath, { recursive: true, withFileTypes: true })
          .filter((f) => f.isFile())
          .filter((f) => !denyListedFiles.includes(f.name))
          .map((f) => path.join(f.parentPath, f.name))
          .map((source) => {
            const contentType = {
              html: 'text/html; charset=utf-8',
              json: 'application/json',
              js: 'application/x-javascript',
              css: 'text/css; charset=utf-8',
              jpg: 'image/jpg',
              svg: 'image/svg+xml',
              default: undefined,
            }[source.split('.')?.pop() ?? 'default'];
            return new S3Object(this, `website-file-${source}`, {
              bucket: fe.frontendBucket.bucket,
              source,
              key: path.relative(folderPath, source),
              contentType,
              etag: Fn.filemd5(source),
            });
          });

        const config = new S3Object(this, 'config-item', {
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

        const manifest = new S3Object(this, 'manifest-item', {
          bucket: fe.frontendBucket.bucket,
          key: 'manifest.json',
          content: JSON.stringify({ apps }),
          contentType: 'application/json',
        });

        new InvalidateCloudfront(this, 'invalidate', {
          cloudfrontDistribution: fe.distribution,
          dependsOn: [manifest, config, ...objects],
        });
      } catch {
        console.warn('No frontend code found at: ' + folderPath);
      }
    }
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  customDomain?: string;
  apps?: Record<string, Omit<BaseNumaAppProps, 'apiGatewayId' | 'apiGatewayAuthorizerId' | 'outputsBucket'>>;
  /**
   * Whether to upload the Numa frontend. Used to disable frontend installation when using a custom frontend.
   *
   * @default true
   * @deprecated Should only be set to false for NZSBA.
   */
  uploadFrontend?: boolean;
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

const apps: Record<string, new (scope: Construct, name: string, props: BaseNumaAppProps) => BaseNumaApp> = {
  'example-app': ExampleNumaApp,
  'nzsba-policy-builder': NZSBAPolicyBuilder,
};

function lookupAppFromId(id: string): new (scope: Construct, name: string, props: BaseNumaAppProps) => BaseNumaApp {
  const app = apps[id];
  if (!app) throw new Error('Unknown app: ' + id);
  return app;
}
