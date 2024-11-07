import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { BaseNumaApp, BaseNumaAppProps } from '../constructs/base-numa-app-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import _clientConfigProd from '../../clientConfigProd.json';
import _clientConfigDev from '../../clientConfigDev.json';

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

    new NumaFrontendInfra(this, 'numa-frontend', {
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

const apps: Record<string, typeof BaseNumaApp> = {};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  return apps[id] ?? BaseNumaApp;
}
