import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import path from 'node:path';

// AWS Provider imports
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
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
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';

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
  /** Integrations approval table name (for writing approval decisions from the service) */
  integrationsApprovalTableName?: string;
  /** Integrations approval table ARN (for IAM permissions) */
  integrationsApprovalTableArn?: string;
  /** Chat settings table name (for reading user approval mode preferences) */
  chatSettingsTableName?: string;
  /** Chat settings table ARN (for IAM permissions) */
  chatSettingsTableArn?: string;
  /** Whether to enable vault secrets functionality (enables vault system prompt and tools) */
  secretsVaultEnabled?: boolean;
  /** Company bucket name (for loading company profile into system prompt) */
  companyBucketName?: string;
  /** Company bucket ARN (for IAM permissions) */
  companyBucketArn?: string;
  /** Optional AWS provider for AgentCore-region resources (when cross-region) */
  agentCoreProvider?: AwsProvider;
  /** Region where AgentCore resources are deployed (defaults to props.region) */
  agentCoreRegion?: string;
  /** OAuth workspace tools Lambda function name (for connect tools) */
  oauthWorkspaceToolsLambdaName?: string;
  /** OAuth workspace tools Lambda ARN (for IAM invoke permission) */
  oauthWorkspaceToolsLambdaArn?: string;
  /** Data bucket name (for downloading attached files from My Files / Company Files) */
  dataBucketName?: string;
  /** Data bucket ARN (for IAM read permissions) */
  dataBucketArn?: string;
  /** Ext API doc bucket name (for syncing API reference documentation to workspace) */
  extApiDocBucketName?: string;
  /** Ext API doc bucket ARN (for IAM read permissions) */
  extApiDocBucketArn?: string;
  /** V2 app runs DynamoDB table name (for updating run status on completion) */
  v2AppRunsTableName?: string;
  /** V2 app runs DynamoDB table ARN (for IAM permissions) */
  v2AppRunsTableArn?: string;
  /** Extract content Lambda ARN (for Nolia PDF vision extraction) */
  extractContentLambdaArn?: string;
  /** Document converter Lambda ARN (for DOCX/Office → PDF conversion) */
  documentConverterLambdaArn?: string;
  /** Whether Numa Ops feature is enabled for this client */
  numaOpsEnabled?: boolean;
  /** Frontend base URL (e.g. https://nd-labs.numa.arcanum.ai) for constructing links */
  frontendUrl?: string;
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

    // Region-aware model configuration
    // us-east-1 uses us.* prefix, ap-southeast-2 uses au.* for 4.5+ models, apac.* for older
    const REGIONAL_MODEL_MAP: Record<
      string,
      {
        default: { model_id: string; max_tokens: number };
        fallback: { model_id: string; max_tokens: number };
        haiku: { model_id: string; max_tokens: number };
      }
    > = {
      'us-east-1': {
        default: { model_id: 'us.anthropic.claude-sonnet-4-6', max_tokens: 64000 },
        fallback: { model_id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
        haiku: { model_id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
      },
      'ap-southeast-2': {
        default: { model_id: 'au.anthropic.claude-sonnet-4-6', max_tokens: 64000 },
        fallback: { model_id: 'au.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
        haiku: { model_id: 'au.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
      },
      'ap-southeast-3': {
        default: { model_id: 'global.anthropic.claude-sonnet-4-6', max_tokens: 64000 },
        fallback: { model_id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
        haiku: { model_id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', max_tokens: 64000 },
      },
    };
    // AgentCore region — where compute runs (may differ from data region)
    const acRegion = props.agentCoreRegion ?? props.region;
    // Model IDs must match the Bedrock endpoint region the container calls (AWS_REGION = data region).
    // Task 01 (Jakarta region support) will add a separate BEDROCK_REGION config to decouple this.
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
      'image.tar'
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
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
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
aws ecr get-login-password --region ${acRegion} | \\
  skopeo login --authfile /tmp/skopeo-auth.json --username AWS --password-stdin ${callerIdentity.accountId}.dkr.ecr.${acRegion}.amazonaws.com

# Delete all existing images to keep ECR lean (versions tracked in git, not ECR)
echo "Cleaning up old images from ECR..."
REPO_NAME="numa-${props.clientName}-workspace-chat-agent"
IMAGES=$(aws ecr list-images --repository-name "$REPO_NAME" --region ${acRegion} --query 'imageIds[*]' --output json 2>/dev/null || echo "[]")
if [ "$IMAGES" != "[]" ] && [ -n "$IMAGES" ]; then
  aws ecr batch-delete-image --repository-name "$REPO_NAME" --region ${acRegion} --image-ids "$IMAGES" || true
  echo "Deleted old images"
else
  echo "No existing images to delete"
fi

# Push image from tar to client ECR
# --insecure-policy skips signature verification (no policy.json in container)
skopeo copy --authfile /tmp/skopeo-auth.json --insecure-policy \\
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
            sid: 'MarketplaceModelAccess',
            effect: 'Allow',
            actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
            resources: ['*'],
          },
          {
            sid: 'S3WorkspaceAccess',
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
            // Path must match S3_PREFIX in s3_workspace.py: "numa-chat/workspace"
            // Also includes v2-apps/* for V2 app runs (agent type s3_prefix_template)
            resources: [
              props.outputsBucketArn,
              `${props.outputsBucketArn}/numa-chat/workspace/*`,
              `${props.outputsBucketArn}/v2-apps/*`,
            ],
          },
          // Agent reference files - read-only access for downloading agent files
          {
            sid: 'S3AgentFilesRead',
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:ListBucket'],
            // Path matches agent file storage: agents/{agent_id}/files/
            resources: [props.outputsBucketArn, `${props.outputsBucketArn}/numa-chat/agents/*`],
          },
          // Company profile - read-only access for loading company profile into system prompt
          ...(props.companyBucketArn
            ? [
                {
                  sid: 'S3CompanyProfileRead',
                  effect: 'Allow' as const,
                  actions: ['s3:GetObject'],
                  resources: [`${props.companyBucketArn}/company-data.json`],
                },
              ]
            : []),
          {
            sid: 'XRayTracing',
            effect: 'Allow',
            actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
            resources: ['*'],
          },
          {
            sid: 'DynamoDBAccess',
            effect: 'Allow',
            actions: [
              'dynamodb:UpdateItem',
              'dynamodb:PutItem',
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:DeleteItem',
            ],
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
          // Chat settings table - read-only access for user approval mode preferences
          ...(props.chatSettingsTableArn
            ? [
                {
                  sid: 'DynamoDBChatSettingsRead',
                  effect: 'Allow' as const,
                  actions: ['dynamodb:GetItem'],
                  resources: [props.chatSettingsTableArn],
                },
              ]
            : []),
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
          // OAuth workspace tools Lambda invoke permission (for connect tools)
          ...(props.oauthWorkspaceToolsLambdaArn
            ? [
                {
                  sid: 'LambdaInvokeOAuthWorkspaceTools',
                  effect: 'Allow',
                  actions: ['lambda:InvokeFunction'],
                  resources: [props.oauthWorkspaceToolsLambdaArn],
                },
              ]
            : []),
          // Extract content Lambda invoke permission (for Nolia PDF vision extraction)
          ...(props.extractContentLambdaArn
            ? [
                {
                  sid: 'LambdaInvokeExtractContent',
                  effect: 'Allow',
                  actions: ['lambda:InvokeFunction'],
                  resources: [props.extractContentLambdaArn],
                },
              ]
            : []),
          // Document converter Lambda invoke permission (for DOCX/Office → PDF conversion)
          ...(props.documentConverterLambdaArn
            ? [
                {
                  sid: 'LambdaInvokeDocumentConverter',
                  effect: 'Allow',
                  actions: ['lambda:InvokeFunction'],
                  resources: [props.documentConverterLambdaArn],
                },
              ]
            : []),
          // Data bucket read access (for downloading attached files from My Files / Company Files)
          // and write access to KB prefixes (for rules generation upload)
          ...(props.dataBucketArn
            ? [
                {
                  sid: 'S3DataBucketRead',
                  effect: 'Allow' as const,
                  actions: ['s3:GetObject', 's3:ListBucket'],
                  resources: [props.dataBucketArn, `${props.dataBucketArn}/*`],
                },
                {
                  sid: 'S3DataBucketKBWrite',
                  effect: 'Allow' as const,
                  actions: ['s3:PutObject'],
                  resources: [`${props.dataBucketArn}/documents/kb-*`],
                },
              ]
            : []),
          // Ext API doc bucket read access (for syncing API reference docs to workspace)
          ...(props.extApiDocBucketArn
            ? [
                {
                  sid: 'S3ExtApiDocRead',
                  effect: 'Allow' as const,
                  actions: ['s3:GetObject', 's3:ListBucket'],
                  resources: [props.extApiDocBucketArn, `${props.extApiDocBucketArn}/*`],
                },
              ]
            : []),
          // DynamoDB UpdateItem for integration tool approval decisions
          ...(props.integrationsApprovalTableArn
            ? [
                {
                  sid: 'DynamoDBIntegrationsApproval',
                  effect: 'Allow',
                  actions: ['dynamodb:UpdateItem'],
                  resources: [props.integrationsApprovalTableArn],
                },
              ]
            : []),
          // V2 app runs table - update run status on completion
          ...(props.v2AppRunsTableArn
            ? [
                {
                  sid: 'DynamoDBV2AppRunsUpdate',
                  effect: 'Allow' as const,
                  actions: ['dynamodb:UpdateItem'],
                  resources: [props.v2AppRunsTableArn],
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
    // Vendedlogs must be in the same region as AgentCore
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
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

    // Shared vendedlogs resource policy — uses a fixed name so all client stacks
    // in the same account share one policy (AWS limit: 10 resource policies per account).
    // PutResourcePolicy is idempotent, so concurrent deploys are safe.
    // DataAwsRegion and resource policy must be in the AgentCore region for vendedlogs
    const region = new DataAwsRegion(this, 'current-region', {
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
    }).region;
    const vendedlogsDeliveryPolicy = new CloudwatchLogResourcePolicy(this, 'vendedlogs-delivery-policy', {
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
      policyName: 'numa-vendedlogs-resource-policy',
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
            Resource: `arn:aws:logs:${region}:${callerIdentity.accountId}:log-group:/aws/vendedlogs/*`,
            Condition: {
              StringEquals: {
                'aws:SourceAccount': callerIdentity.accountId,
              },
              ArnLike: {
                'aws:SourceArn': `arn:aws:logs:${region}:${callerIdentity.accountId}:*`,
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
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
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

      // Session lifecycle - 3 hour idle timeout, 4 hour max lifetime
      // Fire-and-forget pipelines (Nolia, V2 Apps) can run 30-60+ min after the
      // 202 response. The heartbeat subprocess isn't reliably deferring idle kills
      // (see NUMA-1209), so we use a generous timeout as a workaround.
      // Defaults: idleRuntimeSessionTimeout=900s (15 min), maxLifetime=28800s (8 hrs)
      // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
      lifecycleConfiguration: [
        {
          idleRuntimeSessionTimeout: 10800, // 3 hours in seconds
          maxLifetime: 14400, // 4 hours in seconds
        },
      ],

      // Environment variables
      environmentVariables: {
        // Ensure immediate stdout/stderr flushing for logging visibility
        PYTHONUNBUFFERED: '1',
        // Temporary: DEBUG logging for Nolia pipeline testing
        LOG_LEVEL: 'DEBUG',
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
        ENABLE_PROMPT_CACHING_1H_BEDROCK: '1', // 1-hour TTL prompt caching on Bedrock
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(regionModel.default.max_tokens),
        MAX_THINKING_TOKENS: '10000',
        // Model configuration
        ANTHROPIC_MODEL: regionModel.default.model_id,
        ANTHROPIC_SMALL_FAST_MODEL: regionModel.haiku.model_id,
        CLAUDE_CODE_SUBAGENT_MODEL: regionModel.default.model_id,
        // Workspace tools Lambda for KB queries etc. (used by tool wrappers)
        ...(props.workspaceToolsLambdaName && {
          WORKSPACE_TOOLS_LAMBDA_NAME: props.workspaceToolsLambdaName,
        }),
        // Workspace tools Lambda ARN for KB file listings (used by main.py)
        ...(props.workspaceToolsLambdaArn && {
          WORKSPACE_TOOLS_LAMBDA_ARN: props.workspaceToolsLambdaArn,
        }),
        // OAuth workspace tools Lambda for connect tools (OAuth, Synergy, S3 data bucket)
        ...(props.oauthWorkspaceToolsLambdaName && {
          OAUTH_WORKSPACE_TOOLS_LAMBDA_NAME: props.oauthWorkspaceToolsLambdaName,
        }),
        // V2 app runs table (for updating run status on completion)
        ...(props.v2AppRunsTableName && {
          V2_APP_RUNS_TABLE: props.v2AppRunsTableName,
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
        // Integrations approval table (for writing approval decisions)
        ...(props.integrationsApprovalTableName && {
          INTEGRATIONS_APPROVAL_TABLE_NAME: props.integrationsApprovalTableName,
        }),
        // Chat settings table (for reading user approval mode preferences)
        ...(props.chatSettingsTableName && {
          CHAT_SETTINGS_TABLE_NAME: props.chatSettingsTableName,
        }),
        // Company bucket for loading company profile into system prompt
        ...(props.companyBucketName && {
          COMPANY_BUCKET_NAME: props.companyBucketName,
        }),
        // Data bucket for downloading attached files (My Files / Company Files)
        ...(props.dataBucketName && {
          DATA_BUCKET_NAME: props.dataBucketName,
        }),
        // Ext API doc bucket for syncing API reference documentation to workspace
        ...(props.extApiDocBucketName && {
          EXT_API_DOC_BUCKET_NAME: props.extApiDocBucketName,
        }),
        // Extract content Lambda for Nolia PDF vision extraction
        ...(props.extractContentLambdaArn && {
          EXTRACT_CONTENT_LAMBDA_ARN: props.extractContentLambdaArn,
        }),
        // Document converter Lambda for DOCX/Office → PDF conversion
        ...(props.documentConverterLambdaArn && {
          DOCUMENT_CONVERTER_LAMBDA_NAME: props.documentConverterLambdaArn.split(':').pop() ?? '',
        }),
        // Numa Ops feature flag (enables the ops MCP tool)
        ...(props.numaOpsEnabled && {
          NUMA_OPS_ENABLED: 'true',
        }),
        // Frontend base URL for constructing links (e.g. ticket URLs)
        ...(props.frontendUrl && {
          NUMA_FRONTEND_URL: props.frontendUrl,
        }),
      },
    });

    // Construct the endpoint URL for CloudFront routing
    // Format: https://<id>.runtime.bedrock-agentcore.<region>.amazonaws.com
    this.agentCoreEndpoint = `https://${this.agentRuntime.agentRuntimeId}.runtime.bedrock-agentcore.${acRegion}.amazonaws.com`;

    // =========================================================================
    // CLOUDWATCH LOG DELIVERY (for container logs)
    // =========================================================================

    // Create a log delivery destination pointing to the existing log group
    // Log delivery resources must be in the same region as AgentCore
    const logDeliveryDestination = new CloudwatchLogDeliveryDestination(this, 'log-delivery-destination', {
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
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
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
      name: `numa-${props.clientName}-workspace-chat-logs-source`,
      logType: 'APPLICATION_LOGS',
      resourceArn: this.agentRuntime.agentRuntimeArn,
    });

    // Wire source to destination (ensure resource policies are created first)
    new CloudwatchLogDelivery(this, 'log-delivery', {
      ...(props.agentCoreProvider && { provider: props.agentCoreProvider }),
      dependsOn: [logDeliverySource, vendedlogsDeliveryPolicy],
      deliverySourceName: logDeliverySource.name,
      deliveryDestinationArn: logDeliveryDestination.arn,
    });

    // =========================================================================
    // SESSION LIFECYCLE ON DEPLOY
    // =========================================================================
    // Sessions are conversation-scoped (conv-{conversationId}), so each new chat
    // automatically gets a fresh MicroVM with the latest container image.
    // Existing conversations keep their warm sessions until the idle timeout (1hr)
    // or max lifetime (8hr) expires. No active session cleanup is needed on deploy.
  }
}
