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
const clientsProd: Record<string, Omit<ClientConfig, 'client'>> = {
  accumen: {
    clientAccountId: '677276116117',
  },
  'arcanum-demo': {
    clientAccountId: '905418183804',
    createServiceLinkedRole: false,
    webCrawlerConfigs: [
      {
        url: 'https://arcanum.ai/',
      },
    ],
  },
  autoshoppe: {
    clientAccountId: '060795909741',
  },
  'av-media': {
    clientAccountId: '961341552812',
  },
  'beyond-expectations': {
    clientAccountId: '474668383176',
  },
  'broken-hill-city-council': {
    clientAccountId: '863518418134',
    webCrawlerConfigs: [
      { url: 'https://data.gov.au' },
      { url: 'https://www.brokenhill.nsw.gov.au/Home' },
      { url: 'https://www.dpie.nsw.gov.au/home' },
      { url: 'https://www.visitbrokenhill.com/Home' },
      { url: 'https://www.digital.nsw.gov.au/' },
      { url: 'https://www.ombo.nsw.gov.au/' },
      { url: 'https://lgnsw.org.au/' },
      { url: 'https://www.olg.nsw.gov.au/' },
    ],
  },
    corangamite: {
      clientAccountId: '442426871546',
      webCrawlerConfigs: [
        { url: 'https://data.gov.au' },
        { url: 'https://www.corangamite.vic.gov.au/Home' },
        { url: 'https://www.planning.vic.gov.au/planning-schemes' },
        { url: 'https://data.corangamite.vic.gov.au/pages/home/' },
        { url: 'https://www.cmlibraries.com.au/Home' },
        { url: 'https://visit12apostles.com.au/' },
        { url: 'https://prov.vic.gov.au/' },
        { url: 'https://ovic.vic.gov.au/' },
        { url: 'https://www.legislation.vic.gov.au/' },
        { url: 'https://www.epa.vic.gov.au/' },
        { url: 'https://www.fairwork.gov.au/' },
    ],
  },
  'design-builders': {
    clientAccountId: '061039773876',
  },
  'lg-pro': {
    clientAccountId: '539247480075',
    webCrawlerConfigs: [
      { url: 'https://www.lgpro.com/' },
      { url: 'https://www.legislation.vic.gov.au/' },
      { url: 'https://www.planning.vic.gov.au/planning-schemes' },
      { url: 'https://discover.data.vic.gov.au/group/local-government' },
      { url: 'https://www.localgovernment.vic.gov.au/' },
    ],
  },
  'modern-sales': {
    clientAccountId: '228743762183',
  },
  'moira-shire-council': {
    clientAccountId: '084828600250',
    webCrawlerConfigs: [
      { url: 'https://data.gov.au' },
      { url: 'https://mycouncilwebsite.vic.gov' },
      { url: 'https://www.planning.vic.gov.au/planning-schemes' },
      { url: 'https://www.legislation.vic.gov.au/' },
      { url: 'https://www.localgovernment.vic.gov.au/' },
      { url: 'https://www.moira.vic.gov.au/Our-Council/Our-policies' },
      { url: 'https://www.vba.vic.gov.au/building/building-resource-hub' },
      { url: 'https://www.legislation.vic.gov.au/in-force/acts/local-government-act-2020/021' },
      { url: 'https://www.legislation.gov.au/' },
    ],
  },
  nzsba: {
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
    clientAccountId: '640168445517',
  },
  'shire-of-narrogin': {
    clientAccountId: '491085384376',
    webCrawlerConfigs: [
      { url: 'https://www.legislation.wa.gov.au' },
      { url: 'https://www.dlgsc.wa.gov.au' },
      { url: 'https://www.dplh.wa.gov.au' },
      { url: 'https://www.wa.gov.au/organisation/western-australian-planning-commission' },
      { url: 'https://www.epa.wa.gov.au' },
      { url: 'https://www.dwer.wa.gov.au' },
      { url: 'https://www.commerce.wa.gov.au/worksafe' },
      { url: 'https://www.walga.asn.au' },
      { url: 'https://www.mainroads.wa.gov.au' },
      { url: 'https://www.health.wa.gov.au' },
      { url: 'https://www.narrogin.wa.gov.au/' },
      { url: 'https://www.abs.gov.au/' },
      { url: 'https://dfes.wa.gov.au/' },
      { url: 'https://www.wa.gov.au/organisation/state-records-office-of-western-australia' },
      { url: 'https://wheatbelt.wa.gov.au/' },
    ],
  },
  'story-box': {
    clientAccountId: '851725285135',
    loadSampleFile: false,
  },
  tda: {
    clientAccountId: '575108948290',
  },
  transit: {
    clientAccountId: '442426865055',
  },
  'w-advisory': {
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
    clientAccountId: '440744229592',
    webCrawlerConfigs: [
      { url: 'https://data.gov.au' },
      { url: 'https://mycouncilwebsite.vic.gov' },
      { url: 'https://www.planning.vic.gov.au/planning-schemes' },
      { url: 'https://Aquazone.com.au' },
      { url: 'https://Education.lighthousetheatre.com.au' },
      { url: 'https://Flagstaffhill.com' },
      { url: 'https://Gscdama.warrnambool.vic.gov.au' },
      { url: 'https://Healthymoves.warrnambool.vic.gov.au' },
      { url: 'https://Library.warrnambool.vic.gov.au' },
      { url: 'https://Lighthousetheatre.com.au' },
      { url: 'https://Moyjil.com.au' },
      { url: 'https://Plantselector.warrnambool.vic.gov.au' },
      { url: 'https://pp.lighthoiusetheatre.com.au' },
      { url: 'https://promenade.warrnambool.vic.gov.au' },
      { url: 'https://surfsidepark.com.au' },
      { url: 'https://thewag.com.au' },
      { url: 'https://w2040.com.au' },
      { url: 'https://warrnambool.com' },
      { url: 'https://warrnambool.vic.gov.au' },
      { url: 'https://warrnamboolpenguins.com.au' },
      { url: 'https://warrnamboolstreetart.com.au' },
      { url: 'https://whatson.warrnambool.vic.gov.au' },
      { url: 'https://yoursaywarrnambool.com.au' },
      { url: 'https://Connectwarrnambool.com.au' },
      { url: 'https://Eatwellbeactive.org.au' },
      { url: 'https://planning-schemes.app.planning.vic.gov.au/Warrnambool/ordinance' },
      { url: 'https://vpa.vic.gov.au' },
      { url: 'https://mav.asn.au' },
      { url: 'https://online.fines.vic.gov.au' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2024-10/20-9aa022-authorised.pdf' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2024-06/87-45aa156-authorised.pdf' },
      { url: 'https://www.legislation.vic.gov.au/in-force/acts/local-government-act-1989/163' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2023-05/94-81aa086-authorised.pdf' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2024-06/04-12aa065-authorised.pdf' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2024-10/86-127aa224-authorised.pdf' },
      { url: 'https://content.legislation.vic.gov.au/sites/default/files/2023-11/66-7405aa142-authorised.pdf' },
    ],
  },
  '30-seconds': {
    clientAccountId: '593793032721',
  },
};

const clientsDev: Record<string, Omit<ClientConfig, 'client'>> = {};

export function listNumaClients(environmentName?: EnvironmentName): string[] {
  return Object.keys(environmentName == EnvironmentName.prod ? clientsProd : clientsDev);
}

function lookupConfigForClient(client: string, environmentName?: EnvironmentName): ClientConfig {
  if (!listNumaClients(environmentName).includes(client)) throw new Error('Invalid client.');
  return { client, ...(environmentName == EnvironmentName.prod ? clientsProd : clientsDev)[client] };
}

export interface NumaClientStackProps extends ArcanumStackProps {
  client: string;
  config?: ClientConfig;
}

const apps: Record<string, typeof BaseNumaApp> = {};

function lookupAppFromId(id: string): typeof BaseNumaApp {
  return apps[id] ?? BaseNumaApp;
}
