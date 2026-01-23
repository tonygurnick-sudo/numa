import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import path from 'node:path';

// AWS Provider imports
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { BedrockagentcoreAgentRuntime } from '@cdktf/provider-aws/lib/bedrockagentcore-agent-runtime';
import { CloudwatchLogDeliverySource } from '@cdktf/provider-aws/lib/cloudwatch-log-delivery-source';
import { CloudwatchLogDeliveryDestination } from '@cdktf/provider-aws/lib/cloudwatch-log-delivery-destination';
import { CloudwatchLogDelivery } from '@cdktf/provider-aws/lib/cloudwatch-log-delivery';
import { CloudwatchLogResourcePolicy } from '@cdktf/provider-aws/lib/cloudwatch-log-resource-policy';

// Null provider for skopeo push
import { Resource as NullResource } from '@cdktf/provider-null/lib/resource';

export interface WorkspaceChatAgentConstructProps {
  /** Client name for resource naming */
  clientName: string;
  /** AWS region */
  region: string;
  /** Deployer role ARN for chain assume (required for ECR push from local-exec) */
  deployerRoleArn: string;
  /** Cognito User Pool ID for JWT verification */
  cognitoUserPoolId: string;
  /** Cognito User Pool Client ID for JWT verification */
  cognitoUserPoolClientId: string;
  /** S3 outputs bucket ARN for workspace persistence */
  outputsBucketArn: string;
  /** S3 outputs bucket name for workspace persistence */
  outputsBucketName: string;
  /** Image version/tag to deploy (default: 'latest') */
  imageVersion?: string;
  /** Workspace tools Lambda function name (for environment variable) */
  workspaceToolsLambdaName?: string;
  /** Workspace tools Lambda ARN (for IAM invoke permission) */
  workspaceToolsLambdaArn?: string;
  /** Shared CloudWatch log group for container logs (watchtower) */
  containerLogGroup: CloudwatchLogGroup;
  /** Optional Bedrock account ID for cross-account model access (global inference profiles) */
  bedrockAccount?: string;
}

export class WorkspaceChatAgentConstruct extends Construct {
  // Exposed resources
  readonly ecrRepository: EcrRepository;
  readonly logGroup: CloudwatchLogGroup;
  readonly agentRuntime: BedrockagentcoreAgentRuntime;

  /**
   * Get the ARN of the AgentCore runtime for use with invoke_agent_runtime SDK calls.
   * Use this with the workspace-chat-agent-proxy Lambda to bridge HTTP requests.
   */
  get agentRuntimeArn(): string {
    return this.agentRuntime.agentRuntimeArn;
  }

  /**
   * @deprecated AgentCore has no public HTTP endpoint. Use agentRuntimeArn with the proxy Lambda instead.
   */
  readonly agentCoreEndpoint: string;

  constructor(scope: Construct, id: string, props: WorkspaceChatAgentConstructProps) {
    super(scope, id);

    // Region-aware model configuration (matches data-analysis-construct.ts)
    const REGIONAL_MODEL_MAP: Record<
      string,
      {
        default: { model_id: string; max_tokens: number };
        fallback: { model_id: string; max_tokens: number };
        haiku: { model_id: string; max_tokens: number };
      }
    > = {
      'us-east-1': {
        default: { model_id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', max_tokens: 64000 },
        fallback: { model_id: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0', max_tokens: 4096 },
        haiku: { model_id: 'anthropic.claude-3-haiku-20240307-v1:0', max_tokens: 4096 },
      },
      'ap-southeast-2': {
        default: { model_id: 'apac.anthropic.claude-sonnet-4-20250514-v1:0', max_tokens: 64000 },
        fallback: { model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', max_tokens: 8192 },
        haiku: { model_id: 'anthropic.claude-3-haiku-20240307-v1:0', max_tokens: 4096 },
      },
    };
    const regionModel = REGIONAL_MODEL_MAP[props.region] ?? REGIONAL_MODEL_MAP['us-east-1'];

    // Get current account ID
    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    // Path to the image tar (baked into numa-deploy container)
    const imageTarPath = path.resolve(
      import.meta.dirname,
      '..',
      'assets',
      'artifacts',
      'numa-workspace-agent',
      'image.tar',
    );

    // Compute content-based image tag from tar hash
    // This ensures AgentCore updates when the image changes (Terraform sees new containerUri)
    // Use first 12 chars of SHA256 hex (only 0-9a-f, safe for Docker tags)
    // Note: filebase64sha256 can produce +/= which are invalid in Docker tags
    const imageTarHash = Fn.filesha256(imageTarPath);
    const imageTag = props.imageVersion || Fn.substr(imageTarHash, 0, 12);

    // =========================================================================
    // ECR REPOSITORY (per-client)
    // =========================================================================

    this.ecrRepository = new EcrRepository(this, 'ecr', {
      name: `numa-${props.clientName}-workspace-chat-agent`,
      imageScanningConfiguration: { scanOnPush: true },
      forceDelete: true, // Allow deletion even if images exist (for dev)
    });

    // =========================================================================
    // PUSH IMAGE TO CLIENT ECR (using skopeo)
    // =========================================================================

    // Push the image tar to client's ECR using skopeo
    // This runs during CDKTF deploy (local-exec provisioner)
    // Uses chain assume (deployer → client) to mirror the Terraform provider credential chain
    const pushImage = new NullResource(this, 'push-image', {
      triggers: {
        // Re-run when image tag changes (derived from tar hash, so changes when tar changes)
        image_tag: imageTag,
      },
      provisioners: [
        {
          type: 'local-exec',
          command: `
set -e

# Chain assume: deployer role → client role
# This mirrors the Terraform provider chain so it works both locally and in CI
echo "Assuming deployer role..."
DEPLOYER_CREDS=$(aws sts assume-role \\
  --role-arn ${props.deployerRoleArn} \\
  --role-session-name skopeo-deployer \\
  --query 'Credentials' \\
  --output json)

export AWS_ACCESS_KEY_ID=$(echo $DEPLOYER_CREDS | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $DEPLOYER_CREDS | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $DEPLOYER_CREDS | jq -r .SessionToken)

echo "Assuming client role..."
CLIENT_CREDS=$(aws sts assume-role \\
  --role-arn arn:aws:iam::${callerIdentity.accountId}:role/ArcanumAIAccess \\
  --role-session-name skopeo-push \\
  --query 'Credentials' \\
  --output json)

export AWS_ACCESS_KEY_ID=$(echo $CLIENT_CREDS | jq -r .AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $CLIENT_CREDS | jq -r .SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $CLIENT_CREDS | jq -r .SessionToken)

# Login to client ECR with client credentials
# Use --authfile to avoid /run/containers permission issues when running as non-root
aws ecr get-login-password --region ${props.region} | \\
  skopeo login --authfile /tmp/skopeo-auth.json --username AWS --password-stdin ${callerIdentity.accountId}.dkr.ecr.${props.region}.amazonaws.com

# Delete all existing images to keep ECR lean (versions tracked in git, not ECR)
echo "Cleaning up old images from ECR..."
REPO_NAME="numa-${props.clientName}-workspace-chat-agent"
IMAGES=$(aws ecr list-images --repository-name "$REPO_NAME" --region ${props.region} --query 'imageIds[*]' --output json 2>/dev/null || echo "[]")
if [ "$IMAGES" != "[]" ] && [ -n "$IMAGES" ]; then
  aws ecr batch-delete-image --repository-name "$REPO_NAME" --region ${props.region} --image-ids "$IMAGES" || true
  echo "Deleted old images"
else
  echo "No existing images to delete"
fi

# Push image from tar to client ECR
skopeo copy --authfile /tmp/skopeo-auth.json \\
  docker-archive:${imageTarPath} \\
  docker://${this.ecrRepository.repositoryUrl}:${imageTag}

echo "Successfully pushed image to ${this.ecrRepository.repositoryUrl}:${imageTag}"
`,
        },
      ],
    });

    // =========================================================================
    // IAM ROLE FOR AGENTCORE
    // =========================================================================

    const agentCoreRole = new IamRole(this, 'agentcore-role', {
      name: `numa-${props.clientName}-workspace-chat-agentcore`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'agentcore-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['bedrock-agentcore.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    new IamRolePolicy(this, 'agentcore-policy', {
      name: 'agentcore-policy',
      role: agentCoreRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'agentcore-policy-doc', {
        statement: [
          {
            sid: 'BedrockAccess',
            effect: 'Allow',
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ['*'],
          },
          {
            sid: 'S3WorkspaceAccess',
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
            // Path must match S3_PREFIX in s3_workspace.py: "numa-chat/workspace"
            resources: [props.outputsBucketArn, `${props.outputsBucketArn}/numa-chat/workspace/*`],
          },
          // Agent reference files - read-only access for downloading agent files
          {
            sid: 'S3AgentFilesRead',
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:ListBucket'],
            // Path matches agent file storage: agents/{agent_id}/files/
            resources: [props.outputsBucketArn, `${props.outputsBucketArn}/numa-chat/agents/*`],
          },
          {
            sid: 'XRayTracing',
            effect: 'Allow',
            actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
            resources: ['*'],
          },
          {
            sid: 'DynamoDBAccess',
            effect: 'Allow',
            actions: ['dynamodb:UpdateItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:GetItem'],
            resources: [
              `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-chat-history`,
            ],
          },
          // Agent tables - read-only access for fetching agent configurations
          {
            sid: 'DynamoDBAgentTablesRead',
            effect: 'Allow',
            actions: ['dynamodb:GetItem', 'dynamodb:Query'],
            resources: [
              `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-agents`,
              `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-user-agents`,
            ],
          },
          {
            sid: 'ECRPull',
            effect: 'Allow',
            actions: ['ecr:GetAuthorizationToken', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
            resources: ['*'],
          },
          {
            sid: 'CloudWatchLogs',
            effect: 'Allow',
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:CreateLogGroup'],
            resources: ['*'],
          },
          // Workspace tools Lambda invoke permission (for KB queries etc.)
          ...(props.workspaceToolsLambdaArn
            ? [
                {
                  sid: 'LambdaInvokeWorkspaceTools',
                  effect: 'Allow',
                  actions: ['lambda:InvokeFunction'],
                  resources: [props.workspaceToolsLambdaArn],
                },
              ]
            : []),
          // Cross-account Bedrock access (for global inference profiles)
          ...(props.bedrockAccount
            ? [
                {
                  sid: 'CrossAccountBedrockAssumeRole',
                  effect: 'Allow',
                  actions: ['sts:AssumeRole'],
                  resources: [`arn:aws:iam::${props.bedrockAccount}:role/bedrock-quota-sharing`],
                },
              ]
            : []),
          // IoT Core publish permission for real-time streaming events
          // Topic structure: numa/{client}/{user_sub}/stream/{request_id}
          {
            sid: 'IoTPublish',
            effect: 'Allow',
            actions: ['iot:Publish'],
            resources: [
              `arn:aws:iot:${props.region}:${callerIdentity.accountId}:topic/numa/${props.clientName}/*/stream/*`,
            ],
          },
          // IoT policy attachment for frontend Cognito identities
          // AttachPolicy doesn't support resource-level restrictions, so we use '*'
          // This is called by the /iot-credentials endpoint when users connect
          {
            sid: 'IoTAttachPolicy',
            effect: 'Allow',
            actions: ['iot:AttachPolicy'],
            resources: ['*'],
          },
        ],
      }).json,
    });

    // =========================================================================
    // CLOUDWATCH LOG GROUP
    // =========================================================================

    // Use /aws/vendedlogs/ prefix required for AWS service log delivery
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/vendedlogs/bedrock-agentcore/numa-${props.clientName}-workspace-chat`,
      retentionInDays: 30,
    });

    // Use shared log group for container stdout/stderr (passed from client stack)
    // This enables unified logging across workspace-agent and workspace-tools
    const containerLogGroup = props.containerLogGroup;

    // =========================================================================
    // CLOUDWATCH LOG RESOURCE POLICIES
    // =========================================================================
    // Required for CloudWatch Log Delivery to write to the log groups.
    // Without these policies, log delivery creates a validation stream but no actual logs flow.

    // Policy for vendedlogs log group (AgentCore APPLICATION_LOGS delivery)
    const vendedlogsDeliveryPolicy = new CloudwatchLogResourcePolicy(this, 'vendedlogs-delivery-policy', {
      policyName: `numa-${props.clientName}-workspace-chat-vendedlogs-delivery`,
      policyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowLogDelivery',
            Effect: 'Allow',
            Principal: {
              Service: 'delivery.logs.amazonaws.com',
            },
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: `${this.logGroup.arn}:*`,
            Condition: {
              StringEquals: {
                'aws:SourceAccount': callerIdentity.accountId,
              },
              ArnLike: {
                'aws:SourceArn': `arn:aws:logs:${props.region}:${callerIdentity.accountId}:*`,
              },
            },
          },
        ],
      }),
    });

    // NOTE: Container log group (/numa/{clientName}/workspace-chat-agent) is covered by
    // the wildcard CloudWatch resource policy created by NumaLogGroup (/numa/*).
    // No additional policy needed here - see numa-log-group.ts for the shared policy.

    // =========================================================================
    // AGENTCORE RUNTIME
    // =========================================================================

    // Sanitize client name for AgentCore (only alphanumeric and underscores allowed)
    const sanitizedClientName = props.clientName.replace(/-/g, '_');

    this.agentRuntime = new BedrockagentcoreAgentRuntime(this, 'agentcore-runtime', {
      // Ensure image is pushed to ECR before creating AgentCore runtime
      dependsOn: [pushImage],

      agentRuntimeName: `numa_${sanitizedClientName}_workspace_chat`,
      description: `Numa Workspace Chat Agent for ${props.clientName}`,

      // Container configuration (CDKTF expects array)
      // Uses content-based tag so Terraform detects changes and updates the runtime
      agentRuntimeArtifact: [
        {
          containerConfiguration: [
            {
              containerUri: `${this.ecrRepository.repositoryUrl}:${imageTag}`,
            },
          ],
        },
      ],

      // IAM role
      roleArn: agentCoreRole.arn,

      // Network configuration - PUBLIC mode (no VPC required)
      networkConfiguration: [
        {
          networkMode: 'PUBLIC',
        },
      ],

      // NOTE: JWT auth disabled - using IAM-only auth.
      // The proxy Lambda already validates the user via Cognito/CloudFront upstream,
      // and passes user_sub in the payload. boto3 can't pass JWT tokens to AgentCore,
      // so we rely on IAM auth + user_sub for session isolation.
      // To re-enable JWT auth, uncomment and use HTTPS requests instead of boto3.
      // authorizerConfiguration: [
      //   {
      //     customJwtAuthorizer: [
      //       {
      //         discoveryUrl: `https://cognito-idp.${props.region}.amazonaws.com/${props.cognitoUserPoolId}/.well-known/openid-configuration`,
      //         allowedAudience: [props.cognitoUserPoolClientId],
      //       },
      //     ],
      //   },
      // ],

      // Protocol configuration
      protocolConfiguration: [
        {
          serverProtocol: 'HTTP',
        },
      ],

      // Session lifecycle - 2 hour idle timeout, 8 hour max lifetime
      // Defaults: idleRuntimeSessionTimeout=900s (15 min), maxLifetime=28800s (8 hrs)
      // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
      lifecycleConfiguration: [
        {
          idleRuntimeSessionTimeout: 7200, // 2 hours in seconds
          maxLifetime: 28800, // 8 hours in seconds
        },
      ],

      // Environment variables
      environmentVariables: {
        // Ensure immediate stdout/stderr flushing for logging visibility
        PYTHONUNBUFFERED: '1',
        // Disable OpenTelemetry SDK (X-Ray OTLP not configured for AgentCore)
        OTEL_SDK_DISABLED: 'true',
        CLIENT_NAME: props.clientName,
        AWS_REGION: props.region,
        LOCAL_WORKSPACE_ROOT: '/workdir',
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        DYNAMODB_TABLE_NAME: `numa-${props.clientName}-chat-history`,
        // CloudWatch direct logging via watchtower (vendedlogs path has write restrictions)
        CLOUDWATCH_LOG_GROUP: containerLogGroup.name,
        // Bedrock configuration
        CLAUDE_CODE_USE_BEDROCK: '1',
        DISABLE_PROMPT_CACHING: '1', // Prompt caching not fully supported on Bedrock
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(regionModel.default.max_tokens),
        MAX_THINKING_TOKENS: '10000',
        // Model configuration
        ANTHROPIC_MODEL: regionModel.default.model_id,
        ANTHROPIC_DEFAULT_SONNET_MODEL: regionModel.default.model_id,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: regionModel.haiku.model_id,
        CLAUDE_CODE_SUBAGENT_MODEL: regionModel.default.model_id,
        // Workspace tools Lambda for KB queries etc. (used by tool wrappers)
        ...(props.workspaceToolsLambdaName && {
          WORKSPACE_TOOLS_LAMBDA_NAME: props.workspaceToolsLambdaName,
        }),
        // Workspace tools Lambda ARN for KB file listings (used by main.py)
        ...(props.workspaceToolsLambdaArn && {
          WORKSPACE_TOOLS_LAMBDA_ARN: props.workspaceToolsLambdaArn,
        }),
        // Cross-account Bedrock access (for global inference profiles)
        ...(props.bedrockAccount && {
          BEDROCK_ACCOUNT: props.bedrockAccount,
        }),
        // IoT streaming config for real-time event delivery
        // Topic structure: numa/{client}/{user_sub}/stream/{request_id}
        IOT_TOPIC_PREFIX: `numa/${props.clientName}`,
        // Agent tables for custom agent support (personal and workspace agents)
        WORKSPACE_AGENTS_TABLE: `numa-${props.clientName}-agents`,
        USER_AGENTS_TABLE: `numa-${props.clientName}-user-agents`,
      },
    });

    // Construct the endpoint URL for CloudFront routing
    // Format: https://<id>.runtime.bedrock-agentcore.<region>.amazonaws.com
    this.agentCoreEndpoint = `https://${this.agentRuntime.agentRuntimeId}.runtime.bedrock-agentcore.${props.region}.amazonaws.com`;

    // =========================================================================
    // CLOUDWATCH LOG DELIVERY (for container logs)
    // =========================================================================

    // Create a log delivery destination pointing to the existing log group
    const logDeliveryDestination = new CloudwatchLogDeliveryDestination(this, 'log-delivery-destination', {
      name: `numa-${props.clientName}-workspace-chat-logs-dest`,
      outputFormat: 'json',
      deliveryDestinationConfiguration: [
        {
          destinationResourceArn: this.logGroup.arn,
        },
      ],
    });

    // Create a log delivery source linked to the AgentCore runtime
    const logDeliverySource = new CloudwatchLogDeliverySource(this, 'log-delivery-source', {
      name: `numa-${props.clientName}-workspace-chat-logs-source`,
      logType: 'APPLICATION_LOGS',
      resourceArn: this.agentRuntime.agentRuntimeArn,
    });

    // Wire source to destination (ensure resource policies are created first)
    new CloudwatchLogDelivery(this, 'log-delivery', {
      dependsOn: [logDeliverySource, vendedlogsDeliveryPolicy],
      deliverySourceName: logDeliverySource.name,
      deliveryDestinationArn: logDeliveryDestination.arn,
    });

    // =========================================================================
    // SESSION CLEANUP ON DEPLOY (not currently possible)
    // =========================================================================
    // NOTE: boto3's bedrock-agentcore client does not have a list_runtime_sessions API.
    // The list_sessions API is for Memory sessions (requires memoryId/actorId), not
    // AgentCore runtime sessions. Until AWS adds a list_runtime_sessions API, we cannot
    // programmatically enumerate and stop active sessions on deploy.
    //
    // Existing sessions will continue running the old container until they hit the
    // idle timeout (4 hours) or max lifetime (8 hours) configured in lifecycleConfiguration.
    // Users starting new sessions after deploy will get the updated container.
    //
    // See: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-agentcore.html
  }
}
