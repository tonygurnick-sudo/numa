import { Construct } from 'constructs';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';

/**
 * Props for the PublicDemoProxy construct.
 */
export interface PublicDemoProxyProps {
  /** Client name for resource naming */
  clientName: string;
  /** AWS region */
  region: string;
  /** ARN of the AgentCore runtime to invoke */
  agentRuntimeArn: string;
  /** Outputs bucket name (for S3 file operations) */
  outputsBucketName: string;
  /** Outputs bucket ARN (for IAM permissions) */
  outputsBucketArn: string;
  /** Daily cost limit in USD */
  dailyLimitUsd: number;
  /** Usage analytics counters table name (for cost tracking) */
  countersTableName: string;
  /** Usage analytics counters table ARN (for IAM permissions) */
  countersTableArn: string;
  /** Workspace chat tools Lambda ARN (for document conversion) */
  workspaceToolsLambdaArn?: string;
  /** Workspace chat tools Lambda name (for invoking) */
  workspaceToolsLambdaName?: string;
  /** Region where AgentCore resources are deployed (defaults to props.region) */
  agentCoreRegion?: string;
}

/**
 * Creates a public (unauthenticated) proxy Lambda for the demo chat page.
 *
 * This is a separate, simpler proxy than the main workspace chat agent proxy.
 * No JWT validation, no Cognito, no CloudFront secret. Uses a synthetic user
 * identity and enforces daily cost limits via DynamoDB counters.
 *
 * Architecture:
 * Browser ──HTTP──▶ CloudFront ──▶ Lambda Function URL ──SDK──▶ AgentCore Runtime
 *                   (no secret)    (no auth)                     (Haiku 4.5 only)
 */
export class PublicDemoProxy extends Construct {
  /** The Function URL for CloudFront to route to */
  readonly functionUrl: string;

  constructor(scope: Construct, id: string, props: PublicDemoProxyProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    // ── Scoped IAM role for browser-side S3 credentials ──────────────────────
    // The proxy Lambda assumes this role via STS and returns temporary credentials
    // to the frontend. Tightly scoped: only S3 GetObject on public demo workspace files.
    const demoRole = new IamRole(this, 'demo-s3-role', {
      name: `${props.clientName}-public-demo-s3`,
      maxSessionDuration: 3600, // 1 hour max
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'demo-role-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'AWS',
                // Only the Lambda's execution role can assume this
                identifiers: [`arn:aws:iam::${callerIdentity.accountId}:root`],
              },
            ],
          },
        ],
      }).json,
    });

    new IamRolePolicy(this, 'demo-s3-role-policy', {
      role: demoRole.name,
      policy: new DataAwsIamPolicyDocument(this, 'demo-s3-policy-doc', {
        statement: [
          {
            actions: ['s3:GetObject', 's3:PutObject'],
            // Only files in public demo workspace conversations
            resources: [`${props.outputsBucketArn}/numa-chat/workspace/public-*`],
          },
        ],
      }).json,
    });

    const logGroupName = `/aws/lambda/${props.clientName}-public-demo-proxy`;
    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: logGroupName,
      retentionInDays: 30,
    });

    const proxyFn = new NumaLambda(this, 'proxy-lambda', {
      clientName: props.clientName,
      lambdaDirectory: 'python/public-demo-proxy/',
      handler: 'run.sh',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 900,
      environment: {
        AGENT_RUNTIME_ARN: props.agentRuntimeArn,
        CLIENT_NAME: props.clientName,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        COUNTERS_TABLE_NAME: props.countersTableName,
        DAILY_LIMIT_USD: String(props.dailyLimitUsd),
        // Scoped IAM role ARN for vending temporary S3-only credentials to the browser
        DEMO_S3_ROLE_ARN: demoRole.arn,
        // LWA configuration for response streaming
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        // Cross-region AgentCore support
        ...(props.agentCoreRegion &&
          props.agentCoreRegion !== props.region && {
            AGENTCORE_REGION: props.agentCoreRegion,
          }),
        // Workspace chat tools Lambda for document conversion
        ...(props.workspaceToolsLambdaName && {
          WORKSPACE_TOOLS_LAMBDA_NAME: props.workspaceToolsLambdaName,
        }),
      },
      logGroup: logGroup,
      resourceNameSuffix: '_public_demo_proxy',
      additionalLayers: [`arn:aws:lambda:${props.region}:753240598075:layer:LambdaAdapterLayerX86:25`],
      additionalPolicyStatements: [
        // Permission to invoke the AgentCore runtime
        {
          effect: 'Allow',
          actions: [
            'bedrock-agentcore:InvokeAgentRuntime',
            'bedrock-agentcore:InvokeAgentRuntimeStreaming',
            'bedrock-agentcore:InvokeAgentRuntimeForUser',
          ],
          resources: [
            `arn:aws:bedrock-agentcore:${props.agentCoreRegion ?? props.region}:${callerIdentity.accountId}:*`,
          ],
        },
        // CloudWatch logs
        {
          effect: 'Allow',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`arn:aws:logs:${props.region}:${callerIdentity.accountId}:log-group:${logGroupName}:*`],
        },
        // DynamoDB for daily cost tracking
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem', 'dynamodb:Query'],
          resources: [props.countersTableArn],
        },
        // S3 for file operations (uploads/outputs in workspace paths)
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${props.outputsBucketArn}/numa-chat/workspace/*`],
        },
        // STS AssumeRole to vend scoped S3 credentials to the browser
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          resources: [demoRole.arn],
        },
        // Lambda invoke for workspace-chat-tools (document conversion)
        ...(props.workspaceToolsLambdaArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['lambda:InvokeFunction'],
                resources: [props.workspaceToolsLambdaArn],
              },
            ]
          : []),
      ],
    });

    // Create Function URL - fully public, no auth
    const fnUrl = new LambdaFunctionUrl(this, 'function-url', {
      functionName: proxyFn.lambda.functionName,
      authorizationType: 'NONE',
      invokeMode: 'RESPONSE_STREAM',
      cors: {
        allowOrigins: ['*'],
        allowMethods: ['*'],
        allowHeaders: ['*'],
        allowCredentials: false,
        maxAge: 86400,
      },
    });

    // AWS requires both InvokeFunctionUrl and InvokeFunction for public Function URLs
    new LambdaPermission(this, 'function-url-invoke-permission', {
      functionName: proxyFn.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: '*',
      statementId: 'FunctionURLAllowPublicAccessInvoke',
    });

    this.functionUrl = fnUrl.functionUrl;
  }
}
