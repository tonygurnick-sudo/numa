import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { SchedulerScheduleGroup } from '@cdktf/provider-aws/lib/scheduler-schedule-group';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { awsNameWithHashedPrefix } from './aws-name-utils';
import { NumaLogGroup } from './numa-log-group';

// ─── Ops Construct ──────────────────────────────────────────────────────────────
// Creates all Numa Ops infrastructure: 3 DynamoDB tables, 4 Lambdas (3 API + 1
// seed), and the deploy-time seed invocation. Gated behind the `numaOps` feature
// flag in the client stack.

export interface OpsConstructProps extends ApiGatewayLambdaCollectionProps {
  environmentName: string;
  region: string;
  outputsBucketArn: string;
  outputsBucketName: string;
  userPoolId?: string;
  userPoolArn?: string;
  /** Chat-settings table name — used to enrich staff profiles with user profile data (name, jobTitle, avatar). */
  chatSettingsTableName?: string;
  /** Chat-settings table ARN — used to grant read access for staff profile enrichment. */
  chatSettingsTableArn?: string;
  /** ARN for the centralized email sender lambda. */
  emailSenderLambdaArn?: string;
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
        OPS_TABLE: this.opsTable.name,
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
        // Read-only access to ops table for team access checks (project filtering)
        {
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [`${this.opsTable.arn}/index/*`],
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
          // Read GSI2 to find linked tickets, plus update/delete on the base
          // table so customer-delete can unlink each ticket (clear customerId
          // on the main item and delete its IDX_CUSTOMER sibling).
          effect: 'Allow',
          actions: ['dynamodb:Query', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
          resources: [this.opsTable.arn, `${this.opsTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:GetObject'],
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

    // ── Recurrence wiring (FEAT-141) ──────────────────────────────────────────
    // Per-recurrence EventBridge Schedule entries fire the runner Lambda,
    // which spawns a fresh ticket from the template via direct invocation
    // of the ops-api Lambda. Predictable function names avoid a circular
    // env-var dependency between ops-api and the runner.

    const opsApiFunctionName = awsNameWithHashedPrefix(clientName, '_ops-api', 64);
    const runnerFunctionName = `${clientName}-ops-recurrence-runner`;
    const schedulerRoleName = `${clientName}-ops-recurrence-scheduler`;

    const opsRecurrenceScheduleGroup = new SchedulerScheduleGroup(this, 'ops-recurrence-schedule-group', {
      name: `${clientName}-ops-recurrences`,
    });

    // Runner Lambda IAM role — DDB R/W on opsTable, invoke ops-api by predictable
    // function name, delete its own EB schedule on termination.
    const runnerRole = new IamRole(this, 'ops-recurrence-runner-role', {
      name: runnerFunctionName,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
    });
    new IamRolePolicyAttachment(this, 'ops-recurrence-runner-basic-policy', {
      role: runnerRole.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });
    const runnerPolicy = new IamPolicy(this, 'ops-recurrence-runner-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'ops-recurrence-runner-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: dynamoFullActions,
            resources: [this.opsTable.arn, `${this.opsTable.arn}/index/*`],
          },
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [`arn:aws:lambda:${props.region}:*:function:${opsApiFunctionName}`],
          },
          {
            effect: 'Allow',
            actions: ['scheduler:DeleteSchedule'],
            resources: [`arn:aws:scheduler:${props.region}:*:schedule/${opsRecurrenceScheduleGroup.name}/*`],
          },
        ],
      }).json,
    });
    new IamRolePolicyAttachment(this, 'ops-recurrence-runner-policy-attachment', {
      role: runnerRole.name,
      policyArn: runnerPolicy.arn,
    });

    const runnerLambdaDir = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'numa-ops-recurrence-runner'
    );
    const runnerZipPath = path.resolve(runnerLambdaDir, 'lambda_function.zip');
    const recurrenceRunnerLambda = new LambdaFunction(this, 'ops-recurrence-runner-lambda', {
      functionName: runnerFunctionName,
      role: runnerRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: runnerZipPath,
      sourceCodeHash: Fn.filebase64sha256(runnerZipPath),
      timeout: 60,
      memorySize: 512,
      environment: {
        variables: {
          OPS_TABLE: this.opsTable.name,
          // Ops-api is built below via addLambdaFunction with the same
          // predictable name; Lambda's InvokeCommand accepts either the
          // unqualified name or a full ARN.
          OPS_API_LAMBDA_ARN: opsApiFunctionName,
          OPS_RECURRENCE_SCHEDULER_GROUP: opsRecurrenceScheduleGroup.name,
        },
      },
    });

    // Scheduler service role — assumed by scheduler.amazonaws.com to invoke
    // the runner Lambda on each fire. Standard agent-schedules pattern.
    const schedulerRole = new IamRole(this, 'ops-recurrence-scheduler-role', {
      name: schedulerRoleName,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'ops-recurrence-scheduler-assume-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ identifiers: ['scheduler.amazonaws.com'], type: 'Service' }],
          },
        ],
      }).json,
    });
    new IamRolePolicy(this, 'ops-recurrence-scheduler-role-policy', {
      name: schedulerRoleName,
      role: schedulerRole.name,
      policy: new DataAwsIamPolicyDocument(this, 'ops-recurrence-scheduler-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [recurrenceRunnerLambda.arn],
          },
        ],
      }).json,
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
        OPS_CRM_TABLE: this.opsCrmTable.name,
        OUTPUTS_BUCKET_NAME: props.outputsBucketName,
        REGION: props.region,
        OTEL_METRICS_EXPORTER: 'none',
        EMAIL_SENDER_LAMBDA_ARN: props.emailSenderLambdaArn ?? '',
        OPS_RECURRENCE_SCHEDULER_GROUP: opsRecurrenceScheduleGroup.name,
        OPS_RECURRENCE_RUNNER_ARN: recurrenceRunnerLambda.arn,
        OPS_RECURRENCE_SCHEDULER_ROLE_ARN: schedulerRole.arn,
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
        // Atomic openTicketCount maintenance on customer/supplier META items
        // when ticket.customerId / ticket.supplierId changes.
        {
          effect: 'Allow',
          actions: ['dynamodb:UpdateItem'],
          resources: [this.opsCrmTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:GetObject'],
          resources: [`${props.outputsBucketArn}/ops/*`],
        },
        ...(props.emailSenderLambdaArn
          ? [
              {
                effect: 'Allow' as const,
                actions: ['lambda:InvokeFunction'],
                resources: [props.emailSenderLambdaArn],
              },
            ]
          : []),
        // Recurrence: CRUD EventBridge Schedules in our dedicated group, and
        // PassRole the scheduler service role so Scheduler can in turn invoke
        // the runner Lambda.
        {
          effect: 'Allow',
          actions: [
            'scheduler:CreateSchedule',
            'scheduler:UpdateSchedule',
            'scheduler:DeleteSchedule',
            'scheduler:GetSchedule',
          ],
          resources: [`arn:aws:scheduler:${props.region}:*:schedule/${opsRecurrenceScheduleGroup.name}/*`],
        },
        {
          effect: 'Allow',
          actions: ['iam:PassRole'],
          resources: [schedulerRole.arn],
          condition: [
            {
              test: 'StringEquals',
              variable: 'iam:PassedToService',
              values: ['scheduler.amazonaws.com'],
            },
          ],
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
