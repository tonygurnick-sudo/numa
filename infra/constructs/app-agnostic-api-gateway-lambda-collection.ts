import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

export class AppAgnosticApiGatewayLambdaCollection extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;
  readonly clientName: string;
  // Expose shared extract-content Lambda for reuse by Step Functions
  public readonly extractContentLambda: import('@cdktf/provider-aws/lib/lambda-function').LambdaFunction;
  public readonly agentsLambda: import('@cdktf/provider-aws/lib/lambda-function').LambdaFunction;

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
      route: {
        verb: 'POST',
        path: 'start-web-crawler',
      },
      environment: {
        LOG_LEVEL: 'INFO',
        ALLOWED_ORIGIN: '*',
        CLIENT_NAME: props.clientName,
        WEB_CRAWLER_STATE_MACHINE_ARN: props.webCrawlerStateMachineArn,
      },
      timeout: 30,
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['states:StartExecution'],
          resources: [props.webCrawlerStateMachineArn],
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
      },
      timeout: 900,
      memorySize: 1024,
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
      ],
    });

    // Branding configuration API (feature-flagged)
    if (props.brandingProviderEnabled && props.brandingTableName) {
      const brandingEnv = {
        CLIENT_NAME: props.clientName,
        BRANDING_TABLE_NAME: props.brandingTableName,
        BRANDING_PROVIDER_ENABLED: String(props.brandingProviderEnabled ?? false),
        ...(props.brandingAssetsPrefix ? { BRANDING_ASSETS_PREFIX: props.brandingAssetsPrefix } : {}),
      } as Record<string, string>;

      const brandingReadPolicy = [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.brandingTableName}`],
        },
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
  }
}

export interface AppAgnosticApiGatewayLambdaCollectionProps
  extends Omit<ApiGatewayLambdaCollectionProps, 'apiGatewayId' | 'apiGatewayAuthorizerId'> {
  chatHistoryTableName: string;
  clientName: string;
  dataBucketName: string;
  logGroup: CloudwatchLogGroup;
  region: string;
  userPoolClientId: string;
  userPoolClientSecret: string;
  apiGatewayId: string;
  apiGatewayAuthorizerId: string;
  webCrawlerStateMachineArn: string;
  visionModelType: string;
  // Branding API settings
  brandingProviderEnabled?: boolean;
  brandingTableName?: string;
  brandingAssetsPrefix?: string;
  /** Exact outputs bucket ARN for this environment (handles -dev/-staging suffix). */
  outputsBucketArn: string;
  /** Outputs bucket name for constructing S3 keys. */
  outputsBucketName: string;
  workspaceAgentsTableName: string;
  userAgentsTableName: string;
  /** Exact agents settings table name, passed from Core to avoid name drift. */
  agentsSettingsTableName: string;
}
