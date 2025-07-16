import { Construct } from 'constructs';
import {
  DataAwsIamPolicyDocument,
  DataAwsIamPolicyDocumentStatement,
} from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import * as asl from 'asl-types';

import {
  AddLambdaFunctionProps,
  ApiGatewayLambdaCollection,
  ApiGatewayLambdaCollectionProps,
  RouteDefinition,
} from '../api-gateway-lambda-collection';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { NumaLogGroup } from '../numa-log-group';
import { z } from 'zod';

export abstract class BaseNumaApp extends ApiGatewayLambdaCollection {
  abstract readonly manifest: NumaAppManifest;
  protected jobsTable?: DynamodbTable;
  protected logGroup: CloudwatchLogGroup;
  protected s3KeyPrefix: string;
  protected outputsBucket: S3Bucket;
  readonly appId: string;
  readonly clientName: string;
  readonly region: string;

  protected getResourceName(suffix: string): string {
    const appSpecificSuffix = `-${this.appId}${suffix}`;
    return `${this.clientName}`.slice(0, 64 - appSpecificSuffix.length) + appSpecificSuffix;
  }

  constructor(scope: Construct, name: string, props: AppSpecificBaseNumaAppProps) {
    super(scope, name, { ...props, resourceNameInfix: '-' + props.appId });

    this.appId = props.appId;
    this.clientName = props.clientName;
    this.region = props.region;
    this.outputsBucket = props.outputsBucket;

    this.logGroup = new NumaLogGroup(this, 'lambda-log-group', {
      logGroupName: name,
    }).logGroup;

    this.urlPathPrefix = '/api' + this.prepPathPart(props.urlPathPrefix ?? this.appId);
    this.s3KeyPrefix = props.s3KeyPrefix ?? `/${this.appId}`;

    if (props.enableJobs) {
      this.setupJobs();
    }
  }

  addLambdaFunction(scope: Construct, name: string, props: AddLambdaFunctionProps): LambdaFunction {
    props.appId = this.appId;
    return super.addLambdaFunction(scope, name, props);
  }

  addStepFunction(scope: Construct, name: string, props: AddStepFunctionProps): SfnStateMachine {
    const stepFunctionPolicy = new IamPolicy(this, name + '_policy', {
      policy: new DataAwsIamPolicyDocument(this, name + '_policy-document', {
        statement: [
          {
            actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
            resources: ['*'],
          },
          {
            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
            resources: [this.outputsBucket.arn, `${this.outputsBucket.arn}/*`],
          },
          ...(this.jobsTable
            ? [
                {
                  actions: [
                    'dynamodb:PutItem',
                    'dynamodb:GetItem',
                    'dynamodb:UpdateItem',
                    'dynamodb:DeleteItem',
                    'dynamodb:Query',
                    'dynamodb:Scan',
                  ],
                  resources: [this.jobsTable.arn, `${this.jobsTable.arn}/index/*`],
                },
              ]
            : []),
          {
            actions: [
              'logs:CreateLogDelivery',
              'logs:CreateLogStream',
              'logs:DeleteLogDelivery',
              'logs:DescribeLogGroups',
              'logs:DescribeResourcePolicies',
              'logs:GetLogDelivery',
              'logs:ListLogDeliveries',
              'logs:PutLogEvents',
              'logs:PutResourcePolicy',
              'logs:UpdateLogDelivery',
            ],
            resources: ['*'],
          },
        ],
      }).json,
    });

    const stepFunctionRole = new IamRole(this, name + '_role', {
      name: this.getResourceName(`_${name}_step-function-role`),
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, name + '_assume-role-policy', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['states.amazonaws.com'],
              },
            ],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachment(this, name + '_policy-attachment', {
      role: stepFunctionRole.name,
      policyArn: stepFunctionPolicy.arn,
    });

    const functionNameSuffix = `-${this.appId}_${name}_step-function`;
    const stepFunction = new SfnStateMachine(this, name + '_step-function', {
      name: this.clientName.slice(0, 80 - functionNameSuffix.length) + functionNameSuffix,
      definition: props.stepFunctionDefinition,
      roleArn: stepFunctionRole.arn,
      loggingConfiguration: {
        level: 'ALL',
        logDestination: `${this.logGroup.arn}:*`,
      },
      publish: true,
    });

    this.addLambdaFunction(scope, name + '-start', {
      route: {
        verb: 'POST',
        path: props.urlPath,
      },
      lambdaDirectory: 'python/step-function-start',
      environment: {
        APP_ID: this.appId,
        STEP_FUNCTION_ARN: stepFunction.arn,
      },
      additionalPolicyStatements: [
        {
          actions: ['states:StartExecution'],
          effect: 'Allow',
          resources: [stepFunction.arn],
        },
      ],
    });

    this.addLambdaFunction(scope, name + '-status', {
      route: {
        verb: 'GET',
        path: props.urlPath,
      },
      lambdaDirectory: 'python/step-function-status',
      environment: {
        APP_ID: this.appId,
        BUCKET: this.outputsBucket.bucket,
      },
      additionalPolicyStatements: [
        {
          actions: ['s3:ListBucket'], // this is required to get a 404 instead of a 403 if object not found
          effect: 'Allow',
          resources: [this.outputsBucket.arn],
        },
        {
          actions: ['s3:GetObject'],
          effect: 'Allow',
          resources: [`${this.outputsBucket.arn}${this.s3KeyPrefix}/*`],
        },
      ],
    });

    // Return the step function object so it can be used by callers
    return stepFunction;
  }

  addLambdaTask(
    lambdaArn: string,
    payload: Record<string, string | boolean | number>,
    next: string | null,
    additionalParameters?: AdditionalLambdaParameters,
  ): asl.State {
    return {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: {
        FunctionName: lambdaArn,
        Payload: payload,
      },
      Retry: [
        {
          BackoffRate: 2,
          ErrorEquals: [
            'Lambda.ServiceException',
            'Lambda.AWSLambdaException',
            'Lambda.SdkClientException',
            'Lambda.TooManyRequestsException',
          ],
          IntervalSeconds: 1,
          JitterStrategy: 'FULL',
          MaxAttempts: 3,
        },
      ],
      Catch: [
        {
          ErrorEquals: ['States.ALL'],
          Next: 'WriteFailureStatus',
          ResultPath: '$.CatcherOutput',
        },
      ],
      ...additionalParameters,
      ...(next ? { Next: next } : { End: true }),
    };
  }

  addExtractContentLambda(): LambdaFunction {
    const extractContentLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${this.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
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
    ];
    return this.addLambdaFunction(this, 'extract', {
      additionalPolicyStatements: extractContentLambdaPolicyStatements,
      lambdaDirectory: 'python/extract-content-from-file',
      timeout: 900,
    });
  }

  addExtractContentTask(
    extractContentLambda: LambdaFunction,
    input_key: string,
    next: string,
    additionalParameters?: AdditionalLambdaParameters,
  ): asl.State {
    return this.addLambdaTask(
      extractContentLambda.arn,
      {
        'input_key.$': input_key,
        'output_key.$': `States.Format('${this.appId}/{}/{}/extracted.json', $$.Execution.Input.user_id, $$.Execution.Input.job_id)`,
        input_bucket: this.outputsBucket.bucket,
      },
      next,
      {
        ResultSelector: {
          'output_key.$': '$.Payload.output_key',
        },
        ResultPath: '$.extracted',
        ...additionalParameters,
      },
    );
  }

  /**
   * Generate a unique state name prefix to avoid duplicate state names in Step Functions
   * @returns A unique string to use as a prefix for state names
   */
  protected getUniqueStateNamePrefix(): string {
    return `${Math.random().toString(36).substring(2, 8)}_`;
  }

  // Write status to either S3 or DynamoDB based on configuration
  writeStatus(body: Record<string, string | Record<string, string>>, next: string): asl.State {
    // If we have a jobs table, write to DynamoDB instead of S3
    if (this.jobsTable) {
      // Extract the status string from the body object
      const statusValue = typeof body.status === 'string' ? body.status : 'UNKNOWN';

      // Prepare update expression and attribute values
      let updateExpression = 'SET #status = :status, #lastUpdated = :lastUpdated';
      const expressionAttributeNames: Record<string, string> = {
        '#status': 'status',
        '#lastUpdated': 'lastUpdated',
      };
      const expressionAttributeValues: Record<
        string,
        | { S: string }
        | { 'S.$': string }
        | { 'M.$': string }
        | { 'L.$': string | Record<string, string> }
        | { M: Record<string, unknown> }
        | { L: Record<string, unknown> }
      > = {
        ':status': {
          S: statusValue,
        },
        ':lastUpdated': {
          S: new Date().toISOString(),
        },
      };

      // Include the results field in the update if present
      if ('results.$' in body) {
        updateExpression += ', #results = :results';
        expressionAttributeNames['#results'] = 'results';
        // Store results as a JSON string for backward compatibility
        // The frontend already has logic to parse this string
        expressionAttributeValues[':results'] = {
          'S.$': `States.JsonToString(${body['results.$']})`,
        };
      }

      // If there's a message field, include it in the update
      if ('message.$' in body) {
        updateExpression += ', #message = :message';
        expressionAttributeNames['#message'] = 'message';
        expressionAttributeValues[':message'] = {
          'S.$': `States.JsonToString(${body['message.$']})`,
        };
      }

      // Get a unique state name prefix to avoid duplicate state names
      const statePrefix = this.getUniqueStateNamePrefix();

      // Create a state machine that handles both job_id and original_job_id
      return {
        Type: 'Parallel',
        Branches: [
          {
            StartAt: `${statePrefix}CheckOriginalJobId`,
            States: {
              [`${statePrefix}CheckOriginalJobId`]: {
                Type: 'Choice',
                Choices: [
                  {
                    Variable: '$$.Execution.Input.original_job_id',
                    IsPresent: true,
                    Next: `${statePrefix}UpdateWithOriginalJobId`,
                  },
                ],
                Default: `${statePrefix}UpdateWithJobId`,
              },
              [`${statePrefix}UpdateWithOriginalJobId`]: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:updateItem',
                Parameters: {
                  TableName: this.jobsTable.name,
                  Key: {
                    jobId: {
                      'S.$': '$$.Execution.Input.original_job_id',
                    },
                  },
                  UpdateExpression: updateExpression,
                  ExpressionAttributeNames: expressionAttributeNames,
                  ExpressionAttributeValues: expressionAttributeValues,
                },
                ResultPath: null,
                Next: `${statePrefix}SuccessState`,
                Catch: [
                  {
                    ErrorEquals: ['States.ALL'],
                    ResultPath: null,
                    Next: `${statePrefix}SuccessState`,
                  },
                ],
              },
              [`${statePrefix}UpdateWithJobId`]: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:updateItem',
                Parameters: {
                  TableName: this.jobsTable.name,
                  Key: {
                    jobId: {
                      'S.$': '$$.Execution.Input.job_id',
                    },
                  },
                  UpdateExpression: updateExpression,
                  ExpressionAttributeNames: expressionAttributeNames,
                  ExpressionAttributeValues: expressionAttributeValues,
                },
                ResultPath: null,
                Next: `${statePrefix}SuccessState`,
                Catch: [
                  {
                    ErrorEquals: ['States.ALL'],
                    ResultPath: null,
                    Next: `${statePrefix}SuccessState`,
                  },
                ],
              },
              [`${statePrefix}SuccessState`]: {
                Type: 'Succeed',
              },
            },
          },
        ],
        Next: next,
      };
    } else {
      // Fall back to S3 if no jobs table is configured
      return {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        Parameters: {
          Body: body,
          Bucket: this.outputsBucket.bucket,
          'Key.$': `States.Format('${this.appId}/{}/{}/status.json', $$.Execution.Input.user_id, $$.Execution.Input.job_id)`,
        },
        ResultPath: null,
        Next: next,
      };
    }
  }

  writeProcessingStatus(): asl.State {
    return this.writeStatus({ status: 'PROCESSING' }, 'Initialize');
  }

  writeFailureStatus(): asl.State {
    return this.writeStatus(
      {
        status: 'FAILURE',
        'message.$': "States.Format('{}: {}', $.CatcherOutput.Error, $.CatcherOutput.Cause)",
      },
      'Failure',
    );
  }

  writeSuccessStatus(resultPath?: string): asl.State {
    return this.writeStatus(
      {
        status: 'SUCCESS',
        'results.$': resultPath ?? '$',
      },
      'Success',
    );
  }

  protected setupJobs(): void {
    // Create DynamoDB table with same naming convention as before
    const tableName = `${this.clientName}-${this.appId}-recent-jobs`;
    const table = (this.jobsTable = new DynamodbTable(this, 'jobs-table', {
      name: tableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'jobId',
      attribute: [
        { name: 'jobId', type: 'S' },
        { name: 'dateTime', type: 'S' },
        { name: 'userId', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'date-time-index',
          hashKey: 'dateTime',
          projectionType: 'ALL',
        },
        {
          name: 'user-date-index',
          hashKey: 'userId',
          rangeKey: 'dateTime',
          projectionType: 'ALL',
        },
      ],
    }));

    // Set the base path for jobs
    const jobsBasePath = '/jobs';

    // Define API operations
    type Operation = RouteDefinition & {
      handler: string;
      lambdaName: string;
    };

    const operations: Operation[] = [
      { verb: 'POST', path: jobsBasePath, handler: 'create_job.handler', lambdaName: 'create-job' },
      { verb: 'GET', path: jobsBasePath, handler: 'list_jobs.handler', lambdaName: 'list-jobs' },
      { verb: 'GET', path: `${jobsBasePath}/{jobId}`, handler: 'get_job.handler', lambdaName: 'get-job' },
      { verb: 'PUT', path: `${jobsBasePath}/{jobId}`, handler: 'update_job.handler', lambdaName: 'update-job' },
    ];

    operations.forEach((op) => {
      this.addLambdaFunction(this, op.lambdaName, {
        route: {
          verb: op.verb,
          path: op.path,
        },
        handler: op.handler,
        lambdaDirectory: 'python/numa-recent-jobs',
        runtime: 'python3.13',
        environment: {
          DYNAMODB_TABLE: table.arn,
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: [
              'dynamodb:PutItem',
              'dynamodb:GetItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:Scan',
            ],
            resources: [table.arn, `${table.arn}/index/*`],
          },
        ],
      });
    });
  }
}

export type BaseNumaAppType = new (scope: Construct, name: string, props: BaseNumaAppProps) => BaseNumaApp;

export enum AppType {
  NUMA = 'numa-app',
  NZSBA_POLICY_DESIGNER = 'policy-builder',
  Q = 'q-app',
}

export enum AppStatus {
  ACTIVE = 'Active',
  INTERNAL = 'Internal',
  COMING_SOON = 'Coming Soon',
}

export const DROPDOWN_TASK = 'dropdown' as const;
export const DROPDOWN_TABLE_TASK = 'dropdown-table' as const;
export const HTTP_REQUEST_TASK = 'http-request' as const;
export const Q_APP_TASK = 'q-app' as const;
export const S3_UPLOAD_TASK = 's3-upload' as const;
export const TEXT_INPUT_TASK = 'text-input' as const;
export const TEXT_OUTPUT_TASK = 'text-output' as const;

export interface NumaAppManifestBaseTask {
  id: string;
  title: string;
  order: number;
}

export interface NumaAppManifestDropdownTask extends NumaAppManifestBaseTask {
  type: typeof DROPDOWN_TASK;
  required: boolean;
  params: {
    options: string[];
  };
}

export interface NumaAppManifestHttpRequestTask extends NumaAppManifestBaseTask {
  type: typeof HTTP_REQUEST_TASK;
  endpoint: string;
  params: {
    payload?: Record<string, unknown>;
  };
}

export interface NumaAppManifestQAppTask extends NumaAppManifestBaseTask {
  type: typeof Q_APP_TASK;
  appVersion: string;
  params: {
    qAppId: string;
    inputs: {
      inputContentRef: string;
      qInputCardId: string;
    }[];
    qOutputCardId: string;
  };
}

export interface NumaAppManifestTextInputTask extends NumaAppManifestBaseTask {
  type: typeof TEXT_INPUT_TASK;
}

export interface NumaAppManifestS3UploadTask extends NumaAppManifestBaseTask {
  type: typeof S3_UPLOAD_TASK;
  parameters?: {
    // Accepts either MIME types (e.g., 'image/jpeg') or file extensions (e.g., '.pdf')
    allowedFileTypes?: string[];
    maximumFileSize?: number; // Maximum file size in MB
    minFiles?: number;
    maxFiles?: number;
    userMessage?: string;
  };
}

export interface NumaAppManifestTextOutputTask extends NumaAppManifestBaseTask {
  type: typeof TEXT_OUTPUT_TASK;
  params: {
    dataRef: string;
  };
}

export interface NumaAppManifestDropdownTableTask extends NumaAppManifestBaseTask {
  type: typeof DROPDOWN_TABLE_TASK;
  required: boolean;
  params: {
    fields: Array<{
      id: string;
      label: string;
      type: 'dropdown' | 'number' | 'text';
      options?: string[];
      defaultValue?: string | number;
      required?: boolean;
      placeholder?: string;
      validation?: {
        min?: number;
        max?: number;
        pattern?: string;
      };
    }>;
  };
}

export enum AppCategory {
  PRODUCTIVITY = 'productivity',
  FINANCE = 'finance',
  COMPLIANCE = 'compliance',
  HR = 'hr',
  GENERAL = 'general',
  LEGAL = 'legal',
}

export type NumaAppManifestTask =
  | NumaAppManifestDropdownTask
  | NumaAppManifestDropdownTableTask
  | NumaAppManifestHttpRequestTask
  | NumaAppManifestQAppTask
  | NumaAppManifestS3UploadTask
  | NumaAppManifestTextInputTask
  | NumaAppManifestTextOutputTask;

export interface NumaAppManifest {
  appName: string;
  id: string;
  type: AppType;
  status: AppStatus;
  category: AppCategory;
  createdDate: string;
  appDescription: string;
  tasks: NumaAppManifestTask[];
}

export interface AddStepFunctionProps {
  additionalPolicyStatements?: DataAwsIamPolicyDocumentStatement[];
  outputsBucket: S3Bucket;
  stepFunctionDefinition: string;
  urlPath: string;
}

export const userConfigurableBaseNumaAppPropsSchema = z
  .object({
    enableJobs: z.boolean().optional(),
    urlPathPrefix: z.string().optional(),
    s3KeyPrefix: z.string().optional(),

    // Generic email configuration for apps that need email functionality
    senderEmail: z.string().optional(),
    receiverEmails: z.array(z.string()).optional(),
  })
  .strict();

export type UserConfigurableBaseNumaAppProps = z.infer<typeof userConfigurableBaseNumaAppPropsSchema>;

export interface BaseNumaAppProps extends UserConfigurableBaseNumaAppProps, ApiGatewayLambdaCollectionProps {
  clientName: string;
  outputsBucket: S3Bucket;
  region: string;
}

export interface AppSpecificBaseNumaAppProps extends BaseNumaAppProps {
  appId: string;
}

export interface AdditionalLambdaParameters {
  Catch?: Array<Record<string, string>>;
  OutputPath?: string;
  ResultPath?: string;
  ResultSelector?: Record<string, string>;
}
