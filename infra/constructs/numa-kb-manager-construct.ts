import { Construct } from 'constructs';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';
import type { Construct as CDKConstruct } from 'constructs';

interface KbManagerKnowledgeBaseConfig {
  preferredKnowledgeBase: 'bedrock' | 'q' | 'none';
  qApplicationId?: string;
  qIndexId?: string;
  bedrockKnowledgeBaseId?: string;
}

export interface KbManagerProps {
  clientName: string;
  region: string;
  knowledgeBaseConfiguration: KbManagerKnowledgeBaseConfig;
  userPoolId: string;
  userPoolClientId: string;
  knowledgeBasesTableName: string;
  dataBucketArn: string;
  /** Shared secret value CloudFront sends in x-arcanum-cloudfront-secret */
  cloudfrontSharedSecret: string;
  /** Optional crawl URLs table name for web crawler stats in KB state */
  crawlUrlsTableName?: string;
}

/**
 * KB management Lambda — handles `/api/kb*` requests behind CloudFront.
 *
 * Split out of the chat-agent so that lightweight KB CRUD doesn't pay the
 * chat lambda's heavy startup cost (Claude Agent SDK, MCP, Bedrock model warm).
 * Plain ZIP package with FastAPI + Mangum on a Lambda Function URL.
 */
export class NumaKbManager extends Construct {
  readonly functionUrl: string;

  constructor(scope: CDKConstruct, id: string, props: KbManagerProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const logGroupName = `/aws/lambda/${props.clientName}-kb-manager`;
    const logGroup = new CloudwatchLogGroup(this, 'kb-manager-logs', {
      name: logGroupName,
    });

    const kb = props.knowledgeBaseConfiguration;
    const knowledgeBasesTableArn = `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/${props.knowledgeBasesTableName}`;

    const lambdaFn = new NumaLambda(this, 'kb-manager', {
      clientName: props.clientName,
      lambdaDirectory: 'python/numa-kb-manager/',
      handler: 'numa_kb_manager.lambda_handler.handler',
      runtime: 'python3.13',
      // GET /api/kb/{id}/state paginates the full Bedrock document list and
      // does a HeadObject per web-crawler file — large company KBs push the
      // tail latency up, so we give it comfortable headroom.
      memorySize: 1024,
      timeout: 120,
      environment: {
        CLIENT_NAME: props.clientName,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        PREFERRED_KNOWLEDGE_BASE: kb.preferredKnowledgeBase,
        BEDROCK_KNOWLEDGE_BASE_ID: kb.bedrockKnowledgeBaseId ?? '',
        Q_APPLICATION_ID: kb.qApplicationId ?? '',
        Q_INDEX_ID: kb.qIndexId ?? '',
        ...(props.crawlUrlsTableName && { CRAWL_URLS_TABLE_NAME: props.crawlUrlsTableName }),
      },
      logGroup,
      resourceNameSuffix: '_kb_manager',
      additionalPolicyStatements: [
        // KB metadata table — full CRUD on items + memberships
        {
          effect: 'Allow',
          actions: [
            'dynamodb:Query',
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
          ],
          resources: [knowledgeBasesTableArn, `${knowledgeBasesTableArn}/index/*`],
        },
        // Document bucket — list, delete, head/get for metadata sidecars
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [props.dataBucketArn],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:DeleteObject'],
          resources: [`${props.dataBucketArn}/*`],
        },
        // Cognito — resolve emails ↔ subs and validate JWT
        {
          effect: 'Allow',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
          resources: [`arn:aws:cognito-idp:${props.region}:${callerIdentity.accountId}:userpool/${props.userPoolId}`],
        },
        // Bedrock KB state — list data sources, ingestion jobs, documents
        ...(kb.bedrockKnowledgeBaseId
          ? [
              {
                effect: 'Allow',
                actions: [
                  'bedrock:ListDataSources',
                  'bedrock:ListIngestionJobs',
                  'bedrock:GetIngestionJob',
                  'bedrock:ListKnowledgeBaseDocuments',
                ],
                resources: [
                  `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${kb.bedrockKnowledgeBaseId}`,
                  `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${kb.bedrockKnowledgeBaseId}/data-source/*`,
                ],
              },
            ]
          : []),
        // Q Business KB state — list data sources, sync jobs, documents
        ...(kb.qApplicationId
          ? [
              {
                effect: 'Allow',
                actions: ['qbusiness:ListDataSources', 'qbusiness:ListDataSourceSyncJobs', 'qbusiness:ListDocuments'],
                resources: [
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${kb.qApplicationId}`,
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${kb.qApplicationId}/index/*`,
                  `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${kb.qApplicationId}/index/*/data-source/*`,
                ],
              },
            ]
          : []),
        // Web crawler stats table for /api/kb/{id}/state
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

    const fnUrl = new LambdaFunctionUrl(this, 'kb-manager-url', {
      functionName: lambdaFn.lambda.functionName,
      authorizationType: 'NONE',
    });

    // As of October 2025 AWS requires both lambda:InvokeFunctionUrl AND
    // lambda:InvokeFunction for public Function URLs. The LambdaFunctionUrl
    // resource auto-creates InvokeFunctionUrl; we add InvokeFunction here.
    new LambdaPermission(this, 'kb-manager-url-invoke-permission', {
      functionName: lambdaFn.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: '*',
      statementId: 'FunctionURLAllowPublicAccessInvoke',
    });

    this.functionUrl = fnUrl.functionUrl;
  }
}
