import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';
import { OTelConfig } from './numa-lambda';

// ─── Ops Construct ──────────────────────────────────────────────────────────────
// Creates all Numa Ops infrastructure: 3 DynamoDB tables, 4 Lambdas (3 API + 1
// seed), and the deploy-time seed invocation. Gated behind the `numaOps` feature
// flag in the client stack.

export interface OpsConstructProps extends ApiGatewayLambdaCollectionProps {
  environmentName: string;
  region: string;
  outputsBucketArn: string;
  outputsBucketName: string;
  otelConfig?: OTelConfig;
  userPoolId?: string;
  userPoolArn?: string;
  /** Chat-settings table name — used to enrich staff profiles with user profile data (name, jobTitle, avatar). */
  chatSettingsTableName?: string;
  /** Chat-settings table ARN — used to grant read access for staff profile enrichment. */
  chatSettingsTableArn?: string;
}

export class OpsConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  public readonly opsTable: DynamodbTable;
  public readonly opsConfigTable: DynamodbTable;
  public readonly opsCrmTable: DynamodbTable;

  constructor(scope: Construct, name: string, props: OpsConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;

    this.logGroup = new NumaLogGroup(this, 'ops-log-group', {
      logGroupName: `${clientName}-ops`,
    }).logGroup;

    // ── DynamoDB Tables ───────────────────────────────────────────────────────

    // Core operations table (tickets, boards, zones, stages, work units,
    // comments, links, audit log, prefix registry)
    this.opsTable = new DynamodbTable(this, 'ops-table', {
      name: `${clientName}-ops`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'PK',
      rangeKey: 'SK',
      attribute: [
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
        { name: 'GSI1PK', type: 'S' },
        { name: 'GSI1SK', type: 'S' },
        { name: 'GSI2PK', type: 'S' },
        { name: 'GSI2SK', type: 'S' },
        { name: 'GSI3PK', type: 'S' },
        { name: 'GSI3SK', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'GSI1',
          hashKey: 'GSI1PK',
          rangeKey: 'GSI1SK',
          projectionType: 'ALL',
        },
        {
          name: 'GSI2',
          hashKey: 'GSI2PK',
          rangeKey: 'GSI2SK',
          projectionType: 'ALL',
        },
        {
          name: 'GSI3',
          hashKey: 'GSI3PK',
          rangeKey: 'GSI3SK',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-ops`,
        Environment: props.environmentName,
        Purpose: 'numa-ops-core',
      },
    });

    // Configuration table (ticket types, statuses, fields, staff, projects,
    // CRM config, supplier config, link config)
    this.opsConfigTable = new DynamodbTable(this, 'ops-config-table', {
      name: `${clientName}-ops-config`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'PK',
      rangeKey: 'SK',
      attribute: [
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-ops-config`,
        Environment: props.environmentName,
        Purpose: 'numa-ops-config',
      },
    });

    // CRM table (customers, suppliers, activities, documents)
    this.opsCrmTable = new DynamodbTable(this, 'ops-crm-table', {
      name: `${clientName}-ops-crm`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'PK',
      rangeKey: 'SK',
      attribute: [
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
        { name: 'GSI1PK', type: 'S' },
        { name: 'GSI1SK', type: 'S' },
        { name: 'GSI2PK', type: 'S' },
        { name: 'GSI2SK', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'GSI1',
          hashKey: 'GSI1PK',
          rangeKey: 'GSI1SK',
          projectionType: 'ALL',
        },
        {
          name: 'GSI2',
          hashKey: 'GSI2PK',
          rangeKey: 'GSI2SK',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${clientName}-ops-crm`,
        Environment: props.environmentName,
        Purpose: 'numa-ops-crm',
      },
    });

    // ── API Lambdas ─────────────────────────────────────────────────────────

    // Shared DynamoDB policy actions
    const dynamoFullActions = [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:BatchGetItem',
    ];

    // 1. Config API — manages ticket types, statuses, fields, staff, projects,
    //    CRM/supplier settings, and Cognito staff sync
    this.addLambdaFunction(this, 'ops-config-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/numa-ops-config-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      environment: {
        CLIENT_NAME: clientName,
        OPS_CONFIG_TABLE: this.opsConfigTable.name,
        USER_POOL_ID: props.userPoolId ?? '',
        CHAT_SETTINGS_TABLE: props.chatSettingsTableName ?? '',
        OTEL_METRICS_EXPORTER: 'none',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: dynamoFullActions,
          resources: [this.opsConfigTable.arn],
        },
        // Cognito ListUsers permission for staff sync
        ...(props.userPoolArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['cognito-idp:ListUsers'],
                resources: [props.userPoolArn],
              },
            ]
          : []),
        // Read-only access to chat-settings table for staff profile enrichment
        ...(props.chatSettingsTableArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['dynamodb:BatchGetItem', 'dynamodb:GetItem'],
                resources: [props.chatSettingsTableArn],
              },
            ]
          : []),
        // S3 read for generating presigned avatar URLs (profile images)
        {
          effect: 'Allow' as const,
          actions: ['s3:GetObject'],
          resources: [`${props.outputsBucketArn}/numa-chat/profile-images/*`],
        },
      ],
      route: [
        { verb: 'ANY', path: 'ops/config' },
        { verb: 'ANY', path: 'ops/config/{proxy+}' },
      ],
    });

    // 2. CRM API — manages customers, suppliers, activities, documents
    this.addLambdaFunction(this, 'ops-crm-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/numa-ops-crm-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      environment: {
        CLIENT_NAME: clientName,
        OPS_CRM_TABLE: this.opsCrmTable.name,
        OPS_TABLE: this.opsTable.name,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        REGION: props.region,
        OTEL_METRICS_EXPORTER: 'none',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: dynamoFullActions,
          resources: [this.opsCrmTable.arn, `${this.opsCrmTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [`${this.opsTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`${props.outputsBucketArn}/ops/*`],
        },
      ],
      route: [
        { verb: 'ANY', path: 'ops/customers' },
        { verb: 'ANY', path: 'ops/customers/{proxy+}' },
        { verb: 'ANY', path: 'ops/suppliers' },
        { verb: 'ANY', path: 'ops/suppliers/{proxy+}' },
      ],
    });

    // 3. Core Ops API — tickets, boards, work centres, zones, stages, work
    //    units, comments, links, metrics, uploads, user preferences
    this.addLambdaFunction(this, 'ops-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/numa-ops-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      environment: {
        CLIENT_NAME: clientName,
        OPS_TABLE: this.opsTable.name,
        OPS_CONFIG_TABLE: this.opsConfigTable.name,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        REGION: props.region,
        OTEL_METRICS_EXPORTER: 'none',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: dynamoFullActions,
          resources: [this.opsTable.arn, `${this.opsTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:GetItem'],
          resources: [this.opsConfigTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`${props.outputsBucketArn}/ops/*`],
        },
      ],
      route: [
        { verb: 'ANY', path: 'ops' },
        { verb: 'ANY', path: 'ops/{proxy+}' },
      ],
    });

    // ── Seed Lambda (deploy-time invocation) ────────────────────────────────
    // Idempotent seeder that populates default config (ticket types, statuses,
    // fields, CRM/supplier config, prefix registry, link config, industries).

    const seedLambdaDir = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'seed-ops-config');
    const seedZipPath = path.resolve(seedLambdaDir, 'lambda_function.zip');

    const seedRole = new IamRole(this, 'seed-ops-config-role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const seedBasicPolicyAttachment = new IamRolePolicyAttachment(this, 'seed-ops-config-basic-policy', {
      role: seedRole.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const seedDynamoPolicy = new IamPolicy(this, 'seed-ops-config-dynamo-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'seed-ops-config-dynamo-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
            resources: [this.opsConfigTable.arn, this.opsTable.arn],
          },
        ],
      }).json,
    });

    const seedDynamoPolicyAttachment = new IamRolePolicyAttachment(this, 'seed-ops-config-dynamo-policy-attachment', {
      role: seedRole.name,
      policyArn: seedDynamoPolicy.arn,
    });

    const seedLambda = new LambdaFunction(this, 'seed-ops-config-lambda', {
      functionName: `${clientName}-seed-ops-config`,
      role: seedRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: seedZipPath,
      sourceCodeHash: Fn.filebase64sha256(seedZipPath),
      timeout: 120,
      environment: {
        variables: {
          OPS_CONFIG_TABLE: this.opsConfigTable.name,
          OPS_TABLE: this.opsTable.name,
        },
      },
    });

    new LambdaInvocation(this, 'seed-ops-config-invocation', {
      functionName: seedLambda.functionName,
      input: JSON.stringify({ action: 'seed' }),
      triggers: {
        configTableName: this.opsConfigTable.name,
        opsTableName: this.opsTable.name,
        seedSourceHash: seedLambda.sourceCodeHash,
      },
      dependsOn: [
        this.opsConfigTable,
        this.opsTable,
        seedLambda,
        seedBasicPolicyAttachment,
        seedDynamoPolicyAttachment,
      ],
    });
  }
}
