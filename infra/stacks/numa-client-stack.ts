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
import { DataAnalysis } from '../constructs/apps/data-analysis-construct';
import { DocumentSummariser } from '../constructs/apps/document-summariser-construct';
import { FinancialAnalysis } from '../constructs/apps/financial-analysis-construct';
import { Nolia } from '../constructs/apps/nolia-construct';
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
import { SharedChatConstruct } from '../constructs/shared-chat-construct';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';
import { E2ETestNumaApp } from '../constructs/apps/e2e-test-numa-app-construct';
import { v4 as uuidv4 } from 'uuid';
import { EnvironmentName } from '@arcanumai/cdktf-util';
import { z } from 'zod';
import { KnowledgeBase } from '../constructs/knowledge-base-construct';
import { S3VectorsKnowledgeBase } from '../constructs/s3-vectors-knowledge-base-construct';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { DataAwsSsmParameter } from '@cdktf/provider-aws/lib/data-aws-ssm-parameter';
import { NumaLambda } from '../constructs/numa-lambda';
import { OAuthIntegrationConstruct } from '../constructs/oauth-integration-construct';
import { OpsConstruct } from '../constructs/ops-construct';
import { TranscriptionServiceConstruct } from '../constructs/transcription-service-construct';
import { VaultSecretsConstruct } from '../constructs/vault-secrets-construct';
import { V2AppsConstruct } from '../constructs/v2-apps-construct';
import { WorkspaceChatAgentConstruct } from '../constructs/workspace-chat-agent-construct';
import { WorkspaceChatAgentProxy } from '../constructs/workspace-chat-agent-proxy-construct';
import { WorkspaceChatToolsConstruct } from '../constructs/workspace-chat-tools-construct';
import { NullProvider } from '@cdktf/provider-null/lib/provider';
import { awsNameWithHashedPrefix } from '../constructs/aws-name-utils';

const arcanumOrgId = 'o-g8veu85jva';
const nextGenOrgId = 'o-apdsu3c1a7';

// Dedicated account for secure Pipedream proxy operations
const PIPEDREAM_PROXY_ACCOUNT_ID = '965745962688';

export class NumaClientStack extends TerraformStack {
  constructor(scope: Construct, name: string, props: NumaClientStackProps) {
    const defaults = {
      domainSuffix: props.domainSuffix,
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      bedrockParserModel: 'amazon.nova-lite-v1:0',
      visionModelType: 'haiku',
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
      secretsVaultEnabled: clientConfig.secretsVaultEnabled ?? false,
      numaDropZones: clientConfig.numaDropZones ?? false,
      oauthIntegrationsEnabled: clientConfig.oauthIntegrationsEnabled ?? false,
      additionalOrigins: coreAdditionalOrigins,
      environmentName: props.environmentName,
      qBusinessProvider: qBusinessProvider,
      knowledgeBase: knowledgeBase,
    });

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
      // Web crawler stats for KB state endpoint
      crawlUrlsTableName: core.webCrawler.crawlUrlsTable.name,
      scheduleRunnerSecret: agentScheduleSecretParam.value,
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

      // Shared secret for file redirect HMAC tokens (used by both tools and proxy Lambdas)
      const fileRedirectSecret = new SsmParameter(this, 'file-redirect-secret', {
        name: `${props.clientName}_workspace-chat_file-redirect-secret`,
        type: 'String',
        value: uuidv4(),
        lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
      });

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
        // Chat settings table (for user profile memory management)
        chatSettingsTableName: core.chatSettingsTable.name,
        chatSettingsTableArn: core.chatSettingsTable.arn,
        // File redirect for integration uploads (clean URLs to avoid Slack filename length issues)
        fileRedirectSecret: fileRedirectSecret.value,
        fileRedirectBaseUrl: `https://${domainName}/api/workspace-chat-agent`,
        // Vault secrets integration removed in favor of usage analytics
        // Numa Ops Lambda ARNs (conditional on numaOps flag)
        opsApiLambdaArn,
        opsConfigApiLambdaArn,
        opsCrmApiLambdaArn,
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
        // Vault secrets feature flag (enables vault system prompt and tools)
        secretsVaultEnabled: clientConfig.secretsVaultEnabled ?? false,
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
        // Extract content Lambda for Nolia PDF vision extraction
        extractContentLambdaArn: extractContentLambdaArn,
        // Numa Ops feature flag
        numaOpsEnabled: clientConfig.numaOps,
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
      cloudfrontSecretParam: cfSecretParam,
      // Workspace chat agent proxy Lambda Function URL is routed through main CloudFront
      // (AgentCore has no public HTTP endpoint, so we use a proxy Lambda)
      workspaceChatAgentProxyUrl: workspaceChatAgentProxy?.functionUrl,
      // Shared document Q&A Lambda Function URL for public sharing feature
      sharedChatFunctionUrl: sharedChat.functionUrl,
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
      mfaSettingsTableName: core.mfaSettingsTable.name,
      chatSettingsTableName: core.chatSettingsTable.name,
      dataConnectorsTableName: core.dataConnectorsTable.name,
      dataConnectorsSettingsTableName: core.dataConnectorsSettingsTable.name,
      capabilitiesTableName: core.capabilitiesTable.name,
      dataConnectorsSyncConfigsTableName: core.dataConnectorsSyncConfigsTable.name,
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
      filesTableName: core.filesTable?.name,
      filesTableArn: core.filesTable?.arn,
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
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycombBackendKey,
          region: clientConfig.region,
        },
      });
    }

    // Vault Secrets (encrypted secrets management via AWS Secrets Manager)
    if (clientConfig.secretsVaultEnabled) {
      new VaultSecretsConstruct(this, safeConstructId + '-vault', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        region: clientConfig.region,
        vaultAuditLogTableName: core.vaultAuditLogTable.name,
        vaultAuditLogTableArn: core.vaultAuditLogTable.arn,
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycombBackendKey,
          region: clientConfig.region,
        },
      });
    }

    // Transcription Service (async job queue for document transcription)
    if (clientConfig.transcriptionService) {
      new TranscriptionServiceConstruct(this, safeConstructId + '-transcription', {
        apiGatewayAuthorizerId: fe.authorizer.id,
        apiGatewayId: fe.apiGateway.id,
        clientName: props.clientName,
        region: clientConfig.region,
        dataBucketArn: core.dataBucket.bucket.arn,
        dataBucketName: core.dataBucket.bucket.bucket,
        outputsBucketArn: core.outputsBucket.bucket.arn,
        extractContentLambdaArn: coreApis.extractContentLambda.arn,
        extractContentLambdaName: coreApis.extractContentLambda.functionName,
        notificationsTableName: core.notificationsTable.name,
        notificationsTableArn: core.notificationsTable.arn,
        usageAnalyticsEventsTableName: core.usageAnalyticsEventsTable.name,
        usageAnalyticsEventsTableArn: core.usageAnalyticsEventsTable.arn,
        auditAutomationTableName: core.auditAutomationTable.name,
        auditAutomationTableArn: core.auditAutomationTable.arn,
        deployerRoleArn: deployerRole,
        otelConfig: {
          otelConfigPath: core.otelConfigPath,
          honeycombIngestKey: honeycombBackendKey,
          region: clientConfig.region,
        },
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
      otelConfig: {
        otelConfigPath: core.otelConfigPath,
        honeycombIngestKey: honeycombBackendKey,
        region: clientConfig.region,
      },
      // Data connectors table (for Synergy credential resolution)
      dataConnectorsTableName: core.dataConnectorsTable.name,
      dataConnectorsTableArn: core.dataConnectorsTable.arn,
      // Data bucket (for S3 data bucket connector)
      dataBucketName: core.dataBucket.bucket.bucket,
      dataBucketArn: core.dataBucket.bucket.arn,
      // Vault audit log table (for tracking vault access)
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
    const apps = appConfigsToDeploy.map(([configuredAppId, appConfig]) => {
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
        HONEYCOMB_KEY: honeycombFrontendKey, // We're going to send data directly to honeycomb for now. Move to a collector later.
        DATA_BUCKET: core.dataBucket.bucket.bucket,
        PROVISION_Q_RESOURCES: clientConfig.provisionQResources ?? false,
        PREFERRED_KNOWLEDGE_BASE: clientConfig.preferredKnowledgeBase ?? 'bedrock',
        BEDROCK_KNOWLEDGE_BASE_ID: knowledgeBase?.knowledgeBaseId ?? '',
        BEDROCK_ACCOUNT: clientConfig.bedrockAccount,
        PIPEDREAM_RELAY_LAMBDA_ARN: core.pipedreamRelayLambdaArn ?? undefined,
        PIPEDREAM_INTEGRATIONS: clientConfig.pipedreamIntegrations ?? false,
        // Parent flags
        DATA_CONNECTORS_ENABLED: clientConfig.dataConnectorsEnabled ?? false,
        AGENTS: clientConfig.agents ?? false,
        NUMA_WORKSPACE_CHAT: clientConfig.numaWorkspaceChat ?? true,
        SCHEDULING: clientConfig.scheduling ?? false,
        NUMA_FILES: clientConfig.numaFiles ?? false,
        KNOWLEDGE_BASES: true,
        DEVELOPER_MODE: clientConfig.developerMode ?? false,
        NUMA_OPS: clientConfig.numaOps ?? false,
        MFA_ENABLED: clientConfig.mfa ?? false,
        SECRETS_VAULT_ENABLED: clientConfig.secretsVaultEnabled ?? false,
        // Dependency cascade — children forced off when parent is off
        NUMA_DROP_ZONES: (clientConfig.numaFiles ?? false) ? (clientConfig.numaDropZones ?? false) : false,
        NUMA_SHARING: (clientConfig.numaFiles ?? false) ? (clientConfig.numaSharing ?? false) : false,
        WORKSPACE_CHAT_MODEL_SELECTION:
          (clientConfig.numaWorkspaceChat ?? false) ? (clientConfig.workspaceChatModelSelection ?? false) : false,
        OAUTH_AVAILABLE: true, // Always available - infrastructure always deployed, admin flags control UI access only
        OAUTH_INTEGRATIONS_ENABLED: clientConfig.oauthIntegrationsEnabled ?? false, // Controls UI access to OAuth setup
        // Per-provider flags removed — providers are now configured dynamically via COMPANY vault secrets.
        // OAUTH_GOOGLE_DRIVE, OAUTH_ONEDRIVE, OAUTH_DROPBOX are no longer needed in config.json.
        V2_APPS: clientConfig.v2Apps ?? false,
        TRANSCRIPTION_SERVICE: clientConfig.transcriptionService ?? false,
        // Direct Lambda Function URL for workspace chat agent (bypasses CloudFront buffering for streaming)
        WORKSPACE_CHAT_AGENT_FUNCTION_URL: workspaceChatAgentProxy?.functionUrl,
        NUMA_VERSION: siteVersion,
      }),
      contentType: 'application/json',
      cacheControl: 'no-cache, no-store, must-revalidate',
    });

    const manifest = new S3Object(this, 'manifest-item', {
      bucket: fe.frontendBucket.bucket,
      key: 'manifest.json',
      content: JSON.stringify({ apps: apps.map((app) => app.manifest) }),
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
              'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
              'arn:aws:bedrock:*::foundation-model/us.amazon.nova-*',
              'arn:aws:bedrock:*::foundation-model/apac.amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/au.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/apac.anthropic.claude-*',
              'arn:aws:bedrock:*:*:inference-profile/amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-*',
              'arn:aws:bedrock:*:*:inference-profile/apac.amazon.nova-*',
            ],
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
         * Whether to enable the Numa Files feature (file management page and backend).
         *
         * @default false
         */
        numaFiles: z.boolean().optional().default(false),

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
         * Whether to enable Numa Ops (work management, kanban boards, CRM, supplier management).
         *
         * @default false
         */
        numaOps: z.boolean().optional().default(false),

        /**
         * Feature flags from other branches (not yet implemented in this branch)
         * Added to schema for forward compatibility with configs that include them
         */
        knowledgeBases: z.boolean().optional().default(true),
        recordsKBEnabled: z.boolean().optional(),
        oauthProviders: z.record(z.string(), z.any()).optional(), // Object with provider configs
        oauthIntegrationsEnabled: z.boolean().optional(),
        contentSearchEnabled: z.boolean().optional(),

        /**
         * Whether to enable V2 Apps (next-generation app framework with agents, workspace, runs).
         *
         * @default false
         */
        v2Apps: z.boolean().optional().default(false),

        /**
         * Whether to enable the Transcription Service (async job queue for document transcription).
         *
         * @default false
         */
        transcriptionService: z.boolean().optional().default(false),

        /**
         * Comma-separated additional Cognito User Pool Client IDs to accept.
         * Used when a whitelabel frontend shares the same User Pool but has its own app client.
         */
        additionalCognitoClientIds: z.string().optional(),
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
  'data-analysis': { app: DataAnalysis, isProdApp: true },
  'document-summariser': { app: DocumentSummariser, isProdApp: true },
  'financial-analysis': { app: FinancialAnalysis, isProdApp: true },
  'gdsr-assessment': { app: GdsrAssessment, isProdApp: false },
  'infringement-review': { app: InfringementReview, isProdApp: false },
  'tor-assessment': { app: TorAssessment, isProdApp: false },
  'meeting-analyser': { app: MeetingAnalyser, isProdApp: true },
  'structured-data-query': { app: StructuredDataQueryApp, isProdApp: false },
  nolia: { app: Nolia, isProdApp: false },
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
