import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn, S3Backend, TerraformOutput, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppAgnosticApiGatewayLambdaCollection } from '../constructs/app-agnostic-api-gateway-lambda-collection';
import { BudgetAlertForwarderConstruct, budgetConfigSchema } from '../constructs/budget-alert-forwarder-construct';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  BaseNumaAppType,
  NumaAppManifest,
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
import { StructuredDataQueryApp } from '../constructs/apps/structured-data-query-construct';
import { RfpResponseComparison } from '../constructs/apps/rfp-response-comparison-construct';
import { CoreNumaInfra, coreNumaInfraPropsSchema } from '../constructs/core-numa-infra-construct';
import { InvalidateCloudfront } from '../constructs/invalidate-cloudfront-construct';
import { NumaFrontendInfra } from '../constructs/numa-frontend-infra-construct';
import { NumaChatAgent } from '../constructs/numa-chat-agent-construct';
import { NumaKbManager } from '../constructs/numa-kb-manager-construct';
import { SharedChatConstruct } from '../constructs/shared-chat-construct';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';
import { E2ETestNumaApp } from '../constructs/apps/e2e-test-numa-app-construct';
import { v4 as uuidv4 } from 'uuid';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { z } from 'zod';
import { KnowledgeBase } from '../constructs/knowledge-base-construct';
import { S3VectorsKnowledgeBase } from '../constructs/s3-vectors-knowledge-base-construct';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { NumaLambda } from '../constructs/numa-lambda';
import { OAuthIntegrationConstruct } from '../constructs/oauth-integration-construct';
import { OpsConstruct } from '../constructs/ops-construct';
import { SearchConstruct } from '../constructs/search-construct';
import { RacetechDataFeedConstruct } from '../constructs/racetech-data-feed-construct';
import { VaultSecretsConstruct } from '../constructs/vault-secrets-construct';
import { DisasterRecoveryConstruct } from '../constructs/disaster-recovery-construct';
import { NumaVoiceConstruct } from '../constructs/numa-voice-construct';
import { V2AppsConstruct } from '../constructs/v2-apps-construct';
import { WorkspaceChatAgentConstruct } from '../constructs/workspace-chat-agent-construct';
import { WorkspaceChatAgentProxy } from '../constructs/workspace-chat-agent-proxy-construct';
import { PublicDemoProxy } from '../constructs/public-demo-proxy-construct';
import { WorkspaceChatToolsConstruct } from '../constructs/workspace-chat-tools-construct';
import { NullProvider } from '@cdktf/provider-null/lib/provider';
import { awsNameWithHashedPrefix } from '../constructs/aws-name-utils';
import { CAPABILITIES_METADATA } from '../capabilities-metadata';

const arcanumOrgId = 'o-g8veu85jva';
const nextGenOrgId = 'o-apdsu3c1a7';

// Dedicated account for secure Pipedream proxy operations
const PIPEDREAM_PROXY_ACCOUNT_ID = '965745962688';

// Numa Standard Model relay (deployer-account streaming egress). ONE relay
// serves every client, reached at its Lambda Function URL. Unlike the Pipedream
// proxy ARN above, a Function URL is AWS-generated and can't be derived — so set
// this ONCE after the relay's first deploy (the `numa-standard-model-relay-
// function-url` TerraformOutput). It's injected into the workspace container as
// an env var only when workspaceChatModelSelection is on (see the construct call
// below) — a global value gated by a per-client flag, never per-client config,
// exactly like PIPEDREAM_PROXY_ACCOUNT_ID. Empty → standard-model path stays inert.
const NUMA_STANDARD_MODEL_RELAY_URL: string = 'https://4b65jot6l6ogoif6n7f4siadqa0lyngv.lambda-url.us-east-1.on.aws/';

export class NumaClientStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    const defaults = {
      domainSuffix: props.domainSuffix,
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      bedrockParserModel: 'amazon.nova-lite-v1:0',
      visionModelType: 'nova-pro',
      provisionQResources: false,
    };
    const domainName = props.clientConfig.customDomain ?? `${props.clientName}.${defaults.domainSuffix}`;
    const emailDomain = props.clientConfig.emailDomain ?? domainName;
    const preferredKnowledgeBase =
      (props.clientConfig.provisionQResources ?? defaults.provisionQResources) ? 'q' : 'bedrock';
    const clientConfig = {
      clientName: props.clientName,
      domainName,
      preferredKnowledgeBase,
      ...defaults,
      ...props.clientConfig,
    };

    if (
      clientConfig.preferredKnowledgeBase !== 'none' &&
      !clientConfig.provisionQResources &&
      clientConfig.preferredKnowledgeBase === 'q'
    ) {
      throw new Error('Nonsense detected: Q cannot be preferred knowledgebase when resources are not provisioned.');
    }

    const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    const clientRole = `arn:aws:iam::${clientConfig.clientAccountId}:role/ArcanumAIAccess`;
    // Centralized email sender Lambda in the deployer account (fixed name)
    const emailSenderLambdaArn = `arn:aws:lambda:us-east-1:${props.arcanumNumaAccount}:function:numa-email-sender`;
    // Numa Voice config write-back Lambda in the deployer account (FEAT-169, fixed name)
    const voiceConfigWriterLambdaArn = `arn:aws:lambda:us-east-1:${props.arcanumNumaAccount}:function:numa-voice-config-writer`;
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
            'aws-apn-id': 'pc:cl23v3vsno0k35czlg7e3ld9p',
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
    // AgentCore provider - needed when client region doesn't support Bedrock AgentCore
    // (e.g., Jakarta ap-southeast-3 uses Sydney ap-southeast-2 for AgentCore)
    const agentCoreRegion = clientConfig.agentCoreRegion ?? clientConfig.region;
    const needsCrossRegionAgentCore = agentCoreRegion !== clientConfig.region;
    const agentCoreProvider = needsCrossRegionAgentCore
      ? new AwsProvider(this, 'agentcore-provider', {
          region: agentCoreRegion,
          assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
          alias: 'agentcore-provider',
          defaultTags: defaultProvider.defaultTags,
        })
      : undefined;

    // QBusiness provider - currently needs to be us-east-1 in most regions
    // When QBusiness becomes available in other regions, this can use the client's region
    const qBusinessRegion = clientConfig.qBusinessRegion ?? clientConfig.region;
    const qBusinessProvider = new AwsProvider(this, 'qbusiness-provider', {
      region: qBusinessRegion,
      assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
      alias: 'qbusiness-provider',
      defaultTags: defaultProvider.defaultTags,
    });

    // Numa Voice provider - Amazon Connect + Transcribe + the call-recordings
    // bucket must live in a Connect/Transcribe region (ap-southeast-2). When the
    // client stack isn't already there, create an alias provider so the voice
    // resources pin to it. Undefined ⇒ the stack is already in-region and voice
    // resources use the default provider. Only created when numaVoice is on.
    const NUMA_VOICE_REGION = 'ap-southeast-2';
    const voiceProvider =
      clientConfig.numaVoice && clientConfig.region !== NUMA_VOICE_REGION
        ? new AwsProvider(this, 'voice-provider', {
            region: NUMA_VOICE_REGION,
            assumeRole: [{ roleArn: deployerRole }, { roleArn: clientRole }],
            alias: 'voice-provider',
            defaultTags: defaultProvider.defaultTags,
          })
        : undefined;

    // Conditionally create either RDS-based or S3 Vectors-based knowledge base
    // When preferredKnowledgeBase is 'none', skip KB creation entirely (e.g. for regions without Bedrock KB support)
    const knowledgeBase =
      clientConfig.preferredKnowledgeBase !== 'none'
        ? ((): S3VectorsKnowledgeBase | KnowledgeBase => {
            const vectorStorageType = clientConfig.vectorStorageType ?? 's3vectors';
            return vectorStorageType === 's3vectors'
              ? new S3VectorsKnowledgeBase(this, 'knowledge-base', {
                  clientName: clientConfig.clientName,
                  region: clientConfig.region,
                  embeddingModel: clientConfig.embeddingModel,
                  bedrockParserModel: clientConfig.bedrockParserModel,
                })
              : new KnowledgeBase(this, 'knowledge-base', {
                  clientName: clientConfig.clientName,
                  region: clientConfig.region,
                  embeddingModel: clientConfig.embeddingModel,
                  bedrockParserModel: clientConfig.bedrockParserModel,
                });
          })()
        : undefined;

    // Include CS Portal origin in data bucket CORS so the Support Docs Manager
    // tool can write support docs into client buckets from the browser.
    const portalOrigin = `https://customer-success-portal.${props.domainSuffix}`;
    const coreAdditionalOrigins = clientConfig.additionalOrigins
      ? [...clientConfig.additionalOrigins, portalOrigin]
      : [portalOrigin];

    const core = new CoreNumaInfra(this, 'numa', {
      ...clientConfig,
      emailDomain,
      numaDropZones: clientConfig.numaDropZones ?? false,
      oauthIntegrationsEnabled: clientConfig.oauthIntegrationsEnabled ?? false,
      additionalOrigins: coreAdditionalOrigins,
      environmentName: props.environmentName,
      qBusinessProvider: qBusinessProvider,
      knowledgeBase: knowledgeBase,
      deployerRoleArn: deployerRole,
      emailSenderLambdaArn,
      // FEAT-167: browser-upload grant for the voice prospect-intake bucket.
      // Name must match NumaVoiceConstruct's intakeBucketName derivation.
      voiceIntakeBucketArn: clientConfig.numaVoice
        ? `arn:aws:s3:::numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}-prospect-intake`
        : undefined,
    });

    // ── Disaster Recovery ────────────────────────────────────────────────────
    let disasterRecovery: DisasterRecoveryConstruct | undefined;
    if (clientConfig.disasterRecovery) {
      const sourceBuckets = [
        { label: 'data', name: core.dataBucket.bucket.bucket, arn: core.dataBucket.bucket.arn },
        ...(core.companyBucket
          ? [{ label: 'company', name: core.companyBucket.bucket.bucket, arn: core.companyBucket.bucket.arn }]
          : []),
        { label: 'outputs', name: core.outputsBucket.bucket.bucket, arn: core.outputsBucket.bucket.arn },
        { label: 'branding', name: core.brandingAssetsBucketName, arn: core.brandingAssetsBucketArn },
        { label: 'config', name: core.configBucket.bucket.bucket, arn: core.configBucket.bucket.arn },
        ...(core.sitemapsBucket
          ? [{ label: 'sitemaps', name: core.sitemapsBucket.bucket.bucket, arn: core.sitemapsBucket.bucket.arn }]
          : []),
        // Note: S3 Vectors buckets are excluded from DR — they use s3vectors:* APIs,
        // not standard S3, so versioning/replication don't apply. Embeddings are
        // regenerable from source documents in the data bucket.
      ];

      // Skip versioning on data bucket if racetech already manages it
      if (clientConfig.racetechDataFeed) {
        const dataBucket = sourceBuckets.find((b) => b.label === 'data');
        if (dataBucket) (dataBucket as { skipVersioning?: boolean }).skipVersioning = true;
      }

      disasterRecovery = new DisasterRecoveryConstruct(this, 'disaster-recovery', {
        clientName: props.clientName,
        environmentName: props.environmentName,
        clientAccountId: clientConfig.clientAccountId,
        region: clientConfig.region,
        sourceBuckets,
        userPoolId: core.userPoolId,
        qBusinessApplicationId: core.qBusinessApplicationId,
      });
    }

    // Frontend + CloudFront
    // Shared CloudFront secret SSM parameter (used by both FE and Chat Agent)
    const cfSecretParam = new SsmParameter(this, 'shared-cloudfront-secret', {
      name: clientConfig.clientName + '_' + 'numa-frontend' + '_cloudfront-secret',
      type: 'String',
      value: uuidv4(),
      lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
      provider: hostedZoneProvider,
    });

    const agentScheduleSecretParam = new SsmParameter(this, 'agent-schedule-runner-secret', {
      name: clientConfig.clientName + '_' + 'agent-schedule-runner-secret',
      type: 'String',
      value: uuidv4(),
      lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
      provider: hostedZoneProvider,
    });

    // HMAC secret the workspace-chat-agent-proxy uses to sign short-lived
    // "service identity" tokens for non-interactive runs (scheduled agents,
    // V2 apps, Nolia) — runs that have no user Cognito token. numa-cli-api
    // verifies these tokens with the same secret. Shared ONLY between the
    // proxy and numa-cli-api; deliberately never injected into the workspace
    // agent container, so the LLM inside a MicroVM has no path to it and
    // cannot forge an identity. See lambdas/node/numa-cli-api/src/shared/auth.ts.
    const cliIdentitySecretParam = new SsmParameter(this, 'numa-cli-identity-secret', {
      name: clientConfig.clientName + '_' + 'numa-cli-identity-secret',
      type: 'String',
      value: uuidv4(),
      lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
      provider: hostedZoneProvider,
    });

    // Chat Agent – HTTP streaming via Lambda Function URL (created first to pass URL into FE)
    const chatAgent = new NumaChatAgent(this, 'chat-agent', {
      clientName: props.clientName,
      region: clientConfig.region,
      chatAgentConfiguration: {
        preferredKnowledgeBase: clientConfig.preferredKnowledgeBase as 'q' | 'bedrock' | 'none',
        qApplicationId: core.qBusinessApplicationId,
        qRetrieverId: core.qBusinessRetrieverId,
        qIndexId: core.qBusinessIndexId,
        bedrockKnowledgeBaseId: knowledgeBase?.knowledgeBaseId,
      },
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      chatHistoryTableName: core.chatHistoryTable.name,
      knowledgeBasesTableName: core.knowledgeBasesTable.name,
      outputsBucketArn: core.outputsBucket.bucket.arn,
      outputsBucketName: core.outputsBucket.bucket.bucket,
      dataBucketArn: core.dataBucket.bucket.arn,
      workspaceAgentsTableName: core.workspaceAgentsTable.name,
      userAgentsTableName: core.userAgentsTable.name,
      agentsSettingsTableName: core.agentsSettingsTable.name,
      pipedreamIntegrationsEnabled: clientConfig.pipedreamIntegrations,
      pipedreamProxyLambdaArn: clientConfig.pipedreamIntegrations
        ? `arn:aws:lambda:us-east-1:${PIPEDREAM_PROXY_ACCOUNT_ID}:function:pipedream-proxy`
        : undefined,
      mcpPolicyTableName: core.mcpPolicyTable?.name,
      globalIntegrationSettingsTableName: `${props.clientName}-global-integration-settings`,
      // Enforce CloudFront secret
      cloudfrontSharedSecret: cfSecretParam.value,
      // Cross-account Bedrock quota sharing
      bedrockAccount: clientConfig.bedrockAccount,
      scheduleRunnerSecret: agentScheduleSecretParam.value,
    });

    // KB management API — handles /api/kb* requests via its own Function URL.
    // Split out of the chat agent so KB CRUD doesn't pay the chat lambda's
    // heavy cold-start cost. Same Cognito + CloudFront auth model.
    const kbManager = new NumaKbManager(this, 'kb-manager', {
      clientName: props.clientName,
      region: clientConfig.region,
      knowledgeBaseConfiguration: {
        preferredKnowledgeBase: clientConfig.preferredKnowledgeBase as 'q' | 'bedrock' | 'none',
        qApplicationId: core.qBusinessApplicationId,
        qIndexId: core.qBusinessIndexId,
        bedrockKnowledgeBaseId: knowledgeBase?.knowledgeBaseId,
      },
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      knowledgeBasesTableName: core.knowledgeBasesTable.name,
      dataBucketArn: core.dataBucket.bucket.arn,
      cloudfrontSharedSecret: cfSecretParam.value,
      crawlUrlsTableName: core.webCrawler.crawlUrlsTable.name,
    });

    // Shared Document Q&A - public API for sharing documents with Nova 2 Lite
    // Compute the expected extract-content Lambda ARN (created later in coreApis)
    const sharedChatExtractLambdaName = awsNameWithHashedPrefix(props.clientName, '_extract-content', 64);
    const sharedChatExtractLambdaArn = `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${sharedChatExtractLambdaName}`;

    const sharedChat = new SharedChatConstruct(this, 'shared-chat', {
      clientName: props.clientName,
      region: clientConfig.region,
      sharedTableName: core.sharedTable.name,
      sharedTableArn: core.sharedTable.arn,
      sharedChatHistoryTableName: core.sharedChatHistoryTable.name,
      sharedChatHistoryTableArn: core.sharedChatHistoryTable.arn,
      logGroup: core.logGroup,
      userPoolId: core.userPoolId,
      userPoolClientId: core.userPoolClient.id,
      extractionLambdaArn: sharedChatExtractLambdaArn,
      outputsBucketArn: core.outputsBucket.bucket.arn,
      outputsBucketName: core.outputsBucket.bucket.bucket,
      dataBucketArn: core.dataBucket.bucket.arn,
      bedrockKnowledgeBaseId: knowledgeBase?.knowledgeBaseId,
    });

    // Numa Workspace Chat Agent (AgentCore runtime + proxy Lambda, routed through main CloudFront)
    // Created before frontend so we can pass proxy URL for CloudFront routing
    let workspaceChatAgent: WorkspaceChatAgentConstruct | undefined;
    let workspaceChatAgentProxy: WorkspaceChatAgentProxy | undefined;
    let workspaceChatTools: WorkspaceChatToolsConstruct | undefined;
    if (clientConfig.numaWorkspaceChat) {
      // Null provider is required for the NullResource used in skopeo image push
      new NullProvider(this, 'null-provider', {});

      // Shared log group for all workspace chat logs (agent + tools)
      // This enables unified debugging across the workspace chat system
      const workspaceChatLogGroup = new CloudwatchLogGroup(this, 'workspace-chat-log-group', {
        name: `/numa/${props.clientName}/workspace-chat-agent`,
      });

      // Compute the expected extract-content lambda name (created later in coreApis)
      // This follows the naming convention in AppAgnosticApiGatewayLambdaCollection
      const extractContentLambdaName = awsNameWithHashedPrefix(props.clientName, '_extract-content', 64);
      const extractContentLambdaArn = `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${extractContentLambdaName}`;

      // Compute the expected document-converter lambda name (created later in coreApis)
      const documentConverterLambdaName = awsNameWithHashedPrefix(props.clientName, '_document-converter', 64);
      const documentConverterLambdaArn = `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${documentConverterLambdaName}`;

      // Compute the expected oauth-workspace-tools Lambda name (created later in OAuth construct)
      const oauthWorkspaceToolsLambdaName = awsNameWithHashedPrefix(props.clientName, '_oauth_workspace_tools', 64);
      const oauthWorkspaceToolsLambdaArn = `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${oauthWorkspaceToolsLambdaName}`;

      // Compute the expected ops Lambda names (created later in OpsConstruct, conditional on numaOps)
      const opsApiLambdaArn = clientConfig.numaOps
        ? `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${awsNameWithHashedPrefix(props.clientName, '_ops-api', 64)}`
        : undefined;
      const opsConfigApiLambdaArn = clientConfig.numaOps
        ? `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${awsNameWithHashedPrefix(props.clientName, '_ops-config-api', 64)}`
        : undefined;
      const opsCrmApiLambdaArn = clientConfig.numaOps
        ? `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${awsNameWithHashedPrefix(props.clientName, '_ops-crm-api', 64)}`
        : undefined;

      // numa-cli-api Lambda ARN — always created in AppAgnosticApiGatewayLambdaCollection
      // (the `numa` CLI is the agent's entire tool layer). Computed here so the
      // workspace agent role can be granted invoke permission at construct time.
      const numaCliApiLambdaArn = `arn:aws:lambda:${clientConfig.region}:${clientConfig.clientAccountId}:function:${awsNameWithHashedPrefix(props.clientName, '_numa-cli-api', 64)}`;

      // Shared secret for file redirect HMAC tokens (used by both tools and proxy Lambdas)
      const fileRedirectSecret = new SsmParameter(this, 'file-redirect-secret', {
        name: `${props.clientName}_workspace-chat_file-redirect-secret`,
        type: 'String',
        value: uuidv4(),
        lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
      });

      // ffmpeg Lambda layer for audio/video transcription (parallel pipeline).
      // Custom layer built from static ffmpeg binaries (johnvansickle.com), published
      // to q-demo (905418183804) with public access. Provides /opt/bin/ffmpeg and /opt/bin/ffprobe.
      // To add a new region: run `AWS_PROFILE=q-demo ./tools/publish-ffmpeg-layer.sh <region>`
      // and add the output ARN here.
      const ffmpegLayerByRegion: Record<string, string> = {
        'us-east-1': 'arn:aws:lambda:us-east-1:905418183804:layer:ffmpeg-static:1',
        'ap-southeast-2': 'arn:aws:lambda:ap-southeast-2:905418183804:layer:ffmpeg-static:1',
        'ap-southeast-3': 'arn:aws:lambda:ap-southeast-3:207567759910:layer:ffmpeg-static:1',
      };
      const ffmpegLayerArn = ffmpegLayerByRegion[clientConfig.region];

      // Create the workspace chat tools Lambda (provides KB queries etc. for workspace chat agent)
      workspaceChatTools = new WorkspaceChatToolsConstruct(this, 'workspace-chat-tools', {
        clientName: props.clientName,
        region: clientConfig.region,
        logGroup: workspaceChatLogGroup,
        preferredKnowledgeBase: (clientConfig.preferredKnowledgeBase as 'q' | 'bedrock' | 'none') ?? 'bedrock',
        bedrockKnowledgeBaseId: knowledgeBase?.knowledgeBaseId,
        qApplicationId: core.qBusinessApplicationId,
        qRetrieverId: core.qBusinessRetrieverId,
        // Data bucket for KB file downloads/uploads
        dataBucketArn: core.dataBucket.bucket.arn,
        dataBucketName: core.dataBucket.bucket.bucket,
        // Cognito User Pool for admin group checks on KB uploads
        userPoolId: core.userPoolId,
        userPoolArn: `arn:aws:cognito-idp:${clientConfig.region}:${clientConfig.clientAccountId}:userpool/${core.userPoolId}`,
        // Outputs bucket for workspace files (extract_content tool)
        outputsBucketArn: core.outputsBucket.bucket.arn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        // Extract content Lambda for file extraction (ARN computed, Lambda created later in coreApis)
        extractContentLambdaArn: extractContentLambdaArn,
        // Document converter Lambda for markdown to PDF/DOCX conversion
        documentConverterLambdaArn: documentConverterLambdaArn,
        // Pipedream integrations (optional, only if enabled)
        integrationsApprovalTableName: core.integrationsApprovalTable?.name,
        integrationsApprovalTableArn: core.integrationsApprovalTable?.arn,
        pipedreamRelayLambdaArn: core.pipedreamRelayLambdaArn,
        emailSenderLambdaArn,
        // Chat settings table (for user profile memory management)
        chatSettingsTableName: core.chatSettingsTable.name,
        chatSettingsTableArn: core.chatSettingsTable.arn,
        // File redirect for integration uploads (clean URLs to avoid Slack filename length issues)
        fileRedirectSecret: fileRedirectSecret.value,
        fileRedirectBaseUrl: `https://${domainName}/api/workspace-chat-agent`,
        // Vault audit log — name wires the env var so chat-driven Pipedream
        // and vault-MCP tool calls can write `ai_access` rows; arn grants the
        // IAM PutItem permission. Without the arn the write silently logs
        // AccessDenied and chat usage never appears in My Secrets > Activity
        // (TASK-146 follow-up — was removed in an earlier refactor).
        vaultAuditLogTableName: core.vaultAuditLogTable.name,
        vaultAuditLogTableArn: core.vaultAuditLogTable.arn,
        // Numa Ops Lambda ARNs (conditional on numaOps flag)
        opsApiLambdaArn,
        opsConfigApiLambdaArn,
        opsCrmApiLambdaArn,
        // ffmpeg layer for parallel audio/video transcription
        ffmpegLayerArn,
        // Crawl-page Lambda for web search fetch_url (JS rendering via Playwright)
        browserLambdaArn: core.webCrawler.browserLambda.arn,
        browserLambdaName: core.webCrawler.browserLambda.functionName,
      });

      // Create the AgentCore runtime
      workspaceChatAgent = new WorkspaceChatAgentConstruct(this, 'workspace-chat-agent', {
        clientName: props.clientName,
        region: clientConfig.region,
        deployerRoleArn: deployerRole,
        cognitoUserPoolId: core.userPoolId,
        cognitoUserPoolClientId: core.userPoolClient.id,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        // Workspace chat tools Lambda for KB queries etc.
        workspaceToolsLambdaName: workspaceChatTools.lambdaName,
        workspaceToolsLambdaArn: workspaceChatTools.lambdaArn,
        // Shared log group for unified workspace chat logging
        containerLogGroup: workspaceChatLogGroup,
        // Cross-account Bedrock access for global inference profiles (Claude 4.5 models)
        bedrockAccount: clientConfig.bedrockAccount,
        // Integrations approval table (for writing approval decisions from the service)
        integrationsApprovalTableName: core.integrationsApprovalTable?.name,
        integrationsApprovalTableArn: core.integrationsApprovalTable?.arn,
        // Chat settings table (for reading user approval mode preferences)
        chatSettingsTableName: core.chatSettingsTable.name,
        chatSettingsTableArn: core.chatSettingsTable.arn,
        // Company bucket (for loading company profile into system prompt)
        companyBucketName: core.companyBucket?.bucket.bucket,
        companyBucketArn: core.companyBucket?.bucket.arn,
        // Cross-region AgentCore support (when client region doesn't support AgentCore)
        agentCoreProvider,
        agentCoreRegion,
        // OAuth workspace tools Lambda for unified connect tools (OAuth, Synergy, S3 data bucket)
        oauthWorkspaceToolsLambdaName: oauthWorkspaceToolsLambdaName,
        oauthWorkspaceToolsLambdaArn: oauthWorkspaceToolsLambdaArn,
        // Data bucket for downloading attached files (My Files / Company Files)
        dataBucketName: core.dataBucket.bucket.bucket,
        dataBucketArn: core.dataBucket.bucket.arn,
        // Ext API doc bucket for syncing API reference documentation to workspace
        extApiDocBucketName: core.extApiDocBucket.bucket.bucket,
        extApiDocBucketArn: core.extApiDocBucket.bucket.arn,
        extractContentLambdaArn: extractContentLambdaArn,
        // Document converter Lambda for DOCX/Office → PDF conversion
        // (used by Nolia funding pre-extraction and MD→PDF/DOCX output rendering)
        documentConverterLambdaArn: documentConverterLambdaArn,
        // Numa Ops feature flag
        numaOpsEnabled: clientConfig.numaOps,
        // Frontend URL for constructing links (e.g. ticket URLs in chat)
        frontendUrl: `https://${domainName}`,
        // Global vs regional Bedrock inference profile selection.
        // Defaults to true (global, no 10% CRI premium); set false for
        // customers whose parent-org SCPs deny the `global.*` route.
        useGlobalInferenceProfile: clientConfig.useGlobalInferenceProfile,
        // Live credit metering (Numa Credit System / SPK-015) — intentionally ON for ALL clients so
        // usage data accrues fleet-wide (cheap, client-side, invisible). The admin VIEW is gated
        // separately by the SHOW_CREDITS flag; metering itself is not gated.
        creditDebitLambdaName: core.creditDebitLambda.lambda.functionName,
        creditDebitLambdaArn: core.creditDebitLambda.lambda.arn,
        creditMeteringEnabled: true,
        // numa-cli-api Lambda — workspace IAM role gets InvokeFunction so
        // the @numa/cli binary in the MicroVM can call the dispatcher.
        // Always set (numa-cli-api is always deployed).
        numaCliApiLambdaArn,
        // Centralized email sender — V2 app run-completion emails (FEAT-174)
        emailSenderLambdaArn,
        // Numa Standard Model (opaque cheap model) — the relay URL is a single
        // global constant (one relay serves all clients), injected as an env var
        // only when the model-selection flag is on. Same shape as the Pipedream
        // proxy ARN above: a global value gated by a per-client flag, never
        // per-client config. visionModelId falls back to the construct default
        // (Haiku 4.5), so it isn't wired here.
        numaStandardModelRelayUrl: clientConfig.workspaceChatModelSelection ? NUMA_STANDARD_MODEL_RELAY_URL : undefined,
      });

      // Create the proxy Lambda that bridges CloudFront to AgentCore SDK
      // AgentCore has no public HTTP endpoint, so we need this proxy
      workspaceChatAgentProxy = new WorkspaceChatAgentProxy(this, 'workspace-chat-agent-proxy', {
        clientName: props.clientName,
        region: clientConfig.region,
        agentRuntimeArn: workspaceChatAgent.agentRuntimeArn,
        cloudfrontSharedSecret: cfSecretParam.value,
        // Cognito config for JWT verification (prevents token forgery via direct Lambda URL calls)
        cognitoUserPoolId: core.userPoolId,
        cognitoClientId: core.userPoolClient.id,
        additionalCognitoClientIds: clientConfig.additionalCognitoClientIds,
        // Integrations approval table (proxy handles approve actions directly to avoid container deadlock)
        integrationsApprovalTableName: core.integrationsApprovalTable?.name,
        integrationsApprovalTableArn: core.integrationsApprovalTable?.arn,
        // File redirect for integration uploads (clean URLs to avoid Slack filename length issues)
        fileRedirectSecret: fileRedirectSecret.value,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        // Schedule runner secret so the proxy can authenticate server-to-server calls
        // from the agent-schedule-runner Lambda (scheduled agents use V2 sync mode)
        scheduleRunnerSecret: agentScheduleSecretParam.value,
        // HMAC secret the proxy signs service-identity tokens with for
        // non-interactive runs; numa-cli-api verifies them with the same secret.
        cliIdentitySecret: cliIdentitySecretParam.value,
        // Workspace chat tools Lambda for document conversion preview (DOCX → PDF)
        workspaceToolsLambdaArn: workspaceChatTools.lambdaArn,
        workspaceToolsLambdaName: workspaceChatTools.lambdaName,
        // Cross-region AgentCore support (when client region doesn't support AgentCore)
        agentCoreRegion,
      });

      new TerraformOutput(this, 'workspace-chat-agent-proxy-url', {
        value: workspaceChatAgentProxy.functionUrl,
        description: 'Workspace Chat Agent Proxy Lambda Function URL (routed through main CloudFront)',
      });

      new TerraformOutput(this, 'workspace-chat-agent-runtime-arn', {
        value: workspaceChatAgent.agentRuntimeArn,
        description: 'Workspace Chat Agent AgentCore Runtime ARN',
      });
    }

    // Public demo proxy — lightweight, unauthenticated chat proxy for demos.
    // Requires workspace chat to be enabled (reuses the same AgentCore runtime).
    let publicDemoProxy: PublicDemoProxy | undefined;
    if (clientConfig.publicDemo && clientConfig.numaWorkspaceChat && workspaceChatAgent) {
      publicDemoProxy = new PublicDemoProxy(this, 'public-demo-proxy', {
        clientName: props.clientName,
        region: clientConfig.region,
        agentRuntimeArn: workspaceChatAgent.agentRuntimeArn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        dailyLimitUsd: clientConfig.publicDemoDailyLimitUsd,
        countersTableName: core.usageAnalyticsCountersTable.name,
        countersTableArn: core.usageAnalyticsCountersTable.arn,
        workspaceToolsLambdaArn: workspaceChatTools?.lambdaArn,
        workspaceToolsLambdaName: workspaceChatTools?.lambdaName,
        agentCoreRegion,
      });
    }

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
      knowledgeBase,
      chatAgentFunctionUrl: chatAgent.functionUrl,
      kbManagerFunctionUrl: kbManager.functionUrl,
      cloudfrontSecretParam: cfSecretParam,
      // Workspace chat agent proxy Lambda Function URL is routed through main CloudFront
      // (AgentCore has no public HTTP endpoint, so we use a proxy Lambda)
      workspaceChatAgentProxyUrl: workspaceChatAgentProxy?.functionUrl,
      // Shared document Q&A Lambda Function URL for public sharing feature
      sharedChatFunctionUrl: sharedChat.functionUrl,
      // Public demo proxy Lambda Function URL (unlisted, no auth, Haiku 4.5 only)
      publicDemoProxyUrl: publicDemoProxy?.functionUrl,
    });

    // Resources can't start with a number, so prefix with an underscore if required.
    const safeConstructId = props.clientName.replace(/^(?=[^a-zA-Z_])/, '_');
    const coreApis = new AppAgnosticApiGatewayLambdaCollection(this, safeConstructId + '-core', {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      bedrockAccount: clientConfig.bedrockAccount,
      chatHistoryTableName: core.chatHistoryTable.name,
      clientName: props.clientName,
      dataBucketName: core.dataBucket.bucket.bucket,
      dataBucketArn: core.dataBucket.bucket.arn,
      logGroup: core.logGroup,
      region: clientConfig.region,
      userPoolClientId: core.userPoolClient.id,
      userPoolClientSecret: core.userPoolClient.clientSecret,
      webCrawlerStateMachineArn: core.webCrawler.stateMachine.arn,
      webCrawlerTableArn: core.webCrawler.crawlUrlsTable.arn,
      webCrawlerTableName: core.webCrawler.crawlUrlsTable.name,
      visionModelType: clientConfig.visionModelType ?? defaults.visionModelType,
      // Branding API (disabled until lambda and finalized table wiring are added)
      brandingProviderEnabled: true,
      brandingTableName: core.brandingTable.name,
      brandingAssetsPrefix: core.brandingAssetsPrefix,
      brandingAssetsBucketName: core.brandingAssetsBucketName,
      brandingAssetsBucketArn: core.brandingAssetsBucketArn,
      outputsBucketArn: core.outputsBucket.bucket.arn,
      outputsBucketName: core.outputsBucket.bucket.bucket,
      workspaceAgentsTableName: core.workspaceAgentsTable.name,
      userAgentsTableName: core.userAgentsTable.name,
      agentsSettingsTableName: core.agentsSettingsTable.name,
      agentUserPrefsTableName: core.agentUserPrefsTable.name,
      agentTeamsTableName: core.agentTeamsTable.name,
      agentTeamMembersTableName: core.agentTeamMembersTable.name,
      agentSharingTableName: core.agentSharingTable.name,
      schedulingSettingsTableName: core.schedulingSettingsTable.name,
      perClientSchedulingMinIntervalMinutes:
        clientConfig.schedulingMinIntervalMinutes ?? props.globalSchedulingMinIntervalMinutes,
      globalSchedulingMinIntervalMinutes: props.globalSchedulingMinIntervalMinutes,
      scheduleQuotas: {
        // Per-client (Level 2) overrides take precedence over the global
        // platform-settings (Level 1) values. Platform-settings is the sole
        // source of truth for unset Level 2 fields — there is no code-side
        // fallback. Lambdas throw on missing fields at runtime.
        maxRunsPerCompanyPerMonth:
          clientConfig.maxRunsPerCompanyPerMonth ?? props.globalScheduleQuotas?.maxRunsPerCompanyPerMonth,
        maxRunsPerUserPerMonth:
          clientConfig.maxRunsPerUserPerMonth ?? props.globalScheduleQuotas?.maxRunsPerUserPerMonth,
        maxTriggerRunsPerCompanyPerMonth:
          clientConfig.maxTriggerRunsPerCompanyPerMonth ?? props.globalScheduleQuotas?.maxTriggerRunsPerCompanyPerMonth,
        maxTriggerRunsPerUserPerMonth:
          clientConfig.maxTriggerRunsPerUserPerMonth ?? props.globalScheduleQuotas?.maxTriggerRunsPerUserPerMonth,
        maxConcurrentActiveSchedulesPerCompany:
          clientConfig.maxConcurrentActiveSchedulesPerCompany ??
          props.globalScheduleQuotas?.maxConcurrentActiveSchedulesPerCompany,
        maxConcurrentActiveSchedulesPerUser:
          clientConfig.maxConcurrentActiveSchedulesPerUser ??
          props.globalScheduleQuotas?.maxConcurrentActiveSchedulesPerUser,
        requireApprovalAboveUserCap:
          clientConfig.requireApprovalAboveUserCap ?? props.globalScheduleQuotas?.requireApprovalAboveUserCap,
      },
      mfaSettingsTableName: core.mfaSettingsTable.name,
      userPoolId: core.userPoolId,
      additionalCognitoClientIds: clientConfig.additionalCognitoClientIds,
      // Verifies proxy-minted service tokens for non-interactive numa CLI calls.
      cliIdentitySecret: cliIdentitySecretParam.value,
      chatSettingsTableName: core.chatSettingsTable.name,
      dataConnectorsTableName: core.dataConnectorsTable.name,
      dataConnectorsSettingsTableName: core.dataConnectorsSettingsTable.name,
      extApiDocBucketName: core.extApiDocBucket.bucket.bucket,
      extApiDocBucketArn: core.extApiDocBucket.bucket.arn,
      capabilitiesTableName: core.capabilitiesTable.name,
      creditLedgerTableName: core.creditLedgerTable.name,
      dataConnectorsSyncConfigsTableName: core.dataConnectorsSyncConfigsTable.name,
      // Admin-side gate. When false, the unified integrations catalog skips
      // every native row so users never see them; when true, admins can
      // manage native connectors and they surface alongside Pipedream.
      dataConnectorsEnabled: clientConfig.dataConnectorsEnabled ?? false,
      // Forwarded to scheduled runs as featureFlags on the workspace-agent
      // request body, so the SDK config registers the `connectors` MCP and
      // `vault` MCP in unattended runs. Without these the schedule runner
      // can't use native connectors at all (the MCP server isn't registered).
      // Vault MCP is gated on the `DATA_CONNECTORS_ENABLED` flag forwarded
      // from `app-agnostic-api-gateway-lambda-collection` (TASK-146).
      oauthIntegrationsEnabled: clientConfig.oauthIntegrationsEnabled ?? false,
      connectorEventsTableName: core.connectorEventsTable.name,
      connectorEventConfigsTableName: core.connectorEventConfigsTable.name,
      connectorEventBusName: core.connectorEventBusName,
      agentSchedulesTableName: core.agentSchedulesTable.name,
      notificationsTableName: core.notificationsTable.name,
      chatAgentFunctionUrl: chatAgent.functionUrl,
      workspaceAgentProxyUrl: workspaceChatAgentProxy?.functionUrl ?? '',
      cloudfrontSharedSecret: cfSecretParam.value,
      agentScheduleRunnerSecret: agentScheduleSecretParam.value,
      bedrockKbId: knowledgeBase?.knowledgeBaseId,
      bedrockDataSourceId: knowledgeBase?.dataSourceId,
      usageAnalyticsEventsTableName: core.usageAnalyticsEventsTable.name,
      usageAnalyticsEventsTableArn: core.usageAnalyticsEventsTable.arn,
      usageAnalyticsKeysTableName: core.usageAnalyticsKeysTable.name,
      usageAnalyticsKeysTableArn: core.usageAnalyticsKeysTable.arn,
      usageAnalyticsCountersTableName: core.usageAnalyticsCountersTable.name,
      usageAnalyticsCountersTableArn: core.usageAnalyticsCountersTable.arn,
      domainName,
      auditWebCrawlerTableName: core.auditWebCrawlerTable.name,
      auditWebCrawlerTableArn: core.auditWebCrawlerTable.arn,
      auditAutomationTableName: core.auditAutomationTable.name,
      auditAutomationTableArn: core.auditAutomationTable.arn,
      auditSearchIndexTableName: core.auditSearchIndexTable.name,
      auditSearchIndexTableArn: core.auditSearchIndexTable.arn,
      auditKbIndexTableName: core.auditKbIndexTable.name,
      auditKbIndexTableArn: core.auditKbIndexTable.arn,
      auditScheduleTableName: core.auditScheduleTable.name,
      auditScheduleTableArn: core.auditScheduleTable.arn,
      auditSyncTableName: core.auditSyncTable.name,
      auditSyncTableArn: core.auditSyncTable.arn,
      auditRecoveryTableName: core.auditRecoveryTable.name,
      auditRecoveryTableArn: core.auditRecoveryTable.arn,
      auditUserManagementTableName: core.auditUserManagementTable.name,
      auditUserManagementTableArn: core.auditUserManagementTable.arn,
      emailSenderLambdaArn,
      cognitoUserPoolId: core.userPoolId,
      cognitoUserPoolArn: `arn:aws:cognito-idp:${clientConfig.region}:${clientConfig.clientAccountId}:userpool/${core.userPoolId}`,
      recoveryBucketName: disasterRecovery?.recoveryBucketName,
      recoveryBucketArn: disasterRecovery?.recoveryBucketArn,
      pipedreamRelayLambdaArn: core.pipedreamRelayLambdaArn,
      // Numa CLI API — backend for the `numa` CLI binary (/numa-cli/).
      // Numa Ops entitlement — forwarded to numa-cli-api as NUMA_OPS_ENABLED so
      // it can hard-gate `ops_*` CLI tool calls server-side (the old MCP-
      // registration gate is gone now the CLI has broad `Bash(numa:*)`). Same
      // flag source the workspace agent construct uses (line ~542).
      numaOpsEnabled: clientConfig.numaOps,
      // numa-cli-api reads `company-data.json` from the company bucket for
      // bootstrap's `company_profile` field. Optional — not every stack
      // provisions the company bucket.
      companyBucketName: core.companyBucket?.bucket.bucket,
      companyBucketArn: core.companyBucket?.bucket.arn,
      // Phase 2 centralised approval orchestrator — DDB create + poll.
      integrationsApprovalTableName: core.integrationsApprovalTable?.name,
      integrationsApprovalTableArn: core.integrationsApprovalTable?.arn,
    });

    // Numa Ops (work management, kanban boards, CRM, supplier management)
    if (clientConfig.numaOps) {
      new OpsConstruct(this, safeConstructId + '-ops', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        environmentName: props.environmentName,
        region: clientConfig.region,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        userPoolId: core.userPoolId,
        userPoolArn: `arn:aws:cognito-idp:${clientConfig.region}:${clientConfig.clientAccountId}:userpool/${core.userPoolId}`,
        chatSettingsTableName: core.chatSettingsTable.name,
        chatSettingsTableArn: core.chatSettingsTable.arn,
        emailSenderLambdaArn,
      });
    }

    // Numa Voice (Amazon Connect outbound calling + AI call intelligence for SDRs).
    // Single gated construct: when numaVoice is false this `new` never runs, so ZERO
    // voice resources (recordings bucket, voice-processor Lambda, Transcribe IAM,
    // EventBridge, Connect, routes) enter the synthesized Terraform — the same
    // own-everything-in-one-construct pattern as OpsConstruct above.
    if (clientConfig.numaVoice) {
      new NumaVoiceConstruct(this, safeConstructId + '-voice', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        environmentName: props.environmentName,
        region: clientConfig.region,
        // Connect + Transcribe + recordings are PINNED to ap-southeast-2
        // (NUMA_VOICE_REGION) regardless of the client's primary region — the
        // region-mismatch guard above handles cross-region clients via voiceProvider.
        // Changing this region is a deliberate, support-assisted operation.
        voiceRegion: NUMA_VOICE_REGION,
        voiceProvider,
        clientAccountId: clientConfig.clientAccountId,
        // Resolved tenant origin (custom domain or standard subdomain) — drives the
        // Connect Approved Origin + intake-bucket upload CORS so custom-domain
        // tenants aren't locked out.
        frontendOrigin: `https://${domainName}`,
        connectInstanceUrl: clientConfig.connectInstanceUrl,
        // FEAT-169 config write-back relay (deployer account, fixed name).
        voiceConfigWriterLambdaArn,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        dataBucketName: core.dataBucket.bucket.bucket,
        // Connector-events bus (client region) the processor fires the Post-Call agent on.
        connectorEventBusName: core.connectorEventBusName,
        // Client-region tables/pool the seed Lambda writes to (system-user-owned).
        agentsTableName: core.workspaceAgentsTable.name,
        agentsTableArn: core.workspaceAgentsTable.arn,
        schedulesTableName: core.agentSchedulesTable.name,
        schedulesTableArn: core.agentSchedulesTable.arn,
        userPoolId: core.userPoolId,
        userPoolArn: `arn:aws:cognito-idp:${clientConfig.region}:${clientConfig.clientAccountId}:userpool/${core.userPoolId}`,
        // Single source of truth for the system-user email (the seed's AdminGetUser).
        systemUserEmail: core.systemUserCreator.username,
        // Morning Call List Preparer scheduler fires the runner (client region).
        runnerArn: coreApis.agentScheduleRunnerLambda.arn,
        connectAutoProvision: clientConfig.connectAutoProvision,
        connectClaimDid: clientConfig.connectClaimDid,
        // FEAT-164: per-client morning call-prep run time (defaults inside the construct).
        callPrepTime: clientConfig.voiceCallPrepTime,
        callPrepTimezone: clientConfig.voiceCallPrepTimezone,
        // FEAT-168: realtime Contact Lens for the live-assist sidebar (off by default).
        liveAssist: clientConfig.voiceLiveAssist,
        // Seed (AdminGetUser) must run after the system user is created.
        systemUserDependsOn: core.systemUserCreator.dependsOn,
      });
    }

    // Site-wide search (DynamoDB index + GET /api/search query Lambda)
    if (clientConfig.siteWideSearch) {
      new SearchConstruct(this, safeConstructId + '-search', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        environmentName: props.environmentName,
      });
    }

    // Racetech external data feed (Glenn's daily SQLite upload via presigned URL)
    if (clientConfig.racetechDataFeed) {
      new RacetechDataFeedConstruct(this, safeConstructId + '-racetech-data-feed', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        dataBucketName: core.dataBucket.bucket.bucket,
        dataBucketArn: core.dataBucket.bucket.arn,
      });
    }

    // Vault Secrets (encrypted secrets management via AWS Secrets Manager).
    // Tied to the data-connectors flag — native connectors are the primary
    // producer of vault secrets (TASK-146).
    if (clientConfig.dataConnectorsEnabled) {
      new VaultSecretsConstruct(this, safeConstructId + '-vault', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        region: clientConfig.region,
        vaultAuditLogTableName: core.vaultAuditLogTable.name,
        vaultAuditLogTableArn: core.vaultAuditLogTable.arn,
      });
    }

    // OAuth cloud storage integration (Google Drive, OneDrive, Dropbox)
    // Also deploys the workspace tools Lambda for unified connect access
    // (OAuth, Synergy, S3 data bucket, generic HTTP)
    new OAuthIntegrationConstruct(this, safeConstructId + '-oauth', {
      apiGatewayAuthorizerId: fe.authorizer.id,
      apiGatewayId: fe.apiGateway.id,
      clientName: props.clientName,
      region: clientConfig.region,
      frontendBaseUrl: `https://${domainName}`,
      oauthProviders: clientConfig.oauthProviders ?? {},
      // Data connectors table (for Synergy credential resolution)
      dataConnectorsTableName: core.dataConnectorsTable.name,
      dataConnectorsTableArn: core.dataConnectorsTable.arn,
      // Global connector settings table (for Pub/Sub topic lookup)
      dataConnectorsSettingsTableName: core.dataConnectorsSettingsTable.name,
      dataConnectorsSettingsTableArn: core.dataConnectorsSettingsTable.arn,
      // Data bucket (for S3 data bucket connector)
      dataBucketName: core.dataBucket.bucket.bucket,
      dataBucketArn: core.dataBucket.bucket.arn,
      // Outputs bucket (stage large connector downloads as presigned URLs)
      outputsBucketName: core.outputsBucket.bucket.bucket,
      outputsBucketArn: core.outputsBucket.bucket.arn,
      // Vault audit log — the construct treats this as required (it builds
      // an IAM resource ARN from it), but it was never being passed. The
      // policy was being rendered as `table/undefined`, so the lambda had
      // no permission to write to the real audit table and chat OAuth
      // fetches silently failed audit (TASK-146 follow-up).
      vaultAuditLogTableName: core.vaultAuditLogTable.name,
    });

    // V2 Apps (workspace-agent-based apps: data analysis, quoting, etc.)
    // Requires workspace chat to be enabled since apps run on the workspace agent
    if (workspaceChatAgentProxy) {
      new V2AppsConstruct(this, safeConstructId + '-v2-apps', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        environmentName: props.environmentName,
        region: clientConfig.region,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        outputsBucketName: core.outputsBucket.bucket.bucket,
        workspaceProxyFunctionArn: workspaceChatAgentProxy.functionArn,
        workspaceProxyFunctionName: workspaceChatAgentProxy.functionName,
      });
    }

    const appConfigsToDeploy = getAppConfigsToDeploy(
      appLibrary,
      clientConfig.apps ?? {},
      clientConfig.allApps ?? false,
      clientConfig.allProdApps ?? false,
      clientConfig.devInstance ?? false
    );
    // Collect V2-migrated apps that should appear in the manifest.
    // These come from explicit client config OR allApps/allProdApps flags.
    const v2MigratedAppIds = new Set<string>();
    for (const [id] of appConfigsToDeploy) {
      if (id in V2_MIGRATED_APPS) v2MigratedAppIds.add(id);
    }
    if (clientConfig.allApps || clientConfig.allProdApps) {
      for (const [id, meta] of Object.entries(V2_MIGRATED_APPS)) {
        if (clientConfig.allApps || meta.isProdApp) v2MigratedAppIds.add(id);
      }
    }
    // Filter V2-migrated apps out of V1 deployment (they don't need infra)
    const v1AppConfigs = appConfigsToDeploy.filter(([id]) => !(id in V2_MIGRATED_APPS));

    const apps = v1AppConfigs.map(([configuredAppId, appConfig]) => {
      const app = lookupAppFromId(configuredAppId);
      return new app(this, `${safeConstructId}-${configuredAppId}`, {
        ...appConfig,
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        bedrockAccount: clientConfig.bedrockAccount,
        clientName: props.clientName,
        dataBucket: core.dataBucket.bucket,
        outputsBucket: core.outputsBucket.bucket,
        region: clientConfig.region,
        sharedExtractContentLambdaArn: coreApis.extractContentLambda.arn,
      });
    });
    const folderPath = path.join(import.meta.dirname, '..', 'build', 'numa-frontend');
    const excludedFiles = ['config.json', 'manifest.json', 'capabilities.json'];
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
          const key = path.relative(folderPath, source);
          const shouldBypassCache = key === 'index.html' || key.startsWith('locales/');
          return new S3Object(this, `website-file-${source}`, {
            bucket: fe.frontendBucket.bucket,
            contentType,
            key,
            source,
            sourceHash: Fn.filemd5(source),
            cacheControl: shouldBypassCache ? 'no-cache, no-store, must-revalidate' : undefined,
          });
        });
    } catch {
      console.warn('No frontend code found at: ' + folderPath);
    }

    const gitHash = process.env['GIT_HASH'] ?? execSync('git rev-parse --short HEAD').toString().trim();
    const gitBranch = process.env['GIT_BRANCH'] ?? execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const versionLabel = process.env['VERSION_LABEL'] ?? process.env['NUMA_VERSION_LABEL'];
    const deployTime = new Date();
    const siteVersion = `${gitHash}-${deployTime.getTime()}`;

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
        BRANDING_PROVIDER_ENABLED: clientConfig.brandingProviderEnabled ?? false,
        BRANDING_ASSETS_BUCKET: core.brandingAssetsBucketName,
        BRANDING_ASSETS_PREFIX: core.brandingAssetsPrefix,
        CLIENT_NAME: props.clientName,
        OUTPUTS_BUCKET_NAME: core.outputsBucket.bucket.bucket,
        DATA_BUCKET: core.dataBucket.bucket.bucket,
        PROVISION_Q_RESOURCES: clientConfig.provisionQResources ?? false,
        PREFERRED_KNOWLEDGE_BASE: clientConfig.preferredKnowledgeBase ?? 'bedrock',
        BEDROCK_KNOWLEDGE_BASE_ID: knowledgeBase?.knowledgeBaseId ?? '',
        BEDROCK_ACCOUNT: clientConfig.bedrockAccount,
        PIPEDREAM_RELAY_LAMBDA_ARN: core.pipedreamRelayLambdaArn ?? undefined,
        PIPEDREAM_INTEGRATIONS: clientConfig.pipedreamIntegrations ?? false,
        // Credit metering runs for ALL clients; SHOW_CREDITS only gates the in-app admin view.
        // Emitted explicitly (default false) because getFlag() treats an absent key as true.
        SHOW_CREDITS: clientConfig.showCredits ?? false,
        // Parent flags
        DATA_CONNECTORS_ENABLED: clientConfig.dataConnectorsEnabled ?? false,
        // Synergy 12d file-interface parity (rich metadata columns, in-job
        // file search, per-file actions). Sub-capability of data connectors;
        // off by default so it ships dark until a client opts in.
        SYNERGY_FILE_PARITY: clientConfig.synergyFileParity ?? false,
        AGENTS: clientConfig.agents ?? false,
        NUMA_WORKSPACE_CHAT: clientConfig.numaWorkspaceChat ?? true,
        SCHEDULING: clientConfig.scheduling ?? false,
        // Sub-flag of SCHEDULING gating the event-trigger surface (the "When
        // something happens" wizard tile, the admin trigger audit panel, and
        // the per-client trigger quota fields in the CSP). Defaults false —
        // clients must opt in explicitly. Cron schedules work whenever
        // SCHEDULING is on, regardless of EVENT_TRIGGERS.
        EVENT_TRIGGERS: clientConfig.eventTriggers ?? false,
        SCHEDULING_MIN_INTERVAL_MINUTES: clientConfig.schedulingMinIntervalMinutes ?? null,
        GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES: props.globalSchedulingMinIntervalMinutes ?? null,
        KNOWLEDGE_BASES: true,
        DEVELOPER_MODE: clientConfig.developerMode ?? false,
        NUMA_OPS: clientConfig.numaOps ?? false,
        SITE_WIDE_SEARCH: clientConfig.siteWideSearch ?? false,
        MFA_ENABLED: clientConfig.mfa ?? false,
        NUMA_DROP_ZONES: clientConfig.numaDropZones ?? false,
        NUMA_SHARING: clientConfig.numaSharing ?? false,
        WORKSPACE_CHAT_MODEL_SELECTION:
          (clientConfig.numaWorkspaceChat ?? false) ? (clientConfig.workspaceChatModelSelection ?? false) : false,
        CHAT_SUGGESTIONS: (clientConfig.numaWorkspaceChat ?? false) ? (clientConfig.chatSuggestions ?? true) : false,
        OAUTH_AVAILABLE: true, // Always available - infrastructure always deployed, admin flags control UI access only
        OAUTH_INTEGRATIONS_ENABLED: clientConfig.oauthIntegrationsEnabled ?? false, // Controls UI access to OAuth setup
        // Per-provider flags removed — providers are now configured dynamically via COMPANY vault secrets.
        // OAUTH_GOOGLE_DRIVE, OAUTH_ONEDRIVE, OAUTH_DROPBOX are no longer needed in config.json.
        RACETECH_DATA_FEED: clientConfig.racetechDataFeed ?? false,
        DISASTER_RECOVERY: clientConfig.disasterRecovery ?? false,
        // Numa Voice (Amazon Connect + AI call intelligence). Emitted explicitly
        // so getFlag('NUMA_VOICE') does NOT default-true on older deployments.
        NUMA_VOICE: clientConfig.numaVoice ?? false,
        // Voice Analytics ships with Voice (admin can toggle it off via the
        // Capabilities tab). Tied to numaVoice to avoid a new client-config key
        // (which would need adding to both the infra + CSP config schemas).
        VOICE_ANALYTICS: clientConfig.numaVoice ?? false,
        // When autoProvision creates the instance, derive its access URL from the
        // deterministic instance alias (numa-{client}{envSuffix}, matching the
        // construct) so the softphone is wired in ONE deploy — no manual
        // connectInstanceUrl, no second deploy. An explicit connectInstanceUrl
        // (a manually-created Connect instance) still takes precedence.
        CONNECT_INSTANCE_URL:
          clientConfig.connectInstanceUrl ??
          (clientConfig.connectAutoProvision
            ? // The instance lives on the modern *.my.connect.aws domain; the legacy
              // *.awsapps.com host does NOT resolve for instances created via CreateInstance.
              `https://numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}.my.connect.aws`
            : ''),
        // Connect/Transcribe always live in NUMA_VOICE_REGION regardless of the
        // client's primary region — emit it so the FE CCP hook doesn't rely on
        // its hardcoded fallback.
        CONNECT_REGION: NUMA_VOICE_REGION,
        // FEAT-168: live-assist (realtime transcript keyword matching). Emitted
        // explicitly so the FE's hidden-by-default check (sessionStorage ===
        // 'true') stays false on older deployments.
        VOICE_LIVE_ASSIST: clientConfig.voiceLiveAssist ?? false,
        // FEAT-167: prospect-spreadsheet intake bucket (client region) — the FE
        // uploads .xlsx here; its S3 notification fires the ingest agent. Name
        // must match NumaVoiceConstruct's intakeBucketName derivation.
        VOICE_INTAKE_BUCKET: clientConfig.numaVoice
          ? `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}-prospect-intake`
          : '',
        V2_APPS: clientConfig.v2Apps ?? false,
        NUMA_APPS: clientConfig.allApps ?? false,
        JOB_HISTORY: (clientConfig.allApps ?? false) ? (clientConfig.jobHistory ?? true) : false,
        // Direct Lambda Function URL for workspace chat agent (bypasses CloudFront buffering for streaming)
        WORKSPACE_CHAT_AGENT_FUNCTION_URL: workspaceChatAgentProxy?.functionUrl,
        PUBLIC_DEMO: clientConfig.publicDemo ?? false,
        PUBLIC_DEMO_PROXY_URL: publicDemoProxy?.functionUrl ?? '',
        SSO_ENABLED: clientConfig.ssoEnabled ?? true,
        SSO_ENTERPRISE: clientConfig.ssoEnterprise ?? false,
        NUMA_VERSION: siteVersion,
      }),
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });

    // Capabilities metadata — display info for the admin Capabilities tab.
    // Generated from the shared constant so the frontend gets nice names,
    // descriptions, and icons instead of raw flag names.
    new S3Object(this, 'capabilities-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'capabilities.json',
      content: JSON.stringify(CAPABILITIES_METADATA),
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });

    // Build manifest entries for V2-migrated apps (no infra, manifest only)
    const v2ManifestEntries: NumaAppManifest[] = [...v2MigratedAppIds].map((id) => {
      const meta = V2_MIGRATED_APPS[id];
      return {
        id,
        appName: meta.appName,
        appDescription: meta.description,
        type: AppType.NUMA,
        status: AppStatus.ACTIVE,
        category: meta.category,
        createdDate: new Date().toISOString().split('T')[0],
        tasks: [],
        typicalDurationMinutes: 5,
      };
    });

    const manifest = new S3Object(this, 'manifest-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'manifest.json',
      content: JSON.stringify({ apps: [...apps.map((app) => app.manifest), ...v2ManifestEntries] }),
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });

    // When building in a container, we don't have access to the git repo, so need to pass through the values as environment variables.
    const version = new S3Object(this, 'version-file', {
      bucket: fe.frontendBucket.bucket,
      key: 'version.json',
      content: JSON.stringify(
        {
          version: siteVersion,
          gitHash,
          gitBranch,
          deployTime: deployTime.getTime(),
          deployTimeHuman: deployTime.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
          displayVersion: versionLabel ?? undefined,
        },
        undefined,
        2
      ),
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });

    new InvalidateCloudfront(this, 'invalidate', {
      clientName: props.clientName,
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
      // Use a Lambda to idempotently create/retrieve the quota-sharing IAM resources
      // This handles the case where multiple stacks in the same account enable quota sharing
      const iamManagerPolicyStatements = [
        {
          actions: [
            'iam:GetRole',
            'iam:CreateRole',
            'iam:GetPolicy',
            'iam:CreatePolicy',
            'iam:GetPolicyVersion',
            'iam:ListPolicyVersions',
            'iam:DeletePolicyVersion',
            'iam:CreatePolicyVersion',
            'iam:ListAttachedRolePolicies',
            'iam:AttachRolePolicy',
          ],
          effect: 'Allow',
          resources: ['arn:aws:iam::*:role/bedrock-quota-sharing', 'arn:aws:iam::*:policy/bedrock-quota-sharing'],
        },
        {
          actions: ['sts:GetCallerIdentity'],
          effect: 'Allow',
          resources: ['*'],
        },
      ];

      const iamQuotaSharingManager = new NumaLambda(this, 'iam-quota-sharing-manager', {
        additionalPolicyStatements: iamManagerPolicyStatements,
        clientName: clientConfig.clientName,
        lambdaDirectory: 'python/iam-quota-sharing-manager/',
        logGroup: core.logGroup,
        resourceNameSuffix: '_iam-quota-sharing-manager',
        timeout: 60,
      });

      // Prepare the input for the Lambda
      const assumeRolePolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: '*' },
            Action: 'sts:AssumeRole',
            Condition: {
              StringLike: {
                'aws:PrincipalOrgId': [arcanumOrgId, nextGenOrgId],
              },
            },
          },
        ],
      };

      const policyDocument = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            Resource: [
              'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
              'arn:aws:bedrock:*::foundation-model/us.anthropic.claude-*',
              'arn:aws:bedrock:*::foundation-model/au.anthropic.claude-*',
              'arn:aws:bedrock:*::foundation-model/apac.anthropic.claude-*',
              'arn:aws:bedrock:*::foundation-model/global.anthropic.claude-*',
              'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
              'arn:aws:bedrock:*::foundation-model/us.amazon.nova-*',
              'arn:aws:bedrock:*::foundation-model/apac.amazon.nova-*',
              'arn:aws:bedrock:*::foundation-model/global.amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/au.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/apac.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/apac.amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-*',
            ],
          },
          {
            Effect: 'Allow',
            Action: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
            Resource: ['*'],
          },
        ],
      };

      const iamManagerInvocation = new LambdaInvocation(this, 'iam-quota-sharing-manager-invocation', {
        functionName: iamQuotaSharingManager.lambda.functionName,
        input: JSON.stringify({
          assume_role_policy: assumeRolePolicy,
          policy_document: policyDocument,
        }),
        triggers: {
          sourceHash: iamQuotaSharingManager.lambda.sourceCodeHash,
          policyHash: JSON.stringify(policyDocument),
        },
        dependsOn: [
          iamQuotaSharingManager.lambda,
          ...iamQuotaSharingManager.additionalPolicies,
          ...iamQuotaSharingManager.policyAttachments,
        ],
      });

      new TerraformOutput(this, 'quota-sharing-result', {
        value: iamManagerInvocation.result,
        description: 'IAM quota sharing manager result',
      });
    }

    // ── Sync ext-api-doc files to S3 (at END to avoid resource address shifts) ──
    // ext-api-doc/ holds the per-connector knowledge packs the workspace agent loads at
    // runtime. It is a repo-root sibling of infra/ and MUST be present in EVERY deploy
    // context — host `make deploy` AND the CI/portal deploy container (see
    // infra/container/Dockerfile, which must `COPY ext-api-doc ext-api-doc`). When the
    // dir was missing inside the container this block silently no-op'd and Terraform
    // pruned every client's docs — the "docs deploy inconsistently" bug. Fail loudly
    // instead so that gap can never ship unnoticed again.
    const extApiDocPath = path.join(import.meta.dirname, '..', '..', 'ext-api-doc');
    if (!fs.existsSync(extApiDocPath)) {
      throw new Error(
        `ext-api-doc directory not found at ${extApiDocPath}. It must be present in the deploy ` +
          'context for both `make deploy` (host) and the CI/portal deploy image — check that ' +
          'infra/container/Dockerfile copies it (`COPY ext-api-doc ext-api-doc`).'
      );
    }
    const mdFiles = fs
      .readdirSync(extApiDocPath, { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.'))
      .map((f) => path.join(f.parentPath, f.name))
      // _templates/ is dev-only reference material; do not ship to client stacks.
      // It also produces construct IDs starting with `-` after sanitization, which
      // throws inside the loop and used to be silently swallowed by a try/catch.
      .filter((source) => path.relative(extApiDocPath, source).split(path.sep)[0] !== '_templates')
      // Deterministic order across platforms (readdir order is filesystem-dependent),
      // for stable synth diffs.
      .sort();

    // The existsSync guard above catches a MISSING dir, but a PRESENT-but-partial dir
    // would synth too few S3Objects and let Terraform prune the client's bucket
    // silently. Fail loudly here too so a partially-packaged deploy (e.g. a sparse or
    // interrupted host checkout — which never builds the Dockerfile, so its build-time
    // check can't catch it) can never empty docs. Floor MUST match the Dockerfile
    // assertion in infra/container/Dockerfile (real corpus is ~254 .md across ~30
    // connectors); bump both together if the corpus ever shrinks.
    const MIN_EXT_API_DOC_FILES = 50;
    if (mdFiles.length < MIN_EXT_API_DOC_FILES) {
      throw new Error(
        `ext-api-doc directory at ${extApiDocPath} has only ${mdFiles.length} shippable files ` +
          `(expected >= ${MIN_EXT_API_DOC_FILES}, after excluding _templates/ and dotfiles). Refusing to ` +
          "deploy: a short sync would let Terraform prune this client's ext-api-doc bucket. Verify the deploy " +
          'context shipped the full docs corpus.'
      );
    }

    for (const source of mdFiles) {
      const key = path.relative(extApiDocPath, source);
      new S3Object(this, `ext-api-doc-${key.replace(/[^a-zA-Z0-9]/g, '-')}`, {
        bucket: core.extApiDocBucket.bucket.bucket,
        key,
        source,
        sourceHash: Fn.filemd5(source),
        contentType: 'text/markdown',
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
         * Override domain used in Cognito emails (welcome, password reset links).
         * Defaults to the computed domainName if not set.
         */
        emailDomain: z.string().optional(),
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
        apps: z.record(z.string(), userConfigurableBaseNumaAppPropsSchema).optional(),

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
        preferredKnowledgeBase: z.enum(['q', 'bedrock', 'none']).optional(),

        /**
         * Vector storage type for Bedrock knowledge base
         *
         * - 's3vectors': Amazon S3 Vectors (default, 90% cost reduction)
         * - 'rds': Aurora PostgreSQL with pgvector (production-ready alternative)
         *
         * Note: S3 Vectors is in preview and only available in us-east-1, us-east-2,
         * us-west-2, eu-central-1, ap-southeast-2
         *
         * @default 's3vectors'
         */
        vectorStorageType: z.enum(['rds', 's3vectors']).optional().default('s3vectors'),

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

        /**
         * Whether to enable Pipedream integrations functionality
         *
         * @default false
         */
        pipedreamIntegrations: z.boolean().optional().default(false),
        /**
         * Whether to show the in-app Credits admin view (Settings -> Credits).
         * Credit metering runs for ALL clients regardless — this only gates UI visibility.
         *
         * @default false
         */
        showCredits: z.boolean().optional().default(false),
        /**
         * Central pricing config for the Numa Credit System (SPK-015). Authored in the Customer
         * Success Portal ("Numa Credits" page) and pushed into the client's credit-ledger CONFIG
         * row; the client never authors it. Omitted -> lib/credit-pricing defaults apply.
         */
        creditConfig: z
          .object({
            creditUsd: z.number().positive().optional(),
            margin: z.number().min(1).optional(),
            agentcoreMult: z.number().min(1).optional(),
            trivialConsumptionUsd: z.number().min(0).optional(),
            valueTiers: z.record(z.string(), z.record(z.string(), z.number())).optional(),
            marginsByTier: z.record(z.string(), z.number()).optional(),
            monthlyAllocations: z.array(z.number().min(0)).optional(),
          })
          .optional(),
        /**
         * Whether to show branding UI and attempt runtime fetch on the FE
         * (Backend still enforces runtime owner switch via numa-client-config)
         *
         * @default false
         */
        brandingProviderEnabled: z.boolean().optional(),

        /**
         * Whether to enable OpenAPI documentation server
         *
         * @default false
         */
        enableOpenApiDocs: z.boolean().optional(),

        /**
         * CloudWatch log group for OpenAPI docs (internal use)
         */
        logGroup: z.any().optional(),

        /**
         * Whether to provision the Numa Workspace Chat Agent (AgentCore runtime).
         * This provides a persistent workspace with Claude Code CLI for complex tasks.
         *
         * @default true
         */
        numaWorkspaceChat: z.boolean().optional().default(true),

        /**
         * Region to deploy AgentCore workspace chat resources to (ECR, AgentCore runtime, vendedlogs).
         * Required when the client region doesn't support Bedrock AgentCore.
         * Defaults to the client's own region.
         */
        agentCoreRegion: z.string().optional(),

        /**
         * Whether to route Sonnet/Opus 4.5+ traffic via the `global.*` Bedrock
         * inference profile (true) vs the regional `us.*`/`au.*`/`apac.*`
         * profiles (false). Global avoids the 10% per-token CRI premium AWS
         * charges on regional profiles. Set false for customers whose
         * parent-org SCPs deny the `global.*` route (e.g. Suez).
         *
         * @default true
         */
        useGlobalInferenceProfile: z.boolean().optional().default(true),

        /**
         * Whether to enable Data Connectors functionality in the frontend.
         *
         * @default false
         */
        dataConnectorsEnabled: z.boolean().optional().default(false),

        /**
         * Whether to enable Agent Scheduling and Notifications features.
         *
         * @default false
         */
        scheduling: z.boolean().optional().default(false),

        /**
         * Sub-flag of `scheduling`. Gates the event-trigger surface: the
         * "When something happens" tile in the Automations wizard, the admin
         * Settings > Scheduling > Triggers tab, the trigger audit panel, and
         * the per-client trigger quota fields in the CSP. Defaults to `false` —
         * clients must explicitly opt in. Cron schedules remain functional
         * regardless. Has no effect when `scheduling: false`. Independent of
         * `pipedreamIntegrations` (which gates Pipedream-backed sources
         * within the trigger picker).
         *
         * Existing clients on `scheduling: true` at the time this flag landed
         * were backfilled to `eventTriggers: true` via
         * `tools/backfill-triggers-flag.ts` so the default flip didn't
         * silently disable them.
         *
         * @default false
         */
        eventTriggers: z.boolean().optional().default(false),

        /**
         * Per-client minimum scheduling interval override (minutes).
         * When set, users in this client account cannot schedule agents more
         * frequently than this value. Overrides the global default.
         * Leave unset to inherit the global default (or platform fallback of 5 min).
         *
         * @minimum 5
         */
        schedulingMinIntervalMinutes: z.number().int().min(5).optional(),

        /**
         * Per-client cap on total scheduled runs per month across the tenant.
         * Hard ceiling — schedules that would push the tenant over this are
         * rejected at creation. Falls back to the platform-settings record
         * (Level 1, in numa-client-config) when unset.
         */
        maxRunsPerCompanyPerMonth: z.number().int().min(0).optional(),

        /**
         * Per-client cap on scheduled runs per user per month. Above this,
         * schedules go to admin approval if `requireApprovalAboveUserCap`
         * is true (or are hard-rejected if not).
         */
        maxRunsPerUserPerMonth: z.number().int().min(0).optional(),

        /**
         * Per-client cap on simultaneously active schedules across the whole tenant.
         */
        maxConcurrentActiveSchedulesPerCompany: z.number().int().min(0).optional(),

        /**
         * Per-client cap on simultaneously active schedules per user.
         */
        maxConcurrentActiveSchedulesPerUser: z.number().int().min(0).optional(),

        /**
         * If true, schedules above the user cap are routed to admin approval
         * instead of being hard-rejected. Default true.
         */
        requireApprovalAboveUserCap: z.boolean().optional(),

        /**
         * Per-client cap on event-trigger fires per month across the tenant.
         * Actuals (counted at fire time), not projected.
         */
        maxTriggerRunsPerCompanyPerMonth: z.number().int().min(0).optional(),

        /** Per-client cap on event-trigger fires per user per month. */
        maxTriggerRunsPerUserPerMonth: z.number().int().min(0).optional(),

        /**
         * Whether to enable Drop Zone creation in the Files shared tab.
         *
         * @default false
         */
        numaDropZones: z.boolean().optional().default(false),

        /**
         * Whether to enable Sharing creation (share documents for public Q&A).
         *
         * @default false
         */
        numaSharing: z.boolean().optional().default(false),

        /**
         * Whether to enable developer mode (developer/power-user actions).
         * When enabled, allows file system drill-down, metadata inspection, and debug views.
         *
         * @default false
         */
        developerMode: z.boolean().optional().default(false),

        /**
         * Whether to allow users to select AI models in Chat V2.
         * When false, Sonnet 4.5 is always used.
         *
         * @default false
         */
        workspaceChatModelSelection: z.boolean().optional().default(false),

        /**
         * Whether the suggested-next-message capability is *available* for
         * this client. When true, admins can toggle it on/off per client via
         * the Capabilities tab; when false, the capability is hard-disabled
         * regardless of admin settings.
         *
         * Default true so admins can flip it on for their client without a
         * config change. The capability is OFF by default at the runtime
         * layer (see DEFAULT_DISABLED_FLAGS in adminCapabilityGating.ts) —
         * admins must explicitly enable it via the Capabilities tab.
         *
         * @default true
         */
        chatSuggestions: z.boolean().optional().default(true),

        /**
         * Whether to enable Numa Ops (work management, kanban boards, CRM, supplier management).
         *
         * @default false
         */
        numaOps: z.boolean().optional().default(false),

        /**
         * Whether to enable the Synergy 12d file-interface parity features —
         * rich file metadata columns, in-job file search, and per-file actions
         * (details / version history / copy link) in the Files Remote UI.
         * Sub-capability of data connectors; ships dark by default.
         *
         * Schema-only on this branch: the feature's config.json wiring and
         * frontend gating live on the Synergy parity branch. Declared here so
         * the strict client-config parse tolerates the flag already present on
         * dev-stack configs (e.g. arcanum-demo-tony) without failing synth.
         *
         * @default false
         */
        synergyFileParity: z.boolean().optional().default(false),

        /**
         * Whether to enable site-wide search (DynamoDB search index + /api/search).
         * Foundational only — producers populate the index in follow-up work.
         *
         * @default false
         */
        siteWideSearch: z.boolean().optional().default(false),

        /**
         * Whether to enable the Racetech external data feed upload endpoint.
         * Provisions a presigned S3 PUT URL API for Glenn's daily SQLite upload.
         *
         * @default false
         */
        racetechDataFeed: z.boolean().optional().default(false),

        /**
         * Whether to enable disaster recovery (S3 replication + DynamoDB/Cognito/Secrets exports).
         * Creates a {namespace}-recovery bucket with versioned replicas and scheduled exports every 6 hours.
         *
         * @default false
         */
        disasterRecovery: z.boolean().optional().default(false),

        /**
         * Whether to enable Numa Voice (Amazon Connect outbound calling + AI call
         * intelligence for SDRs). When false, the NumaVoiceConstruct is never
         * instantiated, so ZERO voice resources (recordings bucket, voice-processor
         * Lambda, Transcribe IAM, EventBridge, Connect) are synthesized. Soft-depends
         * on numaOps for the Qualification Promoter's CRM write-back.
         *
         * @default false
         */
        numaVoice: z.boolean().optional().default(false),

        /**
         * Phase 2 (FEAT-169): auto-provision the Amazon Connect instance + call-
         * recording storage config via IaC. OFF by default — Phase 1 uses a
         * manually-created instance (FEAT-158). Only takes effect when numaVoice
         * is also true.
         *
         * @default false
         */
        connectAutoProvision: z.boolean().optional().default(false),
        connectClaimDid: z.boolean().optional().default(false),

        /**
         * Per-tenant Amazon Connect instance URL (e.g. https://<alias>.my.connect.aws).
         * External, non-derivable — surfaced to the frontend CCP widget via config.json
         * (CONNECT_INSTANCE_URL). Phase 1 set manually after the Connect instance is
         * provisioned; Phase 2 (FEAT-169) writes it from the provisioning pipeline.
         */
        connectInstanceUrl: z.string().optional(),

        /**
         * FEAT-169 write-back fields. numa-voice-config-writer (deployer account)
         * persists these from the voice-admin Lambda so the recordings bucket and
         * claimed DID numbers are discoverable in tenant config. They are
         * informational for the stack (the bucket name is always re-derived by
         * convention) but MUST be in the schema — the first write-back would
         * otherwise fail every subsequent deploy with `unrecognized_keys`.
         */
        recordingsBucket: z.string().optional(),
        didNumbers: z.array(z.string()).optional(),

        /**
         * FEAT-164: local time ('HH:MM' 24-hour) + IANA timezone the morning
         * Call List Preparer runs at. Defaults: 07:30 Pacific/Auckland.
         */
        voiceCallPrepTime: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "voiceCallPrepTime must be 'HH:MM' 24-hour")
          .optional(),
        voiceCallPrepTimezone: z.string().optional(),

        /**
         * FEAT-168: real-time Contact Lens on outbound calls feeding the SDR
         * assist sidebar's live keyword matching. Adds per-minute Contact Lens
         * cost — default false (zero cost when off).
         */
        voiceLiveAssist: z.boolean().optional().default(false),

        /**
         * Feature flags from other branches (not yet implemented in this branch)
         * Added to schema for forward compatibility with configs that include them
         */
        knowledgeBases: z.boolean().optional().default(true),
        recordsKBEnabled: z.boolean().optional(),
        oauthProviders: z.record(z.string(), z.any()).optional(), // Object with provider configs
        oauthIntegrationsEnabled: z.boolean().optional(),
        contentSearchEnabled: z.boolean().optional(),
        numaFiles: z.boolean().optional(),
        transcriptionService: z.any().optional(),

        /**
         * Whether to enable V2 Apps (next-generation app framework with agents, workspace, runs).
         *
         * @default false
         */
        v2Apps: z.boolean().optional().default(false),

        /**
         * Enable job history viewer.
         *
         * @default true (when allApps is enabled)
         */
        jobHistory: z.boolean().optional().default(true),

        /**
         * Comma-separated additional Cognito User Pool Client IDs to accept.
         * Used when a whitelabel frontend shares the same User Pool but has its own app client.
         */
        additionalCognitoClientIds: z.string().optional(),

        /**
         * Whether to enable the public demo chat page (unlisted, no auth, Haiku 4.5 only).
         * When enabled, creates a public proxy Lambda + CloudFront route at /demo.
         * Requires numaWorkspaceChat to be enabled.
         *
         * @default false
         */
        publicDemo: z.boolean().optional().default(false),

        /**
         * Daily cost limit (USD) for the public demo chat.
         * Requests are blocked with HTTP 429 once the daily accumulated cost exceeds this.
         *
         * @default 10
         */
        publicDemoDailyLimitUsd: z.number().optional().default(10),

        /**
         * Whether to enable SSO (SAML 2.0) self-service configuration.
         * When true, the SSO admin tab is visible and admins can configure identity providers.
         *
         * @default true
         */
        ssoEnabled: z.boolean().optional().default(true),

        /**
         * Whether to enable enterprise SSO features (group mapping, OIDC, SSO-only, SCIM, user management).
         * Requires ssoEnabled to be true.
         *
         * @default false
         */
        ssoEnterprise: z.boolean().optional().default(false),
      })
      .strict()
  );
export type ClientConfig = z.infer<typeof clientConfigSchema>;

export interface NumaClientStackProps {
  clientName: string;
  environmentName: EnvironmentName;
  domainSuffix: string;
  hostedZone: string;
  arcanumNumaAccount: string;
  clientConfig: ClientConfig;
  /** Global scheduling minimum interval (minutes), read from platform-settings record. */
  globalSchedulingMinIntervalMinutes?: number;
  /**
   * Global scheduled-run quotas (Level 1), read from platform-settings.
   * Per-client overrides on `ClientConfig` take precedence — see numa-client-stack
   * where these flow through to the lambda construct.
   */
  globalScheduleQuotas?: {
    maxRunsPerCompanyPerMonth?: number;
    maxRunsPerUserPerMonth?: number;
    maxTriggerRunsPerCompanyPerMonth?: number;
    maxTriggerRunsPerUserPerMonth?: number;
    maxConcurrentActiveSchedulesPerCompany?: number;
    maxConcurrentActiveSchedulesPerUser?: number;
    requireApprovalAboveUserCap?: boolean;
  };
}

export interface AppDefinition {
  app: BaseNumaAppType;
  isProdApp: boolean;
}

export const appLibrary: Record<string, AppDefinition> = {
  'beyond-expectations': { app: BeyondExpectations, isProdApp: false },
  'candidate-screening': { app: CandidateScreening, isProdApp: true },
  'company-profile': { app: CompanyProfile, isProdApp: false },
  'contract-analysis': { app: ContractAnalysis, isProdApp: true },
  'council-recourse-consents': { app: CouncilResourceConsents, isProdApp: false },
  'costing-calculator': { app: CostingCalculator, isProdApp: false },
  'document-summariser': { app: DocumentSummariser, isProdApp: true },
  'financial-analysis': { app: FinancialAnalysis, isProdApp: true },
  'gdsr-assessment': { app: GdsrAssessment, isProdApp: false },
  'infringement-review': { app: InfringementReview, isProdApp: false },
  'tor-assessment': { app: TorAssessment, isProdApp: false },
  'meeting-analyser': { app: MeetingAnalyser, isProdApp: true },
  'structured-data-query': { app: StructuredDataQueryApp, isProdApp: false },
  'nzsba-policy-builder': { app: NZSBAPolicyBuilder, isProdApp: false },
  'policy-drafter': { app: PolicyDrafter, isProdApp: true },
  'policy-reviewer': { app: PolicyReviewer, isProdApp: true },
  'rfp-response-comparison': { app: RfpResponseComparison, isProdApp: false },
  'procurement-rfp-assessment': { app: ProcurementRfpAssessment, isProdApp: false },
};

// Apps fully migrated to V2 (AgentCore workspace agent). These no longer need V1 infra
// but should still appear in the manifest so the frontend shows them and routes to V2.
// isProdApp mirrors the old appLibrary flag so allProdApps clients still see these.
const V2_MIGRATED_APPS: Record<
  string,
  { appName: string; category: AppCategory; description: string; isProdApp: boolean }
> = {
  'data-analysis': {
    appName: 'Data Analysis',
    category: AppCategory.PRODUCTIVITY,
    description: 'Analyze CSV, Excel, and JSON data files with AI-powered insights and visualizations.',
    isProdApp: true,
  },
  nolia: {
    appName: 'Nolia',
    category: AppCategory.COMPLIANCE,
    description: 'AI-powered procurement compliance review for government agencies.',
    isProdApp: false,
  },
  'policy-designer': {
    appName: 'Policy Designer',
    category: AppCategory.COMPLIANCE,
    description:
      "Generate a complete school governance policy suite from your school's context, based on the NZSBA exemplar.",
    isProdApp: false,
  },
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
  isDevInstance: boolean
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
