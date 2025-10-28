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
  bedrockKnowledgeBaseId?: string;
}

export interface ChatAgentHttpProps {
  clientName: string;
  region: string;
  chatAgentConfiguration: ChatAgentConfiguration;
  userPoolId: string;
  userPoolClientId: string;
  chatHistoryTableName: string;
  outputsBucketArn: string;
  outputsBucketName: string;
  dataBucketArn: string;
  pipedreamProxyLambdaArn?: string;
  pipedreamIntegrationsEnabled?: boolean;
  mcpPolicyTableName?: string;
  /** Optional DynamoDB table name for global integration settings (client account) */
  globalIntegrationSettingsTableName?: string;
  /** Shared secret value CloudFront sends in x-arcanum-cloudfront-secret */
  cloudfrontSharedSecret: string;
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
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        // LWA configuration for response streaming
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        ...(props.mcpPolicyTableName && { MCP_POLICY_TABLE_NAME: props.mcpPolicyTableName }),
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
          actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-chat-history`,
            `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-*-chat-history`,
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
