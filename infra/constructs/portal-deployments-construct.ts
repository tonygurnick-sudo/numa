import { Construct } from 'constructs';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { EcsCluster } from '@cdktf/provider-aws/lib/ecs-cluster';
import { EcsTaskDefinition } from '@cdktf/provider-aws/lib/ecs-task-definition';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';
import { SecurityGroupRule } from '@cdktf/provider-aws/lib/security-group-rule';
import { DataAwsVpc } from '@cdktf/provider-aws/lib/data-aws-vpc';
import { DataAwsSubnets } from '@cdktf/provider-aws/lib/data-aws-subnets';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { Fn } from 'cdktf';
import type { StateMachine } from 'asl-types';
import path from 'node:path';

export interface PortalDeploymentsConstructProps {
  /** Optional ECR image URI to use as a default (RegisterTaskDefinition will set the tag dynamically). */
  defaultImageUri?: string;
  /** CPU units for the task (e.g., '1024'). */
  cpu?: string;
  /** Memory for the task (e.g., '2048'). */
  memory?: string;
  /** Deployer account ID to form backend role ARN (admin-delegated-access). */
  arcanumNumaAccount: string;
  /** Optional explicit backend role ARN (preferred when backend is in a different account). */
  backendRoleArn?: string;
}

/**
 * Creates resources to orchestrate client deployments from the portal:
 * - DynamoDB table for deployment history (with clientName-index)
 * - ECS cluster, task roles, and base task definition
 * - Step Functions state machine that registers a task def revision, runs task, polls status, and records results
 */
export class PortalDeploymentsConstruct extends Construct {
  readonly table: DynamodbTable;
  readonly imageMetadataTable: DynamodbTable;
  readonly groupsTable: DynamodbTable;
  readonly cluster: EcsCluster;
  readonly taskExecRole: IamRole;
  readonly taskRole: IamRole;
  readonly taskDefinition: EcsTaskDefinition;
  readonly logGroup: CloudwatchLogGroup;
  readonly stateMachine: SfnStateMachine;
  readonly sfnRole: IamRole;
  readonly sfnLogGroup: CloudwatchLogGroup;
  readonly groupStateMachine: SfnStateMachine;
  readonly groupSfnRole: IamRole;
  readonly groupSfnLogGroup: CloudwatchLogGroup;
  readonly groupDefaultConcurrency: number;
  readonly groupMaxConcurrency: number;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly securityGroupId: string;
  readonly assumeRoleLambdaArn: string;

  constructor(scope: Construct, name: string, props: PortalDeploymentsConstructProps) {
    super(scope, name);

    const region = new DataAwsRegion(this, 'region', {}).region;
    const defaultGroupConcurrency = 10;
    const maxGroupConcurrency = 30;
    this.groupDefaultConcurrency = defaultGroupConcurrency;
    this.groupMaxConcurrency = maxGroupConcurrency;
    const backendRoleArn =
      props.backendRoleArn ?? `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    // Lambda to assume backend role and return credentials
    const assumePath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'portal-deploy-assume-role');
    const assumeZip = path.resolve(assumePath, 'lambda_function.zip');
    const assumeRoleLambdaRole = new IamRole(this, 'assume-backend-role-lambda-role', {
      name: 'portal-deploy-assume-backend-role',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'assume-backend-role-lambda-trust', {
        statement: [
          { actions: ['sts:AssumeRole'], principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }] },
        ],
      }).json,
    });
    new IamRolePolicy(this, 'assume-backend-role-lambda-policy', {
      role: assumeRoleLambdaRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'assume-backend-role-lambda-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            resources: [backendRoleArn],
          },
        ],
      }).json,
    });
    new IamRolePolicy(this, 'assume-backend-role-lambda-logs', {
      role: assumeRoleLambdaRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'assume-backend-role-lambda-logs-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: ['*'],
          },
        ],
      }).json,
    });
    const assumeLambda = new LambdaFunction(this, 'assume-backend-role-lambda', {
      functionName: 'portal-deploy-assume-backend',
      role: assumeRoleLambdaRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: assumeZip,
      sourceCodeHash: Fn.filebase64sha256(assumeZip),
      environment: { variables: { BACKEND_ROLE_ARN: backendRoleArn } },
      timeout: 30,
      memorySize: 128,
    });
    this.assumeRoleLambdaArn = assumeLambda.arn;

    // 1) Deployment history table
    this.table = new DynamodbTable(this, 'deployments-table', {
      name: 'numa-portal-deployments',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'deploymentId',
      attribute: [
        { name: 'deploymentId', type: 'S' },
        { name: 'clientName', type: 'S' },
        { name: 'startedAt', type: 'S' },
        { name: 'groupRunId', type: 'S' },
        { name: 'historyPk', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'clientName-index',
          hashKey: 'clientName',
          rangeKey: 'startedAt',
          projectionType: 'ALL',
        },
        {
          name: 'groupRunId-index',
          hashKey: 'groupRunId',
          rangeKey: 'deploymentId',
          projectionType: 'ALL',
        },
        {
          name: 'history-index',
          hashKey: 'historyPk',
          rangeKey: 'startedAt',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // 2) Image metadata table for custom names and descriptions
    this.imageMetadataTable = new DynamodbTable(this, 'image-metadata-table', {
      name: 'numa-portal-image-metadata',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'imageTag',
      rangeKey: 'digest',
      attribute: [
        { name: 'imageTag', type: 'S' },
        { name: 'digest', type: 'S' },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // 2b) Deployment group definitions (named sets of clients)
    this.groupsTable = new DynamodbTable(this, 'deploy-groups-table', {
      name: 'numa-portal-deploy-groups',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'groupName',
      attribute: [{ name: 'groupName', type: 'S' }],
      pointInTimeRecovery: { enabled: true },
    });

    // 3) ECS cluster & networking (default VPC + public subnets)
    const vpc = new DataAwsVpc(this, 'default-vpc', { default: true });
    this.vpcId = vpc.id;
    const subnets = new DataAwsSubnets(this, 'default-vpc-subnets', {
      filter: [{ name: 'vpc-id', values: [vpc.id] }],
    });
    // Select first two subnet IDs to avoid embedding list tokens in a string context
    const subnet0 = Fn.element(subnets.ids, 0);
    const subnet1 = Fn.element(subnets.ids, 1);
    this.subnetIds = [subnet0, subnet1];

    // Security group allowing all egress
    const sg = new SecurityGroup(this, 'ecs-tasks-sg', {
      name: 'numa-portal-deploy-ecs-sg',
      description: 'ECS tasks for portal deployments',
      vpcId: vpc.id,
    });
    new SecurityGroupRule(this, 'ecs-sg-egress-all', {
      type: 'egress',
      fromPort: 0,
      toPort: 0,
      protocol: '-1',
      cidrBlocks: ['0.0.0.0/0'],
      securityGroupId: sg.id,
    });
    this.securityGroupId = sg.id;

    this.cluster = new EcsCluster(this, 'ecs-cluster', {
      name: 'numa-portal-deployments',
    });

    // 4) Log group
    this.logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: '/ecs/numa-portal-deploy',
      retentionInDays: 30,
    });

    // 5) Roles
    this.taskExecRole = new IamRole(this, 'task-exec-role', {
      name: 'numa-portal-deploy-task-exec',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'task-exec-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['ecs-tasks.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    new IamRolePolicy(this, 'task-exec-policy', {
      name: 'numa-portal-deploy-task-exec-policy',
      role: this.taskExecRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'task-exec-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [this.logGroup.arn, `${this.logGroup.arn}:*`],
          },
          {
            effect: 'Allow',
            actions: [
              'ecr:GetAuthorizationToken',
              'ecr:BatchCheckLayerAvailability',
              'ecr:BatchGetImage',
              'ecr:GetDownloadUrlForLayer',
            ],
            resources: ['*'],
          },
        ],
      }).json,
    });

    this.taskRole = new IamRole(this, 'task-role', {
      name: 'numa-portal-deploy-task',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'task-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['ecs-tasks.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    // Allow assuming the same roles used by CDKTF in infra
    new IamRolePolicy(this, 'task-assume-policy', {
      name: 'numa-portal-deploy-task-assume',
      role: this.taskRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'task-assume-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            resources: [
              // Deployer admin role
              `arn:aws:iam::*:role/admin-delegated-access`,
              // Client access role (target account varies)
              'arn:aws:iam::*:role/ArcanumAIAccess',
            ],
          },
        ],
      }).json,
    });

    // Allow Terraform backend access (S3 state + DynamoDB lock)
    new IamRolePolicy(this, 'task-backend-access', {
      name: 'numa-portal-deploy-backend-access',
      role: this.taskRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'task-backend-access-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['s3:ListBucket'],
            resources: ['arn:aws:s3:::arcanum-terraform-state'],
          },
          {
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:PutObject'],
            resources: ['arn:aws:s3:::arcanum-terraform-state/*'],
          },
          {
            effect: 'Allow',
            actions: [
              'dynamodb:DescribeTable',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:DeleteItem',
              'dynamodb:UpdateItem',
            ],
            resources: ['arn:aws:dynamodb:ap-southeast-2:*:table/arcanum-terraform-lock'],
          },
        ],
      }).json,
    });

    // 6) Base task definition (RegisterTaskDefinition in the state machine will pin the image tag)
    const defaultImage =
      props.defaultImageUri || '826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/numa-deploy:latest';
    const cpu = props.cpu || '1024';
    const memory = props.memory || '2048';

    this.taskDefinition = new EcsTaskDefinition(this, 'task-def', {
      family: 'numa-portal-deploy',
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu,
      memory,
      executionRoleArn: this.taskExecRole.arn,
      taskRoleArn: this.taskRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name: 'deployer',
          image: defaultImage,
          essential: true,
          // Base task definition is a template; actual image/command overridden in SFN RegisterTaskDefinition
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              // Use static strings in containerDefinitions to avoid Terraform interpolation inside JSON
              'awslogs-group': '/ecs/numa-portal-deploy',
              'awslogs-region': 'us-east-1',
              'awslogs-stream-prefix': 'ecs',
            },
          },
          environment: [{ name: 'TF_ENVIRONMENT', value: 'prod' }],
        },
      ]),
      runtimePlatform: { operatingSystemFamily: 'LINUX' },
    });

    // 7) State machine IAM role & logging
    this.sfnLogGroup = new CloudwatchLogGroup(this, 'sfn-log-group', {
      name: '/numa/portal-deployments-sfn',
      retentionInDays: 30,
    });

    this.sfnRole = new IamRole(this, 'sfn-role', {
      name: 'numa-portal-deploy-sfn-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });

    new IamRolePolicy(this, 'sfn-policy', {
      name: 'numa-portal-deploy-sfn-policy',
      role: this.sfnRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'sfn-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['ecs:RegisterTaskDefinition', 'ecs:RunTask', 'ecs:DescribeTasks', 'ecs:StopTask'],
            resources: ['*'],
          },
          {
            effect: 'Allow',
            actions: ['iam:PassRole'],
            resources: [this.taskExecRole.arn, this.taskRole.arn],
          },
          {
            effect: 'Allow',
            actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
            resources: [this.table.arn],
          },
          {
            effect: 'Allow',
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [this.sfnLogGroup.arn, `${this.sfnLogGroup.arn}:*`],
          },
          {
            effect: 'Allow',
            actions: [
              'logs:CreateLogDelivery',
              'logs:GetLogDelivery',
              'logs:UpdateLogDelivery',
              'logs:DeleteLogDelivery',
              'logs:ListLogDeliveries',
              'logs:PutResourcePolicy',
              'logs:DescribeResourcePolicies',
              'logs:DescribeLogGroups',
            ],
            resources: ['*'],
          },
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [this.assumeRoleLambdaArn + ':$LATEST'],
          },
        ],
      }).json,
    });

    // 8) State machine definition (AWS SDK integration)
    const baseRepo = defaultImage.split(':')[0];
    const definition = {
      Comment: 'Run client deploy via ECS task and record status',
      StartAt: 'InitRetryCount',
      States: {
        InitRetryCount: {
          Type: 'Pass',
          Result: 0,
          ResultPath: '$.retryCount',
          Next: 'AcquireLock',
        },
        AcquireLock: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
          Parameters: {
            TableName: this.table.name,
            Item: {
              deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" },
              clientName: { 'S.$': '$.clientName' },
              startedAt: { 'S.$': '$$.State.EnteredTime' },
            },
            ConditionExpression: 'attribute_not_exists(deploymentId)',
          },
          ResultPath: null,
          Next: 'EnsureMode',
          Catch: [
            {
              ErrorEquals: ['DynamoDB.ConditionalCheckFailedException', 'DynamoDb.ConditionalCheckFailedException'],
              ResultPath: '$.error',
              Next: 'RecordLockFailure',
            },
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'RecordFailure',
            },
          ],
        },
        EnsureMode: {
          Type: 'Choice',
          Choices: [{ Variable: '$.mode', IsPresent: true, Next: 'RecordStart' }],
          Default: 'SetDefaultMode',
        },
        SetDefaultMode: {
          Type: 'Pass',
          Result: 'deploy',
          ResultPath: '$.mode',
          Next: 'RecordStart',
        },
        RecordLockFailure: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
          Parameters: {
            TableName: this.table.name,
            Item: {
              historyPk: { S: 'all' },
              deploymentId: { 'S.$': '$.deploymentId' },
              clientName: { 'S.$': '$.clientName' },
              imageTag: { 'S.$': '$.imageTag' },
              initiatedBy: { 'S.$': '$.initiatedBy' },
              sfnExecutionArn: { 'S.$': '$$.Execution.Id' },
              status: { S: 'failed' },
              message: { S: 'Another deployment is already in flight for this client' },
              startedAt: { 'S.$': '$.startedAt' },
              endedAt: { 'S.$': '$$.State.EnteredTime' },
              deploymentLabel: { 'S.$': '$.deploymentLabel' },
            },
          },
          ResultPath: null,
          Next: 'RecordLockContext?',
        },
        'RecordLockContext?': {
          Type: 'Choice',
          Choices: [{ Variable: '$.groupRunId', IsPresent: true, Next: 'AttachRecordLockContext' }],
          Default: 'RecordLockFailureEnd',
        },
        AttachRecordLockContext: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET groupRunId = :g, entityType = :type, groupName = :name',
            ExpressionAttributeValues: {
              ':g': { 'S.$': '$.groupRunId' },
              ':type': { S: 'deployment' },
              ':name': { 'S.$': '$.groupName' },
            },
          },
          ResultPath: null,
          Next: 'RecordLockFailureEnd',
        },
        RecordLockFailureEnd: {
          Type: 'Succeed',
        },
        RecordStart: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
          Parameters: {
            TableName: this.table.name,
            Item: {
              historyPk: { S: 'all' },
              deploymentId: { 'S.$': '$.deploymentId' },
              clientName: { 'S.$': '$.clientName' },
              imageTag: { 'S.$': '$.imageTag' },
              initiatedBy: { 'S.$': '$.initiatedBy' },
              sfnExecutionArn: { 'S.$': '$$.Execution.Id' },
              status: { S: 'running' },
              startedAt: { 'S.$': '$.startedAt' },
              attemptNumber: { N: '1' },
              attemptLabel: { S: '1/2' },
              mode: { 'S.$': '$.mode' },
              deploymentLabel: { 'S.$': '$.deploymentLabel' },
              entityType: { S: 'deployment' },
            },
          },
          // Preserve original input for subsequent states
          ResultPath: null,
          Next: 'SetGroupContext?',
        },
        'SetGroupContext?': {
          Type: 'Choice',
          Choices: [{ Variable: '$.groupRunId', IsPresent: true, Next: 'AttachGroupContext' }],
          Default: 'AssumeBackendRole',
        },
        AttachGroupContext: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET groupRunId = :g, entityType = :type, groupName = :name',
            ExpressionAttributeValues: {
              ':g': { 'S.$': '$.groupRunId' },
              ':type': { S: 'deployment' },
              ':name': { 'S.$': '$.groupName' },
            },
          },
          ResultPath: null,
          Next: 'AssumeBackendRole',
        },
        AssumeBackendRole: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: `${this.assumeRoleLambdaArn}:$LATEST`,
          },
          ResultPath: '$.BackendCreds',
          Next: 'UseExistingTaskDef?',
        },
        'UseExistingTaskDef?': {
          Type: 'Choice',
          Choices: [{ Variable: '$.taskDefinitionArn', IsPresent: true, Next: 'ModePlanOverride?' }],
          Default: 'AcquireTdRegisterLock',
        },
        'ModePlanOverride?': {
          Type: 'Choice',
          Choices: [{ Variable: '$.mode', StringEquals: 'plan', Next: 'RunTaskWithOverridesPlan' }],
          Default: 'RunTaskWithOverridesDeploy',
        },
        RunTaskWithOverridesDeploy: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:runTask',
          Parameters: {
            Cluster: this.cluster.arn,
            'TaskDefinition.$': '$.taskDefinitionArn',
            LaunchType: 'FARGATE',
            Overrides: {
              ContainerOverrides: [
                {
                  Name: 'deployer',
                  'Command.$':
                    "States.Array('workspace','@arcanumai/q-apps-deployer-infra','exec','cdktf','deploy','--auto-approve', States.Format('numa-{}', $.clientName))",
                  Environment: [
                    { Name: 'TF_ENVIRONMENT', Value: 'prod' },
                    { Name: 'CLIENT_OVERRIDE', 'Value.$': '$.clientName' },
                    { Name: 'TF_CLI_ARGS_apply', Value: '-parallelism=15' },
                    { Name: 'AWS_ACCESS_KEY_ID', 'Value.$': '$.BackendCreds.Payload.Credentials.AccessKeyId' },
                    { Name: 'AWS_SECRET_ACCESS_KEY', 'Value.$': '$.BackendCreds.Payload.Credentials.SecretAccessKey' },
                    { Name: 'AWS_SESSION_TOKEN', 'Value.$': '$.BackendCreds.Payload.Credentials.SessionToken' },
                  ],
                },
              ],
            },
            NetworkConfiguration: {
              AwsvpcConfiguration: {
                AssignPublicIp: 'ENABLED',
                Subnets: this.subnetIds,
                SecurityGroups: [this.securityGroupId],
              },
            },
          },
          ResultPath: '$.Run',
          Next: 'RecordRunTaskInfo',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseLockBeforeError',
            },
          ],
        },
        RunTaskWithOverridesPlan: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:runTask',
          Parameters: {
            Cluster: this.cluster.arn,
            'TaskDefinition.$': '$.taskDefinitionArn',
            LaunchType: 'FARGATE',
            Overrides: {
              ContainerOverrides: [
                {
                  Name: 'deployer',
                  'Command.$':
                    "States.Array('workspace','@arcanumai/q-apps-deployer-infra','exec','cdktf','diff', States.Format('numa-{}', $.clientName))",
                  Environment: [
                    { Name: 'TF_ENVIRONMENT', Value: 'prod' },
                    { Name: 'CLIENT_OVERRIDE', 'Value.$': '$.clientName' },
                    { Name: 'AWS_ACCESS_KEY_ID', 'Value.$': '$.BackendCreds.Payload.Credentials.AccessKeyId' },
                    { Name: 'AWS_SECRET_ACCESS_KEY', 'Value.$': '$.BackendCreds.Payload.Credentials.SecretAccessKey' },
                    { Name: 'AWS_SESSION_TOKEN', 'Value.$': '$.BackendCreds.Payload.Credentials.SessionToken' },
                  ],
                },
              ],
            },
            NetworkConfiguration: {
              AwsvpcConfiguration: {
                AssignPublicIp: 'ENABLED',
                Subnets: this.subnetIds,
                SecurityGroups: [this.securityGroupId],
              },
            },
          },
          ResultPath: '$.Run',
          Next: 'RecordRunTaskInfo',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseLockBeforeError',
            },
          ],
        },
        AcquireTdRegisterLock: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
          Parameters: {
            TableName: this.table.name,
            Item: {
              deploymentId: { S: 'tdlock#numa-portal-deploy' },
              startedAt: { 'S.$': '$$.State.EnteredTime' },
            },
            ConditionExpression: 'attribute_not_exists(deploymentId)',
          },
          ResultPath: null,
          Retry: [
            {
              ErrorEquals: ['DynamoDB.ConditionalCheckFailedException', 'DynamoDb.ConditionalCheckFailedException'],
              IntervalSeconds: 2,
              BackoffRate: 1.5,
              MaxAttempts: 20,
            },
          ],
          Next: 'ModePlan?',
        },
        'ModePlan?': {
          Type: 'Choice',
          Choices: [{ Variable: '$.mode', StringEquals: 'plan', Next: 'RegisterTaskDefinitionPlan' }],
          Default: 'RegisterTaskDefinition',
        },
        RegisterTaskDefinition: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:registerTaskDefinition',
          Parameters: {
            Family: this.taskDefinition.family,
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Cpu: cpu,
            Memory: memory,
            ExecutionRoleArn: this.taskExecRole.arn,
            TaskRoleArn: this.taskRole.arn,
            RuntimePlatform: { OperatingSystemFamily: 'LINUX' },
            ContainerDefinitions: [
              {
                Name: 'deployer',
                // Use {} placeholder for States.Format arguments
                'Image.$': `States.Format('${baseRepo}:{}', $.imageTag)`,
                Essential: true,
                // Use yarn workspace exec to avoid AWS_PROFILE from npm script
                EntryPoint: ['yarn'],
                'Command.$':
                  "States.Array('workspace','@arcanumai/q-apps-deployer-infra','exec','cdktf','deploy','--auto-approve', States.Format('numa-{}', $.clientName))",
                LogConfiguration: {
                  LogDriver: 'awslogs',
                  Options: {
                    'awslogs-group': this.logGroup.name,
                    'awslogs-region': region,
                    'awslogs-stream-prefix': 'ecs',
                  },
                },
                Environment: [
                  { Name: 'TF_ENVIRONMENT', Value: 'prod' },
                  { Name: 'CLIENT_OVERRIDE', 'Value.$': '$.clientName' },
                  { Name: 'TF_CLI_ARGS_apply', Value: '-parallelism=15' },
                  { Name: 'AWS_ACCESS_KEY_ID', 'Value.$': '$.BackendCreds.Payload.Credentials.AccessKeyId' },
                  { Name: 'AWS_SECRET_ACCESS_KEY', 'Value.$': '$.BackendCreds.Payload.Credentials.SecretAccessKey' },
                  { Name: 'AWS_SESSION_TOKEN', 'Value.$': '$.BackendCreds.Payload.Credentials.SessionToken' },
                ],
              },
            ],
          },
          ResultPath: '$.TaskDef',
          Next: 'ReleaseTdRegisterLock',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseTdRegisterLockOnError',
            },
          ],
        },
        RegisterTaskDefinitionPlan: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:registerTaskDefinition',
          Parameters: {
            Family: this.taskDefinition.family,
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Cpu: cpu,
            Memory: memory,
            ExecutionRoleArn: this.taskExecRole.arn,
            TaskRoleArn: this.taskRole.arn,
            RuntimePlatform: { OperatingSystemFamily: 'LINUX' },
            ContainerDefinitions: [
              {
                Name: 'deployer',
                'Image.$': `States.Format('${baseRepo}:{}', $.imageTag)`,
                Essential: true,
                EntryPoint: ['yarn'],
                'Command.$':
                  "States.Array('workspace','@arcanumai/q-apps-deployer-infra','exec','cdktf','diff', States.Format('numa-{}', $.clientName))",
                LogConfiguration: {
                  LogDriver: 'awslogs',
                  Options: {
                    'awslogs-group': this.logGroup.name,
                    'awslogs-region': region,
                    'awslogs-stream-prefix': 'ecs',
                  },
                },
                Environment: [
                  { Name: 'TF_ENVIRONMENT', Value: 'prod' },
                  { Name: 'CLIENT_OVERRIDE', 'Value.$': '$.clientName' },
                  { Name: 'AWS_ACCESS_KEY_ID', 'Value.$': '$.BackendCreds.Payload.Credentials.AccessKeyId' },
                  { Name: 'AWS_SECRET_ACCESS_KEY', 'Value.$': '$.BackendCreds.Payload.Credentials.SecretAccessKey' },
                  { Name: 'AWS_SESSION_TOKEN', 'Value.$': '$.BackendCreds.Payload.Credentials.SessionToken' },
                ],
              },
            ],
          },
          ResultPath: '$.TaskDef',
          Next: 'ReleaseTdRegisterLock',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseTdRegisterLockOnError',
            },
          ],
        },
        ReleaseTdRegisterLock: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { S: 'tdlock#numa-portal-deploy' } },
          },
          ResultPath: null,
          Next: 'RunTask',
        },
        ReleaseTdRegisterLockOnError: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { S: 'tdlock#numa-portal-deploy' } },
          },
          ResultPath: null,
          Next: 'ReleaseLockBeforeError',
        },
        RunTask: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:runTask',
          Parameters: {
            Cluster: this.cluster.arn,
            'TaskDefinition.$': '$.TaskDef.TaskDefinition.TaskDefinitionArn',
            LaunchType: 'FARGATE',
            NetworkConfiguration: {
              AwsvpcConfiguration: {
                AssignPublicIp: 'ENABLED',
                Subnets: this.subnetIds,
                SecurityGroups: [this.securityGroupId],
              },
            },
          },
          ResultPath: '$.Run',
          Next: 'RecordRunTaskInfo',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseLockBeforeError',
            },
          ],
        },
        RecordRunTaskInfo: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET ecsTaskArn = :task',
            ExpressionAttributeValues: {
              ':task': { 'S.$': '$.Run.Tasks[0].TaskArn' },
            },
          },
          // Do not overwrite input; keep $.Run for DescribeTasks
          ResultPath: null,
          Next: 'WaitForStop',
        },
        WaitForStop: {
          Type: 'Wait',
          Seconds: 15,
          Next: 'DescribeTasks',
        },
        DescribeTasks: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:describeTasks',
          Parameters: {
            Cluster: this.cluster.arn,
            'Tasks.$': 'States.Array($.Run.Tasks[0].TaskArn)',
          },
          ResultPath: '$.Desc',
          Next: 'EnsureDeadline',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'ReleaseLockBeforeError',
            },
          ],
        },
        EnsureDeadline: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Deadline.deadline',
              IsPresent: true,
              Next: 'UpdateNow',
            },
          ],
          Default: 'SetDeadline',
        },
        SetDeadline: {
          Type: 'Pass',
          Parameters: {
            deadline: "States.TimestampAdd($.Desc.Tasks[0].StartedAt, 120, 'Minutes')",
          },
          ResultPath: '$.Deadline',
          Next: 'UpdateNow',
        },
        UpdateNow: {
          Type: 'Pass',
          Parameters: {
            now: '$$.State.EnteredTime',
          },
          ResultPath: '$.Now',
          Next: 'TaskTimeout?',
        },
        'TaskTimeout?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Now.now',
              TimestampGreaterThanEqualsPath: '$.Deadline.deadline',
              Next: 'StopTaskAndTimeout',
            },
          ],
          Default: 'TaskFinished?',
        },
        StopTaskAndTimeout: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:stopTask',
          Parameters: {
            Cluster: this.cluster.arn,
            'Task.$': '$.Run.Tasks[0].TaskArn',
            Reason: 'Timeout exceeded (2h)',
          },
          ResultPath: null,
          Next: 'ReleaseLockBeforeExitFailureNoLogs',
        },
        'TaskFinished?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].LastStatus',
              StringEquals: 'STOPPED',
              Next: 'IsPlanRun?',
            },
          ],
          Default: 'WaitForStop',
        },
        'IsPlanRun?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.mode',
              StringEquals: 'plan',
              Next: 'PlanExit?',
            },
          ],
          Default: 'ExitOk?',
        },
        'PlanExit?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].ExitCode',
              NumericEquals: 0,
              Next: 'PlanHasLogsNoChanges?',
            },
            {
              Variable: '$.Desc.Tasks[0].Containers[0].ExitCode',
              NumericEquals: 2,
              Next: 'PlanHasLogsChanges?',
            },
          ],
          Default: 'FailureHasLogs?',
        },
        'PlanHasLogsNoChanges?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].LogStreamName',
              IsPresent: true,
              Next: 'ReleaseLockBeforePlanNoChanges',
            },
          ],
          Default: 'ReleaseLockBeforePlanNoChangesNoLogs',
        },
        'PlanHasLogsChanges?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].LogStreamName',
              IsPresent: true,
              Next: 'ReleaseLockBeforePlanChanges',
            },
          ],
          Default: 'ReleaseLockBeforePlanChangesNoLogs',
        },
        ReleaseLockBeforePlanNoChanges: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordPlanNoChanges',
        },
        ReleaseLockBeforePlanNoChangesNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordPlanNoChangesNoLogs',
        },
        ReleaseLockBeforePlanChanges: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordPlanChanges',
        },
        ReleaseLockBeforePlanChangesNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordPlanChangesNoLogs',
        },
        RecordPlanNoChanges: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, logsStream = :t, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'plan-no-changes' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':t': { 'S.$': '$.Desc.Tasks[0].Containers[0].LogStreamName' },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        RecordPlanNoChangesNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'plan-no-changes' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        RecordPlanChanges: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, logsStream = :t, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'plan-changes' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':t': { 'S.$': '$.Desc.Tasks[0].Containers[0].LogStreamName' },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        RecordPlanChangesNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'plan-changes' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        'ExitOk?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].ExitCode',
              NumericEquals: 0,
              Next: 'SuccessHasLogs?',
            },
          ],
          Default: 'ComputeRetryWindow',
        },
        ComputeRetryWindow: {
          Type: 'Pass',
          Parameters: {
            'started.$': '$.Desc.Tasks[0].StartedAt',
            'stopped.$': '$.Desc.Tasks[0].StoppedAt',
            windowStart: "States.TimestampAdd($.Desc.Tasks[0].StartedAt, 25, 'Minutes')",
            windowEnd: "States.TimestampAdd($.Desc.Tasks[0].StartedAt, 35, 'Minutes')",
          },
          ResultPath: '$.Retry',
          Next: 'RetryWindow?',
        },
        'RetryWindow?': {
          Type: 'Choice',
          Choices: [
            {
              And: [
                { Variable: '$.retryCount', NumericLessThan: 1 },
                { Variable: '$.Desc.Tasks[0].Containers[0].ExitCode', NumericGreaterThan: 0 },
                { Variable: '$.Desc.Tasks[0].StoppedAt', TimestampGreaterThanPath: '$.Retry.windowStart' },
                { Variable: '$.Desc.Tasks[0].StoppedAt', TimestampLessThanPath: '$.Retry.windowEnd' },
              ],
              Next: 'RetryMarkAndBump',
            },
          ],
          Default: 'FailureHasLogs?',
        },
        RetryMarkAndBump: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET attemptNumber = :two, attemptLabel = :label, #s = :retrying',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':two': { N: '2' },
              ':label': { S: '2/2' },
              ':retrying': { S: 'retrying' },
            },
          },
          ResultPath: null,
          Next: 'SetRetryCount',
        },
        SetRetryCount: {
          Type: 'Pass',
          Result: 1,
          ResultPath: '$.retryCount',
          Next: 'AssumeBackendRole',
        },
        'SuccessHasLogs?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].LogStreamName',
              IsPresent: true,
              Next: 'ReleaseLockBeforeSuccess',
            },
          ],
          Default: 'ReleaseLockBeforeSuccessNoLogs',
        },
        'FailureHasLogs?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].LogStreamName',
              IsPresent: true,
              Next: 'ReleaseLockBeforeExitFailure',
            },
          ],
          Default: 'ReleaseLockBeforeExitFailureNoLogs',
        },
        ReleaseLockBeforeSuccess: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordSuccess',
        },
        ReleaseLockBeforeSuccessNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordSuccessNoLogs',
        },
        ReleaseLockBeforeExitFailure: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'ComputeFailureMessageThenRecordExitFailure',
        },
        ReleaseLockBeforeExitFailureNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'ComputeFailureMessageThenRecordExitFailureNoLogs',
        },
        // Compute a robust failure message with fallbacks so JSONPath never fails
        ComputeFailureMessageThenRecordExitFailure: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].Reason',
              IsPresent: true,
              Next: 'SetFMFromContainerThenRecordExitFailure',
            },
            {
              Variable: '$.Desc.Tasks[0].StoppedReason',
              IsPresent: true,
              Next: 'SetFMFromStoppedThenRecordExitFailure',
            },
            {
              Variable: '$.Desc.Tasks[0].Containers[0].ExitCode',
              IsPresent: true,
              Next: 'SetFMFromExitThenRecordExitFailure',
            },
          ],
          Default: 'SetFMUnknownThenRecordExitFailure',
        },
        SetFMFromContainerThenRecordExitFailure: {
          Type: 'Pass',
          Parameters: { 'message.$': '$.Desc.Tasks[0].Containers[0].Reason' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailure',
        },
        SetFMFromStoppedThenRecordExitFailure: {
          Type: 'Pass',
          Parameters: { 'message.$': '$.Desc.Tasks[0].StoppedReason' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailure',
        },
        SetFMFromExitThenRecordExitFailure: {
          Type: 'Pass',
          Parameters: { 'message.$': "States.Format('Exit code {}', $.Desc.Tasks[0].Containers[0].ExitCode)" },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailure',
        },
        SetFMUnknownThenRecordExitFailure: {
          Type: 'Pass',
          Parameters: { message: 'Unknown error' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailure',
        },
        ComputeFailureMessageThenRecordExitFailureNoLogs: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Desc.Tasks[0].Containers[0].Reason',
              IsPresent: true,
              Next: 'SetFMFromContainerThenRecordExitFailureNoLogs',
            },
            {
              Variable: '$.Desc.Tasks[0].StoppedReason',
              IsPresent: true,
              Next: 'SetFMFromStoppedThenRecordExitFailureNoLogs',
            },
            {
              Variable: '$.Desc.Tasks[0].Containers[0].ExitCode',
              IsPresent: true,
              Next: 'SetFMFromExitThenRecordExitFailureNoLogs',
            },
          ],
          Default: 'SetFMUnknownThenRecordExitFailureNoLogs',
        },
        SetFMFromContainerThenRecordExitFailureNoLogs: {
          Type: 'Pass',
          Parameters: { 'message.$': '$.Desc.Tasks[0].Containers[0].Reason' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailureNoLogs',
        },
        SetFMFromStoppedThenRecordExitFailureNoLogs: {
          Type: 'Pass',
          Parameters: { 'message.$': '$.Desc.Tasks[0].StoppedReason' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailureNoLogs',
        },
        SetFMFromExitThenRecordExitFailureNoLogs: {
          Type: 'Pass',
          Parameters: { 'message.$': "States.Format('Exit code {}', $.Desc.Tasks[0].Containers[0].ExitCode)" },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailureNoLogs',
        },
        SetFMUnknownThenRecordExitFailureNoLogs: {
          Type: 'Pass',
          Parameters: { message: 'Unknown error' },
          ResultPath: '$.FailureMessage',
          Next: 'RecordExitFailureNoLogs',
        },
        ReleaseLockBeforeError: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:deleteItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': "States.Format('lock#{}', $.clientName)" } },
          },
          ResultPath: null,
          Next: 'RecordFailure',
        },
        RecordSuccess: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, logsStream = :t, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'success' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':t': { 'S.$': '$.Desc.Tasks[0].Containers[0].LogStreamName' },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        RecordSuccessNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, ecsTaskArn = :task',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'success' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnSuccess',
        },
        RecordExitFailure: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression:
              'SET #s = :s, endedAt = :e, logsGroup = :g, logsStream = :t, ecsTaskArn = :task, message = :m',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'failed' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':t': { 'S.$': '$.Desc.Tasks[0].Containers[0].LogStreamName' },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
              ':m': { 'S.$': '$.FailureMessage.message' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnFailed',
        },
        RecordExitFailureNoLogs: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, logsGroup = :g, ecsTaskArn = :task, message = :m',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':s': { S: 'failed' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':g': { S: this.logGroup.name },
              ':task': { 'S.$': '$.Desc.Tasks[0].TaskArn' },
              ':m': { 'S.$': '$.FailureMessage.message' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnFailed',
        },
        RecordFailure: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.deploymentId' } },
            UpdateExpression: 'SET #s = :s, endedAt = :e, #err = :err, #det = :det',
            ExpressionAttributeNames: {
              '#s': 'status',
              '#err': 'error',
              '#det': 'details',
            },
            ExpressionAttributeValues: {
              ':s': { S: 'failed' },
              ':e': { 'S.$': '$$.State.EnteredTime' },
              ':err': { 'S.$': '$.error.Error' },
              ':det': { 'S.$': '$.error.Cause' },
            },
          },
          ResultPath: '$.noop',
          Next: 'ReturnFailed',
        },
        ReturnSuccess: {
          Type: 'Pass',
          Result: { result: 'success' },
          ResultPath: '$',
          End: true,
        },
        ReturnFailed: {
          Type: 'Pass',
          Result: { result: 'failed' },
          ResultPath: '$',
          End: true,
        },
      },
    };

    this.stateMachine = new SfnStateMachine(this, 'deploy-state-machine', {
      name: 'NumaPortalDeployment',
      definition: JSON.stringify(definition),
      roleArn: this.sfnRole.arn,
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ALL',
        includeExecutionData: true,
        logDestination: `${this.sfnLogGroup.arn}:*`,
      },
    });

    // 9) Group deployment orchestration (fan-out with bounded concurrency)
    this.groupSfnLogGroup = new CloudwatchLogGroup(this, 'group-sfn-log-group', {
      name: '/numa/portal-deployments-groups-sfn',
      retentionInDays: 30,
    });

    this.groupSfnRole = new IamRole(this, 'group-sfn-role', {
      name: 'numa-portal-group-deploy-sfn-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      }),
    });

    new IamRolePolicy(this, 'group-sfn-policy', {
      name: 'numa-portal-group-deploy-sfn-policy',
      role: this.groupSfnRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'group-sfn-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['states:StartExecution', 'states:DescribeExecution'],
            resources: [this.stateMachine.arn],
          },
          // Allow registering a Task Definition once per group run
          {
            effect: 'Allow',
            actions: ['ecs:RegisterTaskDefinition'],
            resources: ['*'],
          },
          // Allow passing the roles referenced by the task definition
          {
            effect: 'Allow',
            actions: ['iam:PassRole'],
            resources: [this.taskExecRole.arn, this.taskRole.arn],
          },
          {
            effect: 'Allow',
            actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
            resources: [this.table.arn, `${this.table.arn}/index/*`],
          },
          {
            effect: 'Allow',
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [this.groupSfnLogGroup.arn, `${this.groupSfnLogGroup.arn}:*`],
          },
          {
            effect: 'Allow',
            actions: [
              'logs:CreateLogDelivery',
              'logs:GetLogDelivery',
              'logs:UpdateLogDelivery',
              'logs:DeleteLogDelivery',
              'logs:ListLogDeliveries',
              'logs:PutResourcePolicy',
              'logs:DescribeResourcePolicies',
              'logs:DescribeLogGroups',
            ],
            resources: ['*'],
          },
          {
            effect: 'Allow',
            actions: [
              'events:PutRule',
              'events:DescribeRule',
              'events:DeleteRule',
              'events:EnableRule',
              'events:DisableRule',
              'events:PutTargets',
              'events:RemoveTargets',
            ],
            resources: ['*'],
          },
        ],
      }).json,
    });

    const groupDefinition: StateMachine = {
      Comment: 'Coordinate multi-client deployments with bounded concurrency',
      StartAt: 'ValidateClients',
      States: {
        ValidateClients: {
          Type: 'Choice',
          Choices: [{ Variable: '$.clients[0]', IsPresent: true, Next: 'EnsureConcurrency' }],
          Default: 'NoClients',
        },
        NoClients: {
          Type: 'Fail',
          Error: 'ValidationError',
          Cause: 'clients array must contain at least one entry',
        },
        EnsureConcurrency: {
          Type: 'Choice',
          Choices: [{ Variable: '$.maxConcurrency', IsPresent: true, Next: 'CapConcurrency?' }],
          Default: 'SetDefaultConcurrency',
        },
        SetDefaultConcurrency: {
          Type: 'Pass',
          Result: defaultGroupConcurrency,
          ResultPath: '$.maxConcurrency',
          Next: 'CapConcurrency?',
        },
        'CapConcurrency?': {
          Type: 'Choice',
          Choices: [
            { Variable: '$.maxConcurrency', NumericGreaterThan: maxGroupConcurrency, Next: 'SetMaxConcurrency' },
          ],
          Default: 'EnsureMode',
        },
        SetMaxConcurrency: {
          Type: 'Pass',
          Result: maxGroupConcurrency,
          ResultPath: '$.maxConcurrency',
          Next: 'EnsureMode',
        },
        EnsureMode: {
          Type: 'Choice',
          Choices: [{ Variable: '$.mode', IsPresent: true, Next: 'CreateSummaryRecord' }],
          Default: 'SetDefaultMode',
        },
        SetDefaultMode: {
          Type: 'Pass',
          Result: 'deploy',
          ResultPath: '$.mode',
          Next: 'CreateSummaryRecord',
        },
        CreateSummaryRecord: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:putItem',
          Parameters: {
            TableName: this.table.name,
            Item: {
              historyPk: { S: 'all' },
              deploymentId: { 'S.$': '$.groupRunId' },
              clientName: { 'S.$': "States.Format('group#{}', $.groupName)" },
              status: { S: 'running' },
              startedAt: { 'S.$': '$.startedAt' },
              initiatedBy: { 'S.$': '$.initiatedBy' },
              imageTag: { 'S.$': '$.imageTag' },
              mode: { 'S.$': '$.mode' },
              entityType: { S: 'group' },
              groupRunId: { 'S.$': '$.groupRunId' },
              groupName: { 'S.$': '$.groupName' },
              clientsJson: { 'S.$': 'States.JsonToString($.clients)' },
              maxConcurrency: { 'S.$': "States.Format('{}', $.maxConcurrency)" },
              clientsTotal: { 'S.$': "States.Format('{}', States.ArrayLength($.clients))" },
              clientsCompleted: { N: '0' },
              clientsSucceeded: { N: '0' },
              clientsFailed: { N: '0' },
            },
          },
          ResultPath: null,
          Next: 'RecordGroupExecutionArn',
        },
        RecordGroupExecutionArn: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.groupRunId' } },
            UpdateExpression: 'SET sfnExecutionArn = :arn',
            ExpressionAttributeValues: {
              ':arn': { 'S.$': '$$.Execution.Id' },
            },
          },
          ResultPath: null,
          Next: 'RegisterGroupTaskDefinition',
        },
        RegisterGroupTaskDefinition: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ecs:registerTaskDefinition',
          Parameters: {
            Family: this.taskDefinition.family,
            NetworkMode: 'awsvpc',
            RequiresCompatibilities: ['FARGATE'],
            Cpu: cpu,
            Memory: memory,
            ExecutionRoleArn: this.taskExecRole.arn,
            TaskRoleArn: this.taskRole.arn,
            RuntimePlatform: { OperatingSystemFamily: 'LINUX' },
            ContainerDefinitions: [
              {
                Name: 'deployer',
                'Image.$': `States.Format('${baseRepo}:{}', $.imageTag)`,
                Essential: true,
                EntryPoint: ['yarn'],
                LogConfiguration: {
                  LogDriver: 'awslogs',
                  Options: {
                    'awslogs-group': this.logGroup.name,
                    'awslogs-region': region,
                    'awslogs-stream-prefix': 'ecs',
                  },
                },
              },
            ],
          },
          ResultPath: '$.GroupTaskDef',
          Next: 'PrepareClientBatches',
        },
        PrepareClientBatches: {
          Type: 'Pass',
          Parameters: {
            'groupRunId.$': '$.groupRunId',
            'groupName.$': '$.groupName',
            'clients.$': '$.clients',
            'clientBatches.$': 'States.ArrayPartition($.clients, $.maxConcurrency)',
            'imageTag.$': '$.imageTag',
            'initiatedBy.$': '$.initiatedBy',
            'mode.$': '$.mode',
            'startedAt.$': '$.startedAt',
            'maxConcurrency.$': '$.maxConcurrency',
            'deploymentLabel.$': '$.deploymentLabel',
            'taskDefinitionArn.$': '$.GroupTaskDef.TaskDefinition.TaskDefinitionArn',
          },
          ResultPath: '$',
          Next: 'DeployClientBatches',
        },
        DeployClientBatches: {
          Type: 'Map',
          ItemsPath: '$.clientBatches',
          MaxConcurrency: 1,
          Parameters: {
            'groupRunId.$': '$.groupRunId',
            'groupName.$': '$.groupName',
            'imageTag.$': '$.imageTag',
            'initiatedBy.$': '$.initiatedBy',
            'mode.$': '$.mode',
            'startedAt.$': '$.startedAt',
            'deploymentLabel.$': '$.deploymentLabel',
            'batchIndex.$': '$$.Map.Item.Index',
            'batch.$': '$$.Map.Item.Value',
            'taskDefinitionArn.$': '$.taskDefinitionArn',
          },
          Iterator: {
            StartAt: 'ProcessBatch',
            States: {
              ProcessBatch: {
                Type: 'Map',
                ItemsPath: '$.batch',
                MaxConcurrency: maxGroupConcurrency,
                Parameters: {
                  'clientName.$': '$$.Map.Item.Value',
                  'groupRunId.$': '$.groupRunId',
                  'groupName.$': '$.groupName',
                  'imageTag.$': '$.imageTag',
                  'initiatedBy.$': '$.initiatedBy',
                  'mode.$': '$.mode',
                  'deploymentLabel.$': '$.deploymentLabel',
                  'startedAt.$': '$.startedAt',
                  'taskDefinitionArn.$': '$.taskDefinitionArn',
                },
                Iterator: {
                  StartAt: 'PrepareDeployment',
                  States: {
                    PrepareDeployment: {
                      Type: 'Pass',
                      Parameters: {
                        'clientName.$': '$.clientName',
                        'groupRunId.$': '$.groupRunId',
                        'groupName.$': '$.groupName',
                        'imageTag.$': '$.imageTag',
                        'initiatedBy.$': '$.initiatedBy',
                        'mode.$': '$.mode',
                        'deploymentLabel.$': "States.Format('{} / {}', $.groupName, $.clientName)",
                        'deploymentId.$': "States.Format('{}#{}', $.groupRunId, $.clientName)",
                        'startedAt.$': '$$.State.EnteredTime',
                        'taskDefinitionArn.$': '$.taskDefinitionArn',
                      },
                      Next: 'StartChildExecution',
                    },
                    StartChildExecution: {
                      Type: 'Task',
                      Resource: 'arn:aws:states:::states:startExecution.sync:2',
                      Parameters: {
                        StateMachineArn: this.stateMachine.arn,
                        Input: {
                          'clientName.$': '$.clientName',
                          'groupRunId.$': '$.groupRunId',
                          'groupName.$': '$.groupName',
                          'deploymentId.$': '$.deploymentId',
                          'imageTag.$': '$.imageTag',
                          'initiatedBy.$': '$.initiatedBy',
                          'mode.$': '$.mode',
                          'deploymentLabel.$': '$.deploymentLabel',
                          'startedAt.$': '$.startedAt',
                          'taskDefinitionArn.$': '$.taskDefinitionArn',
                        },
                      },
                      ResultPath: '$.child',
                      Next: 'CheckChildResult',
                      Catch: [
                        {
                          ErrorEquals: ['States.ALL'],
                          ResultPath: '$.error',
                          Next: 'UpdateSummaryFailureFromCatch',
                        },
                      ],
                    },
                    CheckChildResult: {
                      Type: 'Choice',
                      Choices: [
                        { Variable: '$.child.Output.result', StringEquals: 'success', Next: 'UpdateSummarySuccess' },
                        {
                          Variable: '$.child.Output.result',
                          StringEquals: 'failed',
                          Next: 'UpdateSummaryFailureFromResult',
                        },
                      ],
                      Default: 'UpdateSummarySuccess',
                    },
                    UpdateSummarySuccess: {
                      Type: 'Task',
                      Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
                      Parameters: {
                        TableName: this.table.name,
                        Key: { deploymentId: { 'S.$': '$.groupRunId' } },
                        UpdateExpression: 'ADD clientsCompleted :one, clientsSucceeded :one SET lastActivityAt = :now',
                        ExpressionAttributeValues: {
                          ':one': { N: '1' },
                          ':now': { 'S.$': '$$.State.EnteredTime' },
                        },
                      },
                      ResultPath: null,
                      Next: 'SuccessResult',
                    },
                    SuccessResult: {
                      Type: 'Pass',
                      Parameters: {
                        'clientName.$': '$.clientName',
                        status: 'success',
                        'deploymentId.$': '$.deploymentId',
                        'executionArn.$': '$.child.ExecutionArn',
                      },
                      ResultPath: '$',
                      End: true,
                    },
                    UpdateSummaryFailureFromCatch: {
                      Type: 'Task',
                      Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
                      Parameters: {
                        TableName: this.table.name,
                        Key: { deploymentId: { 'S.$': '$.groupRunId' } },
                        UpdateExpression:
                          'ADD clientsCompleted :one, clientsFailed :one SET lastActivityAt = :now, lastError = :err, lastFailedClient = :client',
                        ExpressionAttributeValues: {
                          ':one': { N: '1' },
                          ':now': { 'S.$': '$$.State.EnteredTime' },
                          ':err': { 'S.$': '$.error.Cause' },
                          ':client': { 'S.$': '$.clientName' },
                        },
                      },
                      ResultPath: null,
                      Next: 'FailureResultFromCatch',
                    },
                    UpdateSummaryFailureFromResult: {
                      Type: 'Task',
                      Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
                      Parameters: {
                        TableName: this.table.name,
                        Key: { deploymentId: { 'S.$': '$.groupRunId' } },
                        UpdateExpression:
                          'ADD clientsCompleted :one, clientsFailed :one SET lastActivityAt = :now, lastError = :err, lastFailedClient = :client',
                        ExpressionAttributeValues: {
                          ':one': { N: '1' },
                          ':now': { 'S.$': '$$.State.EnteredTime' },
                          ':err': { 'S.$': "States.Format('Child result: {}', $.child.Output.result)" },
                          ':client': { 'S.$': '$.clientName' },
                        },
                      },
                      ResultPath: null,
                      Next: 'FailureResultFromResult',
                    },
                    FailureResultFromCatch: {
                      Type: 'Pass',
                      Parameters: {
                        'clientName.$': '$.clientName',
                        status: 'failed',
                        'deploymentId.$': '$.deploymentId',
                        'error.$': '$.error',
                      },
                      ResultPath: '$',
                      End: true,
                    },
                    FailureResultFromResult: {
                      Type: 'Pass',
                      Parameters: {
                        'clientName.$': '$.clientName',
                        status: 'failed',
                        'deploymentId.$': '$.deploymentId',
                        'executionArn.$': '$.child.ExecutionArn',
                        'error.$': "States.Format('Child result: {}', $.child.Output.result)",
                      },
                      ResultPath: '$',
                      End: true,
                    },
                  },
                },
                ResultPath: '$',
                End: true,
              },
            },
          },
          ResultPath: '$.groupExecutions',
          Next: 'FetchSummary',
        },
        FetchSummary: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:getItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.groupRunId' } },
          },
          ResultPath: '$.summary',
          Next: 'ExtractCounts',
        },
        ExtractCounts: {
          Type: 'Pass',
          Parameters: {
            'clientsTotal.$': 'States.StringToJson($.summary.Item.clientsTotal.S)',
            'clientsCompleted.$': 'States.StringToJson($.summary.Item.clientsCompleted.N)',
            'clientsSucceeded.$': 'States.StringToJson($.summary.Item.clientsSucceeded.N)',
            'clientsFailed.$': 'States.StringToJson($.summary.Item.clientsFailed.N)',
          },
          ResultPath: '$.summaryCounts',
          Next: 'DetermineOutcome',
        },
        DetermineOutcome: {
          Type: 'Choice',
          Choices: [
            {
              And: [
                { Variable: '$.summaryCounts.clientsFailed', NumericGreaterThan: 0 },
                { Variable: '$.summaryCounts.clientsSucceeded', NumericGreaterThan: 0 },
              ],
              Next: 'MarkPartial',
            },
            {
              Variable: '$.summaryCounts.clientsFailed',
              NumericGreaterThan: 0,
              Next: 'MarkFailed',
            },
          ],
          Default: 'MarkSuccess',
        },
        MarkPartial: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.groupRunId' } },
            UpdateExpression: 'SET #s = :status, endedAt = :time, lastActivityAt = :time',
            ExpressionAttributeNames: {
              '#s': 'status',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'partial' },
              ':time': { 'S.$': '$$.State.EnteredTime' },
            },
          },
          ResultPath: null,
          Next: 'Finished',
        },
        MarkFailed: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.groupRunId' } },
            UpdateExpression: 'SET #s = :status, endedAt = :time, lastActivityAt = :time',
            ExpressionAttributeNames: {
              '#s': 'status',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'failed' },
              ':time': { 'S.$': '$$.State.EnteredTime' },
            },
          },
          ResultPath: null,
          Next: 'Finished',
        },
        MarkSuccess: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem',
          Parameters: {
            TableName: this.table.name,
            Key: { deploymentId: { 'S.$': '$.groupRunId' } },
            UpdateExpression: 'SET #s = :status, endedAt = :time, lastActivityAt = :time',
            ExpressionAttributeNames: {
              '#s': 'status',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'success' },
              ':time': { 'S.$': '$$.State.EnteredTime' },
            },
          },
          ResultPath: null,
          Next: 'Finished',
        },
        Finished: {
          Type: 'Succeed',
        },
      },
    };

    this.groupStateMachine = new SfnStateMachine(this, 'group-deploy-state-machine', {
      name: 'NumaPortalGroupDeployment',
      definition: JSON.stringify(groupDefinition),
      roleArn: this.groupSfnRole.arn,
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ALL',
        includeExecutionData: true,
        logDestination: `${this.groupSfnLogGroup.arn}:*`,
      },
    });
  }
}
