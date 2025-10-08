import { Construct } from 'constructs';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsS3Bucket } from '@cdktf/provider-aws/lib/data-aws-s3-bucket';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { StateMachine } from 'asl-types';
import { Fn } from 'cdktf';
import path from 'node:path';

/**
 * Construct for creating a Bedrock Knowledge Base using S3 Vectors for storage.
 *
 * Note: Amazon S3 Vectors is in preview and subject to change. This construct
 * uses a custom resource Lambda to manage S3 Vectors resources since there is
 * no native Terraform/CloudFormation support during the preview period.
 *
 * WARNING: Destroying this construct will result in DATA LOSS:
 * - All vector embeddings will be deleted (hours/days to regenerate)
 * - S3 Vector bucket and index will be deleted
 * - Knowledge Base configuration will be lost
 * - No backups are created automatically
 *
 * Before destroying:
 * 1. Ensure you have backups of source documents
 * 2. Consider the time/cost to re-ingest and re-embed all data
 * 3. Verify this is intentional (not an accidental terraform destroy)
 */
export class S3VectorsKnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly vectorBucketName: string;
  public readonly indexName: string;
  public readonly dataSourceId: string;

  constructor(scope: Construct, id: string, props: S3VectorsKnowledgeBaseProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const vectorBucketName = `numa-${props.clientName}-vectors`;
    const indexName = `${props.clientName}-index`;
    const dataBucketName = `numa-${props.clientName}-data`;
    const dimensions = 1024; // Default for Titan embeddings

    // Validate that the data bucket exists
    const dataBucket = new DataAwsS3Bucket(this, 'data-bucket', {
      bucket: dataBucketName,
    });
    const dataBucketArn = dataBucket.arn;

    // IAM Role for custom resource Lambda
    const customResourceRole = new IamRole(this, 'custom-resource-role', {
      name: `${props.clientName}-s3vectors-manager`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'lambda-assume-policy', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const customResourcePolicy = new IamPolicy(this, 'custom-resource-policy', {
      name: `${props.clientName}-s3vectors-manager`,
      policy: new DataAwsIamPolicyDocument(this, 'custom-resource-policy-doc', {
        statement: [
          {
            actions: [
              's3vectors:CreateVectorBucket',
              's3vectors:DeleteVectorBucket',
              's3vectors:GetVectorBucket',
              's3vectors:CreateIndex',
              's3vectors:DeleteIndex',
              's3vectors:GetIndex',
            ],
            resources: ['*'], // S3 Vectors doesn't support resource-level permissions yet
          },
          {
            actions: [
              'bedrock:CreateKnowledgeBase',
              'bedrock:DeleteKnowledgeBase',
              'bedrock:GetKnowledgeBase',
              'bedrock:ListKnowledgeBases',
              'bedrock:CreateDataSource',
              'bedrock:DeleteDataSource',
              'bedrock:GetDataSource',
              'bedrock:ListDataSources',
            ],
            resources: ['*'],
          },
          {
            actions: ['iam:PassRole'],
            resources: [`arn:aws:iam::*:role/${props.clientName}-kb-s3vectors`],
          },
        ],
      }).json,
    });

    const policyAttachments = [
      new IamRolePolicyAttachment(this, 'lambda-basic-execution', {
        role: customResourceRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'custom-policy-attachment', {
        role: customResourceRole.name,
        policyArn: customResourcePolicy.arn,
      }),
    ];

    // IAM Role for Bedrock Knowledge Base (must be created before Lambda invocation)
    const knowledgeBaseRole = new IamRole(this, 'knowledge-base-role', {
      name: `${props.clientName}-kb-s3vectors`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'kb-assume-policy', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['bedrock.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const knowledgeBasePolicy = new IamPolicy(this, 'knowledge-base-policy', {
      name: `${props.clientName}-kb-s3vectors`,
      policy: new DataAwsIamPolicyDocument(this, 'kb-policy-doc', {
        statement: [
          {
            actions: ['bedrock:InvokeModel'],
            resources: [`arn:aws:bedrock:*:*:foundation-model/${props.embeddingModel}`],
          },
          {
            actions: ['bedrock:InvokeModel'],
            resources: [`arn:aws:bedrock:*:*:foundation-model/${props.bedrockParserModel}`],
          },
          {
            actions: [
              's3vectors:GetVectorBucket',
              's3vectors:ListIndexes',
              's3vectors:GetIndex',
              's3vectors:PutVectors',
              's3vectors:GetVectors',
              's3vectors:DeleteVectors',
              's3vectors:QueryVectors',
            ],
            resources: ['*'], // S3 Vectors preview doesn't support granular permissions
          },
          {
            actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:GetBucketLocation'],
            resources: [dataBucketArn, `${dataBucketArn}/*`],
          },
        ],
      }).json,
    });

    const kbPolicyAttachment = new IamRolePolicyAttachment(this, 'kb-policy-attachment', {
      role: knowledgeBaseRole.name,
      policyArn: knowledgeBasePolicy.arn,
    });

    // Add bucket policy to allow Knowledge Base role to access data bucket
    const dataBucketPolicy = new S3BucketPolicy(this, 'data-bucket-policy', {
      bucket: dataBucketName,
      policy: new DataAwsIamPolicyDocument(this, 'data-bucket-policy-doc', {
        statement: [
          {
            sid: 'AllowKnowledgeBaseAccess',
            effect: 'Allow',
            principals: [
              {
                type: 'AWS',
                identifiers: [knowledgeBaseRole.arn],
              },
            ],
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket', 's3:GetBucketLocation'],
            resources: [dataBucketArn, `${dataBucketArn}/*`],
          },
        ],
      }).json,
    });

    // Cleanup Lambda for removing unsuccessful files from S3 datasource
    const cleanupFunctionRole = new IamRole(this, 'cleanup-function-role', {
      name: `${props.clientName}-kb-s3vectors-cleanup`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'cleanup-function-assume-policy', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const cleanupFunctionPolicy = new IamPolicy(this, 'cleanup-function-policy', {
      name: `${props.clientName}-kb-s3vectors-cleanup`,
      policy: new DataAwsIamPolicyDocument(this, 'cleanup-function-policy-doc', {
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
      }).json,
    });

    const cleanupFunctionPolicyAttachments = [
      new IamRolePolicyAttachment(this, 'cleanup-lambda-basic-execution', {
        role: cleanupFunctionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'cleanup-policy-attachment', {
        role: cleanupFunctionRole.name,
        policyArn: cleanupFunctionPolicy.arn,
      }),
    ];

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
      functionName: `${props.clientName}-kb-s3vectors-cleanup`,
      role: cleanupFunctionRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: cleanupFunctionFilename,
      memorySize: 512,
      timeout: 300,
      sourceCodeHash: Fn.filebase64sha256(cleanupFunctionFilename),
    });

    // Migration Lambda for moving files to documents/ prefix
    const migrationFunctionRole = new IamRole(this, 'migration-function-role', {
      name: `${props.clientName}-kb-s3vectors-migrator`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'migration-function-assume-policy', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const migrationFunctionPolicy = new IamPolicy(this, 'migration-function-policy', {
      name: `${props.clientName}-kb-s3vectors-migrator`,
      policy: new DataAwsIamPolicyDocument(this, 'migration-function-policy-doc', {
        statement: [
          {
            actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:CopyObject'],
            resources: [dataBucketArn, `${dataBucketArn}/*`],
          },
        ],
      }).json,
    });

    const migrationFunctionPolicyAttachments = [
      new IamRolePolicyAttachment(this, 'migration-lambda-basic-execution', {
        role: migrationFunctionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'migration-policy-attachment', {
        role: migrationFunctionRole.name,
        policyArn: migrationFunctionPolicy.arn,
      }),
    ];

    const migrationFunctionPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      's3-kb-file-migrator',
    );
    const migrationFunctionFilename = path.resolve(migrationFunctionPath, 'lambda_function.zip');
    const migrationFunc = new LambdaFunction(this, 'migration-function', {
      functionName: `${props.clientName}-kb-s3vectors-migrator`,
      role: migrationFunctionRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: migrationFunctionFilename,
      memorySize: 1024,
      timeout: 600,
      sourceCodeHash: Fn.filebase64sha256(migrationFunctionFilename),
    });

    // Custom Resource Lambda
    const functionPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 's3-vectors-manager');
    const functionFilename = path.resolve(functionPath, 'lambda_function.zip');

    const func = new LambdaFunction(this, 's3vectors-manager-function', {
      functionName: `${props.clientName}-s3vectors-manager`,
      role: customResourceRole.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: functionFilename,
      memorySize: 512,
      timeout: 300,
      sourceCodeHash: Fn.filebase64sha256(functionFilename),
    });

    // Invoke Lambda to create entire S3 Vectors Knowledge Base stack
    const invocation = new LambdaInvocation(this, 's3vectors-invocation', {
      functionName: func.functionName,
      input: JSON.stringify({
        RequestType: 'Create',
        ResourceProperties: {
          VectorBucketName: vectorBucketName,
          IndexName: indexName,
          Dimensions: dimensions,
          DistanceMetric: 'COSINE',
          Region: props.region,
          KnowledgeBaseName: `${props.clientName}-kb-s3vectors`,
          KnowledgeBaseRoleArn: knowledgeBaseRole.arn,
          EmbeddingModelArn: `arn:aws:bedrock:${props.region}::foundation-model/${props.embeddingModel}`,
          ParserModelArn: `arn:aws:bedrock:${props.region}::foundation-model/${props.bedrockParserModel}`,
          DataSourceName: `${props.clientName}-datasource`,
          DataBucketArn: dataBucketArn,
          AccountId: callerIdentity.accountId,
        },
      }),
      triggers: {
        sourceCodeHash: Fn.filebase64sha256(functionFilename),
        bucketName: vectorBucketName,
        roleArn: knowledgeBaseRole.arn,
      },
      dependsOn: [
        func,
        ...policyAttachments,
        knowledgeBaseRole,
        knowledgeBasePolicy,
        kbPolicyAttachment,
        dataBucketPolicy,
      ],
    });

    // Parse Lambda result to extract Knowledge Base details
    // The Lambda creates: S3 Vectors bucket/index, Bedrock KB, and Data Source
    const invocationResult = Fn.jsondecode(invocation.result);
    const knowledgeBaseId = Fn.lookup(invocationResult, 'KnowledgeBaseId', '');
    const knowledgeBaseArn = Fn.lookup(invocationResult, 'KnowledgeBaseArn', '');
    const dataSourceId = Fn.lookup(invocationResult, 'DataSourceId', '');

    // State Machine for ingestion job polling
    const stateMachineRole = new IamRole(this, 'state-machine-role', {
      name: `${props.clientName}-s3vectors-ingestion`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'state-machine-assume-policy', {
        statement: [
          {
            principals: [{ identifiers: ['states.amazonaws.com'], type: 'Service' }],
            actions: ['sts:AssumeRole'],
          },
        ],
      }).json,
    });

    const stateMachineRolePolicy = new IamPolicy(this, 'state-machine-role-policy', {
      name: `${props.clientName}-s3vectors-ingestion`,
      policy: new DataAwsIamPolicyDocument(this, 'state-machine-policy-doc', {
        statement: [
          {
            resources: [knowledgeBaseArn],
            actions: ['bedrock:GetIngestionJob'],
          },
          {
            resources: [knowledgeBaseArn],
            actions: ['bedrock:StartIngestionJob'],
          },
          {
            resources: [migrationFunc.arn, cleanupFunc.arn],
            actions: ['lambda:InvokeFunction'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'state-machine-attachments', {
      roleName: stateMachineRole.name,
      policyArns: [stateMachineRolePolicy.arn],
    });

    const stateMachineDefinition: StateMachine = {
      StartAt: 'MigrateFiles',
      States: {
        MigrateFiles: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: migrationFunc.arn,
            Payload: {
              bucketName: dataBucketName,
              deleteOriginals: true,
              dryRun: false,
            },
          },
          ResultPath: '$.MigrationResult',
          Next: 'StartIngestionJob',
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
              ResultPath: '$.MigrationError',
              Next: 'StartIngestionJob',
              Comment: 'Continue to ingestion even if migration fails (files may already be migrated)',
            },
          ],
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        StartIngestionJob: {
          Type: 'Task',
          Parameters: {
            DataSourceId: dataSourceId,
            KnowledgeBaseId: knowledgeBaseId,
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
            DataSourceId: dataSourceId,
            KnowledgeBaseId: knowledgeBaseId,
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
              knowledgeBaseId: knowledgeBaseId,
              dataSourceId: dataSourceId,
              bucketName: dataBucketName,
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
      name: `${props.clientName}-s3vectors-sync`,
      roleArn: stateMachineRole.arn,
      definition: JSON.stringify(stateMachineDefinition),
      dependsOn: [
        migrationFunc,
        ...migrationFunctionPolicyAttachments,
        cleanupFunc,
        ...cleanupFunctionPolicyAttachments,
      ],
    });

    // EventBridge Scheduler for automatic syncs every 30 minutes
    const scheduledEventRole = new IamRole(this, 'sync-job-schedule-role', {
      name: `${props.clientName}-s3vectors-scheduler`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'scheduler-assume-policy', {
        statement: [
          {
            principals: [{ identifiers: ['scheduler.amazonaws.com'], type: 'Service' }],
            actions: ['sts:AssumeRole'],
          },
        ],
      }).json,
    });

    const scheduledEventRolePolicy = new IamPolicy(this, 'scheduled-event-role-policy', {
      name: `${props.clientName}-s3vectors-scheduler`,
      policy: new DataAwsIamPolicyDocument(this, 'scheduler-policy-doc', {
        statement: [
          {
            actions: ['states:StartExecution'],
            resources: [syncJobStateMachine.arn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'sync-job-scheduled-event-attachments', {
      roleName: scheduledEventRole.name,
      policyArns: [scheduledEventRolePolicy.arn],
    });

    new SchedulerSchedule(this, 'schedule', {
      name: `${props.clientName}-s3vectors-ingestion`,
      scheduleExpression: 'cron(0,30 * ? * * *)', // Every 30 minutes
      flexibleTimeWindow: {
        mode: 'OFF',
      },
      target: {
        arn: syncJobStateMachine.arn,
        roleArn: scheduledEventRole.arn,
      },
    });

    this.knowledgeBaseId = knowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBaseArn;
    this.dataSourceId = dataSourceId;
    this.vectorBucketName = vectorBucketName;
    this.indexName = indexName;
  }
}

export interface S3VectorsKnowledgeBaseProps {
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
