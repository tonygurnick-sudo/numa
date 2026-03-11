import { Construct } from 'constructs';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { NumaLambda, OTelConfig } from './numa-lambda';

/**
 * Configuration for the workspace chat tools Lambda construct.
 */
export interface WorkspaceChatToolsConstructProps {
  /** Client name for resource naming and multi-tenant isolation */
  clientName: string;
  /** AWS region */
  region: string;
  /** CloudWatch log group for Lambda logs */
  logGroup: CloudwatchLogGroup;
  /** Preferred knowledge base provider: "q" or "bedrock" */
  preferredKnowledgeBase: 'q' | 'bedrock' | 'none';
  /** Bedrock Knowledge Base ID (required for bedrock provider) */
  bedrockKnowledgeBaseId?: string;
  /** Q Business Application ID (required for q provider) */
  qApplicationId?: string;
  /** Q Business Retriever ID (required for q provider) */
  qRetrieverId?: string;
  /** Optional OpenTelemetry configuration for observability */
  otelConfig?: OTelConfig;
  /** Data bucket ARN for KB file downloads/uploads */
  dataBucketArn?: string;
  /** Data bucket name for KB file downloads/uploads */
  dataBucketName?: string;
  /** Cognito User Pool ARN (required for admin checks on KB uploads) */
  userPoolArn?: string;
  /** Cognito User Pool ID (required for admin checks on KB uploads) */
  userPoolId?: string;
  /** Outputs bucket ARN for workspace file access (extract_content tool) */
  outputsBucketArn?: string;
  /** Outputs bucket name for workspace file access (extract_content tool) */
  outputsBucketName?: string;
  /** Extract content Lambda ARN for invoking extract-content-from-file */
  extractContentLambdaArn?: string;
  /** Document converter Lambda ARN for invoking document-converter */
  documentConverterLambdaArn?: string;
  /** Integrations approval table name (for Pipedream human-in-the-loop approval) */
  integrationsApprovalTableName?: string;
  /** Integrations approval table ARN (for IAM permissions) */
  integrationsApprovalTableArn?: string;
  /** Pipedream relay Lambda ARN (for invoking relay from workspace tools) */
  pipedreamRelayLambdaArn?: string;
  /** File redirect HMAC secret (for generating clean URLs for integration uploads) */
  fileRedirectSecret?: string;
  /** File redirect base URL (e.g. https://domain/api/workspace-chat-agent) */
  fileRedirectBaseUrl?: string;
  /** Chat settings table name (for user profile memory management) */
  chatSettingsTableName?: string;
  /** Chat settings table ARN (for IAM permissions) */
  chatSettingsTableArn?: string;
  /** Vault audit log table name (for consolidated vault audit logging) */
  vaultAuditLogTableName?: string;
  /** Vault audit log table ARN (for IAM permissions) */
  vaultAuditLogTableArn?: string;
}

/**
 * Construct for the workspace-chat-tools Lambda.
 *
 * This Lambda provides tool implementations for the workspace-chat-agent,
 * handling privileged operations like knowledge base queries.
 *
 * @example
 * ```typescript
 * const workspaceChatTools = new WorkspaceChatToolsConstruct(this, 'workspace-chat-tools', {
 *   clientName: 'acme',
 *   region: 'us-east-1',
 *   logGroup: myLogGroup,
 *   preferredKnowledgeBase: 'bedrock',
 *   bedrockKnowledgeBaseId: 'kb-123456',
 * });
 *
 * // Pass to workspace chat agent construct
 * workspaceChatAgent = new WorkspaceChatAgentConstruct(this, 'workspace-chat-agent', {
 *   // ...
 *   workspaceToolsLambdaName: workspaceChatTools.lambdaName,
 *   workspaceToolsLambdaArn: workspaceChatTools.lambdaArn,
 * });
 * ```
 */
export class WorkspaceChatToolsConstruct extends Construct {
  /** The underlying NumaLambda construct */
  readonly numaLambda: NumaLambda;

  /** Lambda function ARN (for IAM policies) */
  readonly lambdaArn: string;

  /** Lambda function name (for invoke calls) */
  readonly lambdaName: string;

  constructor(scope: Construct, id: string, props: WorkspaceChatToolsConstructProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    // Build policy statements based on configured providers
    const policyStatements = [];

    // Bedrock KB retrieve permission (if configured)
    if (props.bedrockKnowledgeBaseId) {
      policyStatements.push({
        sid: 'BedrockKBRetrieve',
        effect: 'Allow',
        actions: ['bedrock:Retrieve'],
        resources: [
          `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:knowledge-base/${props.bedrockKnowledgeBaseId}`,
        ],
      });
    }

    // Bedrock invoke for summarization (Nova Lite model)
    policyStatements.push({
      sid: 'BedrockSummarization',
      effect: 'Allow',
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: [
        // Nova models for summarization (Nova 1 and Nova 2)
        'arn:aws:bedrock:*::foundation-model/amazon.nova-*',
        // Cross-region inference profiles (for global.amazon.nova-2-lite-v1:0)
        `arn:aws:bedrock:${props.region}:${callerIdentity.accountId}:inference-profile/*`,
      ],
    });

    // Q Business permission (if configured)
    if (props.qApplicationId) {
      policyStatements.push({
        sid: 'QBusinessSearch',
        effect: 'Allow',
        actions: ['qbusiness:SearchRelevantContent'],
        resources: [
          `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.qApplicationId}`,
          `arn:aws:qbusiness:${props.region}:${callerIdentity.accountId}:application/${props.qApplicationId}/*`,
        ],
      });
    }

    // S3 permission for KB file downloads and uploads (if data bucket configured)
    if (props.dataBucketArn) {
      policyStatements.push({
        sid: 'S3KBFileAccess',
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:ListBucket', 's3:PutObject'],
        resources: [props.dataBucketArn, `${props.dataBucketArn}/*`],
      });
    }

    // Cognito permission for admin group check (required for company KB uploads)
    if (props.userPoolArn) {
      policyStatements.push({
        sid: 'CognitoAdminCheck',
        effect: 'Allow',
        actions: ['cognito-idp:AdminListGroupsForUser'],
        resources: [props.userPoolArn],
      });
    }

    // DynamoDB permission for KB permission verification
    // Used to verify user has access to requested KB (defense-in-depth)
    policyStatements.push({
      sid: 'DynamoDBKBPermissions',
      effect: 'Allow',
      actions: ['dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-knowledge-bases`,
      ],
    });

    // DynamoDB permission for agent management
    // Allows listing, getting, creating, updating, and duplicating agents
    policyStatements.push({
      sid: 'DynamoDBAgentManagement',
      effect: 'Allow',
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
      resources: [
        // Workspace agents table
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-agents`,
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-agents/index/*`,
        // User (personal) agents table
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-user-agents`,
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-user-agents/index/*`,
        // Agents settings table (for admin policy)
        `arn:aws:dynamodb:${props.region}:${callerIdentity.accountId}:table/numa-${props.clientName}-agents-settings`,
      ],
    });

    // S3 permission for outputs bucket (workspace files for extract_content tool)
    if (props.outputsBucketArn) {
      policyStatements.push({
        sid: 'S3OutputsAccess',
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${props.outputsBucketArn}/*`],
      });
    }

    // Lambda invoke permission for extract-content-from-file
    if (props.extractContentLambdaArn) {
      policyStatements.push({
        sid: 'InvokeExtractContent',
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [props.extractContentLambdaArn],
      });
    }

    // Lambda invoke permission for document-converter
    if (props.documentConverterLambdaArn) {
      policyStatements.push({
        sid: 'InvokeDocumentConverter',
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [props.documentConverterLambdaArn],
      });
    }

    // DynamoDB permission for integrations approval table (human-in-the-loop)
    if (props.integrationsApprovalTableArn) {
      policyStatements.push({
        sid: 'DynamoDBIntegrationsApproval',
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.integrationsApprovalTableArn],
      });
    }

    // DynamoDB permission for chat settings table (user profile memory management)
    if (props.chatSettingsTableArn) {
      policyStatements.push({
        sid: 'DynamoDBChatSettingsAccess',
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [props.chatSettingsTableArn],
      });
    }

    // DynamoDB permission for vault audit log table (consolidated vault audit logging)
    if (props.vaultAuditLogTableArn) {
      policyStatements.push({
        sid: 'DynamoDBVaultAuditLog',
        effect: 'Allow',
        actions: ['dynamodb:PutItem', 'dynamodb:Query'],
        resources: [props.vaultAuditLogTableArn],
      });
    }

    // Secrets Manager permission for consolidated vault access
    policyStatements.push({
      sid: 'SecretsManagerVaultAccess',
      effect: 'Allow',
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
        'secretsmanager:CreateSecret',
        'secretsmanager:UpdateSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:DescribeSecret',
      ],
      resources: [
        `arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/users/*`,
        `arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/company*`,
        `arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/templates/*`,
      ],
    });

    // Lambda invoke permission for Pipedream relay (integration actions)
    if (props.pipedreamRelayLambdaArn) {
      policyStatements.push({
        sid: 'InvokePipedreamRelay',
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [props.pipedreamRelayLambdaArn],
      });
    }

    // Create the Lambda using NumaLambda construct
    this.numaLambda = new NumaLambda(this, 'lambda', {
      clientName: props.clientName,
      lambdaDirectory: 'python/workspace-chat-tools/',
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      memorySize: 1024,
      timeout: 300,
      logGroup: props.logGroup,
      resourceNameSuffix: '_workspace_chat_tools',
      otelConfig: props.otelConfig,
      environment: {
        CLIENT_NAME: props.clientName,
        // AWS_REGION is automatically provided by Lambda runtime
        PREFERRED_KNOWLEDGE_BASE: props.preferredKnowledgeBase,
        // KB configuration (empty string if not configured)
        Q_APPLICATION_ID: props.qApplicationId ?? '',
        Q_RETRIEVER_ID: props.qRetrieverId ?? '',
        BEDROCK_KNOWLEDGE_BASE_ID: props.bedrockKnowledgeBaseId ?? '',
        // Nova 2 Lite for fast, cost-effective summarization with reasoning
        FAST_MODEL_ID: 'global.amazon.nova-2-lite-v1:0',
        // Data bucket for KB file downloads/uploads
        DATA_BUCKET_NAME: props.dataBucketName ?? '',
        // Cognito User Pool ID for admin group checks on KB uploads
        USER_POOL_ID: props.userPoolId ?? '',
        // Outputs bucket for workspace files (extract_content tool)
        OUTPUTS_BUCKET_NAME: props.outputsBucketName ?? '',
        // Extract content Lambda name for invoking extract-content-from-file
        EXTRACT_CONTENT_LAMBDA_NAME: props.extractContentLambdaArn
          ? (props.extractContentLambdaArn.split(':').pop() ?? '')
          : '',
        // Document converter Lambda name for invoking document-converter
        DOCUMENT_CONVERTER_LAMBDA_NAME: props.documentConverterLambdaArn
          ? (props.documentConverterLambdaArn.split(':').pop() ?? '')
          : '',
        // Agent management tables
        WORKSPACE_AGENTS_TABLE: `numa-${props.clientName}-agents`,
        USER_AGENTS_TABLE: `numa-${props.clientName}-user-agents`,
        AGENTS_SETTINGS_TABLE_NAME: `numa-${props.clientName}-agents-settings`,
        // Chat settings table (for user profile memory management)
        ...(props.chatSettingsTableName && {
          CHAT_SETTINGS_TABLE_NAME: props.chatSettingsTableName,
        }),
        // Consolidated vault configuration
        ...(props.vaultAuditLogTableName && {
          VAULT_AUDIT_LOG_TABLE_NAME: props.vaultAuditLogTableName,
        }),
        VAULT_SECRETS_PREFIX: `${props.clientName}/vault`,
        // Pipedream integrations (optional)
        INTEGRATIONS_APPROVAL_TABLE_NAME: props.integrationsApprovalTableName ?? '',
        PIPEDREAM_RELAY_LAMBDA_ARN: props.pipedreamRelayLambdaArn ?? '',
        // File redirect for integration uploads (clean URLs to avoid Slack filename length issues)
        ...(props.fileRedirectSecret && {
          FILE_REDIRECT_SECRET: props.fileRedirectSecret,
        }),
        ...(props.fileRedirectBaseUrl && {
          FILE_REDIRECT_BASE_URL: props.fileRedirectBaseUrl,
        }),
        // Note: Lambda's native logging goes to the shared log group via logGroup prop
      },
      additionalPolicyStatements: policyStatements,
    });

    // Expose Lambda ARN and name for downstream constructs
    this.lambdaArn = this.numaLambda.lambda.arn;
    this.lambdaName = this.numaLambda.lambda.functionName;
  }
}
