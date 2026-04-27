import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Construct } from 'constructs';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

// ─── V2 Apps Construct ──────────────────────────────────────────────────────────
// Creates infrastructure for V2 apps: a DynamoDB table for tracking runs and a
// Node Lambda that provides CRUD + execution APIs. V2 apps run on the workspace
// agent (AgentCore) instead of Step Functions.

export interface V2AppsConstructProps extends ApiGatewayLambdaCollectionProps {
  environmentName: string;
  region: string;
  outputsBucketArn: string;
  outputsBucketName: string;
  /** ARN of the workspace-chat-agent-proxy Lambda to invoke for app runs. */
  workspaceProxyFunctionArn: string;
  /** Name of the workspace-chat-agent-proxy Lambda to invoke for app runs. */
  workspaceProxyFunctionName: string;
}

export class V2AppsConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  public readonly runsTable: DynamodbTable;
  public readonly settingsTable: DynamodbTable;

  constructor(scope: Construct, name: string, props: V2AppsConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;

    this.logGroup = new NumaLogGroup(this, 'v2-apps-log-group', {
      logGroupName: `${clientName}-v2-apps`,
    }).logGroup;

    // ── DynamoDB: V2 App Runs ─────────────────────────────────────────────────
    this.runsTable = new DynamodbTable(this, 'v2-app-runs-table', {
      name: `${clientName}-v2-app-runs`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'runId',
      attribute: [
        { name: 'runId', type: 'S' },
        { name: 'userId', type: 'S' },
        { name: 'appId', type: 'S' },
        { name: 'createdAt', type: 'S' },
        { name: 'sharedScope', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'userId-createdAt-index',
          hashKey: 'userId',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
        {
          name: 'appId-createdAt-index',
          hashKey: 'appId',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
        // Sparse index — only runs that set `sharedScope` are present here. Backs the
        // cross-user list endpoint (GET /v2-apps/runs?sharedScope=X). Opt-in per app
        // via SCOPE_SHARED_APPS in v2-apps-api; non-opted-in apps don't write the
        // attribute and so don't appear in this index.
        {
          name: 'sharedScope-createdAt-index',
          hashKey: 'sharedScope',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-v2-app-runs`,
        Environment: props.environmentName,
        Purpose: 'v2-apps-run-tracking',
      },
    });

    // ── DynamoDB: V2 App Settings ────────────────────────────────────────────
    this.settingsTable = new DynamodbTable(this, 'v2-app-settings-table', {
      name: `${clientName}-v2-app-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'appId',
      rangeKey: 'userId',
      attribute: [
        { name: 'appId', type: 'S' },
        { name: 'userId', type: 'S' },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-v2-app-settings`,
        Environment: props.environmentName,
        Purpose: 'v2-apps-workspace-settings',
      },
    });

    // ── V2 Apps API Lambda ────────────────────────────────────────────────────
    const dynamoFullActions = [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    ];

    this.addLambdaFunction(this, 'v2-apps-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/v2-apps-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      timeout: 120,
      systemLogLevel: 'WARN',
      environment: {
        V2_APP_RUNS_TABLE: this.runsTable.name,
        V2_APP_SETTINGS_TABLE: this.settingsTable.name,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        WORKSPACE_PROXY_FUNCTION_NAME: props.workspaceProxyFunctionName,
        REGION: props.region,
      },
      additionalPolicyStatements: [
        // DynamoDB: full access to runs table + GSIs
        {
          effect: 'Allow',
          actions: dynamoFullActions,
          resources: [this.runsTable.arn, `${this.runsTable.arn}/index/*`],
        },
        // DynamoDB: read/write access to settings table
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          resources: [this.settingsTable.arn],
        },
        // S3: object-level access for result checking and file management
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.outputsBucketArn}/v2-apps/*`],
        },
        // S3: bucket-level listing for file management
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [props.outputsBucketArn],
        },
        // Lambda: invoke the workspace proxy to start runs
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [props.workspaceProxyFunctionArn],
        },
      ],
      route: [
        { verb: 'ANY', path: 'v2-apps/runs' },
        { verb: 'ANY', path: 'v2-apps/runs/{proxy+}' },
        { verb: 'ANY', path: 'v2-apps/files' },
        { verb: 'ANY', path: 'v2-apps/files/{proxy+}' },
        { verb: 'ANY', path: 'v2-apps/settings' },
      ],
    });
  }
}
