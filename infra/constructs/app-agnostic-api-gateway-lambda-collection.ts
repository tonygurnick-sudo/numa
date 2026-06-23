import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudwatchMetricAlarm } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { SchedulerScheduleGroup } from '@cdktf/provider-aws/lib/scheduler-schedule-group';
import { ServerlessapplicationrepositoryCloudformationStack } from '@cdktf/provider-aws/lib/serverlessapplicationrepository-cloudformation-stack';
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;
  readonly clientName: string;
  // Expose shared extract-content Lambda for reuse by Step Functions
  public readonly extractContentLambda: import('@cdktf/provider-aws/lib/lambda-function').LambdaFunction;
  public readonly agentsLambda: import('@cdktf/provider-aws/lib/lambda-function').LambdaFunction;
  public readonly agentScheduleRunnerLambda: import('@cdktf/provider-aws/lib/lambda-function').LambdaFunction;

  constructor(scope: Construct, name: string, props: AppAgnosticApiGatewayLambdaCollectionProps) {
    super(scope, name, props);

    this.logGroup = props.logGroup;
    this.clientName = props.clientName;

    // TODO: remove once deployed, this is only here to move the resource
    new NumaLogGroup(this, 'lambda-log-group', {
      logGroupName: this.node.id,
    }).logGroup.moveTo(`${props.clientName}-core-log-group`);

    // SRP Proxy
    const environment = {
      ALLOWED_ORIGIN: '*', // TODO: More closely scope this.
      CLIENT_SECRET: props.userPoolClientSecret,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: props.region,
    };

    this.addLambdaFunction(this, 'srp-hasher', {
      addAuthorizer: false,
      lambdaDirectory: 'node/srp-hasher',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'srp-hasher',
      },
      environment,
    });

    // Web Search Proxy GET
    this.addLambdaFunction(this, 'web-search-proxy', {
      addAuthorizer: false,
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      route: {
        verb: 'GET',
        path: 'web-search',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
      },
      timeout: 45,
      memorySize: 512,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.chatHistoryTableName}`],
        },
      ],
    });

    // Web Search Proxy POST for scraping/upload
    this.addLambdaFunction(this, 'web-search-proxy-scrape', {
      addAuthorizer: false,
      lambdaDirectory: 'python/web-search-proxy',
      handler: 'lambda_function.lambda_handler',
      route: {
        verb: 'POST',
        path: 'web-search-proxy/scrape',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
      },
      timeout: 45,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`arn:aws:s3:::${props.dataBucketName}/*`],
        },
      ],
    });

    this.addLambdaFunction(this, 'web-crawler-start', {
      addAuthorizer: true,
      lambdaDirectory: 'python/web-crawler-start',
      handler: 'lambda_function.handler',
      route: [
        {
          verb: 'POST',
          path: 'start-web-crawler',
        },
        {
          verb: 'GET',
          path: 'web-crawler-stats',
        },
      ],
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
        WEB_CRAWLER_STATE_MACHINE_ARN: props.webCrawlerStateMachineArn,
        CRAWL_URLS_TABLE_NAME: props.webCrawlerTableName,
        KB_STATUS_INDEX_NAME: 'kbId-status-index',
      },
      timeout: 30,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [props.webCrawlerStateMachineArn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [props.webCrawlerTableArn, `${props.webCrawlerTableArn}/index/*`],
        },
      ],
    });

    // Document Converter API - converts markdown to DOCX/PDF
    // Uses Pandoc layer for MD->DOCX, LibreOffice layer for DOCX->PDF
    // Defined before extract-content because extract-content invokes it for DOCX→PDF conversion.

    // Pandoc layer: SAR (Serverless Application Repository) is not available in all regions.
    // For unsupported regions, use a pre-published layer ARN instead.
    // Publish with: tools/publish-pandoc-layer.sh <target-region> <source-layer-arn>
    const pandocLayerArn = this.getPandocLayerArn(props.clientName, props.region);

    const libreOfficeLayerArn = this.getLibreOfficeLayerArn(props.region);
    const documentConverterLambda = this.addLambdaFunction(this, 'document-converter', {
      addAuthorizer: true,
      lambdaDirectory: 'node/document-converter',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: {
        verb: 'POST',
        path: 'document-converter',
      },
      environment: {
        OUTPUTS_BUCKET: props.outputsBucketName,
        LOG_LEVEL: 'INFO',
        PATH: '/opt/bin:/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp', // Required for LibreOffice to work
      },
      timeout: 120,
      memorySize: 2048,
      ephemeralStorageMb: 1024,
      additionalLayers: [pandocLayerArn, libreOfficeLayerArn],
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:GetObject'],
          resources: [`${props.outputsBucketArn}/*`],
        },
      ],
    });

    // Extract Content from File API Endpoint
    this.extractContentLambda = this.addLambdaFunction(this, 'extract-content', {
      addAuthorizer: true,
      lambdaDirectory: 'python/extract-content-from-file',
      handler: 'lambda_function.handler',
      route: {
        verb: 'POST',
        path: 'extract-content',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        VISION_MODEL_TYPE: props.visionModelType,
        DOCUMENT_CONVERTER_LAMBDA_NAME: documentConverterLambda.functionName,
      },
      timeout: 900,
      memorySize: 3008,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.outputsBucketArn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [`${props.outputsBucketArn}`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [
            `${props.dataBucketArn}/files/*`,
            `${props.dataBucketArn}/temp-pdf/*`,
            `${props.dataBucketArn}/shared/*`,
            `${props.dataBucketArn}/transcriptions/*`,
            // Nolia KB pre-extraction: read source PDFs/DOCX and write
            // {filename}.extracted.json sidecars (called from
            // services/numa-workspace-agent .../nolia_funding/workspace_setup.py
            // pre_extract_kb_documents). Scoped to documents/kb-* to match the
            // workspace-agent's existing PutObject scope on the same bucket.
            `${props.dataBucketArn}/documents/kb-*/*`,
            // DOCX simple-path conversion intermediate. The Lambda's
            // _extract_docx_via_pdf writes the converted PDF to
            // temp-docx-conversion/{input_key}.pdf in the SAME bucket as the
            // input, so when the input lives in the data bucket (KB
            // pre-extraction), the temp PDF lands here too.
            `${props.dataBucketArn}/temp-docx-conversion/*`,
          ],
        },
        {
          // Read access to KB documents so shares pointing at KB files can be extracted.
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${props.dataBucketArn}/documents/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [props.dataBucketArn],
        },
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
        },
        {
          actions: ['textract:GetDocumentTextDetection', 'textract:StartDocumentTextDetection'],
          resources: ['*'],
        },
        {
          actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
          effect: 'Allow',
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:UpdateItem'],
          resources: [`arn:aws:dynamodb:${props.region}:*:table/${props.clientName}-*-recent-jobs`],
        },
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [documentConverterLambda.arn],
        },
      ],
    });

    // Branding configuration API (feature-flagged)
    if (props.brandingProviderEnabled && props.brandingTableName) {
      const brandingEnv = {
        CLIENT_NAME: props.clientName,
        BRANDING_TABLE_NAME: props.brandingTableName,
        BRANDING_PROVIDER_ENABLED: String(props.brandingProviderEnabled ?? false),
        ...(props.brandingAssetsPrefix ? { BRANDING_ASSETS_PREFIX: props.brandingAssetsPrefix } : {}),
        ...(props.brandingAssetsBucketName ? { BRANDING_ASSETS_BUCKET: props.brandingAssetsBucketName } : {}),
      } as Record<string, string>;

      const brandingReadPolicy = [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.brandingTableName}`],
        },
        // S3 GetObject permission for pre-signing asset URLs
        ...(props.brandingAssetsBucketArn
          ? [
              {
                effect: 'Allow',
                actions: ['s3:GetObject'],
                resources: [`${props.brandingAssetsBucketArn}/*`],
              },
            ]
          : []),
      ];
      const brandingWritePolicy = [
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.brandingTableName}`],
        },
      ];

      // GET branding config per client (authenticated)
      this.addLambdaFunction(this, 'branding-config-get', {
        addAuthorizer: true,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: brandingEnv,
        additionalPolicyStatements: brandingReadPolicy,
        route: { verb: 'GET', path: 'branding/{clientId}' },
      });

      // GET branding config per client (public)
      this.addLambdaFunction(this, 'branding-config-public-get', {
        addAuthorizer: false,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: {
          ...brandingEnv,
          BRANDING_PUBLIC_MODE: 'true',
        },
        additionalPolicyStatements: brandingReadPolicy,
        route: { verb: 'GET', path: 'public/branding/{clientId}' },
      });

      // GET branding version history
      this.addLambdaFunction(this, 'branding-config-history', {
        addAuthorizer: true,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: brandingEnv,
        additionalPolicyStatements: brandingReadPolicy,
        route: { verb: 'GET', path: 'branding/{clientId}/versions' },
      });

      // GET single branding version for preview
      this.addLambdaFunction(this, 'branding-config-version-get', {
        addAuthorizer: true,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: brandingEnv,
        additionalPolicyStatements: brandingReadPolicy,
        route: { verb: 'GET', path: 'branding/{clientId}/versions/{versionId}' },
      });

      // PUT branding config per client
      this.addLambdaFunction(this, 'branding-config-put', {
        addAuthorizer: true,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: brandingEnv,
        additionalPolicyStatements: [...brandingReadPolicy, ...brandingWritePolicy],
        route: { verb: 'PUT', path: 'branding/{clientId}' },
      });

      // POST branding version revert
      this.addLambdaFunction(this, 'branding-config-revert', {
        addAuthorizer: true,
        lambdaDirectory: 'node/branding-config',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: brandingEnv,
        additionalPolicyStatements: [...brandingReadPolicy, ...brandingWritePolicy],
        route: { verb: 'POST', path: 'branding/{clientId}/versions/{versionId}/revert' },
      });
    }

    // Admin Integration Settings API (GET list, PUT single, GET catalog)
    // The catalog endpoint merges Pipedream + native connector state into a
    // single canonical service list, so the lambda also needs read access to
    // the data-connector settings table.
    const adminIntegrationEnv = {
      CLIENT_NAME: props.clientName,
      GLOBAL_TABLE_NAME: `${props.clientName}-global-integration-settings`,
      CONNECTOR_SETTINGS_TABLE_NAME: props.dataConnectorsSettingsTableName,
      // Admin-side native-availability gate. The catalog handler reads
      // this and suppresses native rows entirely when off.
      DATA_CONNECTORS_ENABLED: String(props.dataConnectorsEnabled ?? false),
    } as Record<string, string>;
    const adminIntegrationPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.clientName}-global-integration-settings`],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:Scan'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSettingsTableName}`],
      },
    ];

    // Register routes pointing to same lambda code
    this.addLambdaFunction(this, 'admin-integration-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-integration-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminIntegrationEnv,
      additionalPolicyStatements: adminIntegrationPolicy,
      route: { verb: 'GET', path: 'settings/integrations' },
    });
    this.addLambdaFunction(this, 'admin-integration-settings-catalog', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-integration-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminIntegrationEnv,
      additionalPolicyStatements: adminIntegrationPolicy,
      route: { verb: 'GET', path: 'settings/integrations/catalog' },
    });
    this.addLambdaFunction(this, 'admin-integration-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-integration-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminIntegrationEnv,
      additionalPolicyStatements: adminIntegrationPolicy,
      route: { verb: 'PUT', path: 'settings/integrations/{integration}' },
    });

    // Admin Data Connector Settings API (GET list, PUT single)
    const adminDataConnectorEnv = {
      CLIENT_NAME: props.clientName,
      GLOBAL_TABLE_NAME: props.dataConnectorsSettingsTableName,
    } as Record<string, string>;
    const adminDataConnectorPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSettingsTableName}`],
      },
    ];
    // GET also lists the ext-api-doc bucket to report which connectors have
    // their per-slug docs deployed. PUT doesn't need this.
    const adminDataConnectorGetEnv = {
      ...adminDataConnectorEnv,
      EXT_API_DOC_BUCKET_NAME: props.extApiDocBucketName,
    };
    const adminDataConnectorGetPolicy = [
      ...adminDataConnectorPolicy,
      {
        effect: 'Allow',
        actions: ['s3:ListBucket'],
        resources: [props.extApiDocBucketArn],
      },
    ];

    this.addLambdaFunction(this, 'admin-data-connector-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-data-connector-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminDataConnectorGetEnv,
      additionalPolicyStatements: adminDataConnectorGetPolicy,
      route: { verb: 'GET', path: 'settings/data-connectors' },
    });
    this.addLambdaFunction(this, 'admin-data-connector-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-data-connector-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminDataConnectorEnv,
      additionalPolicyStatements: adminDataConnectorPolicy,
      route: { verb: 'PUT', path: 'settings/data-connectors/{connector}' },
    });

    // Connector Access Review API (FEAT-129) — admin-only surface that lists
    // every connector authorization in the tenant (which user authorised which
    // connector, with what method/scopes/when/last-used) and revokes one or many
    // per row. Gated in the FE by the CONNECTOR_ACCESS_REVIEW flag.
    //
    // Two sources of truth: NATIVE connectors live in the per-user consolidated
    // Secrets Manager vault (`{client}/vault/users/{sub}`) — revoke clears the
    // credential fields in place (same mutation as oauth-files-api
    // vault_integration.revoke_oauth_token). PIPEDREAM connectors live in
    // Pipedream — the GET fans out per external_user_id to the relay's
    // `get_integration_status` op (isolating per-user failures) and revoke routes
    // through the relay's `disconnect_integration` op. `lastUsedAt` is hydrated
    // best-effort from the connector-usage table (written by workspace-chat-tools).
    const adminConnectorAccessEnv = {
      CLIENT_NAME: props.clientName,
      USER_POOL_ID: props.userPoolId,
      // Relay + usage-table wiring — both optional. When the relay isn't
      // deployed (PIPEDREAM_INTEGRATIONS off) the lambda skips the pipedream
      // fan-out; when the usage table is absent, lastUsedAt stays null.
      ...(props.pipedreamRelayLambdaArn && {
        PIPEDREAM_RELAY_LAMBDA_ARN: props.pipedreamRelayLambdaArn,
      }),
      ...(props.connectorUsageTableName && {
        CONNECTOR_USAGE_TABLE: props.connectorUsageTableName,
      }),
    } as Record<string, string>;
    const adminConnectorAccessPolicy = [
      {
        // Read every user vault to enumerate authorizations; write back the
        // cleared entry on revoke. Vault names are
        // `{client}/vault/users/{sub}` — wildcard-scoped to this client.
        effect: 'Allow',
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
        resources: [`arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/users/*`],
      },
      {
        // Enumerate tenant users to attribute each vault to an email.
        effect: 'Allow',
        actions: ['cognito-idp:ListUsers'],
        resources: [`arn:aws:cognito-idp:*:*:userpool/${props.userPoolId}`],
      },
      // Invoke the Pipedream relay to list/disconnect a user's connected
      // accounts. Only attached when the relay exists for this client; empty
      // resources list otherwise and the lambda skips the pipedream surface.
      ...(props.pipedreamRelayLambdaArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['lambda:InvokeFunction'],
              resources: [props.pipedreamRelayLambdaArn],
            },
          ]
        : []),
      // Read the connector-usage table to hydrate lastUsedAt. Read-only — the
      // rows are written by workspace-chat-tools.
      ...(props.connectorUsageTableArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['dynamodb:GetItem', 'dynamodb:Query'],
              resources: [props.connectorUsageTableArn],
            },
          ]
        : []),
    ];
    this.addLambdaFunction(this, 'admin-connector-access-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-connector-access',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminConnectorAccessEnv,
      additionalPolicyStatements: adminConnectorAccessPolicy,
      route: { verb: 'GET', path: 'settings/connector-access' },
    });
    this.addLambdaFunction(this, 'admin-connector-access-revoke', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-connector-access',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminConnectorAccessEnv,
      additionalPolicyStatements: adminConnectorAccessPolicy,
      route: { verb: 'POST', path: 'settings/connector-access/revoke' },
    });

    // Numa CLI API — backend for the `numa` CLI binary in /numa-cli/.
    // Always deployed: the `numa` CLI is the workspace agent's entire tool
    // layer (zero MCP servers), so every stack running the agent needs this
    // dispatcher. The /api/cli/tools/invoke route translates CLI calls into
    // workspace-chat-tools events.
    //
    // The bootstrap route is intentionally rich — it returns the same context
    // the workspace chat agent assembles at startup (user identity from
    // Cognito GetUser + JWT, agents, integrations + admin policies, knowledge
    // bases, full /config.json). Long-term goal is for the workspace chat
    // agent itself to consume this endpoint so we have a single source of
    // truth for "what does this user have access to" instead of assembling
    // it piecemeal across frontend, proxy, and agent.
    //
    // Implementation: the Lambda fans out in parallel to other client-account
    // Lambdas via Lambda.Invoke with synthetic API Gateway events, plus a
    // Cognito GetUser call (using the caller's access token as the
    // credential, no IAM perm needed). For the `kb_manager` Lambda specifically
    // — which sits behind a Function URL not API Gateway — we also forward
    // the CloudFront shared secret since kb_manager validates it on every
    // request.
    this.addLambdaFunction(this, 'numa-cli-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/numa-cli-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      timeout: 300,
      environment: {
        CLIENT_NAME: props.clientName,
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        // Cognito config for in-Lambda JWT verification (src/shared/auth.ts).
        // numa-cli-api verifies the bearer token itself rather than trusting
        // the upstream authorizer — a direct lambda:Invoke from the workspace
        // role bypasses API Gateway entirely. Must accept the same client-ID
        // set the api-gateway-authorizer does.
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        ...(props.additionalCognitoClientIds
          ? { ADDITIONAL_COGNITO_CLIENT_IDS: props.additionalCognitoClientIds }
          : {}),
        // HMAC secret for verifying proxy-minted service tokens (non-interactive
        // runs). Shared only with workspace-chat-agent-proxy; never reaches the
        // MicroVM. Without it, service tokens are rejected (fail closed).
        ...(props.cliIdentitySecret ? { NUMA_CLI_IDENTITY_SECRET: props.cliIdentitySecret } : {}),
        ...(props.companyBucketName ? { COMPANY_BUCKET_NAME: props.companyBucketName } : {}),
        ...(props.integrationsApprovalTableName
          ? { INTEGRATIONS_APPROVAL_TABLE_NAME: props.integrationsApprovalTableName }
          : {}),
        // Numa Ops entitlement flag — lets numa-cli-api hard-gate `ops_*`
        // tool calls server-side. Same flag source + env value the workspace
        // agent container receives (clientConfig.numaOps → 'true').
        ...(props.numaOpsEnabled ? { NUMA_OPS_ENABLED: 'true' } : {}),
      },
      additionalPolicyStatements: [
        {
          // Fan-out aggregator: this Lambda invokes a handful of other
          // client-account Lambdas (agents, admin-integration-settings-get,
          // data-connectors-status, kb_manager, chat-settings-get,
          // workspace_chat_tools, oauth_workspace_tools) with synthetic
          // API Gateway events. Scoped to the same client's Lambdas only
          // — no cross-client reach, no cross-account reach.
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:*:*:function:${props.clientName}_*`],
        },
        // DDB read/write on the integrations-approval table for the
        // centralised Phase 2 approval orchestrator (create + poll).
        ...(props.integrationsApprovalTableArn
          ? [
              {
                effect: 'Allow',
                actions: ['dynamodb:PutItem', 'dynamodb:GetItem'],
                resources: [props.integrationsApprovalTableArn],
              },
            ]
          : []),
        // Read company-data.json from the company bucket for bootstrap's
        // `company_profile` field. Only added when the bucket exists for
        // this stack.
        ...(props.companyBucketArn
          ? [
              {
                effect: 'Allow',
                actions: ['s3:GetObject'],
                resources: [`${props.companyBucketArn}/company-data.json`],
              },
            ]
          : []),
        // List + read native-connector API docs for the integrations docs
        // endpoint. Same prefix the workspace agent's
        // `sync_ext_api_docs_for_connectors` reads from at chat start.
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [`arn:aws:s3:::numa-${props.clientName}-outputs`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`arn:aws:s3:::numa-${props.clientName}-outputs/tools/api-docs/*`],
        },
      ],
      route: [
        { verb: 'POST', path: 'cli/bootstrap' },
        { verb: 'GET', path: 'cli/bootstrap' },
        // Generic tool dispatcher — translates CLI tool calls into
        // workspace-chat-tools events and invokes via boto3. Single route
        // for files / integrations / KB / ops — the CLI command tree on
        // the front side is what's visible; backend routes are an
        // implementation detail.
        { verb: 'POST', path: 'cli/tools/invoke' },
        // Integration reference docs — Pipedream action index OR native
        // connector markdown bundle, fetched on demand and cached
        // CLI-side at ~/.cache/numa/integrations/<slug>/.
        { verb: 'GET', path: 'cli/integrations/{slug}/docs' },
      ],
    });

    // Admin Capabilities API (GET list, PUT single)
    const adminCapabilitiesEnv = {
      CAPABILITIES_TABLE_NAME: props.capabilitiesTableName,
    } as Record<string, string>;
    const adminCapabilitiesPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:Scan', 'dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.capabilitiesTableName}`],
      },
    ];

    this.addLambdaFunction(this, 'admin-capabilities-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-capabilities',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCapabilitiesEnv,
      additionalPolicyStatements: adminCapabilitiesPolicy,
      route: { verb: 'GET', path: 'capabilities' },
    });
    this.addLambdaFunction(this, 'admin-capabilities-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-capabilities',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCapabilitiesEnv,
      additionalPolicyStatements: adminCapabilitiesPolicy,
      route: { verb: 'PUT', path: 'capabilities/{flag}' },
    });

    // Admin Credits API (balance, ledger, manual top-up) — Numa Credit System / SPK-015
    const adminCreditsEnv = {
      CLIENT_NAME: props.clientName,
      CREDITS_TABLE_NAME: props.creditLedgerTableName,
    } as Record<string, string>;
    const adminCreditsPolicy = [
      {
        effect: 'Allow',
        // PutItem/DeleteItem: save + reset the pricing-config row (Credit Admin tab).
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
        ],
        resources: [
          `arn:aws:dynamodb:*:*:table/${props.creditLedgerTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.creditLedgerTableName}/index/*`,
        ],
      },
    ];
    this.addLambdaFunction(this, 'admin-credits-balance', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'GET', path: 'credits/balance' },
    });
    this.addLambdaFunction(this, 'admin-credits-ledger', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'GET', path: 'credits/ledger' },
    });
    // Per-agent credit analytics for the agent card's Credits section (FEAT-246). NOT billing-admin
    // gated at the route — the handler returns the caller's OWN agent usage to any user, and the
    // all-users aggregate + per-user breakdown ONLY when the caller is a billing admin.
    this.addLambdaFunction(this, 'admin-credits-agent-stats', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'GET', path: 'credits/agent-stats' },
    });
    this.addLambdaFunction(this, 'admin-credits-topup', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'POST', path: 'credits/topup' },
    });
    // Per-conversation credit tier for the in-chat indicator. Same lambda, but the handler
    // ownership-checks the caller's JWT sub against the conversation's userSub (NOT admin-gated),
    // so any user can read the tier of their own chats.
    this.addLambdaFunction(this, 'admin-credits-conversation', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'GET', path: 'credits/conversation' },
    });
    // Billing-admin roster (who may see credit data). GET = read status + roster (any admin);
    // POST = grant/revoke, server-enforced so only an existing billing-admin can propagate.
    this.addLambdaFunction(this, 'admin-credits-billing-admins-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'GET', path: 'credits/billing-admins' },
    });
    this.addLambdaFunction(this, 'admin-credits-billing-admins-set', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-credits',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminCreditsEnv,
      additionalPolicyStatements: adminCreditsPolicy,
      route: { verb: 'POST', path: 'credits/billing-admins' },
    });

    // Admin Agents Settings API (GET/PUT policy)
    const adminAgentsEnv = {
      CLIENT_NAME: props.clientName,
      AGENTS_SETTINGS_TABLE_NAME: props.agentsSettingsTableName,
    } as Record<string, string>;
    const adminAgentsPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.agentsSettingsTableName}`],
      },
    ];
    this.addLambdaFunction(this, 'admin-agents-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-agents-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminAgentsEnv,
      additionalPolicyStatements: adminAgentsPolicy,
      route: { verb: 'GET', path: 'settings/agents' },
    });
    this.addLambdaFunction(this, 'admin-agents-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-agents-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminAgentsEnv,
      additionalPolicyStatements: adminAgentsPolicy,
      route: { verb: 'PUT', path: 'settings/agents' },
    });

    // Admin Scheduling Settings API (GET/PUT minimum interval)
    const adminSchedulingEnv = {
      CLIENT_NAME: props.clientName,
      SCHEDULING_SETTINGS_TABLE_NAME: props.schedulingSettingsTableName,
      ...(props.perClientSchedulingMinIntervalMinutes != null && {
        SCHEDULING_MIN_INTERVAL_MINUTES: String(props.perClientSchedulingMinIntervalMinutes),
      }),
      ...(props.scheduleQuotas?.maxRunsPerCompanyPerMonth != null && {
        SCHEDULE_QUOTA_MAX_RUNS_PER_COMPANY_PER_MONTH: String(props.scheduleQuotas.maxRunsPerCompanyPerMonth),
      }),
      ...(props.scheduleQuotas?.maxRunsPerUserPerMonth != null && {
        SCHEDULE_QUOTA_MAX_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxRunsPerUserPerMonth),
      }),
      ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerCompany != null && {
        SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_COMPANY: String(
          props.scheduleQuotas.maxConcurrentActiveSchedulesPerCompany
        ),
      }),
      ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerUser != null && {
        SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_USER: String(
          props.scheduleQuotas.maxConcurrentActiveSchedulesPerUser
        ),
      }),
      ...(props.scheduleQuotas?.requireApprovalAboveUserCap != null && {
        SCHEDULE_QUOTA_REQUIRE_APPROVAL_ABOVE_USER_CAP: String(props.scheduleQuotas.requireApprovalAboveUserCap),
      }),
      ...(props.scheduleQuotas?.maxTriggerRunsPerCompanyPerMonth != null && {
        SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_COMPANY_PER_MONTH: String(
          props.scheduleQuotas.maxTriggerRunsPerCompanyPerMonth
        ),
      }),
      ...(props.scheduleQuotas?.maxTriggerRunsPerUserPerMonth != null && {
        SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxTriggerRunsPerUserPerMonth),
      }),
    } as Record<string, string>;
    const adminSchedulingPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.schedulingSettingsTableName}`],
      },
    ];
    this.addLambdaFunction(this, 'admin-scheduling-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-scheduling-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSchedulingEnv,
      additionalPolicyStatements: adminSchedulingPolicy,
      route: { verb: 'GET', path: 'settings/scheduling' },
    });
    this.addLambdaFunction(this, 'admin-scheduling-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-scheduling-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSchedulingEnv,
      additionalPolicyStatements: adminSchedulingPolicy,
      route: { verb: 'PUT', path: 'settings/scheduling' },
    });

    // Admin MFA Settings API (GET/PUT device remember duration + admin MFA reset)
    const adminMfaEnv = {
      CLIENT_NAME: props.clientName,
      MFA_SETTINGS_TABLE_NAME: props.mfaSettingsTableName,
      USER_POOL_ID: props.userPoolId,
      ...(props.emailSenderLambdaArn && {
        EMAIL_SENDER_LAMBDA_ARN: props.emailSenderLambdaArn,
      }),
    } as Record<string, string>;
    const adminMfaPolicy = [
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
        ],
        resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
      },
      {
        effect: 'Allow',
        actions: [
          'cognito-idp:AdminSetUserMFAPreference',
          'cognito-idp:AdminUserGlobalSignOut',
          'cognito-idp:AdminGetUser',
        ],
        resources: [`arn:aws:cognito-idp:*:*:userpool/${props.userPoolId}`],
      },
      // Centralized email sender for MFA notifications and OTP delivery
      ...(props.emailSenderLambdaArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['lambda:InvokeFunction'],
              resources: [props.emailSenderLambdaArn],
            },
          ]
        : []),
    ];
    this.addLambdaFunction(this, 'admin-mfa-settings-get', {
      addAuthorizer: false, // Public: Login page fetches this mid-auth before tokens are available
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'GET', path: 'settings/mfa' },
    });
    this.addLambdaFunction(this, 'admin-mfa-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'PUT', path: 'settings/mfa' },
    });
    // Device trust: record (authenticated — called after MFA success to store server-side timestamp)
    this.addLambdaFunction(this, 'admin-mfa-device-trust-record', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/device-trust' },
    });
    // Device trust: validate (public — called mid-login before tokens are available)
    this.addLambdaFunction(this, 'admin-mfa-validate-device', {
      addAuthorizer: false,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/validate-device' },
    });
    // Device trust: clear (public — called mid-login when DEVICE_SRP fails with a stale device)
    this.addLambdaFunction(this, 'admin-mfa-clear-device-trust', {
      addAuthorizer: false,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/clear-device-trust' },
    });
    // Device trust: batch validate (authenticated — called from Security tab to filter device list)
    this.addLambdaFunction(this, 'admin-mfa-validate-devices', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/validate-devices' },
    });
    // Device trust: revoke (authenticated — called when user forgets a device)
    this.addLambdaFunction(this, 'admin-mfa-device-trust-revoke', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'DELETE', path: 'settings/mfa/device-trust' },
    });
    // Admin MFA reset: resets a user's MFA and creates a grace period (admin-only)
    this.addLambdaFunction(this, 'admin-mfa-reset-user', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/reset-user' },
    });
    // Complete MFA reset: called by user after successful re-enrollment to clear grace period
    this.addLambdaFunction(this, 'admin-mfa-complete-reset', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/complete-reset' },
    });
    // Admin MFA reset status: check if a user has a pending/expired MFA reset (admin-only)
    this.addLambdaFunction(this, 'admin-mfa-reset-status', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'GET', path: 'settings/mfa/reset-status' },
    });
    // Recovery codes: generate (authenticated — generates and stores hashed recovery codes)
    this.addLambdaFunction(this, 'admin-mfa-recovery-generate', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/recovery-codes/generate' },
    });
    // Recovery codes: verify (public — called mid-login to validate a recovery code).
    // TODO(SECURITY): Add AWS WAF IP-based rate limiting on this path before production.
    // The application-level rate limit (5 attempts / 15 min per username) prevents brute
    // force, but without IP-based limiting an attacker can try 5 codes for every known
    // username in parallel. WAF rule: ~10 requests/min per IP on this route.
    this.addLambdaFunction(this, 'admin-mfa-recovery-verify', {
      addAuthorizer: false,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/recovery-codes/verify' },
    });
    // Recovery codes: status (authenticated — returns remaining code count)
    this.addLambdaFunction(this, 'admin-mfa-recovery-status', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'GET', path: 'settings/mfa/recovery-codes/status' },
    });
    // Email OTP: send verification code during admin MFA reset (authorized — user has tokens from password login)
    this.addLambdaFunction(this, 'admin-mfa-send-reset-otp', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/send-reset-otp' },
    });
    // Email OTP: verify code during admin MFA reset (authorized)
    this.addLambdaFunction(this, 'admin-mfa-verify-reset-otp', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-mfa-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminMfaEnv,
      additionalPolicyStatements: adminMfaPolicy,
      route: { verb: 'POST', path: 'settings/mfa/verify-reset-otp' },
    });

    // Admin SSO Settings API (SAML identity provider configuration)
    const adminSsoEnv = {
      CLIENT_NAME: props.clientName,
      SSO_SETTINGS_TABLE_NAME: props.mfaSettingsTableName, // Reuses MFA settings table with 'sso-config' key
      USER_POOL_ID: props.userPoolId,
      USER_POOL_CLIENT_ID: props.userPoolClientId,
      DOMAIN_NAME: props.domainName,
      REGION: props.region,
    } as Record<string, string>;
    const adminSsoPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
      },
      {
        effect: 'Allow',
        actions: [
          'cognito-idp:CreateIdentityProvider',
          'cognito-idp:UpdateIdentityProvider',
          'cognito-idp:DeleteIdentityProvider',
          'cognito-idp:DescribeIdentityProvider',
          'cognito-idp:ListIdentityProviders',
          'cognito-idp:UpdateUserPoolClient',
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:ListUsers',
          'cognito-idp:AdminDisableProviderForUser',
        ],
        resources: [`arn:aws:cognito-idp:*:*:userpool/${props.userPoolId}`],
      },
    ];
    // GET /settings/sso/login-config — public (login page fetches SSO status pre-auth)
    this.addLambdaFunction(this, 'admin-sso-login-config', {
      addAuthorizer: false,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso/login-config' },
    });
    // GET /settings/sso — get current SSO config (admin)
    this.addLambdaFunction(this, 'admin-sso-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso' },
    });
    // GET /settings/sso/metadata — get SP metadata for IdP configuration (admin)
    this.addLambdaFunction(this, 'admin-sso-metadata-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso/metadata' },
    });
    // PUT /settings/sso — save SSO config (admin)
    this.addLambdaFunction(this, 'admin-sso-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'PUT', path: 'settings/sso' },
    });
    // POST /settings/sso/enable — activate SSO (admin)
    this.addLambdaFunction(this, 'admin-sso-enable', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'POST', path: 'settings/sso/enable' },
    });
    // POST /settings/sso/disable — deactivate SSO (admin)
    this.addLambdaFunction(this, 'admin-sso-disable', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'POST', path: 'settings/sso/disable' },
    });
    // DELETE /settings/sso — delete SSO config and IdP entirely (admin)
    this.addLambdaFunction(this, 'admin-sso-settings-delete', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'DELETE', path: 'settings/sso' },
    });
    // GET /settings/sso/group-mapping — get group mapping config (admin)
    this.addLambdaFunction(this, 'admin-sso-group-mapping-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso/group-mapping' },
    });
    // PUT /settings/sso/group-mapping — save group mapping config (admin)
    this.addLambdaFunction(this, 'admin-sso-group-mapping-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'PUT', path: 'settings/sso/group-mapping' },
    });
    // GET /settings/sso/users — list users with SSO link status (admin)
    this.addLambdaFunction(this, 'admin-sso-users-list', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso/users' },
    });
    // POST /settings/sso/users/{sub}/unlink — unlink SSO from a user (admin)
    this.addLambdaFunction(this, 'admin-sso-user-unlink', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'POST', path: 'settings/sso/users/{sub}/unlink' },
    });
    // SCIM token management (admin)
    this.addLambdaFunction(this, 'admin-sso-scim-generate', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'POST', path: 'settings/sso/scim/generate-token' },
    });
    this.addLambdaFunction(this, 'admin-sso-scim-config', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'GET', path: 'settings/sso/scim/config' },
    });
    this.addLambdaFunction(this, 'admin-sso-scim-revoke', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-sso-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminSsoEnv,
      additionalPolicyStatements: adminSsoPolicy,
      route: { verb: 'DELETE', path: 'settings/sso/scim/token' },
    });

    // SCIM endpoint (token auth — Azure AD calls these, not Cognito authorizer)
    const scimEnv = {
      USER_POOL_ID: props.userPoolId,
      SCIM_TOKEN_TABLE: props.mfaSettingsTableName,
      CLIENT_NAME: props.clientName,
    } as Record<string, string>;
    const scimPolicy = [
      {
        effect: 'Allow',
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:ListUsers',
        ],
        resources: [`arn:aws:cognito-idp:*:*:userpool/${props.userPoolId}`],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
      },
    ];
    // SCIM routes — no Cognito authorizer (uses bearer token auth internally)
    this.addLambdaFunction(this, 'scim-service-provider-config', {
      addAuthorizer: false,
      lambdaDirectory: 'node/scim-endpoint',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: scimEnv,
      additionalPolicyStatements: scimPolicy,
      route: { verb: 'GET', path: 'scim/ServiceProviderConfig' },
    });
    this.addLambdaFunction(this, 'scim-schemas', {
      addAuthorizer: false,
      lambdaDirectory: 'node/scim-endpoint',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: scimEnv,
      additionalPolicyStatements: scimPolicy,
      route: { verb: 'GET', path: 'scim/Schemas' },
    });
    this.addLambdaFunction(this, 'scim-users-list', {
      addAuthorizer: false,
      lambdaDirectory: 'node/scim-endpoint',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: scimEnv,
      additionalPolicyStatements: scimPolicy,
      route: { verb: 'GET', path: 'scim/Users' },
    });
    this.addLambdaFunction(this, 'scim-users-create', {
      addAuthorizer: false,
      lambdaDirectory: 'node/scim-endpoint',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: scimEnv,
      additionalPolicyStatements: scimPolicy,
      route: { verb: 'POST', path: 'scim/Users' },
    });
    // ANY handles GET, PUT, PATCH, DELETE on /scim/Users/{id} — Lambda routes by method internally
    this.addLambdaFunction(this, 'scim-users-by-id', {
      addAuthorizer: false,
      lambdaDirectory: 'node/scim-endpoint',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: scimEnv,
      additionalPolicyStatements: scimPolicy,
      route: { verb: 'ANY', path: 'scim/Users/{id}' },
    });

    // SSO Token Exchange (public — proxies Cognito /oauth2/token with client_secret)
    const ssoTokenExchangeEnv = {
      CLIENT_SECRET: props.userPoolClientSecret,
      COGNITO_CLIENT_ID: props.userPoolClientId,
      COGNITO_REGION: props.region,
      CLIENT_NAME: props.clientName,
    };
    this.addLambdaFunction(this, 'sso-token-exchange', {
      addAuthorizer: false,
      lambdaDirectory: 'node/sso-token-exchange',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: ssoTokenExchangeEnv,
      route: { verb: 'POST', path: 'auth/sso/token-exchange' },
    });

    // SSO Token Refresh — same client_secret proxy pattern. Federation refresh
    // tokens can only be refreshed against the OAuth2 /token endpoint, not via
    // Cognito InitiateAuth REFRESH_TOKEN_AUTH, so SSO-authenticated sessions
    // route their periodic refreshes here while native (SRP) sessions keep
    // using InitiateAuth in the browser.
    this.addLambdaFunction(this, 'sso-token-refresh', {
      addAuthorizer: false,
      lambdaDirectory: 'node/sso-token-refresh',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: ssoTokenExchangeEnv,
      route: { verb: 'POST', path: 'auth/sso/token-refresh' },
    });

    // User Chat Settings API (per-user defaults for tools, KBs, integrations)
    const chatSettingsEnv = {
      CLIENT_NAME: props.clientName,
      CHAT_SETTINGS_TABLE_NAME: props.chatSettingsTableName,
    } as Record<string, string>;

    const chatSettingsPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.chatSettingsTableName}`],
      },
    ];

    // GET user chat settings
    this.addLambdaFunction(this, 'chat-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/chat-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: chatSettingsEnv,
      additionalPolicyStatements: chatSettingsPolicy,
      route: { verb: 'GET', path: 'chat/settings' },
    });

    // PUT user chat settings
    this.addLambdaFunction(this, 'chat-settings-put', {
      addAuthorizer: true,
      lambdaDirectory: 'node/chat-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: chatSettingsEnv,
      additionalPolicyStatements: chatSettingsPolicy,
      route: { verb: 'PUT', path: 'chat/settings' },
    });

    // Data Connectors API (per-user connector configs + secrets)
    const dataConnectorsEnv = {
      CLIENT_NAME: props.clientName,
      DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
      DATA_CONNECTORS_SECRETS_PREFIX: `${props.clientName}/data-connectors`,
      DATA_CONNECTORS_SETTINGS_TABLE_NAME: props.dataConnectorsSettingsTableName,
      DATA_CONNECTORS_SYNC_CONFIGS_TABLE_NAME: props.dataConnectorsSyncConfigsTableName,
      CONNECTOR_EVENT_CONFIGS_TABLE_NAME: props.connectorEventConfigsTableName,
      // Synergy extraction queue (empty when the crawler is disabled). The
      // on-visit hook enqueues a per-job message; "Sync now" invokes the
      // coordinator to enumerate + enqueue.
      SYNERGY_EXTRACT_QUEUE_URL: props.synergyExtractQueueUrl ?? '',
      SYNERGY_COORDINATOR_FUNCTION_NAME: props.synergyCoordinatorFunctionName ?? '',
      // Crawl-state table for sync-config/status routes + the on-visit grant
      // rows (all no-ops when empty).
      SYNERGY_CRAWL_STATE_TABLE_NAME: props.synergyCrawlStateTableName ?? '',
    } as Record<string, string>;

    const dataConnectorsPolicy = [
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          // DeleteItem needed by the per-user disconnect route
          // (DELETE /api/data-connectors/{connector_id}) so users can
          // actually clear their connection rows from the unified
          // Integrations page.
          'dynamodb:DeleteItem',
          'dynamodb:UpdateItem',
        ],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSettingsTableName}`],
      },
      {
        effect: 'Allow',
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
          // DeleteSecret needed by the disconnect route so the SM payload
          // is cleaned up alongside the DDB row.
          'secretsmanager:DeleteSecret',
        ],
        resources: ['*'],
      },
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
        ],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSyncConfigsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.connectorEventConfigsTableName}`],
      },
      // On-visit hook enqueues onto the Synergy extraction queue; "Sync now"
      // invokes the coordinator. Crawl-state table backs sync-config/status +
      // on-visit grant rows. All only when the crawler is provisioned.
      ...(props.synergyExtractQueueArn
        ? [
            {
              effect: 'Allow',
              actions: ['sqs:SendMessage'],
              resources: [props.synergyExtractQueueArn],
            },
          ]
        : []),
      ...(props.synergyCoordinatorFunctionArn
        ? [
            {
              effect: 'Allow',
              actions: ['lambda:InvokeFunction'],
              resources: [props.synergyCoordinatorFunctionArn],
            },
          ]
        : []),
      ...(props.synergyCrawlStateTableArn
        ? [
            {
              effect: 'Allow',
              actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
              resources: [props.synergyCrawlStateTableArn, `${props.synergyCrawlStateTableArn}/index/*`],
            },
          ]
        : []),
    ];

    this.addLambdaFunction(this, 'data-connectors-status', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'GET', path: 'data-connectors/status' },
    });

    this.addLambdaFunction(this, 'data-connectors-connect', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'POST', path: 'data-connectors/connect' },
    });

    // Per-user disconnect: removes the user's row + cleans up the secret in
    // SM. Used by the unified Integrations page so a user-side disconnect
    // actually clears the data-connector row (otherwise the row keeps the
    // connector "connected" in the UI even after OAuth revoke / PAT delete).
    this.addLambdaFunction(this, 'data-connectors-disconnect', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'DELETE', path: 'data-connectors/{connector_id}' },
    });

    // ── Synergy CONNECTOR routes (gated on synergy) ──────────────────────────
    // The crawl/index control plane: manual "Sync now" + admin crawl config +
    // run status. Only deploy when the single Synergy flag is on — when off
    // the crawler construct (state machine, worker, state table) isn't created
    // either, so these routes would have empty ARNs and 400 at runtime anyway.
    if (props.synergyEnabled) {
      // Manual "Sync now" — kicks off the Synergy → Bedrock KB crawl Step Function.
      this.addLambdaFunction(this, 'data-connectors-synergy-sync-now', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'POST', path: 'data-connectors/synergy/sync-now' },
      });

      // Admin crawl config + run status (admin-gated in the handler).
      this.addLambdaFunction(this, 'data-connectors-synergy-sync-config-get', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/sync-config' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-sync-config-put', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'PUT', path: 'data-connectors/synergy/sync-config' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-sync-status', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/sync-status' },
      });

      // Per-job index overview for the admin Synergy config — same codebase,
      // env, and crawl-state IAM as sync-status (no new zip / CI matrix entry).
      this.addLambdaFunction(this, 'data-connectors-synergy-index-overview', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        // The overview handler SCANs the crawl-state table (all JOB#/FILE# rows
        // to build the per-job rollup); the shared dataConnectorsPolicy only
        // grants GetItem/Query/UpdateItem. Add a read-only Scan scoped to this
        // one synergy table — only this lambda needs it.
        additionalPolicyStatements: [
          ...dataConnectorsPolicy,
          ...(props.synergyCrawlStateTableArn
            ? [
                {
                  effect: 'Allow',
                  actions: ['dynamodb:Scan'],
                  resources: [props.synergyCrawlStateTableArn],
                },
              ]
            : []),
        ],
        route: { verb: 'GET', path: 'data-connectors/synergy/index-overview' },
      });
    }

    // ── Synergy REMOTE FILES BROWSER routes (gated on synergy) ────────────────
    // Interactive browse + read-parity surface: jobs → folders → files, plus the
    // rich parity routes (job-scoped search, details, version history, weblink).
    if (props.synergyEnabled) {
      this.addLambdaFunction(this, 'data-connectors-synergy-jobs', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/jobs' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-job-folders', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/jobs/{job_id}/folders' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-folder-items', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/folders/{folder_id}/items' },
      });

      // Synergy file read-parity routes (job-scoped search, details, version
      // history, weblink). Order in the handler matters — the specific suffixes
      // (/search, /history, /weblink) are matched before the bare /files/{id}.
      this.addLambdaFunction(this, 'data-connectors-synergy-file-search', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/files/search' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-file-history', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/files/{file_id}/history' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-file-weblink', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/files/{file_id}/weblink' },
      });

      this.addLambdaFunction(this, 'data-connectors-synergy-file-details', {
        addAuthorizer: true,
        lambdaDirectory: 'python/data-connectors',
        handler: 'lambda_function.handler',
        environment: dataConnectorsEnv,
        additionalPolicyStatements: dataConnectorsPolicy,
        route: { verb: 'GET', path: 'data-connectors/synergy/files/{file_id}' },
      });
    }

    this.addLambdaFunction(this, 'data-connectors-sync-configs-list', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'GET', path: 'data-connectors/sync-configs' },
    });

    this.addLambdaFunction(this, 'data-connectors-sync-configs-create', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'POST', path: 'data-connectors/sync-configs' },
    });

    this.addLambdaFunction(this, 'data-connectors-sync-configs-update', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'PUT', path: 'data-connectors/sync-configs/{id}' },
    });

    this.addLambdaFunction(this, 'data-connectors-sync-configs-delete', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'DELETE', path: 'data-connectors/sync-configs/{id}' },
    });

    // Gmail-specific data connector routes
    this.addLambdaFunction(this, 'data-connectors-gmail-labels', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'GET', path: 'data-connectors/gmail/labels' },
    });

    this.addLambdaFunction(this, 'data-connectors-gmail-messages', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'GET', path: 'data-connectors/gmail/messages' },
    });

    this.addLambdaFunction(this, 'data-connectors-gmail-send', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'POST', path: 'data-connectors/gmail/send' },
    });

    // Event config routes (per-connector event type toggles + tags)
    this.addLambdaFunction(this, 'data-connectors-event-configs-list', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'GET', path: 'data-connectors/{connector_id}/event-configs' },
    });

    this.addLambdaFunction(this, 'data-connectors-event-configs-update', {
      addAuthorizer: true,
      lambdaDirectory: 'python/data-connectors',
      handler: 'lambda_function.handler',
      environment: dataConnectorsEnv,
      additionalPolicyStatements: dataConnectorsPolicy,
      route: { verb: 'PUT', path: 'data-connectors/{connector_id}/event-configs/{event_type}' },
    });

    // Connector Event Receiver (webhook endpoint — unauthenticated, validated by shared secret)
    const connectorEventReceiverEnv = {
      CLIENT_NAME: props.clientName,
      CONNECTOR_EVENTS_TABLE_NAME: props.connectorEventsTableName,
      CONNECTOR_EVENT_CONFIGS_TABLE_NAME: props.connectorEventConfigsTableName,
      OUTPUTS_BUCKET_NAME: props.outputsBucketName,
      EVENT_BUS_NAME: props.connectorEventBusName,
      WEBHOOK_SECRET: props.cloudfrontSharedSecret,
    } as Record<string, string>;

    const connectorEventReceiverPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:*:*:table/${props.connectorEventsTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.connectorEventConfigsTableName}`,
        ],
      },
      {
        effect: 'Allow',
        actions: ['s3:PutObject'],
        resources: [`${props.outputsBucketArn}/connector-events/*`],
      },
      {
        effect: 'Allow',
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:*:*:event-bus/${props.connectorEventBusName}`],
      },
    ];

    this.addLambdaFunction(this, 'connector-event-receiver', {
      addAuthorizer: false,
      lambdaDirectory: 'node/connector-event-receiver',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: connectorEventReceiverEnv,
      additionalPolicyStatements: connectorEventReceiverPolicy,
      route: { verb: 'POST', path: 'webhooks/connector-events/{secret}' },
    });

    // Pipedream Event Receiver (webhook endpoint — unauthenticated, validated
    // by per-client URL secret + per-trigger HMAC signature).
    //
    // Pipedream delivers events here when any deployed trigger (dc_xxx) fires.
    // The receiver looks up the schedule via the deployed-trigger-id-index GSI
    // on the agent-schedules table, verifies the HMAC against the signing key
    // stored on the schedule record, then persists the event and emits to the
    // shared connector-events EventBridge bus (where the dispatcher picks it up).
    //
    // See dev-notes/tasks/pipedream-triggers/PLAN.md §3.3 for the design rationale.
    const pipedreamEventReceiverEnv = {
      CLIENT_NAME: props.clientName,
      AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
      AGENT_SCHEDULES_DC_GSI_NAME: 'deployed-trigger-id-index',
      CONNECTOR_EVENTS_TABLE_NAME: props.connectorEventsTableName,
      OUTPUTS_BUCKET_NAME: props.outputsBucketName,
      EVENT_BUS_NAME: props.connectorEventBusName,
      // Same shared secret as the Gmail receiver — defence-in-depth path
      // component. Real auth is the per-trigger HMAC verified inside the lambda.
      WEBHOOK_SECRET: props.cloudfrontSharedSecret,
    } as Record<string, string>;

    const pipedreamEventReceiverPolicy = [
      {
        // Schedule lookup — Query the GSI; need both the table and the index ARN.
        effect: 'Allow',
        actions: ['dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/deployed-trigger-id-index`,
        ],
      },
      {
        // Event persistence — same connector-events table the Gmail receiver uses.
        effect: 'Allow',
        actions: ['dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.connectorEventsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['s3:PutObject'],
        resources: [`${props.outputsBucketArn}/connector-events/*`],
      },
      {
        effect: 'Allow',
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:*:*:event-bus/${props.connectorEventBusName}`],
      },
    ];

    this.addLambdaFunction(this, 'pipedream-event-receiver', {
      addAuthorizer: false,
      lambdaDirectory: 'node/pipedream-event-receiver',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: pipedreamEventReceiverEnv,
      additionalPolicyStatements: pipedreamEventReceiverPolicy,
      route: { verb: 'POST', path: 'webhooks/pipedream-events/{secret}' },
    });

    // Gmail Watch Manager (renews Gmail push notification watches every 6 days)
    const gmailWatchManagerEnv = {
      CLIENT_NAME: props.clientName,
      DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
      DATA_CONNECTORS_SETTINGS_TABLE_NAME: props.dataConnectorsSettingsTableName,
    } as Record<string, string>;

    const gmailWatchManagerPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSettingsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      },
    ];

    const gmailWatchManagerLambda = this.addLambdaFunction(this, 'gmail-watch-manager', {
      addAuthorizer: false,
      lambdaDirectory: 'node/gmail-watch-manager',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: gmailWatchManagerEnv,
      additionalPolicyStatements: gmailWatchManagerPolicy,
    });

    // Gmail Watch Manager — EventBridge Scheduler (renew every 6 days)
    const watchScheduleAssumePolicy = new DataAwsIamPolicyDocument(this, 'watch-schedule-assume-policy', {
      statement: [
        {
          principals: [{ identifiers: ['scheduler.amazonaws.com'], type: 'Service' }],
          actions: ['sts:AssumeRole'],
        },
      ],
    });

    const watchScheduleRole = new IamRole(this, 'watch-schedule-role', {
      name: `${props.clientName}-gmail-watch-schedule`,
      assumeRolePolicy: watchScheduleAssumePolicy.json,
    });

    new IamRolePolicy(this, 'watch-schedule-role-policy', {
      role: watchScheduleRole.name,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'lambda:InvokeFunction',
            Resource: gmailWatchManagerLambda.arn,
          },
        ],
      }),
    });

    new SchedulerSchedule(this, 'gmail-watch-schedule', {
      name: `${props.clientName}-gmail-watch-renewal`,
      groupName: 'default',
      scheduleExpression: 'rate(6 days)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: gmailWatchManagerLambda.arn,
        roleArn: watchScheduleRole.arn,
      },
    });

    // Google Cloud Setup (admin-only, automates GCP project provisioning)
    const googleCloudSetupEnv = {
      CLIENT_NAME: props.clientName,
      VAULT_SECRETS_PREFIX: `${props.clientName}/vault`,
      DATA_CONNECTORS_SETTINGS_TABLE_NAME: props.dataConnectorsSettingsTableName,
      WEBHOOK_URL: `https://${props.domainName}/api/webhooks/connector-events/${props.cloudfrontSharedSecret}`,
      // Used by the configure-triggers route to register watches for already-connected mailboxes.
      WATCH_MANAGER_FUNCTION_NAME: gmailWatchManagerLambda.functionName,
    } as Record<string, string>;

    const googleCloudSetupPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsSettingsTableName}`],
      },
      {
        effect: 'Allow',
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
        ],
        resources: ['*'],
      },
      {
        // configure-triggers invokes gmail-watch-manager to register watches for
        // already-connected mailboxes.
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [gmailWatchManagerLambda.arn],
      },
    ];

    this.addLambdaFunction(this, 'google-cloud-setup-list-projects', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/list-projects' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-validate', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/validate-project' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-enable-apis', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/enable-apis' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-create-oauth', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/create-oauth-client' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-pubsub', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/setup-pubsub' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-client-id', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'GET', path: 'admin/google-cloud/client-id' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-status', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'GET', path: 'admin/google-cloud/status' },
    });

    // Token-free trigger setup: the admin provisions Pub/Sub in their own GCP
    // project (guided by trigger-info), then we wire it up Numa-side.
    this.addLambdaFunction(this, 'google-cloud-setup-trigger-info', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'GET', path: 'admin/google-cloud/trigger-info' },
    });

    this.addLambdaFunction(this, 'google-cloud-setup-configure-triggers', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'POST', path: 'admin/google-cloud/configure-triggers' },
    });

    // Agents API (list/create/update/delete/copy + prefs/teams/sharing)
    const agentsEnv = {
      CLIENT_NAME: props.clientName,
      REGION: props.region,
      WORKSPACE_AGENTS_TABLE: props.workspaceAgentsTableName,
      USER_AGENTS_TABLE: props.userAgentsTableName,
      OUTPUTS_BUCKET_NAME: props.outputsBucketName,
      AGENTS_SETTINGS_TABLE_NAME: props.agentsSettingsTableName,
      AGENT_USER_PREFS_TABLE: props.agentUserPrefsTableName,
      AGENT_TEAMS_TABLE: props.agentTeamsTableName,
      AGENT_TEAM_MEMBERS_TABLE: props.agentTeamMembersTableName,
      AGENT_SHARING_TABLE: props.agentSharingTableName,
      AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
    } as Record<string, string>;

    const agentsPolicy = [
      {
        effect: 'Allow',
        actions: [
          'dynamodb:Query',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Scan',
        ],
        resources: [
          `arn:aws:dynamodb:*:*:table/${props.workspaceAgentsTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.workspaceAgentsTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.userAgentsTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.userAgentsTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.agentUserPrefsTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentUserPrefsTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.agentTeamsTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentTeamsTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.agentTeamMembersTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentTeamMembersTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.agentSharingTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentSharingTableName}/index/*`,
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
        ],
      },
      // Read agents settings policy table
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.agentsSettingsTableName}`],
      },
      // S3 access for copying, writing, and deleting agent icon images
      {
        effect: 'Allow',
        actions: ['s3:GetObject'],
        resources: [`${props.outputsBucketArn}/numa-chat/agent-icons/*`],
      },
      {
        effect: 'Allow',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`${props.outputsBucketArn}/numa-chat/agent-icons/*`],
      },
    ];

    this.agentsLambda = this.addLambdaFunction(this, 'agents', {
      addAuthorizer: true,
      lambdaDirectory: 'node/agents',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: agentsEnv,
      additionalPolicyStatements: agentsPolicy,
      route: [
        { verb: 'ANY', path: 'agents' },
        { verb: 'ANY', path: 'agents/{proxy+}' },
      ],
    });

    // FEAT-105 round-2 — DLQ for the runner. Catches async invocation failures
    // (EventBridge fires, throws inside the lambda) so we don't lose the run
    // record. 14-day retention is the SQS max; pair with the alarm below.
    const agentScheduleRunnerDlq = new SqsQueue(this, 'agent-schedule-runner-dlq', {
      name: `${props.clientName}-agent-schedule-runner-dlq`,
      messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days
      tags: {
        Purpose: 'agent-schedule-runner-dlq',
        ClientName: props.clientName,
      },
    });

    // FEAT-105 round-2 — alarm when ANY message lands in the DLQ. SNS topic
    // intentionally not wired here — Arcanum's existing CloudWatch alarms
    // surface to the same notification channel via account-level hookup.
    new CloudwatchMetricAlarm(this, 'agent-schedule-runner-dlq-alarm', {
      alarmName: `${props.clientName}-agent-schedule-runner-dlq-not-empty`,
      alarmDescription: 'Agent schedule runner produced a DLQ message — investigate the failed run.',
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensions: { QueueName: agentScheduleRunnerDlq.name },
      statistic: 'Maximum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
    });

    // FEAT-105 round-2 — 90-day retention on the scheduled-runs S3 prefix.
    // Keeps the audit history bounded; the schedule record itself stays in
    // DynamoDB. Same outputs bucket holds other prefixes (chat uploads, app
    // artifacts) — using a prefixed rule so we don't expire those by accident.
    new S3BucketLifecycleConfiguration(this, 'scheduled-runs-lifecycle', {
      bucket: props.outputsBucketName,
      rule: [
        {
          id: 'expire-scheduled-runs-90d',
          status: 'Enabled',
          filter: [{ prefix: 'numa-chat/scheduled-runs/' }],
          expiration: [{ days: 90 }],
        },
      ],
    });

    // Runner Lambda handles EventBridge + manual executions
    this.agentScheduleRunnerLambda = this.addLambdaFunction(this, 'agent-schedule-runner', {
      addAuthorizer: true,
      lambdaDirectory: 'node/agent-schedule-runner',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      // FEAT-105 — cap parallelism so a noon convergence spike can't take down
      // the workspace agent proxy or AgentCore. Bumped 10→50 because the
      // documented 100-concurrent-automations-per-tenant default was
      // throttling at 10 — a tenant with ~30 hourly-aligned schedules at the
      // top of the hour would lose any past the 10th to the DLQ, with no
      // owner-visible signal.
      //
      // TODO(FEAT-105 round-3): investigate moving the runner behind an SQS
      // queue with event-source-mapping. That gives us smoothing across
      // bursts (no throttle → no DLQ → no missed runs), retain the
      // concurrency cap as the queue's batchSize × maxConcurrency, and free
      // us from picking a single number that fits all tenants. Trade-off:
      // adds queue latency to every fire, partial-batch-failure handling,
      // and a new infra surface area. Worth it once we see real throttle
      // events on this DLQ alarm in production.
      reservedConcurrentExecutions: 50,
      // FEAT-105 round-2 — async failures land in the DLQ (alarm above).
      deadLetterTargetArn: agentScheduleRunnerDlq.arn,
      timeout: 900,
      route: {
        verb: 'POST',
        path: 'agent-schedules/run',
      },
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        CHAT_HISTORY_TABLE_NAME: props.chatHistoryTableName,
        AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
        NOTIFICATIONS_TABLE_NAME: props.notificationsTableName,
        WORKSPACE_AGENT_PROXY_URL: props.workspaceAgentProxyUrl,
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        SCHEDULE_RUNNER_SECRET: props.agentScheduleRunnerSecret,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        // Agent tables for refreshing stale snapshots before each scheduled run
        WORKSPACE_AGENTS_TABLE_NAME: props.workspaceAgentsTableName,
        USER_AGENTS_TABLE_NAME: props.userAgentsTableName,
        // FEAT-143 — unified integrations payload needs admin preferred_method,
        // user native connector state, and the pipedream relay arn to resolve
        // per-slug method at run time. Mirrors workspace-agent-construct wiring.
        GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME: `${props.clientName}-global-integration-settings`,
        DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
        DATA_CONNECTORS_ENABLED: String(props.dataConnectorsEnabled ?? false),
        // Mirrored into the workspace-agent request body's `featureFlags`
        // so scheduled runs register the same MCP servers (connectors, vault)
        // that chat does. Without these, native connector tools are
        // unavailable in scheduled runs even when the user has them authed.
        // Vault MCP is gated on DATA_CONNECTORS_ENABLED above (TASK-146).
        OAUTH_INTEGRATIONS_ENABLED: String(props.oauthIntegrationsEnabled ?? false),
        ...(props.pipedreamRelayLambdaArn && {
          PIPEDREAM_RELAY_LAMBDA_ARN: props.pipedreamRelayLambdaArn,
        }),
        // Centralized email sender (deployer account, cross-account invocation)
        ...(props.emailSenderLambdaArn && {
          EMAIL_SENDER_LAMBDA_ARN: props.emailSenderLambdaArn,
        }),
        // Cognito User Pool ID for resolving user email when notification_email is missing
        ...(props.cognitoUserPoolId && {
          USER_POOL_ID: props.cognitoUserPoolId,
        }),
        // Trigger-quota enforcement moved here from the dispatcher — runner
        // does the cap-check + counter increment AFTER `claimRunSlot` so
        // counts only tick for fires that actually run. Needs the same
        // env block as agent-schedules to satisfy `resolveEffectiveQuotas`.
        SCHEDULING_SETTINGS_TABLE_NAME: props.schedulingSettingsTableName,
        ...(props.scheduleQuotas?.maxRunsPerCompanyPerMonth != null && {
          SCHEDULE_QUOTA_MAX_RUNS_PER_COMPANY_PER_MONTH: String(props.scheduleQuotas.maxRunsPerCompanyPerMonth),
        }),
        ...(props.scheduleQuotas?.maxRunsPerUserPerMonth != null && {
          SCHEDULE_QUOTA_MAX_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxRunsPerUserPerMonth),
        }),
        ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerCompany != null && {
          SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_COMPANY: String(
            props.scheduleQuotas.maxConcurrentActiveSchedulesPerCompany
          ),
        }),
        ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerUser != null && {
          SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_USER: String(
            props.scheduleQuotas.maxConcurrentActiveSchedulesPerUser
          ),
        }),
        ...(props.scheduleQuotas?.requireApprovalAboveUserCap != null && {
          SCHEDULE_QUOTA_REQUIRE_APPROVAL_ABOVE_USER_CAP: String(props.scheduleQuotas.requireApprovalAboveUserCap),
        }),
        ...(props.perClientSchedulingMinIntervalMinutes != null && {
          SCHEDULING_MIN_INTERVAL_MINUTES: String(props.perClientSchedulingMinIntervalMinutes),
        }),
        ...(props.scheduleQuotas?.maxTriggerRunsPerCompanyPerMonth != null && {
          SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_COMPANY_PER_MONTH: String(
            props.scheduleQuotas.maxTriggerRunsPerCompanyPerMonth
          ),
        }),
        ...(props.scheduleQuotas?.maxTriggerRunsPerUserPerMonth != null && {
          SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_USER_PER_MONTH: String(
            props.scheduleQuotas.maxTriggerRunsPerUserPerMonth
          ),
        }),
      },
      additionalPolicyStatements: [
        // FEAT-105 round-2 — DLQ permission. Lambda needs SendMessage so async
        // failures land in the DLQ instead of being silently dropped.
        {
          effect: 'Allow',
          actions: ['sqs:SendMessage'],
          resources: [agentScheduleRunnerDlq.arn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.chatHistoryTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.chatHistoryTableName}/index/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:Query'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.notificationsTableName}`],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`arn:aws:s3:::${props.outputsBucketName}/numa-chat/scheduled-runs/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`arn:aws:s3:::${props.outputsBucketName}/numa-chat/workspace/*/outputs/status.json`],
        },
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: ['*'],
        },
        // Read-only access to agent tables for refreshing stale snapshots
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.workspaceAgentsTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.userAgentsTableName}`,
          ],
        },
        // Query access to knowledge-bases table for resolving "All knowledge bases" in scheduled runs
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [`arn:aws:dynamodb:*:*:table/numa-${props.clientName}-knowledge-bases`],
        },
        // FEAT-143 — unified integrations payload reads admin preferred_method
        // from the global-integration-settings table (Scan) and per-user native
        // connector rows from data-connectors (Query keyed by user_id).
        {
          effect: 'Allow',
          actions: ['dynamodb:Scan'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.clientName}-global-integration-settings`],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
        },
        // Native OAuth integrations (Gmail, Calendar…) live in the per-user
        // vault, not the data-connectors table. The unified payload reads the
        // vault to detect them — without this grant the runner can't see
        // vault-only native connections and silently drops them
        // (INTEGRATION_DROPPED_NO_AUTH) so the scheduled run fails.
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/*`],
        },
        // GetItem for Level-3 admin overrides (read on each invocation so
        // admin toggle changes apply immediately). UpdateItem for the
        // atomic trigger-counter rows (`trigger_count_*`) the runner
        // increments via TransactWriteItems when an event-trigger fires.
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.schedulingSettingsTableName}`],
        },
        // Cognito lookup for resolving user email when notification_email is missing on schedule record
        ...(props.cognitoUserPoolArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['cognito-idp:AdminGetUser'],
                resources: [props.cognitoUserPoolArn],
              },
            ]
          : []),
        // Branding config read for email template styling (logo, primary color)
        ...(props.brandingTableName
          ? [
              {
                effect: 'Allow' as const,
                actions: ['dynamodb:GetItem'],
                resources: [`arn:aws:dynamodb:*:*:table/${props.brandingTableName}`],
              },
            ]
          : []),
      ],
    });

    // FEAT-105 — DLQ for the connector-event-dispatcher. The dispatcher runs
    // off EventBridge async invocations. Without a DLQ, any unhandled throw
    // (vault read fails, Gmail API 5xx, TransactWrite throttle on the
    // trigger-counter row) is invisible — the Gmail event is lost and the
    // owner's automation silently drops fires. Mirrors the runner's pattern.
    const connectorEventDispatcherDlq = new SqsQueue(this, 'connector-event-dispatcher-dlq', {
      name: `${props.clientName}-connector-event-dispatcher-dlq`,
      messageRetentionSeconds: 14 * 24 * 60 * 60, // 14 days
      tags: {
        Purpose: 'connector-event-dispatcher-dlq',
        ClientName: props.clientName,
      },
    });

    new CloudwatchMetricAlarm(this, 'connector-event-dispatcher-dlq-alarm', {
      alarmName: `${props.clientName}-connector-event-dispatcher-dlq-not-empty`,
      alarmDescription: 'Connector event dispatcher produced a DLQ message — a Gmail trigger event was lost.',
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensions: { QueueName: connectorEventDispatcherDlq.name },
      statistic: 'Maximum',
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      treatMissingData: 'notBreaching',
    });

    // Connector Event Dispatcher — routes connector events to user automation triggers
    const connectorEventDispatcherLambda = this.addLambdaFunction(this, 'connector-event-dispatcher', {
      addAuthorizer: false,
      lambdaDirectory: 'node/connector-event-dispatcher',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      timeout: 60,
      // Async failures (throws past Lambda's automatic 2 retries) land here.
      deadLetterTargetArn: connectorEventDispatcherDlq.arn,
      environment: {
        CLIENT_NAME: props.clientName,
        DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
        AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
        AGENT_SCHEDULE_RUNNER_FUNCTION_NAME: this.agentScheduleRunnerLambda.functionName,
        // Used by the Pipedream branch to fetch the full event payload that
        // the receiver lambda persisted under connector-events/pipedream/...
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        SCHEDULING_SETTINGS_TABLE_NAME: props.schedulingSettingsTableName,
        // Per-client (Level-2) quota overrides. The dispatcher only consumes
        // the trigger-quota fields at runtime, but `resolveEffectiveQuotas`
        // validates the full Level-2 record up-front (fail-loud). Pass the
        // complete set so we don't throw on every Gmail/pipedream event the
        // moment a single field is missing — same wiring as agent-schedules
        // above.
        ...(props.scheduleQuotas?.maxRunsPerCompanyPerMonth != null && {
          SCHEDULE_QUOTA_MAX_RUNS_PER_COMPANY_PER_MONTH: String(props.scheduleQuotas.maxRunsPerCompanyPerMonth),
        }),
        ...(props.scheduleQuotas?.maxRunsPerUserPerMonth != null && {
          SCHEDULE_QUOTA_MAX_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxRunsPerUserPerMonth),
        }),
        ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerCompany != null && {
          SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_COMPANY: String(
            props.scheduleQuotas.maxConcurrentActiveSchedulesPerCompany
          ),
        }),
        ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerUser != null && {
          SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_USER: String(
            props.scheduleQuotas.maxConcurrentActiveSchedulesPerUser
          ),
        }),
        ...(props.scheduleQuotas?.requireApprovalAboveUserCap != null && {
          SCHEDULE_QUOTA_REQUIRE_APPROVAL_ABOVE_USER_CAP: String(props.scheduleQuotas.requireApprovalAboveUserCap),
        }),
        ...(props.perClientSchedulingMinIntervalMinutes != null && {
          SCHEDULING_MIN_INTERVAL_MINUTES: String(props.perClientSchedulingMinIntervalMinutes),
        }),
        ...(props.scheduleQuotas?.maxTriggerRunsPerCompanyPerMonth != null && {
          SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_COMPANY_PER_MONTH: String(
            props.scheduleQuotas.maxTriggerRunsPerCompanyPerMonth
          ),
        }),
        ...(props.scheduleQuotas?.maxTriggerRunsPerUserPerMonth != null && {
          SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_USER_PER_MONTH: String(
            props.scheduleQuotas.maxTriggerRunsPerUserPerMonth
          ),
        }),
      },
      additionalPolicyStatements: [
        // DLQ permission. Lambda needs SendMessage so async failures land in
        // the DLQ instead of being silently dropped after the 2 automatic
        // retries.
        {
          effect: 'Allow',
          actions: ['sqs:SendMessage'],
          resources: [connectorEventDispatcherDlq.arn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
        },
        {
          // Query for matching event schedules + tenant-wide trigger-load
          // aggregation; UpdateItem to increment recent_runs / total_runs and
          // stamp last_quota_blocked_month on quota-block notifications.
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
          ],
        },
        {
          // GetItem for Level-3 admin overrides; UpdateItem for the atomic
          // trigger-counter rows (`trigger_count_company_<YYYY-MM>` and
          // `trigger_count_user_<sub>_<YYYY-MM>`) that gate cap enforcement
          // via TransactWriteItems. Without UpdateItem the transaction
          // throws AccessDeniedException and every Gmail trigger fails.
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.schedulingSettingsTableName}`],
        },
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:*:*:secret:${props.clientName}/vault/*`],
        },
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [this.agentScheduleRunnerLambda.arn],
        },
        {
          // Read the full Pipedream event payload that the receiver wrote.
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${props.outputsBucketArn}/connector-events/*`],
        },
      ],
    });

    const connectorEventDispatcherRule = new CloudwatchEventRule(this, 'connector-event-dispatcher-rule', {
      name: `${props.clientName}-connector-event-dispatch`,
      eventBusName: props.connectorEventBusName,
      eventPattern: JSON.stringify({
        source: [{ prefix: 'numa.connector.' }],
        'detail-type': ['connector.event'],
      }),
    });

    new CloudwatchEventTarget(this, 'connector-event-dispatcher-target', {
      rule: connectorEventDispatcherRule.name,
      eventBusName: props.connectorEventBusName,
      arn: connectorEventDispatcherLambda.arn,
    });

    new LambdaPermission(this, 'connector-event-dispatcher-eb-permission', {
      statementId: 'AllowEventBridgeInvoke',
      action: 'lambda:InvokeFunction',
      functionName: connectorEventDispatcherLambda.functionName,
      principal: 'events.amazonaws.com',
      sourceArn: connectorEventDispatcherRule.arn,
    });

    const schedulerAssumePolicy = new DataAwsIamPolicyDocument(this, 'agent-schedule-runner-assume-policy', {
      statement: [
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          principals: [{ identifiers: ['scheduler.amazonaws.com'], type: 'Service' }],
        },
      ],
    }).json;

    const agentScheduleExecutionRole = new IamRole(this, 'agent-schedule-runner-role', {
      name: `${props.clientName}-agent-schedule-runner`,
      assumeRolePolicy: schedulerAssumePolicy,
    });

    new IamRolePolicy(this, 'agent-schedule-runner-role-policy', {
      name: `${props.clientName}-agent-schedule-runner`,
      role: agentScheduleExecutionRole.name,
      policy: new DataAwsIamPolicyDocument(this, 'agent-schedule-runner-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [this.agentScheduleRunnerLambda.arn],
          },
          // FEAT-105 — EB Scheduler must be able to write to the DLQ when
          // synchronous Lambda invocations fail past their retry budget.
          // Without this grant, DeadLetterConfig is silently a no-op.
          {
            effect: 'Allow',
            actions: ['sqs:SendMessage'],
            resources: [agentScheduleRunnerDlq.arn],
          },
        ],
      }).json,
    });

    // Create EventBridge Schedule Groups for different event types
    new SchedulerScheduleGroup(this, 'agent-schedule-group', {
      name: `${props.clientName}-agent-schedules`,
    });

    new SchedulerScheduleGroup(this, 'application-schedule-group', {
      name: `${props.clientName}-application-schedules`,
    });

    new SchedulerScheduleGroup(this, 'data-sync-schedule-group', {
      name: `${props.clientName}-datasync-schedules`,
    });

    const agentSchedulesEnv = {
      CLIENT_NAME: props.clientName,
      REGION: props.region,
      AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
      AGENT_SCHEDULE_EXECUTION_ROLE_ARN: agentScheduleExecutionRole.arn,
      AGENT_SCHEDULE_RUNNER_ARN: this.agentScheduleRunnerLambda.arn,
      // FEAT-105 — every EB Scheduler target carries a DLQ + retry policy so
      // sync invocations that fail after the runner stopped swallowing errors
      // surface in the same DLQ as the lambda's async-invocation failures.
      AGENT_SCHEDULE_DLQ_ARN: agentScheduleRunnerDlq.arn,
      SCHEDULING_SETTINGS_TABLE_NAME: props.schedulingSettingsTableName,
      // Email-sender + Cognito wiring — used when an admin pauses / locks
      // another user's schedule, to notify the owner.
      ...(props.emailSenderLambdaArn && { EMAIL_SENDER_LAMBDA_ARN: props.emailSenderLambdaArn }),
      ...(props.cognitoUserPoolId && { USER_POOL_ID: props.cognitoUserPoolId }),
      ...(props.perClientSchedulingMinIntervalMinutes != null && {
        SCHEDULING_MIN_INTERVAL_MINUTES: String(props.perClientSchedulingMinIntervalMinutes),
      }),
      // Pipedream-trigger lifecycle. Both empty when integrations are disabled
      // for this client; the lambda gracefully rejects pipedream-trigger
      // schedule creates in that case.
      ...(props.pipedreamRelayLambdaArn && {
        PIPEDREAM_RELAY_LAMBDA_ARN: props.pipedreamRelayLambdaArn,
        PIPEDREAM_WEBHOOK_URL: `https://${props.domainName}/api/webhooks/pipedream-events/${props.cloudfrontSharedSecret}`,
      }),
      ...(props.scheduleQuotas?.maxRunsPerCompanyPerMonth != null && {
        SCHEDULE_QUOTA_MAX_RUNS_PER_COMPANY_PER_MONTH: String(props.scheduleQuotas.maxRunsPerCompanyPerMonth),
      }),
      ...(props.scheduleQuotas?.maxRunsPerUserPerMonth != null && {
        SCHEDULE_QUOTA_MAX_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxRunsPerUserPerMonth),
      }),
      ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerCompany != null && {
        SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_COMPANY: String(
          props.scheduleQuotas.maxConcurrentActiveSchedulesPerCompany
        ),
      }),
      ...(props.scheduleQuotas?.maxConcurrentActiveSchedulesPerUser != null && {
        SCHEDULE_QUOTA_MAX_CONCURRENT_ACTIVE_SCHEDULES_PER_USER: String(
          props.scheduleQuotas.maxConcurrentActiveSchedulesPerUser
        ),
      }),
      ...(props.scheduleQuotas?.requireApprovalAboveUserCap != null && {
        SCHEDULE_QUOTA_REQUIRE_APPROVAL_ABOVE_USER_CAP: String(props.scheduleQuotas.requireApprovalAboveUserCap),
      }),
      ...(props.scheduleQuotas?.maxTriggerRunsPerCompanyPerMonth != null && {
        SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_COMPANY_PER_MONTH: String(
          props.scheduleQuotas.maxTriggerRunsPerCompanyPerMonth
        ),
      }),
      ...(props.scheduleQuotas?.maxTriggerRunsPerUserPerMonth != null && {
        SCHEDULE_QUOTA_MAX_TRIGGER_RUNS_PER_USER_PER_MONTH: String(props.scheduleQuotas.maxTriggerRunsPerUserPerMonth),
      }),
    } as Record<string, string>;

    const agentSchedulesPolicy = [
      {
        effect: 'Allow',
        // No `dynamodb:Scan` — tenant-wide aggregation uses Query against
        // `tenant-id-index` (see scanTenantSchedulesForQuota despite its
        // legacy name). If you find yourself wanting Scan here, add a GSI
        // instead.
        actions: [
          'dynamodb:Query',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
          `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
        ],
      },
      {
        effect: 'Allow',
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
          'scheduler:UpdateSchedule',
        ],
        resources: ['*'],
      },
      {
        effect: 'Allow',
        actions: ['iam:PassRole'],
        resources: [agentScheduleExecutionRole.arn],
      },
      {
        effect: 'Allow',
        // GetItem for level-3 quota override reads + UpdateItem for the
        // quota-warning email dedupe rows (`quota_warn_user_<sub>` and
        // `quota_warn_company` keys).
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.schedulingSettingsTableName}`],
      },
      // Pipedream relay invocation for trigger lifecycle. When the relay isn't
      // deployed, this resource list is empty and the lambda gracefully
      // rejects deploy attempts at runtime.
      ...(props.pipedreamRelayLambdaArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['lambda:InvokeFunction'],
              resources: [props.pipedreamRelayLambdaArn],
            },
          ]
        : []),
      // Email-sender + Cognito-lookup grants for the admin-paused-your-
      // automation notification path. Wrapped in spreads so they're only
      // attached when the corresponding props exist (matches the env-var
      // gating above).
      ...(props.emailSenderLambdaArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['lambda:InvokeFunction'],
              resources: [props.emailSenderLambdaArn],
            },
          ]
        : []),
      ...(props.cognitoUserPoolArn
        ? [
            {
              effect: 'Allow' as const,
              actions: ['cognito-idp:AdminGetUser'],
              resources: [props.cognitoUserPoolArn],
            },
          ]
        : []),
    ];

    this.addLambdaFunction(this, 'agent-schedules', {
      addAuthorizer: true,
      lambdaDirectory: 'node/agent-schedules',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: [
        { verb: 'ANY', path: 'agent-schedules' },
        { verb: 'ANY', path: 'agent-schedules/{proxy+}' },
      ],
      environment: agentSchedulesEnv,
      additionalPolicyStatements: agentSchedulesPolicy,
    });

    // Notifications API - CRUD operations for notifications
    this.addLambdaFunction(this, 'notifications-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/notifications-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: [
        { verb: 'ANY', path: 'notifications' },
        { verb: 'ANY', path: 'notifications/{proxy+}' },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        NOTIFICATIONS_TABLE_NAME: props.notificationsTableName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.notificationsTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.notificationsTableName}/index/*`,
          ],
        },
      ],
    });

    // Notifications Stream - Server-sent events for real-time notifications
    this.addLambdaFunction(this, 'notifications-stream', {
      addAuthorizer: false, // Uses CloudFront secret + JWT validation
      lambdaDirectory: 'node/notifications-stream',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: [
        { verb: 'GET', path: 'notifications/stream' },
        { verb: 'GET', path: 'notifications/health' },
      ],
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        NOTIFICATIONS_TABLE_NAME: props.notificationsTableName,
        CLOUDFRONT_SHARED_SECRET: props.cloudfrontSharedSecret,
        // Cognito config for in-Lambda JWT verification. This Lambda has
        // addAuthorizer: false (CloudFront secret + JWT), so it must verify the
        // bearer token's signature itself — accepting the same client-ID set the
        // api-gateway-authorizer does. Without these it fails closed (401).
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: props.userPoolClientId,
        ...(props.additionalCognitoClientIds
          ? { ADDITIONAL_COGNITO_CLIENT_IDS: props.additionalCognitoClientIds }
          : {}),
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.notificationsTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.notificationsTableName}/index/*`,
          ],
        },
      ],
      timeout: 900, // 15 minutes for streaming
    });

    // application-scheduler and data-sync-scheduler were removed as part of
    // FEAT-105. They were deployed but never wired to any EventBridge target —
    // user-facing recurrence goes exclusively through `agent-schedules` /
    // `agent-schedule-runner`. Application and data-sync scheduling will be
    // re-added under the same agent-schedules surface area when needed.

    // Users API - list workspace users (Cognito + profile enrichment from chat-settings)
    if (props.cognitoUserPoolId && props.cognitoUserPoolArn) {
      this.addLambdaFunction(this, 'numa-users-api-get', {
        addAuthorizer: true,
        lambdaDirectory: 'node/numa-users-api',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        route: { verb: 'GET', path: 'users' },
        environment: {
          REGION: props.region,
          USER_POOL_ID: props.cognitoUserPoolId,
          CHAT_SETTINGS_TABLE_NAME: props.chatSettingsTableName,
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: ['cognito-idp:ListUsers'],
            resources: [props.cognitoUserPoolArn],
          },
          {
            effect: 'Allow',
            actions: ['dynamodb:BatchGetItem'],
            resources: [`arn:aws:dynamodb:*:*:table/${props.chatSettingsTableName}`],
          },
          {
            effect: 'Allow',
            actions: ['s3:GetObject'],
            resources: [`${props.outputsBucketArn}/numa-chat/profile-images/*`],
          },
        ],
      });
    }

    // Usage Analytics API - Ingest endpoint (no auth, API key only)
    this.addLambdaFunction(this, 'usage-analytics-ingest', {
      addAuthorizer: false,
      lambdaDirectory: 'node/usage-analytics-ingest',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: { verb: 'POST', path: 'usage-analytics/ingest' },
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        EVENTS_TABLE_NAME: props.usageAnalyticsEventsTableName,
        KEYS_TABLE_NAME: props.usageAnalyticsKeysTableName,
        COUNTERS_TABLE_NAME: props.usageAnalyticsCountersTableName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [
            props.usageAnalyticsKeysTableArn,
            props.usageAnalyticsEventsTableArn,
            props.usageAnalyticsCountersTableArn,
          ],
        },
      ],
    });

    // Usage Analytics API - Admin endpoints (Cognito + admin check)
    const usageAnalyticsAdminEnv = {
      CLIENT_NAME: props.clientName,
      REGION: props.region,
      EVENTS_TABLE_NAME: props.usageAnalyticsEventsTableName,
      KEYS_TABLE_NAME: props.usageAnalyticsKeysTableName,
      COUNTERS_TABLE_NAME: props.usageAnalyticsCountersTableName,
    } as Record<string, string>;

    const usageAnalyticsAdminPolicy = [
      {
        effect: 'Allow',
        actions: [
          'dynamodb:Scan',
          'dynamodb:Query',
          'dynamodb:BatchWriteItem',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
        ],
        resources: [
          props.usageAnalyticsKeysTableArn,
          props.usageAnalyticsEventsTableArn,
          `${props.usageAnalyticsEventsTableArn}/index/*`,
          props.usageAnalyticsCountersTableArn,
        ],
      },
    ];

    this.addLambdaFunction(this, 'usage-analytics-admin-events', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'GET', path: 'usage-analytics/events' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-delete', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'DELETE', path: 'usage-analytics/test-data' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-key', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'GET', path: 'usage-analytics/key' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-regenerate', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'POST', path: 'usage-analytics/key/regenerate' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-get-retention', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'GET', path: 'usage-analytics/retention' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-set-retention', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'PUT', path: 'usage-analytics/retention' },
    });

    this.addLambdaFunction(this, 'usage-analytics-admin-heatmap', {
      addAuthorizer: true,
      lambdaDirectory: 'node/usage-analytics-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: usageAnalyticsAdminEnv,
      additionalPolicyStatements: usageAnalyticsAdminPolicy,
      route: { verb: 'GET', path: 'usage-analytics/heatmap' },
    });

    // Usage Analytics API - Contract endpoint (public, no auth)
    this.addLambdaFunction(this, 'usage-analytics-contract', {
      addAuthorizer: false,
      lambdaDirectory: 'node/usage-analytics-contract',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      route: { verb: 'GET', path: 'usage-analytics/contract' },
      environment: {
        API_BASE_URL: `https://${props.domainName}/api`,
      },
    });

    // Audit Logs API - Admin endpoint (Cognito + admin check)
    const auditLogsEnv = {
      REGION: props.region,
      WEB_CRAWLER_TABLE: props.auditWebCrawlerTableName,
      AUTOMATION_TABLE: props.auditAutomationTableName,
      SEARCH_INDEX_TABLE: props.auditSearchIndexTableName,
      KB_INDEX_TABLE: props.auditKbIndexTableName,
      SCHEDULE_TABLE: props.auditScheduleTableName,
      SYNC_TABLE: props.auditSyncTableName,
      RECOVERY_TABLE: props.auditRecoveryTableName,
      USER_MANAGEMENT_TABLE: props.auditUserManagementTableName,
    } as Record<string, string>;

    const auditLogsPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:Scan', 'dynamodb:Query'],
        resources: [
          props.auditWebCrawlerTableArn,
          `${props.auditWebCrawlerTableArn}/index/*`,
          props.auditAutomationTableArn,
          `${props.auditAutomationTableArn}/index/*`,
          props.auditSearchIndexTableArn,
          `${props.auditSearchIndexTableArn}/index/*`,
          props.auditKbIndexTableArn,
          `${props.auditKbIndexTableArn}/index/*`,
          props.auditScheduleTableArn,
          `${props.auditScheduleTableArn}/index/*`,
          props.auditSyncTableArn,
          `${props.auditSyncTableArn}/index/*`,
          props.auditRecoveryTableArn,
          `${props.auditRecoveryTableArn}/index/*`,
          props.auditUserManagementTableArn,
          `${props.auditUserManagementTableArn}/index/*`,
        ],
      },
    ];

    this.addLambdaFunction(this, 'audit-logs-admin', {
      addAuthorizer: true,
      lambdaDirectory: 'node/audit-logs-admin',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: auditLogsEnv,
      additionalPolicyStatements: auditLogsPolicy,
      route: { verb: 'GET', path: 'audit-logs/{logType}' },
    });

    this.addLambdaFunction(this, 'audit-user-management-writer', {
      addAuthorizer: true,
      lambdaDirectory: 'node/audit-user-management-writer',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: {
        REGION: props.region,
        USER_MANAGEMENT_TABLE: props.auditUserManagementTableName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem'],
          resources: [props.auditUserManagementTableArn],
        },
      ],
      route: { verb: 'POST', path: 'audit-user-management' },
    });

    // Admin Disaster Recovery Stats API (GET)
    if (props.recoveryBucketName && props.recoveryBucketArn) {
      const drEnv = {
        RECOVERY_BUCKET: props.recoveryBucketName,
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        USER_POOL_ID: props.userPoolId,
      } as Record<string, string>;
      const drPolicy = [
        {
          effect: 'Allow',
          actions: ['s3:ListBucket', 's3:GetBucketLocation'],
          resources: [props.recoveryBucketArn],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:HeadObject', 's3:PutObject'],
          resources: [`${props.recoveryBucketArn}/*`],
        },
        {
          // KMS for reading encrypted backups and writing encrypted secrets/DynamoDB
          effect: 'Allow',
          actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey', 'kms:DescribeKey', 'kms:CreateGrant'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:*'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: [
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminUpdateUserAttributes',
            'cognito-idp:AdminAddUserToGroup',
            'cognito-idp:AdminGetUser',
            'cognito-idp:CreateGroup',
            'cognito-idp:ListGroups',
          ],
          resources: [`arn:aws:cognito-idp:*:*:userpool/${props.userPoolId}`],
        },
        {
          effect: 'Allow',
          actions: [
            'secretsmanager:CreateSecret',
            'secretsmanager:UpdateSecret',
            'secretsmanager:ListSecrets',
            'secretsmanager:TagResource',
          ],
          resources: ['*'],
        },
      ];
      // GET /settings/disaster-recovery/stats — legacy stats
      this.addLambdaFunction(this, 'admin-dr-stats', {
        addAuthorizer: true,
        lambdaDirectory: 'node/admin-dr-stats',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        memorySize: 512,
        timeout: 60,
        environment: drEnv,
        additionalPolicyStatements: drPolicy,
        route: { verb: 'GET', path: 'settings/disaster-recovery/stats' },
      });
      // GET /settings/disaster-recovery/backups — daily backup listing
      this.addLambdaFunction(this, 'admin-dr-backups', {
        addAuthorizer: true,
        lambdaDirectory: 'node/admin-dr-stats',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        memorySize: 512,
        timeout: 60,
        environment: drEnv,
        additionalPolicyStatements: drPolicy,
        route: { verb: 'GET', path: 'settings/disaster-recovery/backups' },
      });
      // POST /settings/disaster-recovery/restore — restore from backup
      this.addLambdaFunction(this, 'admin-dr-restore', {
        addAuthorizer: true,
        lambdaDirectory: 'node/admin-dr-stats',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        memorySize: 1024,
        timeout: 900,
        environment: drEnv,
        additionalPolicyStatements: drPolicy,
        route: { verb: 'POST', path: 'settings/disaster-recovery/restore' },
      });
      // POST /settings/disaster-recovery/access-log — record DR tab unlock
      this.addLambdaFunction(this, 'admin-dr-access-log', {
        addAuthorizer: true,
        lambdaDirectory: 'node/admin-dr-stats',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        memorySize: 256,
        timeout: 10,
        environment: drEnv,
        additionalPolicyStatements: drPolicy,
        route: { verb: 'POST', path: 'settings/disaster-recovery/access-log' },
      });
      // GET /settings/disaster-recovery/last-restore — last restore metadata
      this.addLambdaFunction(this, 'admin-dr-last-restore', {
        addAuthorizer: true,
        lambdaDirectory: 'node/admin-dr-stats',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        memorySize: 256,
        timeout: 10,
        environment: drEnv,
        additionalPolicyStatements: drPolicy,
        route: { verb: 'GET', path: 'settings/disaster-recovery/last-restore' },
      });
    }
  }

  /**
   * Get the LibreOffice Lambda layer ARN for the given region.
   * Layer from: https://github.com/shelfio/libreoffice-lambda-layer
   */
  private getLibreOfficeLayerArn(region: string): string {
    const layerArns: Record<string, string> = {
      'us-east-1': 'arn:aws:lambda:us-east-1:764866452798:layer:libreoffice-brotli:1',
      'ap-southeast-2': 'arn:aws:lambda:ap-southeast-2:764866452798:layer:libreoffice-brotli:1',
      'ap-southeast-3': 'arn:aws:lambda:ap-southeast-3:207567759910:layer:libreoffice-brotli:1',
    };
    return layerArns[region] || layerArns['us-east-1'];
  }

  /**
   * Get the Pandoc Lambda layer ARN for the given region.
   * Most regions use SAR (Serverless Application Repository) to deploy the layer per-account.
   * Regions without SAR (e.g. ap-southeast-3) use a pre-published public layer instead.
   * Publish with: tools/publish-pandoc-layer.sh <target-region> <source-layer-arn>
   */
  private getPandocLayerArn(clientName: string, region: string): string {
    // Pre-published layer ARNs for regions where SAR is unavailable
    const staticLayerArns: Record<string, string> = {
      'ap-southeast-3': 'arn:aws:lambda:ap-southeast-3:207567759910:layer:pandoc:1',
    };

    if (staticLayerArns[region]) {
      return staticLayerArns[region];
    }

    // For regions with SAR support, deploy dynamically via SAR
    const pandocSarStack = new ServerlessapplicationrepositoryCloudformationStack(this, 'pandoc-layer', {
      name: `${clientName}-pandoc-layer`,
      applicationId: 'arn:aws:serverlessrepo:us-east-1:145266761615:applications/pandoc-lambda-layer',
      capabilities: ['CAPABILITY_IAM'],
      lifecycle: {
        ignoreChanges: ['parameters', 'tags'],
      },
    });
    return pandocSarStack.outputs.lookup('LayerVersion');
  }
}

export interface AppAgnosticApiGatewayLambdaCollectionProps extends Omit<
  ApiGatewayLambdaCollectionProps,
  'apiGatewayId' | 'apiGatewayAuthorizerId'
> {
  chatHistoryTableName: string;
  /** Per-client credit ledger table name (Numa Credit System / SPK-015). */
  creditLedgerTableName: string;
  agentSchedulesTableName: string;
  notificationsTableName: string;
  clientName: string;
  dataBucketName: string;
  /** Data bucket ARN for Files storage and IAM policies. */
  dataBucketArn: string;
  logGroup: CloudwatchLogGroup;
  region: string;
  userPoolClientId: string;
  userPoolClientSecret: string;
  apiGatewayId: string;
  apiGatewayAuthorizerId: string;
  webCrawlerStateMachineArn: string;
  webCrawlerTableArn: string;
  webCrawlerTableName: string;
  visionModelType: string;
  // Branding API settings
  brandingProviderEnabled?: boolean;
  brandingTableName?: string;
  brandingAssetsPrefix?: string;
  brandingAssetsBucketName?: string;
  brandingAssetsBucketArn?: string;
  /** Exact outputs bucket ARN for this environment (handles -dev/-staging suffix). */
  outputsBucketArn: string;
  /** Outputs bucket name for constructing S3 keys. */
  outputsBucketName: string;
  /** Company-data bucket name (holds company-data.json read by numa-cli-api
   *  for bootstrap and by the workspace agent at chat-start). Optional —
   *  some client stacks don't provision this bucket. */
  companyBucketName?: string;
  /** Company-data bucket ARN — needed to scope the S3 GetObject perm on
   *  the numa-cli-api Lambda. Optional alongside `companyBucketName`. */
  companyBucketArn?: string;
  workspaceAgentsTableName: string;
  userAgentsTableName: string;
  /** Exact agents settings table name, passed from Core to avoid name drift. */
  agentsSettingsTableName: string;
  /** Agent user preferences table name (per-user favorites, hidden, usage). */
  agentUserPrefsTableName: string;
  /** Agent teams table name. */
  agentTeamsTableName: string;
  /** Agent team members table name. */
  agentTeamMembersTableName: string;
  /** Agent sharing table name. */
  agentSharingTableName: string;
  /** Scheduling settings table name for client-admin minimum interval override. */
  schedulingSettingsTableName: string;
  /** Per-client scheduling minimum interval (minutes), from client config. */
  perClientSchedulingMinIntervalMinutes?: number;
  /** Global scheduling minimum interval (minutes), from platform-settings. */
  globalSchedulingMinIntervalMinutes?: number;
  /**
   * Per-client + global scheduled-run quota overrides (Level 2 of the
   * quota chain). Sourced from the platform-settings record in the
   * deployer `numa-client-config` table — the sole source of truth.
   * Lambdas throw at runtime if any required value is missing.
   */
  scheduleQuotas?: {
    maxRunsPerCompanyPerMonth?: number;
    maxRunsPerUserPerMonth?: number;
    maxTriggerRunsPerCompanyPerMonth?: number;
    maxTriggerRunsPerUserPerMonth?: number;
    maxConcurrentActiveSchedulesPerCompany?: number;
    maxConcurrentActiveSchedulesPerUser?: number;
    requireApprovalAboveUserCap?: boolean;
  };
  /** MFA settings table name for device remember duration. */
  mfaSettingsTableName: string;
  /** Cognito User Pool ID — needed for admin MFA reset operations. */
  userPoolId: string;
  /**
   * Comma-separated extra Cognito app-client IDs (beyond `userPoolClientId`)
   * that may have minted valid tokens. Forwarded to numa-cli-api so its
   * in-Lambda JWT verifier accepts the same set the api-gateway-authorizer
   * does. Optional — most stacks have a single client ID.
   */
  additionalCognitoClientIds?: string;
  /**
   * HMAC secret numa-cli-api uses to verify proxy-minted "service identity"
   * tokens for non-interactive runs. Same secret the workspace-chat-agent-proxy
   * signs with. Never injected into the workspace container. Optional — when
   * absent, numa-cli-api rejects service tokens (interactive Cognito path is
   * unaffected).
   */
  cliIdentitySecret?: string;
  /** User chat settings table name for per-user defaults (tools, KBs, integrations). */
  chatSettingsTableName: string;
  /** Data connectors table name for per-user connector configs. */
  dataConnectorsTableName: string;
  /** Data connector settings table name for admin feature flags. */
  dataConnectorsSettingsTableName: string;
  /** ext-api-doc bucket name — admin-data-connector-settings-get reads it to
   *  tell the frontend which per-slug docs are deployed and therefore which
   *  connectors can be enabled. */
  extApiDocBucketName: string;
  /** ext-api-doc bucket ARN — used to grant the GET lambda s3:ListBucket. */
  extApiDocBucketArn: string;
  /** Capabilities table name for admin feature flag overrides. */
  capabilitiesTableName: string;
  /** Data connector selection configs table name. */
  dataConnectorsSyncConfigsTableName: string;
  /** Synergy extraction SQS FIFO queue URL/ARN ('' when the crawler is
   *  disabled). The on-visit hook enqueues a per-job message onto it. */
  synergyExtractQueueUrl?: string;
  synergyExtractQueueArn?: string;
  /** Synergy crawl-state table ('' when disabled) — sync-config/status routes
   *  + the on-visit grant/throttle rows. */
  synergyCrawlStateTableName?: string;
  synergyCrawlStateTableArn?: string;
  /** Synergy coordinator Lambda ('' when disabled) — "Sync now" invokes it to
   *  enumerate + enqueue. */
  synergyCoordinatorFunctionName?: string;
  synergyCoordinatorFunctionArn?: string;
  /** Single Synergy flag (synergy && dataConnectorsEnabled). Gates EVERY Synergy
   *  route: the crawl/index control plane (sync-now, sync-config GET/PUT,
   *  sync-status) AND the remote files browser + read-parity routes (jobs, job
   *  folders, folder items, file search/history/weblink/details). They only
   *  deploy when Synergy is enabled — mirrors the crawler construct, provisioned
   *  on the same flag. */
  synergyEnabled?: boolean;
  /** Admin-side gate. When false, the unified integrations catalog returns
   *  no native rows; admins can't add them and users don't see them. The
   *  flag is the only way to suppress natives entirely — there's no
   *  per-chat user toggle anymore (per-integration enable replaces it). */
  dataConnectorsEnabled?: boolean;
  /** Forwarded as `featureFlags.OAUTH_INTEGRATIONS_ENABLED` on the
   *  workspace-agent request body fired by the schedule runner. The
   *  `connectors` MCP in `sdk_config.py` is gated on this flag, so leaving
   *  it false silently breaks native connector tools in scheduled runs. */
  oauthIntegrationsEnabled?: boolean;
  /** Connector events table name (permanent event records). */
  connectorEventsTableName: string;
  /** Connector event configs table name (admin toggle/tags per event type). */
  connectorEventConfigsTableName: string;
  /** EventBridge custom bus name for connector events. */
  connectorEventBusName: string;
  /** Chat agent function URL for internal invocations (V1 — retained for other callers). */
  chatAgentFunctionUrl: string;
  /** Workspace agent proxy function URL for scheduled agent runs (V2 sync mode). */
  workspaceAgentProxyUrl: string;
  /** CloudFront shared secret for internal agent calls. */
  cloudfrontSharedSecret: string;
  /** Secret shared with chat agent for schedule runner auth. */
  agentScheduleRunnerSecret: string;
  /** Bedrock Knowledge Base ID for data sync scheduling (optional). */
  bedrockKbId?: string;
  /** Bedrock Knowledge Base data source ID for data sync scheduling (optional). */
  bedrockDataSourceId?: string;
  /** Usage analytics events table name. */
  usageAnalyticsEventsTableName: string;
  /** Usage analytics events table ARN for IAM. */
  usageAnalyticsEventsTableArn: string;
  /** Usage analytics API keys table name. */
  usageAnalyticsKeysTableName: string;
  /** Usage analytics API keys table ARN for IAM. */
  usageAnalyticsKeysTableArn: string;
  /** Usage analytics counters table name. */
  usageAnalyticsCountersTableName: string;
  /** Usage analytics counters table ARN for IAM. */
  usageAnalyticsCountersTableArn: string;
  /** Domain name for API contract base URL. */
  domainName: string;
  /** Audit log: web crawler table name. */
  auditWebCrawlerTableName: string;
  /** Audit log: web crawler table ARN. */
  auditWebCrawlerTableArn: string;
  /** Audit log: automation table name. */
  auditAutomationTableName: string;
  /** Audit log: automation table ARN. */
  auditAutomationTableArn: string;
  /** Audit log: search index table name. */
  auditSearchIndexTableName: string;
  /** Audit log: search index table ARN. */
  auditSearchIndexTableArn: string;
  /** Audit log: KB index table name. */
  auditKbIndexTableName: string;
  /** Audit log: KB index table ARN. */
  auditKbIndexTableArn: string;
  /** Audit log: schedule table name. */
  auditScheduleTableName: string;
  /** Audit log: schedule table ARN. */
  auditScheduleTableArn: string;
  /** Audit log: sync table name. */
  auditSyncTableName: string;
  /** Audit log: sync table ARN. */
  auditSyncTableArn: string;
  /** Audit log: recovery table name. */
  auditRecoveryTableName: string;
  /** Audit log: recovery table ARN. */
  auditRecoveryTableArn: string;
  /** Audit log: user management table name. */
  auditUserManagementTableName: string;
  /** Audit log: user management table ARN. */
  auditUserManagementTableArn: string;
  /** Email sender Lambda ARN in deployer account (for cross-account email notifications) */
  emailSenderLambdaArn?: string;
  /** Cognito User Pool ID for resolving user email in schedule runner */
  cognitoUserPoolId?: string;
  /** Cognito User Pool ARN for IAM policy */
  cognitoUserPoolArn?: string;
  /** Recovery bucket name for DR stats endpoint. */
  recoveryBucketName?: string;
  /** Recovery bucket ARN for DR stats endpoint IAM policy. */
  recoveryBucketArn?: string;
  /** Pipedream relay lambda ARN — used by agent-schedules to deploy/update/delete
   *  Pipedream-trigger schedules. Optional because the relay is only created
   *  when PIPEDREAM_INTEGRATIONS is enabled. */
  pipedreamRelayLambdaArn?: string;
  /** Numa Ops entitlement flag (client's `numaOps` feature flag). Forwarded to
   *  numa-cli-api as `NUMA_OPS_ENABLED` so it can hard-gate `ops_*` tool calls
   *  server-side — same source + env the workspace agent container receives. */
  numaOpsEnabled?: boolean;
  /** Integrations approval table name — used by numa-cli-api's Phase 2
   *  centralised approval orchestrator (DDB create + poll). */
  integrationsApprovalTableName?: string;
  /** Integrations approval table ARN — IAM grant for DDB read/write. */
  integrationsApprovalTableArn?: string;
  /** Connector-usage table name (FEAT-129) — admin-connector-access reads it to
   *  hydrate each row's `lastUsedAt`. Written by workspace-chat-tools. */
  connectorUsageTableName?: string;
  /** Connector-usage table ARN — IAM GetItem/Query grant for admin-connector-access. */
  connectorUsageTableArn?: string;
}
