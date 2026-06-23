import { Construct } from 'constructs';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { NumaLambda } from './numa-lambda';

/**
 * Props for the WorkspaceChatAgentProxy construct.
 */
export interface WorkspaceChatAgentProxyProps {
  /** Client name for resource naming */
  clientName: string;
  /** AWS region */
  region: string;
  /** ARN of the AgentCore runtime to invoke */
  agentRuntimeArn: string;
  /**
   * Deploy-generation token (the container image tag) appended to the AgentCore
   * session ID as conv-{conversationId}-{imageGeneration}. Changes on every
   * image deploy, so conversations rotate onto the new image instead of staying
   * pinned to the version their session was created under. Optional: when
   * omitted, build_session_id falls back to the legacy conv-{conversationId}.
   */
  imageGeneration?: string;
  /** Shared secret value CloudFront sends in x-arcanum-cloudfront-secret */
  cloudfrontSharedSecret: string;
  /** Cognito User Pool ID for JWT verification */
  cognitoUserPoolId: string;
  /** Cognito User Pool Client ID for JWT verification */
  cognitoClientId: string;
  /** Comma-separated additional Cognito client IDs to accept (e.g. whitelabel frontends) */
  additionalCognitoClientIds?: string;
  /** Optional integrations approval table name (for handling approve actions directly) */
  integrationsApprovalTableName?: string;
  /** Optional integrations approval table ARN (for IAM permissions) */
  integrationsApprovalTableArn?: string;
  /** File redirect HMAC secret (for integration file upload clean URLs) */
  fileRedirectSecret?: string;
  /** Outputs bucket name (for generating presigned URLs in file redirect) */
  outputsBucketName?: string;
  /** Outputs bucket ARN (for S3 GetObject IAM permission) */
  outputsBucketArn?: string;
  /** Schedule runner secret for authenticating server-to-server calls from the agent-schedule-runner Lambda */
  scheduleRunnerSecret?: string;
  /**
   * HMAC secret for minting short-lived "service identity" tokens for
   * non-interactive runs (scheduled / V2 / Nolia) that have no user Cognito
   * token. numa-cli-api verifies these with the same secret. Never injected
   * into the workspace agent container, so the LLM can't reach it.
   */
  cliIdentitySecret?: string;
  /** Workspace chat tools Lambda ARN (for document conversion preview) */
  workspaceToolsLambdaArn?: string;
  /** Workspace chat tools Lambda name (for invoking from proxy) */
  workspaceToolsLambdaName?: string;
  /** Region where AgentCore resources are deployed (defaults to props.region) */
  agentCoreRegion?: string;
  /** Active-runs mirror table name (for serving /runs/{id}/status without AgentCore, BUG-140) */
  activeRunsTableName?: string;
  /** Active-runs mirror table ARN (for IAM read permission) */
  activeRunsTableArn?: string;
  /**
   * Client app origin (e.g. https://nd-labs.numa.arcanum.ai) used to restrict
   * the Function URL CORS allow-list (BUG-279). The Function URL sits behind
   * CloudFront for normal traffic, but the frontend also hits it directly for
   * streaming — so the browser origin is the client app domain. When omitted,
   * CORS falls back to '*' to preserve the previous (permissive) behaviour for
   * stacks that don't pass it yet.
   */
  appOrigin?: string;
}

/**
 * Creates a Lambda proxy that bridges CloudFront HTTP requests to AgentCore SDK calls.
 *
 * AgentCore requires AWS SigV4-signed SDK calls and has no public HTTP endpoint.
 * This Lambda receives HTTP requests from CloudFront and translates them to
 * invoke_agent_runtime calls via boto3.
 *
 * Architecture:
 * Browser ──HTTP──▶ CloudFront ──▶ Lambda Function URL ──SDK──▶ AgentCore Runtime
 */
export class WorkspaceChatAgentProxy extends Construct {
  /** The Function URL for CloudFront to route to */
  readonly functionUrl: string;
  /** The ARN of the proxy Lambda (for granting invoke permissions) */
  readonly functionArn: string;
  /** The name of the proxy Lambda (for Lambda.invoke calls) */
  readonly functionName: string;

  constructor(scope: Construct, id: string, props: WorkspaceChatAgentProxyProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const logGroupName = `/aws/lambda/${props.clientName}-workspace-chat-agent-proxy`;
    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: logGroupName,
      retentionInDays: 30,
    });

    // Create the proxy Lambda with LWA for streaming
    const proxyFn = new NumaLambda(this, 'proxy-lambda', {
      clientName: props.clientName,
      lambdaDirectory: 'python/workspace-chat-agent-proxy/',
      // Use Lambda Web Adapter (LWA) with ZIP package: startup script is the handler
      handler: 'run.sh',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 900, // 15 minutes to match chat agent
      environment: {
        AGENT_RUNTIME_ARN: props.agentRuntimeArn,
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        CLIENT_NAME: props.clientName,
        // Deploy-generation token suffixed onto the AgentCore session ID so a
        // new image deploy rotates conversations onto the new image (build_session_id).
        // Applies uniformly to chat, scheduled agents, and V2 apps — all route here.
        ...(props.imageGeneration && {
          WORKSPACE_IMAGE_GENERATION: props.imageGeneration,
        }),
        // Cognito config for JWT verification (prevents token forgery)
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        COGNITO_CLIENT_ID: props.cognitoClientId,
        ...(props.additionalCognitoClientIds && {
          ADDITIONAL_COGNITO_CLIENT_IDS: props.additionalCognitoClientIds,
        }),
        // LWA configuration for response streaming
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        // Integrations approval table (for handling approve actions directly in the proxy)
        ...(props.integrationsApprovalTableName && {
          INTEGRATIONS_APPROVAL_TABLE_NAME: props.integrationsApprovalTableName,
        }),
        // File redirect for integration uploads (clean URLs to avoid Slack filename length issues)
        ...(props.fileRedirectSecret && {
          FILE_REDIRECT_SECRET: props.fileRedirectSecret,
        }),
        ...(props.outputsBucketName && {
          OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        }),
        // Schedule runner secret for authenticating server-to-server calls
        // from the agent-schedule-runner Lambda (scheduled agents use V2 sync mode)
        ...(props.scheduleRunnerSecret && {
          SCHEDULE_RUNNER_SECRET: props.scheduleRunnerSecret,
        }),
        // HMAC secret to sign service-identity tokens for non-interactive runs
        // (scheduled / V2 / Nolia). Verified by numa-cli-api with the same secret.
        ...(props.cliIdentitySecret && {
          NUMA_CLI_IDENTITY_SECRET: props.cliIdentitySecret,
        }),
        // Workspace chat tools Lambda for document conversion preview
        ...(props.workspaceToolsLambdaName && {
          WORKSPACE_TOOLS_LAMBDA_NAME: props.workspaceToolsLambdaName,
        }),
        // Active-runs mirror table (BUG-140) — /runs/{id}/status reads it
        // instead of invoking AgentCore (which queues behind the running chat)
        ...(props.activeRunsTableName && {
          ACTIVE_RUNS_TABLE_NAME: props.activeRunsTableName,
        }),
        // AgentCore region (may differ from Lambda's own region for cross-region deployments)
        ...(props.agentCoreRegion &&
          props.agentCoreRegion !== props.region && {
            AGENTCORE_REGION: props.agentCoreRegion,
          }),
      },
      logGroup: logGroup,
      resourceNameSuffix: '_workspace_chat_agent_proxy',
      // LWA layer for HTTP streaming
      additionalLayers: [`arn:aws:lambda:${props.region}:753240598075:layer:LambdaAdapterLayerX86:25`],
      additionalPolicyStatements: [
        // Permission to invoke + stop the AgentCore runtime session.
        // StopRuntimeSession is used by the proxy to recover from the ap-southeast-2
        // "stuck-session 403" condition: after a microVM is terminated by
        // idleRuntimeSessionTimeout, the next invoke returns "(403) from runtime"
        // until the session is explicitly stopped. Proxy calls Stop then retries.
        // Uses account-scoped wildcard to include runtime, sessions, and workload identity resources.
        {
          effect: 'Allow',
          actions: [
            'bedrock-agentcore:InvokeAgentRuntime',
            'bedrock-agentcore:InvokeAgentRuntimeStreaming',
            'bedrock-agentcore:InvokeAgentRuntimeForUser',
            'bedrock-agentcore:StopRuntimeSession',
          ],
          resources: [
            `arn:aws:bedrock-agentcore:${props.agentCoreRegion ?? props.region}:${callerIdentity.accountId}:*`,
          ],
        },
        // CloudWatch logs (inherited from NumaLambda but explicit for clarity)
        {
          effect: 'Allow',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`arn:aws:logs:${props.region}:${callerIdentity.accountId}:log-group:${logGroupName}:*`],
        },
        // DynamoDB permission for handling integration approval decisions directly
        ...(props.integrationsApprovalTableArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['dynamodb:UpdateItem'],
                resources: [props.integrationsApprovalTableArn],
              },
            ]
          : []),
        // DynamoDB read on the active-runs mirror (BUG-140) — lets
        // /runs/{id}/status report in-flight runs without invoking AgentCore
        ...(props.activeRunsTableArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['dynamodb:GetItem'],
                resources: [props.activeRunsTableArn],
              },
            ]
          : []),
        // S3 GetObject for file redirect (serving presigned URLs for integration
        // uploads) and for reading workspace trace/result/progress files directly.
        // v2-apps/* holds _result.json/_progress.json for V2 app + Nolia runs,
        // read by the proxy-served /runs/{id}/status endpoint.
        ...(props.outputsBucketArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['s3:GetObject'],
                resources: [`${props.outputsBucketArn}/numa-chat/workspace/*`, `${props.outputsBucketArn}/v2-apps/*`],
              },
              // ListBucket scoped to the workspace prefix — used by the
              // /artifacts endpoint to aggregate generated files across a
              // user's conversations without going through AgentCore.
              {
                effect: 'Allow' as const,
                actions: ['s3:ListBucket'],
                resources: [props.outputsBucketArn],
                condition: [
                  {
                    test: 'StringLike',
                    variable: 's3:prefix',
                    values: ['numa-chat/workspace/*'],
                  },
                ],
              },
            ]
          : []),
        // Lambda invoke for workspace-chat-tools (document conversion for preview)
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

    // Create Function URL with streaming support
    // CORS configured for direct browser access (bypassing CloudFront for streaming).
    // BUG-279: restrict allowed origins to the client app domain instead of '*'.
    // Only the client's own frontend ever calls this URL from a browser; locking
    // the origin down stops other sites from making cross-origin browser requests.
    // Falls back to '*' if appOrigin isn't supplied (backward compatible).
    const allowOrigins = props.appOrigin ? [props.appOrigin] : ['*'];
    const fnUrl = new LambdaFunctionUrl(this, 'function-url', {
      functionName: proxyFn.lambda.functionName,
      authorizationType: 'NONE', // CloudFront handles auth via secret header
      invokeMode: 'RESPONSE_STREAM',
      cors: {
        allowOrigins,
        allowMethods: ['*'], // All methods (GET, POST, OPTIONS handled automatically)
        allowHeaders: ['*'], // All headers
        allowCredentials: false,
        maxAge: 86400, // 24 hours
      },
    });

    // As of October 2025, AWS requires BOTH lambda:InvokeFunctionUrl AND lambda:InvokeFunction
    // permissions for public Function URLs. The LambdaFunctionUrl resource auto-creates
    // the InvokeFunctionUrl permission, but we must explicitly add InvokeFunction.
    // See: https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html
    new LambdaPermission(this, 'function-url-invoke-permission', {
      functionName: proxyFn.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: '*',
      statementId: 'FunctionURLAllowPublicAccessInvoke',
    });

    this.functionUrl = fnUrl.functionUrl;
    this.functionArn = proxyFn.lambda.arn;
    this.functionName = proxyFn.lambda.functionName;
  }
}
