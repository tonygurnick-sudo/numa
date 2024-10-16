import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { BaseNumaApp, BaseNumaAppProps } from '../constructs/base-numa-app-construct';

export class NumaClientStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    props.config ??= lookupConfigForClient(props.client, props.environmentName as EnvironmentName);
    const deployerAccount =
      (props.environmentName as EnvironmentName) == EnvironmentName.prod ? '207567759910' : '324037291751';
    super(scope, name, {
      ...props,
      assumeRoleList: [
        { roleArn: `arn:aws:iam::${deployerAccount}:role/admin-delegated-access` },
        { roleArn: `arn:aws:iam::${props.config.clientAccountId}:role/ArcanumAIAccess` },
      ],
    });

    new CoreNumaInfra(this, 'numa', {
      ...props.config,
      environmentName: props.environmentName,
    });

    Object.entries(props.config.apps ?? {}).forEach(
      ([appId, appConfig]) => new (lookupAppFromId(appId))(this, appId, appConfig),
    );
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  apps?: Record<string, BaseNumaAppProps>;
}
// TODO: Replace this with some external store.
const clientsProd: Record<string, ClientConfig> = {
  'arcanum-demo': {
    client: 'arcanum-demo',
    identityProvider: 'oidc',
    clientAccountId: '905418183804',
  },
  'av-media': {
    client: 'av-media',
    identityProvider: 'oidc',
    clientAccountId: '961341552812',
  },
  'design-builders': {
    client: 'design-builders',
    identityProvider: 'oidc',
    clientAccountId: '061039773876',
  },
  rooflogic: {
    client: 'rooflogic',
    identityProvider: 'oidc',
    clientAccountId: '640168445517',
  },
  'w-advisory': {
    client: 'w-advisory',
    identityProvider: 'oidc',
    clientAccountId: '746669235417',
  },
};

const clientsDev: Record<string, ClientConfig> = {};

export function listNumaClients(environmentName?: EnvironmentName): string[] {
  return Object.keys(environmentName == EnvironmentName.prod ? clientsProd : clientsDev);
}

function lookupConfigForClient(client: string, environmentName?: EnvironmentName): ClientConfig {
  if (!listNumaClients(environmentName).includes(client)) throw new Error('Invalid client.');
  return (environmentName == EnvironmentName.prod ? clientsProd : clientsDev)[client];
}

export interface NumaClientStackProps extends ArcanumStackProps {
  client: string;
  config?: ClientConfig;
}

const apps: Record<string, typeof BaseNumaApp> = {};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  return apps[id] ?? BaseNumaApp;
}
