import { Construct } from 'constructs';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunctionUrl } from '@cdktf/provider-aws/lib/lambda-function-url';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface NumaStandardModelRelayConstructProps {
  /**
   * ARN of the Secrets Manager secret holding the OpenRouter API key. The ARN is
   * passed to the Lambda as OPENROUTER_SECRET_ARN and the value is fetched at
   * RUNTIME (cached) via the GetSecretValue grant — the plaintext is never baked
   * into the Lambda env or read at deploy time (Pipedream proxy convention).
   */
  openRouterApiKeySecretArn: string;
  /** Name of the numa-client-config DynamoDB table (account allowlist scan). */
  clientConfigTableName: string;
  /** ARN of the numa-client-config DynamoDB table (for IAM read access). */
  clientConfigTableArn: string;
  /** Region the relay runs in (LWA layer account is region-specific). @default us-east-1 */
  region?: string;
  /**
   * Real upstream model id behind the opaque `numa-standard-model`.
   * @default xiaomi/mimo-v2.5-pro
   */
  upstreamModelId?: string;
  /**
   * Comma-separated OpenRouter provider order pin.
   * @default novita
   */
  providerOrder?: string;
  /** Optional shared-secret value for the defence-in-depth header gate. */
  relaySharedSecret?: string;
}

/**
 * Deployer-account streaming relay for the opaque "Numa Standard Model".
 *
 * The single audited egress chokepoint and the only place that knows the real
 * upstream behind `numa-standard-model`. Per-tenant AgentCore containers reach
 * it cross-account, validated by an STS proof header (same pattern as
 * numa-email-sender). Built from two proven in-repo halves:
 *   - Streaming: LWA layer + AWS_LWA_INVOKE_MODE=response_stream + run.sh uvicorn
 *     + LambdaFunctionUrl{ invokeMode: RESPONSE_STREAM, authorizationType: NONE }
 *     (workspace-chat-agent-proxy recipe).
 *   - Auth: STS-proof validation against numa-client-config (email-sender).
 *
 * Architecture:
 *   container proxy ──HTTPS (SSE, STS-proof header)──▶ Function URL ──▶ OpenRouter
 */
export class NumaStandardModelRelayConstruct extends Construct {
  /** The Function URL the container proxy POSTs to (cross-account). */
  readonly functionUrl: string;
  /** The ARN of the relay Lambda. */
  readonly functionArn: string;
  /** The name of the relay Lambda. */
  readonly functionName: string;

  constructor(scope: Construct, id: string, props: NumaStandardModelRelayConstructProps) {
    super(scope, id);

    const region = props.region ?? 'us-east-1';
    const functionName = 'numa-standard-model-relay';

    const logGroupName = `/aws/lambda/${functionName}`;
    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: logGroupName,
      retentionInDays: 30,
    });

    // The OpenRouter key is NOT read at deploy time — the Lambda fetches it from
    // Secrets Manager at runtime (cached) via OPENROUTER_SECRET_ARN, so the
    // plaintext never lands in the Lambda env config and the secret can be
    // populated/rotated independently of deploys (Pipedream proxy convention).

    // ──────────────────────────────────────────────
    // IAM role + policy
    // ──────────────────────────────────────────────

    const execRole = new IamRole(this, 'execution-role', {
      name: `${functionName}-execution`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'assume-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const policy = new IamPolicy(this, 'execution-policy', {
      name: `${functionName}-policy`,
      policy: new DataAwsIamPolicyDocument(this, 'policy-doc', {
        statement: [
          {
            sid: 'CloudWatchLogs',
            effect: 'Allow',
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.arn, `${logGroup.arn}:*`],
          },
          {
            sid: 'ReadClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [props.clientConfigTableArn],
          },
          {
            sid: 'ReadOpenRouterKey',
            effect: 'Allow',
            actions: ['secretsmanager:GetSecretValue'],
            resources: [props.openRouterApiKeySecretArn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    // ──────────────────────────────────────────────
    // Lambda (ZIP + LWA layer for response streaming)
    // ──────────────────────────────────────────────

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'numa-standard-model-relay',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      // LWA: the startup script is the handler.
      handler: 'run.sh',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 900, // 15 min — long streaming turns
      loggingConfig: {
        logGroup: logGroup.name,
        logFormat: 'Text',
      },
      // LWA layer (region-specific) for HTTP response streaming.
      layers: [`arn:aws:lambda:${region}:753240598075:layer:LambdaAdapterLayerX86:25`],
      environment: {
        variables: {
          // LWA response-streaming configuration.
          AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
          AWS_LWA_INVOKE_MODE: 'response_stream',
          // ARN of the OpenRouter key secret — the Lambda fetches the value at
          // runtime (never the plaintext in env). The value lives in this account only.
          OPENROUTER_SECRET_ARN: props.openRouterApiKeySecretArn,
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
          NUMA_STANDARD_MODEL_ID: 'numa-standard-model',
          NUMA_STANDARD_MODEL_UPSTREAM: props.upstreamModelId ?? 'xiaomi/mimo-v2.5-pro',
          NUMA_STANDARD_MODEL_PROVIDER_ORDER: props.providerOrder ?? 'novita',
          ...(props.relaySharedSecret && {
            NUMA_STANDARD_MODEL_RELAY_SECRET: props.relaySharedSecret,
          }),
        },
      },
    });

    // ──────────────────────────────────────────────
    // Function URL (response streaming, no AWS auth — STS proof is the gate)
    // ──────────────────────────────────────────────

    const fnUrl = new LambdaFunctionUrl(this, 'function-url', {
      functionName: fn.functionName,
      authorizationType: 'NONE', // in-handler STS-proof validation is the gate
      invokeMode: 'RESPONSE_STREAM',
      cors: {
        allowOrigins: ['*'],
        allowMethods: ['*'],
        allowHeaders: ['*'],
        allowCredentials: false,
        maxAge: 86400,
      },
    });

    // As of Oct 2025 AWS requires BOTH lambda:InvokeFunctionUrl (auto-created by
    // LambdaFunctionUrl) AND lambda:InvokeFunction for public Function URLs.
    new LambdaPermission(this, 'function-url-invoke-permission', {
      functionName: fn.functionName,
      action: 'lambda:InvokeFunction',
      principal: '*',
      statementId: 'FunctionURLAllowPublicAccessInvoke',
    });

    new TerraformOutput(this, 'function-url-output', {
      value: fnUrl.functionUrl,
      description: 'Function URL of the Numa Standard Model relay (consumed cross-account by the container proxy)',
    });

    new TerraformOutput(this, 'function-arn-output', {
      value: fn.arn,
      description: 'ARN of the Numa Standard Model relay Lambda',
    });

    this.functionUrl = fnUrl.functionUrl;
    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
  }
}
