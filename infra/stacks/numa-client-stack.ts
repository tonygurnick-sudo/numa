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

    // need domain name for certificate and also callback
    // do we delegate a whole NS? ideally not
    // OK, create a CNAME and a TXT for cert.


    props.config ??= lookupConfigForClient(props.client, props.environmentName as EnvironmentName);
    const environmentConfig = (props.environmentName as EnvironmentName) == EnvironmentName.prod ? {
      deployerAccount: '207567759910',
      domainSuffix: 'numa.arcanum.ai',
      hostedZone: 'Z05615802D0KHGAAOFX9U',
    } : {
      deployerAccount: '324037291751',
      domainSuffix: 'numa-dev.arcanum.ai',
      hostedZone: '',
    };
    const deployerRole = `arn:aws:iam::${environmentConfig.deployerAccount}:role/admin-delegated-access`;
    const clientRole = `arn:aws:iam::${props.config.clientAccountId}:role/ArcanumAIAccess`;
    super(scope, name, {
      ...props,
      assumeRoleList: [
        { roleArn: deployerRole },
        { roleArn: clientRole },
      ],
    });

    const hostedZoneProvider = new AwsProvider(this, 'hosted-zone-provider', {
      assumeRole: [
        {
          roleArn: deployerRole
        },
      ],
      alias: 'dns-provider',
      defaultTags: this.provider.defaultTags,
    });
    const certificateProvider = new AwsProvider(this, 'certificate-provider', {
      region: 'us-east-1', // Needs to be us-east-1 to work with Cloudfront.
      assumeRole: [
        { roleArn: deployerRole },
        { roleArn: clientRole },
      ],
      alias: 'certificate-provider',
      defaultTags: this.provider.defaultTags,
    });
    const domainName = props.config.customDomain ?? `${props.client}.${environmentConfig.domainSuffix}`;

    new CoreNumaInfra(this, 'numa', {
      ...props.config,
      environmentName: props.environmentName,
    });

    const fe = new NumaFrontendInfra(this, 'numa-frontend', {
      ...props.config,
      environmentName: props.environmentName,
      domainName,
      zoneId: environmentConfig.hostedZone,
      hostedZoneProvider,
      certificateProvider,
    });

    Object.entries(props.config.apps ?? {}).forEach(
      ([appId, appConfig]) => new (lookupAppFromId(appId))(this, appId, {
        ...appConfig,
        apiGatewayId: fe.apiGateway.id,
      }),
    );
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  apps?: Record<string, Omit<BaseNumaAppProps, 'apiGatewayId'>>;
}
const clientConfigDev = _clientConfigDev as Record<string, Omit<ClientConfig, 'client'>>;
const clientConfigProd = _clientConfigProd as Record<string, Omit<ClientConfig, 'client'>>;

export function listNumaClients(environmentName?: EnvironmentName): string[] {
  return Object.keys(environmentName == EnvironmentName.prod ? clientConfigProd : clientConfigDev);
}

function lookupConfigForClient(client: string, environmentName?: EnvironmentName): ClientConfig {
  if (!listNumaClients(environmentName).includes(client)) throw new Error('Invalid client.');
  return { client, ...(environmentName == EnvironmentName.prod ? clientConfigProd : clientConfigDev)[client] };
}

export interface NumaClientStackProps extends ArcanumStackProps {
  client: string;
  config?: ClientConfig;
}

const apps: Record<string, typeof BaseNumaApp> = {
  example: ExampleNumaApp,
};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  return apps[id] ?? BaseNumaApp;
}
