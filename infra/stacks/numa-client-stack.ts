import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn, S3Backend, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import _clientConfigProd from '../../clientConfigProd.json';
import { AppAgnosticApiGatewayLambdaCollection } from '../constructs/app-agnostic-api-gateway-lambda-collection';
import {
  BaseNumaApp,
  BaseNumaAppProps,
  BaseNumaAppType,
  UserConfigurableBaseNumaAppProps,
} from '../constructs/apps/base-numa-app-construct';
import { CandidateScreening } from '../constructs/apps/candidate-screening-construct';
import { CompanyProfile } from '../constructs/apps/company-profile-construct';
import { ContractAnalysis } from '../constructs/apps/contract-analysis-construct';
import { CostingCalculator } from '../constructs/apps/costing-calculator-construct';
import { CouncilResourceConsents } from '../constructs/apps/council-resource-consents-construct';
import { DocumentSummariser } from '../constructs/apps/document-summariser-construct';
import { FinancialAnalysis } from '../constructs/apps/financial-analysis-construct';
import { GdsrAssessment } from '../constructs/apps/gdsr-assessment-construct';
import { InfringementReview } from '../constructs/apps/infringement-review-construct';
import { MeetingAnalyser } from '../constructs/apps/meeting-analyser-construct';
import { NZSBAPolicyBuilder } from '../constructs/apps/nzsba-policy-builder-construct';
import { PolicyDrafter } from '../constructs/apps/policy-drafter-construct';
import { PolicyReviewer } from '../constructs/apps/policy-reviewer-construct';
import { ProcurementRfpAssessment } from '../constructs/apps/procurement-rfp-assessment-construct';
import { RfpResponseComparison } from '../constructs/apps/rfp-response-comparison-construct';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { InvalidateCloudfront } from '../constructs/invalidate-cloudfront-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { Honeycomb } from '../constructs/honeycomb-construct';
import { E2ETestNumaApp } from '../constructs/apps/e2e-test-numa-app-construct';
import { EnvironmentName } from '@arcanumai/cdktf-util';

export class NumaClientStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    const defaults = {
      domainSuffix: props.domainSuffix,
    };
    const clientConfig = lookupConfigForClient(props.clientName, defaults);

    const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    const clientRole = `arn:aws:iam::${clientConfig.clientAccountId}:role/ArcanumAIAccess`;
    super(scope, name);

    const keyName = [name, 'numa'].join('/') + '.tfstate';
    const key = ['product', props.clientName, props.environmentName, keyName].filter((x) => x).join('/');
    new S3Backend(this, {
      bucket: 'arcanum-terraform-state',
      region: 'ap-southeast-2',
      key,
      dynamodbTable: 'arcanum-terraform-lock',
    });

    const defaultProvider = new AwsProvider(this, 'default-provider', {
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      region: clientConfig.region,
      defaultTags: [
        {
          tags: {
            Arcanum: 'true',
            Client: props.clientName ?? 'unspecified',
            CreatedBy: 'CDKTF',
            Repository: process.env['CI_PROJECT_PATH'] ?? 'unknown',
            ServiceName: 'numa',
            StackName: name,
          },
        },
      ],
    });

    const hostedZoneProvider = new AwsProvider(this, 'hosted-zone-provider', {
      region: 'us-east-1',
      assumeRole: [
        {
          roleArn: deployerRole,
        },
      ],
      alias: 'dns-provider',
      defaultTags: defaultProvider.defaultTags,
    });
    const certificateProvider = new AwsProvider(this, 'certificate-provider', {
      region: 'us-east-1', // Needs to be us-east-1 to work with Cloudfront.
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      alias: 'certificate-provider',
      defaultTags: defaultProvider.defaultTags,
    });

    // QBusiness provider - currently needs to be us-east-1 in most regions
    // When QBusiness becomes available in other regions, this can use the client's region
    const qBusinessRegion = clientConfig.qBusinessRegion ?? clientConfig.region;
    const qBusinessProvider = new AwsProvider(this, 'qbusiness-provider', {
      region: qBusinessRegion,
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      alias: 'qbusiness-provider',
      defaultTags: defaultProvider.defaultTags,
    });

    const core = new CoreNumaInfra(this, 'numa', {
      ...clientConfig,
      environmentName: props.environmentName,
      qBusinessProvider: qBusinessProvider,
    });

    const honeycomb = new Honeycomb(this, 'honeycomb', {
      name: clientConfig.clientName,
    });

    const fe = new NumaFrontendInfra(this, 'numa-frontend', {
      ...clientConfig,
      environmentName: props.environmentName,
      zoneId: props.hostedZone,
      hostedZoneProvider,
      certificateProvider,
      webExUrl: core.webExUrl,
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      outputsBucket: core.outputsBucket,
      accountId: clientConfig.clientAccountId,
    });

    // Resources can't start with a number, so prefix with an underscore if required.
    const safeConstructId = props.clientName.replace(/^(?=[^a-zA-Z_])/, '_');
    new AppAgnosticApiGatewayLambdaCollection(this, safeConstructId + '-core', {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      chatHistoryTableName: core.chatHistoryTable.name,
      clientName: props.clientName,
      logGroup: core.logGroup,
      region: clientConfig.region,
      userPoolClientId: core.userPoolClient.id,
      userPoolClientSecret: core.userPoolClient.clientSecret,
    });

    const appConfigsToDeploy = getAppConfigsToDeploy(
      appLibrary,
      clientConfig.apps ?? {},
      clientConfig.allApps ?? false,
      clientConfig.allProdApps ?? false,
      clientConfig.devInstance ?? false,
    );
    const apps = appConfigsToDeploy.map(([configuredAppId, appConfig]) => {
      const app = lookupAppFromId(configuredAppId);
      return new app(this, `${safeConstructId}-${configuredAppId}`, {
        ...appConfig,
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        outputsBucket: core.outputsBucket.bucket,
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycomb.backendKey,
          region: clientConfig.region,
        },
      });
    });

    const folderPath = path.join(import.meta.dirname, '..', 'build', 'numa-frontend');
    const excludedFiles = ['config.json', 'manifest.json'];
    let objects: S3Object[] = [];
    try {
      objects = fs
        .readdirSync(folderPath, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile())
        .filter((f) => !excludedFiles.includes(f.name))
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
            contentType,
            key: path.relative(folderPath, source),
            source,
            sourceHash: Fn.filemd5(source),
          });
        });
    } catch {
      console.warn('No frontend code found at: ' + folderPath);
    }

    const configObject = new S3Object(this, 'config-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'config.json',
      content: JSON.stringify({
        USER_POOL_ID: core.userPoolId,
        CLIENT_ID: core.userPoolClient?.id,
        IDENTITY_POOL_ID: core.identityPoolId,
        IDENTITY_POOL_ROLE_ARN: core.identityPoolArn,
        REGION: clientConfig.region,
        ROLE_ARN: core.webExperienceRoleArn,
        Q_APPLICATION_ID: core.qBusinessApplicationId,
        Q_INDEX_ID: core.qBusinessIndexId,
        Q_RETRIEVER_ID: core.qBusinessRetrieverId,
        API_ENDPOINT: '/api',
        CLIENT_NAME: props.clientName,
        OUTPUTS_BUCKET_NAME: core.outputsBucket.bucket.bucket,
        HONEYCOMB_KEY: honeycomb.frontendKey, // We're going to send data directly to honeycomb for now. Move to a collector later.
        DATA_BUCKET: core.dataBucket.bucket.bucket,
      }),
      contentType: 'application/json',
    });

    const manifest = new S3Object(this, 'manifest-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'manifest.json',
      content: JSON.stringify({ apps: apps.map((app) => app.manifest) }),
      contentType: 'application/json',
    });

    const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const deployTime = new Date();
    const version = new S3Object(this, 'version-file', {
      bucket: fe.frontendBucket.bucket,
      key: 'version.json',
      content: JSON.stringify(
        {
          version: '0.0.0', // TODO: Make this more meaningful.
          gitHash,
          gitBranch,
          deployTime: deployTime.getTime(),
          deployTimeHuman: deployTime.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
        },
        undefined,
        2,
      ),
      contentType: 'application/json',
    });

    new InvalidateCloudfront(this, 'invalidate', {
      cloudfrontDistribution: fe.distribution,
      dependsOn: [manifest, configObject, version, ...objects],
    });
  }
}

export interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  /**
   * AWS region to deploy resources to.
   * This is the primary region for all resources except those that must be in specific regions.
   */
  region: string;
  customDomain?: string;
  /**
   * Whether this is a development instance that should include dev-only apps
   *
   * @default false
   */
  devInstance?: boolean;
  /**
   * Region to use for QBusiness resources.
   * Currently QBusiness is only available in us-east-1, but will be available in other regions in the future.
   *
   * @default 'us-east-1'
   */
  qBusinessRegion?: string;
  /**
   * Whether to deploy all apps to to the environment.
   *
   * @default false
   */
  allApps?: boolean;
  /**
   * Whether to deploy all production apps to to the environment.
   *
   * @default false
   */
  allProdApps?: boolean;
  /**
   * Object of apps and configs to deploy to the environment.
   *
   * @default {}
   */
  apps?: Record<string, UserConfigurableBaseNumaAppProps>;
}
type InputConfig = Omit<ClientConfig, 'clientName' | 'domainName'>;
const clientConfigProd = _clientConfigProd as Record<string, InputConfig>;

export function listNumaClients(): string[] {
  return Object.keys(clientConfigProd);
}

export function lookupConfigForClient(clientName: string, defaults: Record<string, string>): ClientConfig {
  if (!listNumaClients().includes(clientName)) throw new Error(`Invalid client name: ${clientName}`);
  const config = clientConfigProd[clientName];
  const domainName = config.customDomain ?? `${clientName}.${defaults.domainSuffix}`;
  return {
    clientName,
    domainName,
    ...defaults,
    ...config,
  };
}

export interface NumaClientStackProps {
  clientName: string;
  environmentName: EnvironmentName;
  domainSuffix: string;
  hostedZone: string;
  arcanumNumaAccount: string;
}

export interface AppDefinition {
  app: BaseNumaAppType;
  isProdApp: boolean;
}

export const appLibrary: Record<string, AppDefinition> = {
  'candidate-screening': { app: CandidateScreening, isProdApp: true },
  'company-profile': { app: CompanyProfile, isProdApp: true },
  'contract-analysis': { app: ContractAnalysis, isProdApp: true },
  'council-recourse-consents': { app: CouncilResourceConsents, isProdApp: false },
  'costing-calculator': { app: CostingCalculator, isProdApp: false },
  'document-summariser': { app: DocumentSummariser, isProdApp: true },
  'financial-analysis': { app: FinancialAnalysis, isProdApp: true },
  'gdsr-assessment': { app: GdsrAssessment, isProdApp: false },
  'infringement-review': { app: InfringementReview, isProdApp: false },
  'meeting-analyser': { app: MeetingAnalyser, isProdApp: true },
  'nzsba-policy-builder': { app: NZSBAPolicyBuilder, isProdApp: false },
  'policy-drafter': { app: PolicyDrafter, isProdApp: true },
  'policy-reviewer': { app: PolicyReviewer, isProdApp: true },
  'rfp-response-comparison': { app: RfpResponseComparison, isProdApp: false },
  'procurement-rfp-assessment': { app: ProcurementRfpAssessment, isProdApp: false },
};

// Include the E2E test app in a separate object
const devAppLibrary: Record<string, new (scope: Construct, name: string, props: BaseNumaAppProps) => BaseNumaApp> = {
  'e2e-test': E2ETestNumaApp,
};

function lookupAppFromId(id: string): new (scope: Construct, name: string, props: BaseNumaAppProps) => BaseNumaApp {
  const app = appLibrary[id]?.app || devAppLibrary[id];
  if (!app) throw new Error('Unknown app: ' + id);
  return app;
}

export function getAppConfigsToDeploy(
  appLibrary: Record<string, AppDefinition>,
  appConfigs: Record<string, UserConfigurableBaseNumaAppProps>,
  allApps: boolean,
  allProdApps: boolean,
  isDevInstance: boolean,
): Array<[string, UserConfigurableBaseNumaAppProps]> {
  const appConfigsToDeploy: Array<[string, UserConfigurableBaseNumaAppProps]> = Object.entries(appConfigs);

  if (allApps || allProdApps) {
    // Handle production apps
    Object.entries(appLibrary)
      .filter(([configuredAppId]) => !(configuredAppId in appConfigs))
      .filter((entry) => {
        const [_appId, { isProdApp }] = entry;
        return allApps || isProdApp;
      })
      .forEach((entry) => {
        const [configuredAppId] = entry;
        appConfigsToDeploy.push([configuredAppId, appConfigs[configuredAppId] ?? {}]);
      });
  }

  // Use specific app configurations, including dev apps if this is a dev instance
  if (isDevInstance) {
    Object.entries(devAppLibrary)
      .filter(([configuredAppId]) => !(configuredAppId in appConfigs))
      .forEach((entry) => {
        const [configuredAppId] = entry;
        appConfigsToDeploy.push([configuredAppId, appConfigs[configuredAppId] ?? {}]);
      });
  }

  return appConfigsToDeploy.sort((a, b) => {
    return a[0].localeCompare(b[0]);
  });
}
