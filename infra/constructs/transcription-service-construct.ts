import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsSubnets } from '@cdktf/provider-aws/lib/data-aws-subnets';
import { DataAwsVpc } from '@cdktf/provider-aws/lib/data-aws-vpc';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository';
import { EcsCluster } from '@cdktf/provider-aws/lib/ecs-cluster';
import { EcsTaskDefinition } from '@cdktf/provider-aws/lib/ecs-task-definition';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaEventSourceMapping } from '@cdktf/provider-aws/lib/lambda-event-source-mapping';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';
import { SecurityGroupRule } from '@cdktf/provider-aws/lib/security-group-rule';
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { Resource as NullResource } from '@cdktf/provider-null/lib/resource';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';
import { OTelConfig } from './numa-lambda';

export interface TranscriptionServiceConstructProps extends ApiGatewayLambdaCollectionProps {
  region: string;
  dataBucketArn: string;
  dataBucketName: string;
  outputsBucketArn: string;
  extractContentLambdaArn: string;
  extractContentLambdaName: string;
  notificationsTableName: string;
  notificationsTableArn: string;
  usageAnalyticsEventsTableName: string;
  usageAnalyticsEventsTableArn: string;
  auditAutomationTableName: string;
  auditAutomationTableArn: string;
  /** Deployer role ARN for chain assume (required for ECR push from local-exec) */
  deployerRoleArn: string;
  otelConfig?: OTelConfig;
}

export class TranscriptionServiceConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;
  public readonly transcriptionsTable: DynamodbTable;
  public readonly jobQueue: SqsQueue;
  public readonly ecrRepository: EcrRepository;
  public readonly ecsCluster: EcsCluster;
  public readonly taskDefinition: EcsTaskDefinition;

  constructor(scope: Construct, name: string, props: TranscriptionServiceConstructProps) {
    super(scope, name, props);

    const clientName = props.clientName;

    // Log group
    this.logGroup = new NumaLogGroup(this, 'transcription-log-group', {
      logGroupName: `${clientName}/transcription-service`,
    }).logGroup;

    // ─── DynamoDB table ───
    this.transcriptionsTable = new DynamodbTable(this, 'transcriptions-table', {
      name: `numa-${clientName}-transcriptions`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'userSub',
      rangeKey: 'jobId',
      attribute: [
        { name: 'userSub', type: 'S' },
        { name: 'jobId', type: 'S' },
        { name: 'status', type: 'S' },
        { name: 'updatedAt', type: 'N' },
        { name: 'clientName', type: 'S' },
        { name: 'createdAt', type: 'N' },
        { name: 'fileHash', type: 'S' },
        { name: 'fileKey', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'StatusIndex',
          hashKey: 'status',
          rangeKey: 'updatedAt',
          projectionType: 'ALL',
        },
        {
          name: 'AdminIndex',
          hashKey: 'clientName',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
        {
          name: 'HashIndex',
          hashKey: 'fileHash',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
        {
          name: 'FileKeyIndex',
          hashKey: 'fileKey',
          rangeKey: 'createdAt',
          projectionType: 'ALL',
        },
      ],
      ttl: { enabled: true, attributeName: 'expiresAt' },
      pointInTimeRecovery: { enabled: true },
      streamEnabled: true,
      streamViewType: 'NEW_AND_OLD_IMAGES',
      deletionProtectionEnabled: true,
      lifecycle: { preventDestroy: true },
    });

    // ─── SQS queues ───
    const dlq = new SqsQueue(this, 'transcription-jobs-dlq', {
      name: `numa-${clientName}-transcription-jobs-dlq`,
      messageRetentionSeconds: 1209600, // 14 days
    });

    this.jobQueue = new SqsQueue(this, 'transcription-jobs-queue', {
      name: `numa-${clientName}-transcription-jobs`,
      visibilityTimeoutSeconds: 930,
      messageRetentionSeconds: 345600, // 4 days
      redrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlq.arn,
        maxReceiveCount: 3,
      }),
    });

    // ─── Shared IAM action lists ───
    const dynamoReadActions = ['dynamodb:GetItem', 'dynamodb:Query'];
    const dynamoWriteActions = ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'];
    const dynamoAllActions = [...dynamoReadActions, ...dynamoWriteActions];

    // ─── ECS Fargate Resources ───

    // ECR Repository
    this.ecrRepository = new EcrRepository(this, 'ecr', {
      name: `numa-${clientName}-transcription-service`,
      imageScanningConfiguration: { scanOnPush: true },
      forceDelete: true,
    });

    // ─── Push image to ECR (skopeo) ───

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const imageTarPath = path.resolve(
      import.meta.dirname,
      '..',
      'assets',
      'artifacts',
      'transcription-service',
      'image.tar'
    );

    // Content-based tag: first 12 chars of SHA256 hex (safe for Docker tags)
    const imageTarHash = Fn.filesha256(imageTarPath);
    const imageTag = Fn.substr(imageTarHash, 0, 12);

    new NullResource(this, 'push-image', {
      triggers: {
        image_tag: imageTag,
      },
      provisioners: [
        {
          type: 'local-exec',
          command: `
set -e

# Chain assume: deployer role → client role
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

# Login to client ECR
aws ecr get-login-password --region ${props.region} | \\
  skopeo login --authfile /tmp/skopeo-auth.json --username AWS --password-stdin ${callerIdentity.accountId}.dkr.ecr.${props.region}.amazonaws.com

# Delete all existing images to keep ECR lean
echo "Cleaning up old images from ECR..."
REPO_NAME="numa-${clientName}-transcription-service"
IMAGES=$(aws ecr list-images --repository-name "$REPO_NAME" --region ${props.region} --query 'imageIds[*]' --output json 2>/dev/null || echo "[]")
if [ "$IMAGES" != "[]" ] && [ -n "$IMAGES" ]; then
  aws ecr batch-delete-image --repository-name "$REPO_NAME" --region ${props.region} --image-ids "$IMAGES" || true
  echo "Deleted old images"
else
  echo "No existing images to delete"
fi

# Push image from tar to client ECR
skopeo copy --authfile /tmp/skopeo-auth.json --insecure-policy \\
  docker-archive:${imageTarPath} \\
  docker://${this.ecrRepository.repositoryUrl}:${imageTag}

echo "Successfully pushed image to ${this.ecrRepository.repositoryUrl}:${imageTag}"
`,
        },
      ],
    });

    // VPC + Subnets (default VPC, public subnets for outbound access)
    const vpc = new DataAwsVpc(this, 'default-vpc', { default: true });
    const subnets = new DataAwsSubnets(this, 'default-vpc-subnets', {
      filter: [{ name: 'vpc-id', values: [vpc.id] }],
    });
    const subnet0 = Fn.element(subnets.ids, 0);
    const subnet1 = Fn.element(subnets.ids, 1);

    // Security group — egress only (needs S3, DynamoDB, Bedrock, Transcribe)
    const sg = new SecurityGroup(this, 'fargate-sg', {
      name: `numa-${clientName}-transcription-fargate-sg`,
      description: 'Transcription Fargate tasks - egress only',
      vpcId: vpc.id,
    });
    new SecurityGroupRule(this, 'fargate-sg-egress', {
      type: 'egress',
      fromPort: 0,
      toPort: 0,
      protocol: '-1',
      cidrBlocks: ['0.0.0.0/0'],
      securityGroupId: sg.id,
    });

    // ECS Cluster
    this.ecsCluster = new EcsCluster(this, 'ecs-cluster', {
      name: `numa-${clientName}-transcriptions`,
    });

    // Fargate log group (created directly to avoid construct ID collision with main log group)
    const fargateLogGroup = new CloudwatchLogGroup(this, 'fargate-log-group', {
      name: `/numa/${clientName}/transcription-service-fargate`,
    });

    // Task Execution Role (ECR pull + CloudWatch logs)
    const taskExecRole = new IamRole(this, 'task-exec-role', {
      name: `numa-${clientName}-transcription-task-exec`,
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
      name: `numa-${clientName}-transcription-task-exec-policy`,
      role: taskExecRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'task-exec-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [fargateLogGroup.arn, `${fargateLogGroup.arn}:*`],
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

    // Task Role (app-level permissions)
    const taskRole = new IamRole(this, 'task-role', {
      name: `numa-${clientName}-transcription-task`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'task-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['ecs-tasks.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    new IamRolePolicy(this, 'task-role-policy', {
      name: `numa-${clientName}-transcription-task-policy`,
      role: taskRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'task-role-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
            resources: [`${props.dataBucketArn}/*`, `${props.outputsBucketArn}/*`],
          },
          {
            effect: 'Allow',
            actions: [...dynamoReadActions, 'dynamodb:UpdateItem', 'dynamodb:PutItem'],
            resources: [this.transcriptionsTable.arn],
          },
          {
            effect: 'Allow',
            actions: ['sqs:SendMessage'],
            resources: [this.jobQueue.arn],
          },
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [props.extractContentLambdaArn],
          },
          {
            effect: 'Allow',
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
          },
          {
            effect: 'Allow',
            actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
            resources: ['*'],
          },
        ],
      }).json,
    });

    // ECS Task Definition (ARM64 Fargate)
    this.taskDefinition = new EcsTaskDefinition(this, 'task-def', {
      family: `numa-${clientName}-transcription`,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '2048',
      memory: '4096',
      executionRoleArn: taskExecRole.arn,
      taskRoleArn: taskRole.arn,
      runtimePlatform: {
        operatingSystemFamily: 'LINUX',
        cpuArchitecture: 'ARM64',
      },
      containerDefinitions: JSON.stringify([
        {
          name: 'transcription',
          image: `${this.ecrRepository.repositoryUrl}:${imageTag}`,
          essential: true,
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': `/numa/${clientName}/transcription-service-fargate`,
              'awslogs-region': props.region,
              'awslogs-stream-prefix': 'ecs',
            },
          },
          // Environment overrides are set per-job by the dispatcher via RunTask
        },
      ]),
    });

    // ─── Transcription API Lambda ───
    this.addLambdaFunction(this, 'transcription-api', {
      addAuthorizer: true,
      lambdaDirectory: 'node/transcription-api',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 256,
      timeout: 29,
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: this.transcriptionsTable.name,
        JOB_QUEUE_URL: this.jobQueue.url,
        DATA_BUCKET_NAME: props.dataBucketName,
        CLIENT_NAME: clientName,
        REGION: props.region,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: dynamoAllActions,
          resources: [this.transcriptionsTable.arn, `${this.transcriptionsTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['sqs:SendMessage'],
          resources: [this.jobQueue.arn],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:HeadObject'],
          resources: [`${props.dataBucketArn}/*`, `${props.outputsBucketArn}/*`],
        },
      ],
      route: [
        { verb: 'GET', path: 'transcriptions' },
        { verb: 'POST', path: 'transcriptions' },
        { verb: 'GET', path: 'transcriptions/{jobId}' },
        { verb: 'DELETE', path: 'transcriptions/{jobId}' },
        { verb: 'POST', path: 'transcriptions/{jobId}/retry' },
        { verb: 'GET', path: 'transcriptions/admin/all' },
        { verb: 'POST', path: 'transcriptions/admin/rebuild' },
        { verb: 'GET', path: 'transcriptions/lookup/hash/{hash}' },
        { verb: 'GET', path: 'transcriptions/lookup/path' },
      ],
    });

    // ─── Transcription Dispatcher Lambda (SQS trigger) ───
    const dispatcherLambda = this.addLambdaFunction(this, 'transcription-dispatcher', {
      addAuthorizer: false,
      lambdaDirectory: 'node/transcription-dispatcher',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 512,
      timeout: 900, // 15 minutes (matches Lambda max for long extractions)
      environment: {
        TRANSCRIPTIONS_TABLE_NAME: this.transcriptionsTable.name,
        DATA_BUCKET_NAME: props.dataBucketName,
        EXTRACT_CONTENT_LAMBDA_NAME: props.extractContentLambdaName,
        CLIENT_NAME: clientName,
        REGION: props.region,
        AUDIT_AUTOMATION_TABLE_NAME: props.auditAutomationTableName,
        // Fargate routing config
        ECS_CLUSTER_ARN: this.ecsCluster.arn,
        ECS_TASK_DEFINITION_ARN: this.taskDefinition.arn,
        ECS_SUBNET_IDS: `${subnet0},${subnet1}`,
        ECS_SECURITY_GROUP_ID: sg.id,
        FARGATE_MAX_CONCURRENT: '3',
        JOB_QUEUE_URL: this.jobQueue.url,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: [...dynamoReadActions, 'dynamodb:UpdateItem'],
          resources: [this.transcriptionsTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem'],
          resources: [props.auditAutomationTableArn],
        },
        {
          effect: 'Allow',
          actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
          resources: [this.jobQueue.arn],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${props.dataBucketArn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [props.extractContentLambdaArn],
        },
        {
          effect: 'Allow',
          actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:ListTasks'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['iam:PassRole'],
          resources: [taskExecRole.arn, taskRole.arn],
        },
      ],
    });

    // Wire SQS → dispatcher Lambda event source mapping
    new LambdaEventSourceMapping(this, 'dispatcher-sqs-trigger', {
      eventSourceArn: this.jobQueue.arn,
      functionName: dispatcherLambda.functionName,
      batchSize: 1,
      enabled: true,
    });

    // ─── Transcription Stream Handler (DDB Streams → notifications) ───
    const streamHandlerLambda = this.addLambdaFunction(this, 'transcription-stream-handler', {
      addAuthorizer: false,
      lambdaDirectory: 'node/transcription-stream-handler',
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      memorySize: 256,
      timeout: 60,
      environment: {
        NOTIFICATIONS_TABLE_NAME: props.notificationsTableName,
        USAGE_EVENTS_TABLE_NAME: props.usageAnalyticsEventsTableName,
        AUDIT_AUTOMATION_TABLE_NAME: props.auditAutomationTableName,
        REGION: props.region,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [props.notificationsTableArn, props.usageAnalyticsEventsTableArn, props.auditAutomationTableArn],
        },
        {
          effect: 'Allow',
          actions: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          resources: [this.transcriptionsTable.arn, `${this.transcriptionsTable.arn}/stream/*`],
        },
      ],
    });

    // Wire DynamoDB Streams → stream handler
    new LambdaEventSourceMapping(this, 'stream-handler-ddb-trigger', {
      eventSourceArn: this.transcriptionsTable.streamArn,
      functionName: streamHandlerLambda.functionName,
      startingPosition: 'LATEST',
      batchSize: 10,
      maximumBatchingWindowInSeconds: 5,
      enabled: true,
    });
  }
}
