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
import { StateMachine } from 'asl-types';

export class KnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const cidrBlock = '10.32.0.0/16';
    const subnetCount = 2;
    const databaseName = 'arcanum';
    const model = props.embeddingModel;
    const dimensions = 1024;

    // Dynamically generate the bucket ARN based on
    // client name so it can be defined before the bucket is created
    // This is a workaround to avoid circular dependencies.
    const dataBucketArn = `arn:aws:s3:::numa-${props.clientName}-data`;

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

    const clusterIdentierPrefix = /^[a-zA-Z]/.test(props.clientName) ? props.clientName : 'numa-' + props.clientName; // Cluster identifier must start with a letter.
    const cluster = new RdsCluster(this, 'rds-cluster', {
      clusterIdentifier: `${clusterIdentierPrefix}-knowledge-base`,
      vpcSecurityGroupIds: [securityGroup.id],
      dbSubnetGroupName: dbSubnetGroup.name,
      engine: 'aurora-postgresql',
      engineMode: 'provisioned',
      engineVersion: '16.6',
      masterUsername: 'arcanum_superuser',
      manageMasterUserPassword: true,
      enableHttpEndpoint: true,
      databaseName,
      skipFinalSnapshot: true,
      serverlessv2ScalingConfiguration: {
        minCapacity: 0,
        maxCapacity: 1,
        secondsUntilAutoPause: 300,
      },

      lifecycle: {
        ignoreChanges: ['engine_version'], // Avoid recreating the cluster when the engine version changes
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
      },
    });

    const bedrockUserSecret = new SecretsmanagerSecret(this, 'bedrock-user-secret', {
      name: props.clientName + '-bedrock-user',
    });

    const secretVersion = new SecretsmanagerSecretVersion(this, 'bedrock-user-secret-version', {
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
        {
          actions: ['bedrock:InvokeModel'],
          resources: [`arn:aws:bedrock:*:*:foundation-model/${props.bedrockParserModel}`],
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
            resources: [dataBucketArn],
          },
          {
            actions: ['s3:GetObject'],
            resources: [`${dataBucketArn}/*`],
          },
          {
            actions: ['s3:PutObject'],
            resources: [`${dataBucketArn}/*`],
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

    // Cleanup Lambda IAM configuration
    const cleanupFunctionAssumptionPolicyDoc = new DataAwsIamPolicyDocument(
      this,
      'cleanup-function-assumption-policy-document',
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

    const cleanupFunctionPolicyDoc = new DataAwsIamPolicyDocument(this, 'cleanup-function-policy-document', {
      statement: [
        {
          actions: ['bedrock:ListIngestionJobs', 'bedrock:GetIngestionJob'],
          resources: ['*'],
        },
        {
          actions: ['s3:DeleteObject', 's3:DeleteObjects'],
          resources: [`${dataBucketArn}/*`],
        },
      ],
    });

    const cleanupFunctionPolicy = new IamPolicy(this, 'cleanup-function-policy', {
      name: props.clientName + '-knowledge-base-cleanup',
      policy: cleanupFunctionPolicyDoc.json,
    });

    const cleanupFunctionRole = new IamRole(this, 'cleanup-function-role', {
      name: props.clientName + '-knowledge-base-cleanup',
      assumeRolePolicy: cleanupFunctionAssumptionPolicyDoc.json,
    });

    const cleanupFunctionPolicyAttachments = [
      new IamRolePolicyAttachment(this, 'cleanup-function-role-policy-attachment', {
        role: cleanupFunctionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'cleanup-function-role-policy-attachment-custom', {
        role: cleanupFunctionRole.name,
        policyArn: cleanupFunctionPolicy.arn,
      }),
    ];

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
      ...cleanupFunctionPolicyAttachments,
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

    // Cleanup Lambda for removing unsuccessful files from S3 datasource
    const cleanupFunctionPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'bedrock-cleanup-failed-files',
    );
    const cleanupFunctionFilename = path.resolve(cleanupFunctionPath, 'lambda_function.zip');
    const cleanupFunc = new LambdaFunction(this, 'cleanup-function', {
      functionName: props.clientName + '-knowledge-base-cleanup',
      role: cleanupFunctionRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: cleanupFunctionFilename,
      timeout: 300, // 5 minutes for potentially large cleanup operations
      sourceCodeHash: Fn.filebase64sha256(cleanupFunctionFilename),
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
        secretVersion: secretVersion.versionId,
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

    // Expose the knowledge base ID for frontend configuration
    this.knowledgeBaseId = knowledgeBase.id;
    this.knowledgeBaseArn = knowledgeBase.arn;

    const dataSource = new BedrockagentDataSource(this, 'knowledge-base-datasource', {
      name: props.clientName + '-knowledge-base-datasource',
      knowledgeBaseId: knowledgeBase.id,
      dataDeletionPolicy: 'RETAIN',
      dataSourceConfiguration: [
        {
          type: 'S3',
          s3Configuration: [
            {
              bucketArn: dataBucketArn,
            },
          ],
        },
      ],
      vectorIngestionConfiguration: [
        {
          parsingConfiguration: [
            {
              parsingStrategy: 'BEDROCK_FOUNDATION_MODEL',
              bedrockFoundationModelConfiguration: [
                {
                  modelArn: 'arn:aws:bedrock:' + props.region + '::foundation-model/' + props.bedrockParserModel,
                  parsingModality: 'MULTIMODAL',
                  parsingPrompt: [
                    {
                      parsingPromptString:
                        'Please extract and parse the content from this document, preserving the structure and extracting any tables, figures, or other elements. Return the content in a clear, structured format.',
                    },
                  ],
                } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
              ],
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
        {
          resources: [cleanupFunc.arn],
          actions: ['lambda:InvokeFunction'],
        },
      ],
    });
    const stateMachineRolePolicy = new IamPolicy(this, 'state-machine-role-policy', {
      name: props.clientName + '-ingestion-state-machine',
      policy: stateMachineRolePolicyDocument.json,
    });

    new IamRolePolicyAttachment(this, 'state-machine-policy-attachment', {
      role: stateMachineRole.name,
      policyArn: stateMachineRolePolicy.arn,
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
              Next: 'CleanupFailedFiles',
            },
            {
              Variable: '$.IngestionJob.Status',
              StringEquals: 'COMPLETE',
              Next: 'CleanupFailedFiles',
            },
          ],
          Default: 'Wait X Seconds',
        },
        CleanupFailedFiles: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: cleanupFunc.arn,
            Payload: {
              knowledgeBaseId: knowledgeBase.id,
              dataSourceId: dataSource.dataSourceId,
              bucketName: `numa-${props.clientName}-data`,
            },
          },
          ResultPath: '$.CleanupResult',
          Next: 'CheckJobStatus',
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed'],
              BackoffRate: 2,
              IntervalSeconds: 1,
              MaxAttempts: 3,
            },
          ],
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CleanupError',
              Next: 'CheckJobStatus',
              Comment: 'Continue to check job status even if cleanup fails',
            },
          ],
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        CheckJobStatus: {
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
          Default: 'Success',
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
      dependsOn: [cleanupFunc, ...cleanupFunctionPolicyAttachments],
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
    new IamRolePolicyAttachment(this, 'scheduled-event-policy-attachment', {
      role: scheduledEventRole.name,
      policyArn: scheduledEventRolePolicy.arn,
    });
    new SchedulerSchedule(this, 'schedule', {
      name: props.clientName + '-ingestion',
      scheduleExpression: 'cron(0,30 * ? * * *)', // Every 30 minutes
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
   * The id of the embedding model to use.
   */
  embeddingModel: string;
  /**
   * The id of the bedrock model to use for document parsing.
   */
  bedrockParserModel: string;
}
