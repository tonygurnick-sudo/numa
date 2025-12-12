import { Construct } from 'constructs';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { NumaLambda } from './numa-lambda';
import type { Construct as CDKConstruct } from 'constructs';
import { SUPPORTED_INTEGRATIONS } from '../config/integrations';

interface ChatAgentConfiguration {
  preferredKnowledgeBase: 'bedrock' | 'q';
  qApplicationId?: string;
  qRetrieverId?: string;
  qIndexId?: string;
  bedrockKnowledgeBaseId?: string;
}

export interface ChatAgentHttpProps {
  clientName: string;
  region: string;
  chatAgentConfiguration: ChatAgentConfiguration;
  userPoolId: string;
  userPoolClientId: string;
  chatHistoryTableName: string;
  knowledgeBasesTableName: string;
  outputsBucketArn: string;
  outputsBucketName: string;
  dataBucketArn: string;
  workspaceAgentsTableName?: string;
  userAgentsTableName?: string;
  agentsSettingsTableName?: string;
  pipedreamProxyLambdaArn?: string;
  pipedreamIntegrationsEnabled?: boolean;
  mcpPolicyTableName?: string;
  /** Optional DynamoDB table name for global integration settings (client account) */
  globalIntegrationSettingsTableName?: string;
  /** Shared secret value CloudFront sends in x-arcanum-cloudfront-secret */
  cloudfrontSharedSecret: string;
  /** Optional AWS account ID to use for cross-account Bedrock quota sharing */
  bedrockAccount?: string;
  /** Optional crawl URLs table name for web crawler stats in KB state */
  crawlUrlsTableName?: string;
}

export class NumaChatAgent extends Construct {
  readonly functionUrl: string;

  constructor(scope: CDKConstruct, id: string, props: ChatAgentHttpProps) {
    super(scope, id);

    const config = props.chatAgentConfiguration;
    if (config.preferredKnowledgeBase === 'q') {
      if (!config.qApplicationId || !config.qRetrieverId) {
        throw new Error(
          `Chat agent prefers Q Business but missing required fields: ${!config.qApplicationId ? 'qApplicationId ' : ''}${!config.qRetrieverId ? 'qRetrieverId' : ''}`,
        );
      }
    } else if (config.preferredKnowledgeBase === 'bedrock') {
      if (!config.bedrockKnowledgeBaseId) {
        throw new Error('Chat agent prefers Bedrock but bedrockKnowledgeBaseId is missing');
      }
    }

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const agentLogGroupName = `/aws/lambda/${props.clientName}-chat-agent`;
    const agentLogGroup = new CloudwatchLogGroup(this, 'chat-agent-http-logs', {
      name: agentLogGroupName,
    });

    // Note: outputs bucket name is provided directly via props.outputsBucketName

    const agentTableArns: string[] = [];
    if (props.workspaceAgentsTableName) {
      agentTableArns.push(
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.workspaceAgentsTableName}`,
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.workspaceAgentsTableName}/index/*`,
      );
    }
    if (props.userAgentsTableName) {
      agentTableArns.push(
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.userAgentsTableName}`,
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.userAgentsTableName}/index/*`,
      );
    }
    const agentSettingsArn = props.agentsSettingsTableName
      ? `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.agentsSettingsTableName}`
      : undefined;

    const agentFn = new NumaLambda(this, 'chat-agent-http', {
      clientName: props.clientName,
      lambdaDirectory: 'python/numa-chat-agent/',
      // Use Lambda Web Adapter (LWA) with ZIP package: startup script is the handler
      handler: 'run.sh',
      runtime: 'python3.13',
      memorySize: 1024,
      timeout: 900,
      environment: {
        CHAT_HISTORY_TABLE: props.chatHistoryTableName,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        Q_APPLICATION_ID: config.qApplicationId ?? '',
        Q_RETRIEVER_ID: config.qRetrieverId ?? '',
        Q_INDEX_ID: config.qIndexId ?? '',
        BEDROCK_KNOWLEDGE_BASE_ID: config.bedrockKnowledgeBaseId ?? '',
        PREFERRED_KNOWLEDGE_BASE: config.preferredKnowledgeBase,
        BUCKET: props.outputsBucketName,
        CLIENT_NAME: props.clientName,
        SUPPORTED_INTEGRATIONS: JSON.stringify(SUPPORTED_INTEGRATIONS),
        EXTRACT_CONTENT_LAMBDA_NAME: `${props.clientName}_extract-content`,
        ...(props.pipedreamProxyLambdaArn && { PIPEDREAM_PROXY_LAMBDA_ARN: props.pipedreamProxyLambdaArn }),
        ...(props.globalIntegrationSettingsTableName && {
          GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME: props.globalIntegrationSettingsTableName,
        }),
        ...(props.workspaceAgentsTableName && { WORKSPACE_AGENTS_TABLE: props.workspaceAgentsTableName }),
        ...(props.userAgentsTableName && { USER_AGENTS_TABLE: props.userAgentsTableName }),
        ...(props.agentsSettingsTableName && { AGENTS_SETTINGS_TABLE_NAME: props.agentsSettingsTableName }),
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        // LWA configuration for response streaming
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        ...(props.mcpPolicyTableName && { MCP_POLICY_TABLE_NAME: props.mcpPolicyTableName }),
        ...(props.bedrockAccount && { BEDROCK_ACCOUNT: props.bedrockAccount }),
        ...(props.crawlUrlsTableName && { CRAWL_URLS_TABLE_NAME: props.crawlUrlsTableName }),
      },
      logGroup: agentLogGroup,
      resourceNameSuffix: '_chat_agent',
      additionalLayers: [`arn:aws:lambda:${props.region}:753240598075:layer:LambdaAdapterLayerX86:25`],
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModelWithResponseStream', 'bedrock:InvokeModel'],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
            `arn:aws:bedrock:*::foundation-model/us.anthropic.claude-*`,
            `arn:aws:bedrock:*::foundation-model/apac.anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-*`,
            `arn:aws:bedrock:*:*:inference-profile/apac.anthropic.claude-*`,
            // Nova models for fast summarization
            `arn:aws:bedrock:*::foundation-model/amazon.nova-*`,
            `arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: [`arn:aws:iam::*:role/*NumaRole*`, `arn:aws:iam::*:role/*numa-role*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${props.outputsBucketArn}/*`, `${props.dataBucketArn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [props.outputsBucketArn, props.dataBucketArn],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`${props.outputsBucketArn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:${props.region}:${callerIdentity.accountId}:function:${props.clientName}_extract-content`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
          resources: [`arn:aws:cognito-idp:${props.region}:${callerIdentity.accountId}:userpool/${props.userPoolId}`],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-chat-history`,
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-*-chat-history`,
          ],
        },
        {
          effect: 'Allow',
          actions: [
            'dynamodb:Query',
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
          ],
          resources: [
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.knowledgeBasesTableName}`,
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.knowledgeBasesTableName}/index/*`,
          ],
        },
        ...(props.pipedreamIntegrationsEnabled && props.pipedreamProxyLambdaArn
          ? [
              {
                effect: 'Allow',
                actions: ['lambda:InvokeFunction'],
                resources: [props.pipedreamProxyLambdaArn],
              },
              { effect: 'Allow', actions: ['sts:GetCallerIdentity'], resources: ['*'] },
            ]
          : []),
        ...(props.chatAgentConfiguration.bedrockKnowledgeBaseId
          ? [
              {
                effect: 'Allow',
                actions: ['bedrock:Retrieve'],
                resources: [
                  `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${props.chatAgentConfiguration.bedrockKnowledgeBaseId}`,
                ],
              },
              // KB state endpoint permissions (list data sources, ingestion jobs, documents)
              {
                effect: 'Allow',
                actions: [
                  'bedrock:ListDataSources',
                  'bedrock:ListIngestionJobs',
                  'bedrock:GetIngestionJob',
                  'bedrock:ListKnowledgeBaseDocuments',
                ],
                resources: [
                  `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${props.chatAgentConfiguration.bedrockKnowledgeBaseId}`,
                  `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${props.chatAgentConfiguration.bedrockKnowledgeBaseId}/data-source/*`,
                ],
              },
            ]
          : []),
        ...(props.chatAgentConfiguration.qApplicationId
          ? [
              {
                effect: 'Allow',
                actions: ['qbusiness:SearchRelevantContent'],
                resources: [
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.chatAgentConfiguration.qApplicationId}`,
                ],
              },
              // KB state endpoint permissions (list data sources, sync jobs, documents)
              {
                effect: 'Allow',
                actions: ['qbusiness:ListDataSources', 'qbusiness:ListDataSourceSyncJobs', 'qbusiness:ListDocuments'],
                resources: [
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.chatAgentConfiguration.qApplicationId}`,
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.chatAgentConfiguration.qApplicationId}/index/*`,
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.chatAgentConfiguration.qApplicationId}/index/*/data-source/*`,
                ],
              },
            ]
          : []),
        ...(props.mcpPolicyTableName
          ? [
              {
                effect: 'Allow',
                actions: ['dynamodb:GetItem'],
                resources: [
                  `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.mcpPolicyTableName}`,
                ],
              },
            ]
          : []),
        // Allow reading global integration settings table if provided
        ...(props.globalIntegrationSettingsTableName
          ? [
              {
                effect: 'Allow',
                actions: ['dynamodb:GetItem'],
                resources: [
                  `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.globalIntegrationSettingsTableName}`,
                ],
              },
            ]
          : []),
        ...(agentTableArns.length
          ? [
              {
                effect: 'Allow',
                actions: [
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                  'dynamodb:Query',
                ],
                resources: agentTableArns,
              },
            ]
          : []),
        ...(agentSettingsArn
          ? [
              {
                effect: 'Allow',
                actions: ['dynamodb:GetItem'],
                resources: [agentSettingsArn],
              },
            ]
          : []),
        {
          effect: 'Allow',
          actions: ['cognito-idp:AdminGetUser'],
          resources: [`arn:aws:cognito-idp:${props.region}:${callerIdentity.accountId}:userpool/${props.userPoolId}`],
        },
        // Cross-account Bedrock quota sharing - allow assuming role in shared account
        ...(props.bedrockAccount
          ? [
              {
                effect: 'Allow',
                actions: ['sts:AssumeRole'],
                resources: [`arn:aws:iam::${props.bedrockAccount}:role/bedrock-quota-sharing`],
              },
            ]
          : []),
        // Web crawler stats - read from crawl URLs table for KB state endpoint
        ...(props.crawlUrlsTableName
          ? [
              {
                effect: 'Allow',
                actions: ['dynamodb:Query'],
                resources: [
                  `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.crawlUrlsTableName}`,
                  `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.crawlUrlsTableName}/index/*`,
                ],
              },
            ]
          : []),
      ],
    });

    const fnUrl = new LambdaFunctionUrl(this, 'chat-agent-url', {
      functionName: agentFn.lambda.functionName,
      authorizationType: 'NONE',
      invokeMode: 'RESPONSE_STREAM',
    });

    this.functionUrl = fnUrl.functionUrl;
  }
}
