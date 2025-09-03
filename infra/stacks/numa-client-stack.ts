import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn, S3Backend, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppAgnosticApiGatewayLambdaCollection } from '../constructs/app-agnostic-api-gateway-lambda-collection';
import { BudgetAlertForwarderConstruct, budgetConfigSchema } from '../constructs/budget-alert-forwarder-construct';
import {
  BaseNumaApp,
  BaseNumaAppProps,
  BaseNumaAppType,
  UserConfigurableBaseNumaAppProps,
  userConfigurableBaseNumaAppPropsSchema,
} from '../constructs/apps/base-numa-app-construct';
import { BeyondExpectations } from '../constructs/apps/beyond-expectations-construct';
import { CandidateScreening } from '../constructs/apps/candidate-screening-construct';
import { CompanyProfile } from '../constructs/apps/company-profile-construct';
import { ContractAnalysis } from '../constructs/apps/contract-analysis-construct';
import { CostingCalculator } from '../constructs/apps/costing-calculator-construct';
import { CouncilResourceConsents } from '../constructs/apps/council-resource-consents-construct';
import { DocumentSummariser } from '../constructs/apps/document-summariser-construct';
import { FinancialAnalysis } from '../constructs/apps/financial-analysis-construct';
import { GdsrAssessment } from '../constructs/apps/gdsr-assessment-construct';
import { InfringementReview } from '../constructs/apps/infringement-review-construct';
import { TorAssessment } from '../constructs/apps/tor-assessment-construct';
import { MeetingAnalyser } from '../constructs/apps/meeting-analyser-construct';
import { NZSBAPolicyBuilder } from '../constructs/apps/nzsba-policy-builder-construct';
import { PolicyDrafter } from '../constructs/apps/policy-drafter-construct';
import { PolicyReviewer } from '../constructs/apps/policy-reviewer-construct';
import { ProcurementRfpAssessment } from '../constructs/apps/procurement-rfp-assessment-construct';
import { RfpResponseComparison } from '../constructs/apps/rfp-response-comparison-construct';
import { CoreNumaInfra, coreNumaInfraPropsSchema } from '../constructs/core-numa-infra-construct';
import { InvalidateCloudfront } from '../constructs/invalidate-cloudfront-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { NumaChatAgentWebSocket } from '../constructs/numa-chat-agent-ws-construct';
import { E2ETestNumaApp } from '../constructs/apps/e2e-test-numa-app-construct';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { z } from 'zod';
import { KnowledgeBase } from '../constructs/knowledge-base-construct';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsSsmParameter } from '@cdktf/provider-aws/lib/data-aws-ssm-parameter';

const arcanumOrgId = 'o-g8veu85jva';
const nextGenOrgId = 'o-apdsu3c1a7';

export class NumaClientStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    const defaults = {
      domainSuffix: props.domainSuffix,
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      bedrockParserModel: 'amazon.nova-lite-v1:0',
      visionModelType: 'haiku',
      provisionQResources: true,
    };
    const domainName = props.clientConfig.customDomain ?? `${props.clientName}.${defaults.domainSuffix}`;
    const preferredKnowledgeBase =
      (props.clientConfig.provisionQResources ?? defaults.provisionQResources) ? 'q' : 'bedrock';
    const clientConfig = {
      clientName: props.clientName,
      domainName,
      preferredKnowledgeBase,
      ...defaults,
      ...props.clientConfig,
    };

    if (!clientConfig.provisionQResources && clientConfig.preferredKnowledgeBase === 'q') {
      throw new Error('Nonsense detected: Q cannot be preferred knowledgebase when resources are not provisioned.');
    }

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
    const parameterLookupProvider = new AwsProvider(this, 'parameter-lookup-provider', {
      region: 'us-east-1',
      assumeRole: [
        {
          roleArn: deployerRole,
        },
      ],
      alias: 'parameter-lookup-provider',
      defaultTags: defaultProvider.defaultTags,
    });
    const honeycombFrontendKey = new DataAwsSsmParameter(this, 'honeycomb-frontend-key', {
      provider: parameterLookupProvider,
      name: '/honeycomb/frontend-key',
    }).value;
    const honeycombBackendKey = new DataAwsSsmParameter(this, 'honeycomb-backend-key', {
      provider: parameterLookupProvider,
      name: '/honeycomb/backend-key',
    }).value;

    // QBusiness provider - currently needs to be us-east-1 in most regions
    // When QBusiness becomes available in other regions, this can use the client's region
    const qBusinessRegion = clientConfig.qBusinessRegion ?? clientConfig.region;
    const qBusinessProvider = new AwsProvider(this, 'qbusiness-provider', {
      region: qBusinessRegion,
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      alias: 'qbusiness-provider',
      defaultTags: defaultProvider.defaultTags,
    });

    const knowledgeBase = new KnowledgeBase(this, 'knowledge-base', {
      clientName: clientConfig.clientName,
      region: clientConfig.region,
      embeddingModel: clientConfig.embeddingModel,
      bedrockParserModel: clientConfig.bedrockParserModel,
    });

    const core = new CoreNumaInfra(this, 'numa', {
      ...clientConfig,
      environmentName: props.environmentName,
      qBusinessProvider: qBusinessProvider,
      knowledgeBase: knowledgeBase,
    });

    // Create Chat Agent WebSocket API
    const chatAgentDomain = `chat-agent.${domainName}`;
    const chatAgentWs = new NumaChatAgentWebSocket(this, 'chat-agent-ws', {
      clientName: props.clientName,
      region: clientConfig.region,
      domainName: chatAgentDomain,
      hostedZoneId: props.hostedZone,
      hostedZoneProvider: hostedZoneProvider,
      certificateProvider: certificateProvider,
      chatAgentConfiguration: {
        preferredKnowledgeBase: clientConfig.preferredKnowledgeBase as 'q' | 'bedrock',
        qApplicationId: core.qBusinessApplicationId,
        qRetrieverId: core.qBusinessRetrieverId,
        bedrockKnowledgeBaseId: knowledgeBase.knowledgeBaseId,
      },
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      outputsBucketArn: core.outputsBucket.bucket.arn,
      dataBucketArn: core.dataBucket.bucket.arn,
    });

    const fe = new NumaFrontendInfra(this, 'numa-frontend', {
      ...clientConfig,
      environmentName: props.environmentName,
      zoneId: props.hostedZone,
      hostedZoneProvider,
      certificateProvider,
      webExUrl: core.webExUrl ?? '',
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      outputsBucket: core.outputsBucket,
      accountId: clientConfig.clientAccountId,
      knowledgeBase: knowledgeBase,
    });

    // Resources can't start with a number, so prefix with an underscore if required.
    const safeConstructId = props.clientName.replace(/^(?=[^a-zA-Z_])/, '_');
    new AppAgnosticApiGatewayLambdaCollection(this, safeConstructId + '-core', {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      bedrockAccount: clientConfig.bedrockAccount,
      chatHistoryTableName: core.chatHistoryTable.name,
      clientName: props.clientName,
      dataBucketName: core.dataBucket.bucket.bucket,
      logGroup: core.logGroup,
      region: clientConfig.region,
      userPoolClientId: core.userPoolClient.id,
      userPoolClientSecret: core.userPoolClient.clientSecret,
      webCrawlerStateMachineArn: core.webCrawler.stateMachine.arn,
      visionModelType: clientConfig.visionModelType ?? defaults.visionModelType,
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
        bedrockAccount: clientConfig.bedrockAccount,
        clientName: props.clientName,
        outputsBucket: core.outputsBucket.bucket,
        region: clientConfig.region,
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycombBackendKey,
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
            txt: 'text/plain',
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
        GROUPS: core.cognitoGroups.groups,
        REGION: clientConfig.region,
        ROLE_ARN: core.defaultWebIdentityRoleArn,
        Q_APPLICATION_ID: core.qBusinessApplicationId,
        Q_INDEX_ID: core.qBusinessIndexId,
        Q_RETRIEVER_ID: core.qBusinessRetrieverId,
        API_ENDPOINT: '/api',
        CLIENT_NAME: props.clientName,
        OUTPUTS_BUCKET_NAME: core.outputsBucket.bucket.bucket,
        HONEYCOMB_KEY: honeycombFrontendKey, // We're going to send data directly to honeycomb for now. Move to a collector later.
        DATA_BUCKET: core.dataBucket.bucket.bucket,
        PROVISION_Q_RESOURCES: clientConfig.provisionQResources ?? false,
        PREFERRED_KNOWLEDGE_BASE: clientConfig.preferredKnowledgeBase ?? 'q',
        BEDROCK_KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        BEDROCK_ACCOUNT: clientConfig.bedrockAccount,
        CHAT_AGENT_URL: chatAgentWs.websocketUrl,
        NUMA_CHAT_AGENTS: clientConfig.numaChatAgents ?? true,
      }),
      contentType: 'application/json',
    });

    const manifest = new S3Object(this, 'manifest-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'manifest.json',
      content: JSON.stringify({ apps: apps.map((app) => app.manifest) }),
      contentType: 'application/json',
    });

    // When building in a container, we don't have access to the git repo, so need to pass through the values as environment variables.
    const gitHash = process.env['GIT_HASH'] ?? execSync('git rev-parse --short HEAD').toString().trim();
    const gitBranch = process.env['GIT_BRANCH'] ?? execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
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

    if (clientConfig.budget) {
      new BudgetAlertForwarderConstruct(this, 'budget-alerts', {
        clientName: props.clientName,
        clientAccountId: clientConfig.clientAccountId,
        logGroup: core.logGroup,
        budget: clientConfig.budget,
        centralTopicArn: 'arn:aws:sns:us-east-1:207567759910:NumaBudgetAlerts',
      });
    }

    if (clientConfig.allowBedrockQuotaSharing) {
      const quotaSharingRole = new IamRole(this, 'quota-sharing-role', {
        name: 'bedrock-quota-sharing',
        assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'quota-sharing-assume-role-policy-statement', {
          statement: [
            {
              actions: ['sts:AssumeRole'],
              principals: [
                {
                  type: 'AWS',
                  identifiers: ['*'],
                },
              ],
              effect: 'Allow',
              condition: [
                {
                  test: 'StringLike',
                  values: [arcanumOrgId, nextGenOrgId],
                  variable: 'aws:PrincipalOrgId',
                },
              ],
            },
          ],
        }).json,
      });
      const quotaSharingPolicy = new IamPolicy(this, 'quoting-sharing-policy', {
        name: 'bedrock-quota-sharing',
        policy: new DataAwsIamPolicyDocument(this, 'quota-sharing-policy-statement', {
          statement: [
            {
              actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
              resources: [
                'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
                'arn:aws:bedrock:*::foundation-model/us.anthropic.claude-*',
                'arn:aws:bedrock:*::foundation-model/apac.anthropic.claude-*',
                'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
                'arn:aws:bedrock:*::foundation-model/us.amazon.nova-*',
                'arn:aws:bedrock:*::foundation-model/apac.amazon.nova-*',
                'arn:aws:bedrock:*:*:inference-profile/anthropic.claude-*',
                'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*',
                'arn:aws:bedrock:*:*:inference-profile/apac.anthropic.claude-*',
                'arn:aws:bedrock:*:*:inference-profile/amazon.nova-*',
                'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-*',
                'arn:aws:bedrock:*:*:inference-profile/apac.amazon.nova-*',
              ],
              effect: 'Allow',
            },
          ],
        }).json,
      });
      new IamRolePolicyAttachmentsExclusive(this, 'quota-sharing-attachment', {
        roleName: quotaSharingRole.name,
        policyArns: [quotaSharingPolicy.arn],
      });
    }
  }
}

export const clientConfigSchema = coreNumaInfraPropsSchema
  .omit({
    environmentName: true,
  })
  .merge(
    z
      .object({
        /**
         * AWS region to deploy resources to.
         * This is the primary region for all resources except those that must be in specific regions.
         */
        region: z.string(),
        customDomain: z.string().optional(),
        /**
         * Whether this is a development instance that should include dev-only apps
         *
         * @default false
         */
        devInstance: z.boolean().optional(),
        /**
         * Region to use for QBusiness resources.
         * Currently QBusiness is only available in us-east-1, but will be available in other regions in the future.
         *
         * @default 'us-east-1'
         */
        qBusinessRegion: z.string().optional(),
        /**
         * Whether to deploy all apps to to the environment.
         *
         * @default false
         */
        allApps: z.boolean().optional(),
        /**
         * Whether to deploy all production apps to to the environment.
         *
         * @default false
         */
        allProdApps: z.boolean().optional(),
        /**
         * Object of apps and configs to deploy to the environment.
         *
         * @default {}
         */
        apps: z.record(userConfigurableBaseNumaAppPropsSchema).optional(),

        /**
         * Budget configuration for cost monitoring
         */
        budget: budgetConfigSchema.optional(),

        /**
         * Whether to provision Q Business resources for this client
         *
         * @default false
         */
        provisionQResources: z.boolean().optional(),

        /**
         * Preferred knowledge base to use for document retrieval
         *
         * @default 'q' if provisionQResources is true, else 'bedrock'
         */
        preferredKnowledgeBase: z.enum(['q', 'bedrock']).optional(),

        /**
         * Model to use for document embedding in knowledge base
         *
         * @default 'amazon.titan-embed-text-v2:0'
         */
        embeddingModel: z.string().optional(),

        /**
         * Bedrock model to use for document parsing in knowledge base
         *
         * @default 'amazon.nova-lite-v1:0'
         */
        bedrockParserModel: z.string().optional(),
        /**
         * Vision model type for content extraction
         *
         * @default 'haiku'
         */
        visionModelType: z.enum(['haiku', 'nova-pro']).optional(),

        // Generic email configuration that can be used by any app
        senderEmail: z.string().optional(),
        receiverEmails: z.array(z.string()).optional(),
        bedrockAccount: z.string().optional(),

        /**
         * Whether to enable the new agent-based chat functionality
         *
         * @default true
         */
        numaChatAgents: z.boolean().optional(),

        /** Whether to provision the bedrock-quota-sharing role.
         *
         * NOTE: Due to needing a predictable name, this can only be enabled on one environment per account.
         *
         * @default false
         */
        allowBedrockQuotaSharing: z.boolean().optional().default(false),
      })
      .strict(),
  );
export type ClientConfig = z.infer<typeof clientConfigSchema>;

export interface NumaClientStackProps {
  clientName: string;
  environmentName: EnvironmentName;
  domainSuffix: string;
  hostedZone: string;
  arcanumNumaAccount: string;
  clientConfig: ClientConfig;
}

export interface AppDefinition {
  app: BaseNumaAppType;
  isProdApp: boolean;
}

export const appLibrary: Record<string, AppDefinition> = {
  'beyond-expectations': { app: BeyondExpectations, isProdApp: false },
  'candidate-screening': { app: CandidateScreening, isProdApp: true },
  'company-profile': { app: CompanyProfile, isProdApp: true },
  'contract-analysis': { app: ContractAnalysis, isProdApp: true },
  'council-recourse-consents': { app: CouncilResourceConsents, isProdApp: false },
  'costing-calculator': { app: CostingCalculator, isProdApp: false },
  'document-summariser': { app: DocumentSummariser, isProdApp: true },
  'financial-analysis': { app: FinancialAnalysis, isProdApp: true },
  'gdsr-assessment': { app: GdsrAssessment, isProdApp: false },
  'infringement-review': { app: InfringementReview, isProdApp: false },
  'tor-assessment': { app: TorAssessment, isProdApp: false },
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
