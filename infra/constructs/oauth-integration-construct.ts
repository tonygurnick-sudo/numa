import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';
import { NumaLambda } from './numa-lambda';

// ─── OAuth Integration Construct ────────────────────────────────────────────────
// Creates OAuth cloud storage integration infrastructure: 2 API Lambdas
// (auth handler + files API) with API Gateway routes and Secrets Manager/DynamoDB
// permissions for vault-based token storage, plus a standalone workspace tools
// Lambda invoked directly by the workspace agent for unified connector access
// (OAuth, Synergy, S3 data bucket, generic HTTP).

export interface OAuthProviderConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
}

export interface OAuthIntegrationConstructProps extends ApiGatewayLambdaCollectionProps {
  /** AWS region for resource ARNs */
  region: string;
  /** Vault audit log DynamoDB table name */
  vaultAuditLogTableName: string;
  /** Frontend base URL for CORS and OAuth callbacks */
  frontendBaseUrl: string;
  /** OAuth provider configurations keyed by provider name */
  oauthProviders: Record<string, OAuthProviderConfig>;
  /** Data connectors DynamoDB table name (for Synergy credential resolution) */
  dataConnectorsTableName?: string;
  /** Data connectors DynamoDB table ARN (for IAM permissions) */
  dataConnectorsTableArn?: string;
  /** Global data connector settings table name (for Pub/Sub topic lookup) */
  dataConnectorsSettingsTableName?: string;
  /** Global data connector settings table ARN (for IAM permissions) */
  dataConnectorsSettingsTableArn?: string;
  /** Data bucket name (for S3 data bucket connector) */
  dataBucketName?: string;
  /** Data bucket ARN (for IAM permissions) */
  dataBucketArn?: string;
  /** Outputs bucket name (for staging large connector downloads as presigned URLs) */
  outputsBucketName?: string;
  /** Outputs bucket ARN (for IAM permissions) */
  outputsBucketArn?: string;
  /**
   * Synergy crawl state (JOB#) table — powers the exhaustive structured /
   * portfolio query. Empty string when `synergy` is off, so the env +
   * IAM are only wired when the flag is enabled (the table doesn't exist otherwise).
   */
  synergyCrawlStateTableName?: string;
  /** Synergy crawl state table ARN (for the flag-gated scan IAM). */
  synergyCrawlStateTableArn?: string;
  /**
   * Synergy per-query credit-debit Lambda name — the workspace-tools query
   * handlers fire-and-forget it to meter portfolio / exact-term read-capacity
   * under the real caller. Empty string when `synergy` is off (the
   * debit lambda doesn't exist), so the env + InvokeFunction IAM are only wired
   * when the flag is enabled.
   */
  synergyCreditDebitFunctionName?: string;
  /** Synergy credit-debit Lambda ARN (for the flag-gated InvokeFunction IAM). */
  synergyCreditDebitFunctionArn?: string;
}

export class OAuthIntegrationConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  /** Lambda ARN for the workspace tools Lambda (invoked by workspace agent) */
  readonly workspaceToolsLambdaArn: string;
  /** Lambda function name for the workspace tools Lambda */
  readonly workspaceToolsLambdaName: string;

  constructor(scope: Construct, name: string, props: OAuthIntegrationConstructProps) {
    super(scope, name, props);

    this.logGroup = new NumaLogGroup(this, 'oauth-log-group', {
      logGroupName: `${props.clientName}-oauth`,
    }).logGroup;

    const vaultSecretsPrefix = `${props.clientName}/vault`;
    const dataConnectorsSecretsPrefix = `${props.clientName}/data-connectors`;

    // OAuth client credentials are now read from consolidated COMPANY vault at runtime.
    // No provider-specific env vars needed.
    const sharedEnv: Record<string, string> = {
      CLIENT_NAME: props.clientName,
      VAULT_SECRETS_PREFIX: vaultSecretsPrefix,
      VAULT_AUDIT_LOG_TABLE_NAME: props.vaultAuditLogTableName,
      FRONTEND_BASE_URL: props.frontendBaseUrl,
    };

    // Consolidated vault access via Secrets Manager
    const consolidatedVaultPolicy = [
      {
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
          `arn:aws:secretsmanager:*:*:secret:${vaultSecretsPrefix}/users/*`,
          `arn:aws:secretsmanager:*:*:secret:${vaultSecretsPrefix}/company*`,
          `arn:aws:secretsmanager:*:*:secret:${vaultSecretsPrefix}/pkce/*`,
        ],
      },
      // Audit log table access (keep existing)
      {
        effect: 'Allow',
        actions: ['dynamodb:PutItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.vaultAuditLogTableName}`],
      },
    ];

    const oauthPolicy = consolidatedVaultPolicy;

    // OAuth Authorization Handler (Node.js)
    // Handles OAuth authorize/callback/refresh/revoke flows.
    // No authorizer: OAuth callbacks receive redirects from external providers.
    // Also registers Gmail push notifications on first connect.
    const oauthAuthPolicy = [
      ...oauthPolicy,
      // Data connectors table. UpdateItem: Gmail watch registration writes the
      // connector row (connected_email + watch_expiry). GetItem: the /oauth/gmail/status
      // check reads the row so "connected" only reports true when the Gmail
      // connection is actually triggerable (vault token AND connector row).
      ...(props.dataConnectorsTableArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
              resources: [props.dataConnectorsTableArn],
            },
          ]
        : []),
      // Global connector settings table (read Pub/Sub topic for Gmail watch)
      ...(props.dataConnectorsSettingsTableArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['dynamodb:GetItem'],
              resources: [props.dataConnectorsSettingsTableArn],
            },
          ]
        : []),
    ];

    this.addLambdaFunction(this, 'oauth-auth', {
      addAuthorizer: false,
      lambdaDirectory: 'node/oauth-auth-handler',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 256,
      timeout: 29,
      environment: {
        ...sharedEnv,
        DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName ?? '',
        DATA_CONNECTORS_SETTINGS_TABLE_NAME: props.dataConnectorsSettingsTableName ?? '',
      },
      additionalPolicyStatements: oauthAuthPolicy,
      route: [
        { verb: 'ANY', path: 'oauth/{proxy+}' },
        // PAT connector routes live in the same Lambda but use a distinct
        // route prefix and a separate handler block. See handlePatRequest
        // in oauth-auth-handler/index.ts. Kept here (rather than a new
        // Lambda) deliberately — shared vault helpers, no infra churn.
        { verb: 'ANY', path: 'pat/{proxy+}' },
      ],
    });

    // OAuth Files API Handler (Python)
    // Handles file list/download/metadata/search operations.
    // Requires Cognito authorizer for user identity.
    this.addLambdaFunction(this, 'oauth-files-api', {
      addAuthorizer: true,
      lambdaDirectory: 'python/oauth-files-api',
      handler: 'lambda_function.lambda_handler',
      memorySize: 512,
      timeout: 29,
      environment: sharedEnv,
      additionalPolicyStatements: oauthPolicy,
      route: [
        { verb: 'GET', path: 'oauth-files/{proxy+}' },
        { verb: 'POST', path: 'oauth-files/{proxy+}' },
      ],
    });

    // ── Workspace Tools Lambda (standalone, not API Gateway) ──────────────
    // Invoked directly by the workspace agent for unified connector access:
    // OAuth file ops, Synergy 12d, S3 data bucket, and generic HTTP requests.
    const workspaceToolsPolicy = [
      // Consolidated vault access (same as other OAuth Lambdas)
      ...consolidatedVaultPolicy,
      // Data connectors table (Synergy credential resolution)
      ...(props.dataConnectorsTableArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['dynamodb:GetItem', 'dynamodb:Query'],
              resources: [props.dataConnectorsTableArn],
            },
          ]
        : []),
      // Data connectors secrets (Synergy PAT tokens)
      {
        effect: 'Allow' as const,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:*:*:secret:${dataConnectorsSecretsPrefix}/*`],
      },
      // S3 data bucket (KB files, user files, company files)
      ...(props.dataBucketArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [props.dataBucketArn, `${props.dataBucketArn}/*`],
            },
          ]
        : []),
      // Outputs bucket — stage large connector downloads here and hand them
      // back to the workspace agent as presigned GET URLs (avoids the 6 MB
      // Lambda response cap that silently truncates hex-encoded files).
      // GetObject is required so the lambda can sign valid presigned GETs.
      ...(props.outputsBucketArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['s3:PutObject', 's3:GetObject'],
              resources: [`${props.outputsBucketArn}/numa-chat/connector-downloads/*`],
            },
          ]
        : []),
      // Synergy crawl state (JOB#) table — read-only scan/query for the exhaustive
      // structured/portfolio query. Only present when synergy is on (the
      // ARN is '' otherwise, so this whole statement drops out — flag-gated).
      ...(props.synergyCrawlStateTableArn
        ? [
            {
              effect: 'Allow' as const,
              // BatchGetItem: the exact_term_search ACL probe fetches JOB#/META
              // rows in batches (≤100 keys/call) against the base table ARN.
              actions: ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:BatchGetItem'],
              resources: [props.synergyCrawlStateTableArn, `${props.synergyCrawlStateTableArn}/index/*`],
            },
          ]
        : []),
      // Synergy per-query credit debit — fire-and-forget the debit lambda to
      // meter portfolio / exact-term read-capacity under the real caller. Only
      // present when synergy is on (the ARN is '' otherwise, so this
      // statement drops out — flag-gated, mirrors the crawler/coordinator wiring
      // in synergy-kb-crawler-construct.ts).
      ...(props.synergyCreditDebitFunctionArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['lambda:InvokeFunction'],
              resources: [props.synergyCreditDebitFunctionArn],
            },
          ]
        : []),
    ];

    const workspaceToolsLambda = new NumaLambda(this, 'oauth-workspace-tools', {
      clientName: props.clientName,
      lambdaDirectory: 'python/oauth-workspace-tools/',
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 120,
      logGroup: this.logGroup,
      resourceNameSuffix: '_oauth_workspace_tools',
      environment: {
        ...sharedEnv,
        // Data connectors table for Synergy credential resolution
        DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName ?? '',
        DATA_CONNECTORS_SECRETS_PREFIX: dataConnectorsSecretsPrefix,
        // S3 data bucket for KB/file access
        DATA_BUCKET_NAME: props.dataBucketName ?? '',
        // Outputs bucket for staging large connector downloads (presigned URLs)
        OUTPUTS_BUCKET_NAME: props.outputsBucketName ?? '',
        // Synergy crawl state table for the structured/portfolio query. Empty
        // when synergy is off → the handler returns a clear "not enabled".
        SYNERGY_STATE_TABLE_NAME: props.synergyCrawlStateTableName ?? '',
        // Synergy per-query credit-debit lambda — the query handlers fire-and-
        // forget it to meter read-capacity under the real caller. Empty when
        // synergy is off → the handler skips metering silently.
        SYNERGY_CREDIT_DEBIT_FUNCTION_NAME: props.synergyCreditDebitFunctionName ?? '',
      },
      additionalPolicyStatements: workspaceToolsPolicy,
    });

    this.workspaceToolsLambdaArn = workspaceToolsLambda.lambda.arn;
    this.workspaceToolsLambdaName = workspaceToolsLambda.lambda.functionName;
  }
}
