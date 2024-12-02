import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { BaseNumaApp, BaseNumaAppProps } from '../constructs/base-numa-app-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import _clientConfigProd from '../../clientConfigProd.json';
import _clientConfigDev from '../../clientConfigDev.json';
import { ExampleNumaApp } from '../constructs/example-numa-app-construct';

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
    });

    Object.entries(props.config.apps ?? {}).forEach(
      ([appId, appConfig]) =>
        new (lookupAppFromId(appId))(this, appId, {
          ...appConfig,
          apiGatewayId: fe.apiGateway.id,
        }),
    );
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  customDomain?: string;
  apps?: Record<string, Omit<BaseNumaAppProps, 'apiGatewayId'>>;
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
};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  const app = apps[id];
  if (!app) throw new Error('Unknown app: ' + id);
  return app;
}
