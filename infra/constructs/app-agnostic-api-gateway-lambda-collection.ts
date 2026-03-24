import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { SchedulerScheduleGroup } from '@cdktf/provider-aws/lib/scheduler-schedule-group';
import { ServerlessapplicationrepositoryCloudformationStack } from '@cdktf/provider-aws/lib/serverlessapplicationrepository-cloudformation-stack';
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
      ephemeralStorageMb: 512,
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
          ],
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

    // Admin Integration Settings API (GET list, PUT single)
    const adminIntegrationEnv = {
      CLIENT_NAME: props.clientName,
      GLOBAL_TABLE_NAME: `${props.clientName}-global-integration-settings`,
    } as Record<string, string>;
    const adminIntegrationPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.clientName}-global-integration-settings`],
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

    this.addLambdaFunction(this, 'admin-data-connector-settings-get', {
      addAuthorizer: true,
      lambdaDirectory: 'node/admin-data-connector-settings',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: adminDataConnectorEnv,
      additionalPolicyStatements: adminDataConnectorPolicy,
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

    // Admin MFA Settings API (GET/PUT device remember duration)
    const adminMfaEnv = {
      CLIENT_NAME: props.clientName,
      MFA_SETTINGS_TABLE_NAME: props.mfaSettingsTableName,
    } as Record<string, string>;
    const adminMfaPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
      },
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
    } as Record<string, string>;

    const dataConnectorsPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
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

    // Gmail Watch Manager (renews Gmail push notification watches every 6 days)
    const gmailWatchManagerEnv = {
      CLIENT_NAME: props.clientName,
      DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
      PUBSUB_TOPIC: `projects/numa-${props.clientName}/topics/numa-connector-events`,
    } as Record<string, string>;

    const gmailWatchManagerPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
      },
      {
        effect: 'Allow',
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      },
    ];

    this.addLambdaFunction(this, 'gmail-watch-manager', {
      addAuthorizer: false,
      lambdaDirectory: 'node/gmail-watch-manager',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: gmailWatchManagerEnv,
      additionalPolicyStatements: gmailWatchManagerPolicy,
    });

    // Google Cloud Setup (admin-only, automates GCP project provisioning)
    const googleCloudSetupEnv = {
      CLIENT_NAME: props.clientName,
      DATA_CONNECTORS_TABLE_NAME: props.dataConnectorsTableName,
      WEBHOOK_URL: `https://${props.domainName}/api/webhooks/connector-events/${props.cloudfrontSharedSecret}`,
    } as Record<string, string>;

    const googleCloudSetupPolicy = [
      {
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [`arn:aws:dynamodb:*:*:table/${props.dataConnectorsTableName}`],
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
    ];

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

    this.addLambdaFunction(this, 'google-cloud-setup-status', {
      addAuthorizer: true,
      lambdaDirectory: 'node/google-cloud-setup',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: googleCloudSetupEnv,
      additionalPolicyStatements: googleCloudSetupPolicy,
      route: { verb: 'GET', path: 'admin/google-cloud/status' },
    });

    // Agents API (list/create/update/delete/copy)
    const agentsEnv = {
      CLIENT_NAME: props.clientName,
      REGION: props.region,
      WORKSPACE_AGENTS_TABLE: props.workspaceAgentsTableName,
      USER_AGENTS_TABLE: props.userAgentsTableName,
      OUTPUTS_BUCKET_NAME: props.outputsBucketName,
      AGENTS_SETTINGS_TABLE_NAME: props.agentsSettingsTableName,
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

    // User Files API — per-user virtual file system with scoped access (behind NUMA_FILES flag)
    if (props.filesTableName && props.filesTableArn) {
      this.addLambdaFunction(this, 'user-files', {
        addAuthorizer: true,
        lambdaDirectory: 'node/user-files',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: {
          CLIENT_NAME: props.clientName,
          REGION: props.region,
          FILES_TABLE_NAME: props.filesTableName,
          DATA_BUCKET_NAME: props.dataBucketName,
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: [
              'dynamodb:Query',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
            ],
            resources: [props.filesTableArn],
          },
          {
            effect: 'Allow',
            actions: ['s3:PutObject', 's3:DeleteObject'],
            resources: [`${props.dataBucketArn}/files/*`],
          },
          {
            effect: 'Allow',
            actions: ['s3:GetObject'],
            resources: [`${props.dataBucketArn}/*`],
          },
          {
            effect: 'Allow',
            actions: ['s3:ListBucket'],
            resources: [props.dataBucketArn],
          },
        ],
        route: [
          { verb: 'ANY', path: 'files' },
          { verb: 'ANY', path: 'files/{proxy+}' },
        ],
      });
    }

    // Runner Lambda handles EventBridge + manual executions
    this.agentScheduleRunnerLambda = this.addLambdaFunction(this, 'agent-schedule-runner', {
      addAuthorizer: true,
      lambdaDirectory: 'node/agent-schedule-runner',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
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
      },
      additionalPolicyStatements: [
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
      ],
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
    } as Record<string, string>;

    const agentSchedulesPolicy = [
      {
        effect: 'Allow',
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

    // Application Scheduler - handles scheduled application runs
    this.addLambdaFunction(this, 'application-scheduler', {
      addAuthorizer: false, // Invoked by EventBridge Scheduler only
      lambdaDirectory: 'node/application-scheduler',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
        SCHEDULE_RUNNER_SECRET: props.agentScheduleRunnerSecret || 'placeholder',
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['states:StartExecution', 'states:DescribeExecution'],
          resources: ['*'], // Step Function ARNs vary by app
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`arn:aws:s3:::${props.outputsBucketName}/*`],
        },
      ],
    });

    // Data Sync Scheduler - handles scheduled data synchronization
    this.addLambdaFunction(this, 'data-sync-scheduler', {
      addAuthorizer: false, // Invoked by EventBridge Scheduler only
      lambdaDirectory: 'node/data-sync-scheduler',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      environment: {
        CLIENT_NAME: props.clientName,
        REGION: props.region,
        AGENT_SCHEDULES_TABLE_NAME: props.agentSchedulesTableName,
        SCHEDULE_RUNNER_SECRET: props.agentScheduleRunnerSecret || 'placeholder',
        DATA_BUCKET_NAME: props.dataBucketName,
        BEDROCK_KB_ID: props.bedrockKbId || '',
        BEDROCK_DATA_SOURCE_ID: props.bedrockDataSourceId || '',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}`,
            `arn:aws:dynamodb:*:*:table/${props.agentSchedulesTableName}/index/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['bedrock:StartIngestionJob', 'bedrock:GetIngestionJob', 'bedrock:ListIngestionJobs'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:CopyObject'],
          resources: [`arn:aws:s3:::${props.dataBucketName}`, `arn:aws:s3:::${props.dataBucketName}/*`],
        },
      ],
    });

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
  workspaceAgentsTableName: string;
  userAgentsTableName: string;
  /** Exact agents settings table name, passed from Core to avoid name drift. */
  agentsSettingsTableName: string;
  /** MFA settings table name for device remember duration. */
  mfaSettingsTableName: string;
  /** User chat settings table name for per-user defaults (tools, KBs, integrations). */
  chatSettingsTableName: string;
  /** Data connectors table name for per-user connector configs. */
  dataConnectorsTableName: string;
  /** Data connector settings table name for admin feature flags. */
  dataConnectorsSettingsTableName: string;
  /** Capabilities table name for admin feature flag overrides. */
  capabilitiesTableName: string;
  /** Data connector selection configs table name. */
  dataConnectorsSyncConfigsTableName: string;
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
  /** Files table name for per-user virtual file system. */
  filesTableName?: string;
  /** Files table ARN for IAM policy. */
  filesTableArn?: string;
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
}
