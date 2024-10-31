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
  accumen: {
    client: 'accumen',
    clientAccountId: '677276116117',
  },
  'arcanum-demo': {
    client: 'arcanum-demo',
    clientAccountId: '905418183804',
    createServiceLinkedRole: false,
    webCrawlerConfigs: [
      {
        url: 'https://arcanum.ai/',
      },
    ],
  },
  'av-media': {
    client: 'av-media',
    clientAccountId: '961341552812',
  },
  'beyond-expectations': {
    client: 'beyond-expectations',
    clientAccountId: '474668383176',
  },
  'broken-hill-city-council': {
    client: 'broken-hill-city-council',
    clientAccountId: '863518418134',
  },
  'design-builders': {
    client: 'design-builders',
    clientAccountId: '061039773876',
  },
  'lg-pro': {
    client: 'lg-pro',
    clientAccountId: '539247480075',
  },
  'modern-sales': {
    client: 'modern-sales',
    clientAccountId: '228743762183',
  },
  nzsba: {
    client: 'nzsba',
    clientAccountId: '307946678276',
    webCrawlerConfigs: [
      {
        url: 'https://www.nzstaresourcecentre.org.nz/',
      },
      {
        url: 'https://www.legislation.govt.nz/',
      },
      {
        url: 'https://www.education.govt.nz/',
      },
    ],
    loadSampleFile: false,
  },
  rooflogic: {
    client: 'rooflogic',
    clientAccountId: '640168445517',
  },
  'story-box': {
    client: 'story-box',
    clientAccountId: '851725285135',
    loadSampleFile: false,
  },
  tda: {
    client: 'tda',
    clientAccountId: '575108948290',
  },
  'w-advisory': {
    client: 'w-advisory',
    clientAccountId: '746669235417',
    webCrawlerConfigs: [
      {
        url: 'https://www.ato.gov.au/',
      },
      {
        url: 'https://business.gov.au/',
      },
      {
        url: 'https://asic.gov.au/',
      },
      {
        url: 'https://central.xero.com/s/',
      },
    ],
    loadSampleFile: false,
  },
  'warrnambool-city-council': {
    client: 'warrnambool-city-council',
    clientAccountId: '440744229592',
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
