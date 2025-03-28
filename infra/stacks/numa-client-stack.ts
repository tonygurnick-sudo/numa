import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import _clientConfigDev from '../../clientConfigDev.json';
import _clientConfigProd from '../../clientConfigProd.json';
import { AppAgnosticApiGatewayLambdaCollection } from '../constructs/app-agnostic-api-gateway-lambda-collection';
import { BaseNumaAppType, UserConfigurableBaseNumaAppProps } from '../constructs/apps/base-numa-app-construct';
import { CandidateScreening } from '../constructs/apps/candidate-screening-construct';
import { CompanyProfile } from '../constructs/apps/company-profile-construct';
import { ContractAnalysis } from '../constructs/apps/contract-analysis-construct';
import { DocumentSummariser } from '../constructs/apps/document-summariser-construct';
import { FinancialAnalysis } from '../constructs/apps/financial-analysis-construct';
import { InfringementReview } from '../constructs/apps/infringement-review-construct';
import { MeetingAnalyser } from '../constructs/apps/meeting-analyser-construct';
import { NZSBAPolicyBuilder } from '../constructs/apps/nzsba-policy-builder-construct';
import { PolicyDrafter } from '../constructs/apps/policy-drafter-construct';
import { PolicyReviewer } from '../constructs/apps/policy-reviewer-construct';
import { CoreNumaInfra, CoreNumaInfraProps } from '../constructs/core-numa-infra-construct';
import { InvalidateCloudfront } from '../constructs/invalidate-cloudfront-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { Honeycomb } from '../constructs/honeycomb-construct';

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
    const region = 'us-east-1'; // TODO: Temporary

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

    const honeycomb = new Honeycomb(this, 'honeycomb', {
      name: props.config.client,
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
      outputsBucket: core.outputsBucket,
      accountId: props.config.clientAccountId,
    });

    // Resources can't start with a number, so prefix with an underscore if required.
    const safeConstructId = props.client.replace(/^(?=[^a-zA-Z_])/, '_');
    new AppAgnosticApiGatewayLambdaCollection(this, safeConstructId + '-core', {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      clientId: core.userPoolClient.id,
      clientSecret: core.userPoolClient.clientSecret,
      client: props.client,
      chatHistoryTableName: core.chatHistoryTable.name,
    });

    const appConfigsToDeploy = getAppConfigsToDeploy(
      appLibrary,
      props.config.apps ?? {},
      props.config.allApps ?? false,
      props.config.allProdApps ?? false,
    );
    const apps = appConfigsToDeploy.map(([appId, appConfig]) => {
      const app = lookupAppFromId(appId);
      return new app(this, `${safeConstructId}-${appId}`, {
        ...appConfig,
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        outputsBucket: core.outputsBucket.bucket,
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycomb.backendKey,
          region,
        },
      });
    });

    if (props.config.uploadFrontend ?? true) {
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

      const config = new S3Object(this, 'config-item', {
        bucket: fe.frontendBucket.bucket,
        key: 'config.json',
        content: JSON.stringify({
          USER_POOL_ID: core.userPoolId,
          CLIENT_ID: core.userPoolClient?.id,
          IDENTITY_POOL_ID: core.identityPoolId,
          IDENTITY_POOL_ROLE_ARN: core.identityPoolArn,
          REGION: 'us-east-1', // TODO: Dynamic.
          ROLE_ARN: core.webExperienceRoleArn,
          Q_APPLICATION_ID: core.qBusinessApplicationId,
          Q_INDEX_ID: core.qBusinessIndexId,
          Q_RETRIEVER_ID: core.qBusinessRetrieverId,
          API_ENDPOINT: '/api',
          CLIENT_NAME: props.client,
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
        dependsOn: [manifest, config, version, ...objects],
      });
    }
  }
}

interface ClientConfig extends Omit<CoreNumaInfraProps, 'environmentName'> {
  customDomain?: string;
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

export interface AppDefinition {
  app: BaseNumaAppType;
  isProdApp: boolean;
}

export const appLibrary: Record<string, AppDefinition> = {
  'candidate-screening': { app: CandidateScreening, isProdApp: true },
  'company-profile': { app: CompanyProfile, isProdApp: false },
  'contract-analysis': { app: ContractAnalysis, isProdApp: true },
  'document-summariser': { app: DocumentSummariser, isProdApp: true },
  'financial-analysis': { app: FinancialAnalysis, isProdApp: true },
  'infringement-review': { app: InfringementReview, isProdApp: false },
  'meeting-analyser': { app: MeetingAnalyser, isProdApp: true },
  'nzsba-policy-builder': { app: NZSBAPolicyBuilder, isProdApp: false },
  'policy-drafter': { app: PolicyDrafter, isProdApp: false },
  'policy-reviewer': { app: PolicyReviewer, isProdApp: false },
};

function lookupAppFromId(id: string): BaseNumaAppType {
  const { app } = appLibrary[id];
  if (!app) throw new Error('Unknown app: ' + id);
  return app;
}

export function getAppConfigsToDeploy(
  appLibrary: Record<string, AppDefinition>,
  appConfigs: Record<string, UserConfigurableBaseNumaAppProps>,
  allApps: boolean,
  allProdApps: boolean,
): Array<[string, UserConfigurableBaseNumaAppProps]> {
  let appConfigsToDeploy: Array<[string, UserConfigurableBaseNumaAppProps]> = [];
  if (allApps || allProdApps) {
    appConfigsToDeploy = Object.entries(appLibrary)
      .filter((entry) => {
        const [_appId, { isProdApp }] = entry;
        return allApps || isProdApp;
      })
      .map((entry) => {
        const [appId] = entry;
        return [appId, appConfigs[appId] ?? {}];
      });
  } else {
    appConfigsToDeploy = Object.entries(appConfigs);
  }
  return appConfigsToDeploy;
}
