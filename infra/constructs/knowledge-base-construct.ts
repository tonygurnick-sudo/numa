import { Vpc } from '@cdktf/provider-aws/lib/vpc';
import { Subnet } from '@cdktf/provider-aws/lib/subnet';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import { DbSubnetGroup } from '@cdktf/provider-aws/lib/db-subnet-group';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';
import { RdsCluster } from '@cdktf/provider-aws/lib/rds-cluster';
import { RdsClusterInstance } from '@cdktf/provider-aws/lib/rds-cluster-instance';
import { BedrockagentKnowledgeBase } from '@cdktf/provider-aws/lib/bedrockagent-knowledge-base';
import { BedrockagentDataSource } from '@cdktf/provider-aws/lib/bedrockagent-data-source';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import path from 'node:path';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { Password } from '@cdktf/provider-random/lib/password';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { StateMachine } from 'asl-types';

export class KnowledgeBase extends Construct {
  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const cidrBlock = '10.32.0.0/16';
    const subnetCount = 2;
    const databaseName = 'arcanum';
    const model = props.embeddingModel;
    const dimensions = 1024;

    const vpc = new Vpc(this, 'vpc', {
      cidrBlock,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: {
        Name: `${props.clientName}-knowledge-base`,
      },
    });

    const subnets = [...Array(subnetCount).keys()].map((i) => {
      const availabilityZone = props.region + String.fromCharCode(97 + i);
      return new Subnet(this, `subnet-${availabilityZone}`, {
        vpcId: vpc.id,
        availabilityZone,
        cidrBlock: Fn.cidrsubnet(cidrBlock, 8, i),
        tags: {
          Name: `${props.clientName}-knowledge-base-${availabilityZone}`,
        },
      });
    });
    const dbSubnetGroup = new DbSubnetGroup(this, 'db-subnet-group', {
      subnetIds: subnets.map((s) => s.id),
    });

    const securityGroup = new SecurityGroup(this, 'security-group', {
      vpcId: vpc.id,
    });

    const cluster = new RdsCluster(this, 'rds-cluster', {
      clusterIdentifier: `${props.clientName}-knowledge-base`,
      vpcSecurityGroupIds: [securityGroup.id],
      dbSubnetGroupName: dbSubnetGroup.name,
      engine: 'aurora-postgresql',
      engineMode: 'provisioned',
      engineVersion: '16.6',
      masterUsername: 'arcanum_superuser',
      manageMasterUserPassword: true,
      enableHttpEndpoint: true,
      databaseName,
      serverlessv2ScalingConfiguration: {
        minCapacity: 0,
        maxCapacity: 1,
        secondsUntilAutoPause: 300,
      },

      lifecycle: {
        ignoreChanges: ['engine_version'], // Avoid recreating the cluster when the engine version changes
        preventDestroy: true, // Prevent accidental deletion
      },
    });

    const clusterInstance = new RdsClusterInstance(this, 'rds-cluster-instance', {
      identifier: `${cluster.clusterIdentifier}-instance`,
      clusterIdentifier: cluster.id,
      engine: cluster.engine,
      engineVersion: cluster.engineVersion,
      instanceClass: 'db.serverless',

      lifecycle: {
        ignoreChanges: ['engine_version'], // Avoid recreating the instance when the engine version changes
        preventDestroy: true, // Prevent accidental deletion
      },
    });

    const bedrockUserSecret = new SecretsmanagerSecret(this, 'bedrock-user-secret', {
      name: props.clientName + '-bedrock-user',
    });

    new SecretsmanagerSecretVersion(this, 'bedrock-user-secret-version', {
      secretId: bedrockUserSecret.id,
      secretString: JSON.stringify({
        username: 'bedrock_user',
        password: new Password(this, 'bedrock-user-password', {
          length: 16,
        }).result,
      }),
    });

    const knowledgeBasePolicyDoc = new DataAwsIamPolicyDocument(this, 'knowledge-base-policy-document', {
      statement: [
        {
          actions: ['rds:DescribeDBInstances', 'rds:DescribeDBClusters'],
          resources: ['*'],
        },
        {
          actions: ['rds-data:*'],
          resources: [cluster.arn],
        },
        {
          actions: ['secretsmanager:GetSecretValue'],
          resources: [bedrockUserSecret.arn],
        },
        {
          actions: ['bedrock:InvokeModel'],
          resources: [`arn:aws:bedrock:*:*:foundation-model/${model}`],
        },
      ],
    });

    const knowledgeBaseAccessS3PolicyDoc = new DataAwsIamPolicyDocument(
      this,
      'knowledge-base-access-s3-policy-document',
      {
        statement: [
          {
            actions: ['s3:ListBucket'],
            resources: [props.dataBucketArn],
          },
          {
            actions: ['s3:GetObject'],
            resources: [`${props.dataBucketArn}/*`],
          },
        ],
      },
    );
    const knowledgeBaseAccessS3Policy = new IamPolicy(this, 'knowledge-base-access-s3-policy', {
      name: props.clientName + '-knowledge-base-access-s3',
      policy: knowledgeBaseAccessS3PolicyDoc.json,
    });

    const knowledgeBasePolicy = new IamPolicy(this, 'knowledge-base-policy', {
      name: props.clientName + '-knowledge-base',
      policy: knowledgeBasePolicyDoc.json,
    });

    const knowledgeBaseAssumptionPolicyDoc = new DataAwsIamPolicyDocument(
      this,
      'knowledge-base-assumption-policy-document',
      {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['bedrock.amazonaws.com'],
              },
            ],
          },
        ],
      },
    );

    const knowledgeBaseRole = new IamRole(this, 'knowledge-base-role', {
      name: props.clientName + '-knowledge-base',
      assumeRolePolicy: knowledgeBaseAssumptionPolicyDoc.json,
    });

    const initFunctionAssumptionPolicyDoc = new DataAwsIamPolicyDocument(
      this,
      'init-function-assumption-policy-document',
      {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['lambda.amazonaws.com'],
              },
            ],
          },
        ],
      },
    );

    const initFunctionPolicyDoc = new DataAwsIamPolicyDocument(this, 'init-function-policy-document', {
      statement: [
        {
          actions: ['rds:DescribeDBInstances', 'rds:DescribeDBClusters'],
          resources: ['*'],
        },
        {
          actions: ['rds-data:*'],
          resources: [cluster.arn],
        },
        {
          actions: ['secretsmanager:GetSecretValue'],
          resources: [cluster.masterUserSecret.get(0).secretArn],
        },
        {
          actions: ['secretsmanager:GetSecretValue'],
          resources: [bedrockUserSecret.arn],
        },
      ],
    });

    const initFunctionPolicy = new IamPolicy(this, 'init-function-policy', {
      name: props.clientName + '-knowledge-base-init',
      policy: initFunctionPolicyDoc.json,
    });

    const initFunctionRole = new IamRole(this, 'function-role', {
      name: props.clientName + '-knowledge-base-init',
      assumeRolePolicy: initFunctionAssumptionPolicyDoc.json,
    });

    const policyAttachments = [
      new IamRolePolicyAttachment(this, 'knowledge-base-role-policy-attachment', {
        role: knowledgeBaseRole.name,
        policyArn: knowledgeBasePolicy.arn,
      }),
      new IamRolePolicyAttachment(this, 'knowledge-base-role-policy-attachment-s3', {
        role: knowledgeBaseRole.name,
        policyArn: knowledgeBaseAccessS3Policy.arn,
      }),
      new IamRolePolicyAttachment(this, 'function-role-policy-attachment', {
        role: initFunctionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'function-role-policy-attachment-knowledge-base', {
        role: initFunctionRole.name,
        policyArn: initFunctionPolicy.arn,
      }),
    ];

    const initFunctionPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'vector-db-init');
    const initFunctionFilename = path.resolve(initFunctionPath, 'lambda_function.zip');
    const func = new LambdaFunction(this, 'init-function', {
      functionName: props.clientName + '-knowledge-base-init',
      role: initFunctionRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: initFunctionFilename,
      timeout: 60,
      sourceCodeHash: Fn.filebase64sha256(initFunctionFilename),
    });

    const invocation = new LambdaInvocation(this, 'init-function-invocation', {
      functionName: func.functionName,
      input: JSON.stringify({
        RequestType: 'Create',
        ResourceProperties: {
          AuroraDBClusterArn: cluster.arn,
          AuroraDBClusterAdminSecretArn: cluster.masterUserSecret.get(0).secretArn,
          AuroraDBName: cluster.databaseName,
          BedrockUserSecretArn: bedrockUserSecret.arn,
          VectorDimensions: dimensions,
        },
      }),
      triggers: {
        sourceCodeHash: Fn.filebase64sha256(initFunctionFilename),
        time: new Date().toISOString(),
      },
      dependsOn: [clusterInstance, func, ...policyAttachments],
    });

    const knowledgeBase = new BedrockagentKnowledgeBase(this, 'knowledge-base', {
      name: props.clientName + '-knowledge-base',
      roleArn: knowledgeBaseRole.arn,
      knowledgeBaseConfiguration: [
        {
          type: 'VECTOR',
          vectorKnowledgeBaseConfiguration: [
            {
              embeddingModelArn: 'arn:aws:bedrock:' + props.region + '::foundation-model/' + model,
              embeddingModelConfiguration: [
                {
                  bedrockEmbeddingModelConfiguration: [
                    {
                      dimensions,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      storageConfiguration: [
        {
          type: 'RDS',
          rdsConfiguration: [
            {
              resourceArn: cluster.arn,
              credentialsSecretArn: bedrockUserSecret.arn,
              tableName: 'bedrock_integration.bedrock_knowledge_base',
              databaseName: cluster.databaseName,
              fieldMapping: [
                {
                  vectorField: 'embedding',
                  textField: 'chunks',
                  metadataField: 'metadata',
                  primaryKeyField: 'id',
                },
              ],
            },
          ],
        },
      ],
      dependsOn: [invocation, ...policyAttachments],
    });

    const dataSource = new BedrockagentDataSource(this, 'knowledge-base-datasource', {
      name: props.clientName + '-knowledge-base-datasource',
      knowledgeBaseId: knowledgeBase.id,
      dataSourceConfiguration: [
        {
          type: 'S3',
          s3Configuration: [
            {
              bucketArn: props.dataBucketArn,
            },
          ],
        },
      ],
    });

    const stateMachineRoleAssumptionPolicyDocument = new DataAwsIamPolicyDocument(
      this,
      'state-machine-role-assumption-policy',
      {
        statement: [
          {
            principals: [
              {
                identifiers: ['states.amazonaws.com'],
                type: 'Service',
              },
            ],
            actions: ['sts:AssumeRole'],
          },
        ],
      },
    );
    const stateMachineRole = new IamRole(this, 'state-machine-role', {
      name: props.clientName + '-ingestion-state-machine',
      assumeRolePolicy: stateMachineRoleAssumptionPolicyDocument.json,
    });
    const stateMachineRolePolicyDocument = new DataAwsIamPolicyDocument(this, 'state-machine-role-policy-document', {
      statement: [
        {
          resources: [knowledgeBase.arn],
          actions: ['bedrock:GetIngestionJob'],
        },
        {
          resources: [knowledgeBase.arn],
          actions: ['bedrock:StartIngestionJob'],
        },
      ],
    });
    const stateMachineRolePolicy = new IamPolicy(this, 'state-machine-role-policy', {
      name: props.clientName + '-ingestion-state-machine',
      policy: stateMachineRolePolicyDocument.json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'state-machine-attachments', {
      roleName: stateMachineRole.name,
      policyArns: [stateMachineRolePolicy.arn],
    });

    const stateMachineDefinition: StateMachine = {
      StartAt: 'StartIngestionJob',
      States: {
        StartIngestionJob: {
          Type: 'Task',
          Parameters: {
            DataSourceId: dataSource.dataSourceId,
            KnowledgeBaseId: knowledgeBase.id,
          },
          Resource: 'arn:aws:states:::aws-sdk:bedrockagent:startIngestionJob',
          Next: 'Wait X Seconds',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed'],
              BackoffRate: 2,
              IntervalSeconds: 1,
              MaxAttempts: 5,
            },
          ],
        },
        'Wait X Seconds': {
          Type: 'Wait',
          Seconds: 10,
          Next: 'GetIngestionJob',
        },
        GetIngestionJob: {
          Type: 'Task',
          Parameters: {
            DataSourceId: dataSource.dataSourceId,
            KnowledgeBaseId: knowledgeBase.id,
            'IngestionJobId.$': '$.IngestionJob.IngestionJobId',
          },
          Resource: 'arn:aws:states:::aws-sdk:bedrockagent:getIngestionJob',
          Next: 'Job Complete?',
        },
        'Job Complete?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.IngestionJob.Status',
              StringEquals: 'FAILED',
              Next: 'Fail',
            },
            {
              Variable: '$.IngestionJob.Status',
              StringEquals: 'COMPLETE',
              Next: 'Success',
            },
          ],
          Default: 'Wait X Seconds',
        },
        Success: {
          Type: 'Succeed',
        },
        Fail: {
          Type: 'Fail',
        },
      },
    };

    const syncJobStateMachine = new SfnStateMachine(this, 'sync-job-state-machine', {
      name: props.clientName + '-start-sync-job',
      roleArn: stateMachineRole.arn,
      definition: JSON.stringify(stateMachineDefinition),
    });

    const scheduledEventRoleAssumptionPolicyDocument = new DataAwsIamPolicyDocument(
      this,
      'scheduled-event-role-assumption-policy-document',
      {
        statement: [
          {
            principals: [
              {
                identifiers: ['scheduler.amazonaws.com'],
                type: 'Service',
              },
            ],
            actions: ['sts:AssumeRole'],
          },
        ],
      },
    );

    const scheduledEventRolePolicyDocument = new DataAwsIamPolicyDocument(
      this,
      'scheduled-event-role-policy-document',
      {
        statement: [
          {
            actions: ['states:StartExecution'],
            resources: [syncJobStateMachine.arn],
          },
        ],
      },
    );

    const scheduledEventRolePolicy = new IamPolicy(this, 'scheduled-event-role-policy', {
      name: props.clientName + '-ingestion-scheduled-event',
      policy: scheduledEventRolePolicyDocument.json,
    });

    const scheduledEventRole = new IamRole(this, 'sync-job-schedule-role', {
      name: props.clientName + '-ingestion-scheduled-event',
      assumeRolePolicy: scheduledEventRoleAssumptionPolicyDocument.json,
    });
    new IamRolePolicyAttachmentsExclusive(this, 'sync-job-scheduled-event-attachments', {
      roleName: scheduledEventRole.name,
      policyArns: [scheduledEventRolePolicy.arn],
    });
    new SchedulerSchedule(this, 'schedule', {
      name: props.clientName + '-ingestion',
      scheduleExpression: 'cron(0 * ? * * *)', // TODO: implement expression
      flexibleTimeWindow: {
        mode: 'OFF',
      },
      target: {
        arn: syncJobStateMachine.arn,
        roleArn: scheduledEventRole.arn,
      },
    });
  }
}

interface KnowledgeBaseProps {
  /**
   * The AWS region to deploy the resources in.
   */
  region: string;
  /**
   * The client name.
   */
  clientName: string;
  /**
   * The ARN of the S3 bucket to import data from.
   */
  dataBucketArn: string;
  /**
   * The id of the embedding model to use.
   */
  embeddingModel: string;
}
