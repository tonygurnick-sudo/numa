import * as asl from 'asl-types';
import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
  TEXT_OUTPUT_TASK,
} from './base-numa-app-construct';

const description = `Summarise one or multiple documents`;

export class DocumentSummariser extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    const appId = 'document-summariser';
    props.enableJobs = true;
    props.pathPrefix ??= appId;
    super(scope, name, props);

    this.manifest = {
      appName: 'Document Summariser',
      id: props.pathPrefix,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-31',
      appDescription: description,
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload documents',
          description: 'Upload the documents you would like summarised',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'call-step-function',
          title: 'Process Documents',
          type: HTTP_REQUEST_TASK,
          endpoint: 'document-summariser',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              template: '@template-task',
              other_notes: '@other-notes',
            },
          },
          order: 2,
        },
        {
          id: 'summaries',
          title: 'Summaries',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/output_key',
          },
          order: 3,
        },
      ],
    };

    const extractContentLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/${appId}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
      {
        actions: ['textract:GetDocumentTextDetection', 'textract:StartDocumentTextDetection'],
        resources: ['*'],
      },
    ];
    const extractContentLambda = this.addLambdaFunction(this, 'extract', {
      additionalPolicyStatements: extractContentLambdaPolicyStatements,
      lambdaDirectory: 'python/extract-content-from-file',
      timeout: 900,
    });

    const summariseDocumentLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/${appId}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const summariseDocumentLambda = this.addLambdaFunction(this, 'summarise', {
      additionalPolicyStatements: summariseDocumentLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/document-summariser',
      timeout: 900,
    });

    const aggregatorLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/${appId}/*`],
      },
    ];
    const aggregatorLambda = this.addLambdaFunction(this, 'aggregate', {
      additionalPolicyStatements: aggregatorLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/aggregate-document-results',
      timeout: 900,
    });

    function writeStatus(body: Record<string, string | Record<string, string>>, next: string): asl.State {
      return {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        Parameters: {
          Body: body,
          Bucket: props.outputsBucket.bucket,
          'Key.$': `States.Format('${appId}/{}/status.json', $$.Execution.Input.job_id)`,
        },
        ResultPath: null,
        Next: next,
      };
    }

    const extractedSuffix = '.extracted.json';
    const summarisedSuffix = '.summarised.txt';
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: writeStatus({ status: 'PROCESSING' }, 'Initialize'),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            app_name: appId,
            'job_id.$': '$$.Execution.Input.job_id',
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
          },
          Next: 'ExtractAndSummariseMap',
        },
        ExtractAndSummariseMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          Parameters: {
            'app_name.$': '$.app_name',
            'job_id.$': '$.job_id',
            'key.$': '$$.Map.Item.Value',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractContent',
            States: {
              ExtractContent: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: extractContentLambda.arn,
                  Payload: {
                    'input_key.$': '$.key',
                    'output_key.$': `States.Format('{}${extractedSuffix}', $.key)`,
                    input_bucket: props.outputsBucket.bucket,
                  },
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
                ResultSelector: {
                  'output_key.$': '$.Payload.output_key',
                },
                ResultPath: '$.extracted',
                Next: 'SummariseDocument',
              },
              SummariseDocument: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: summariseDocumentLambda.arn,
                  Payload: {
                    'app_name.$': '$.app_name',
                    'job_id.$': '$.job_id',
                    'input_key.$': '$.extracted.output_key',
                    'output_key.$': `States.Format('{}${summarisedSuffix}', $.key)`,
                  },
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
                ResultSelector: {
                  'output_key.$': '$.Payload.output_key',
                },
                ResultPath: '$.summarised',
                End: true,
              },
            },
          },
          ResultPath: '$.mapped',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'AggregateResults',
        },
        AggregateResults: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: aggregatorLambda.arn,
            Payload: {
              'app_name.$': '$.app_name',
              'job_id.$': '$.job_id',
              'input_keys.$': '$.mapped[*].summarised.output_key',
              key_suffix: summarisedSuffix,
              'output_key.$': `States.Format('${appId}/{}/aggregated.md', $$.Execution.Input.job_id)`,
            },
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
          ResultSelector: {
            'output_key.$': '$.Payload.output_key',
          },
          ResultPath: '$.aggregated',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'WriteSuccessStatus',
        },
        WriteFailureStatus: writeStatus(
          {
            status: 'FAILURE',
            'message.$': "States.Format('{}: {}', $.CatcherOutput.Error, $.CatcherOutput.Cause)",
          },
          'Failure',
        ),
        WriteSuccessStatus: writeStatus(
          {
            status: 'SUCCESS',
            'result.$': '$.aggregated',
          },
          'Success',
        ),
        Success: {
          Type: 'Succeed',
        },
        Failure: {
          Type: 'Fail',
        },
      },
    };

    this.addStepFunction(this, 'main', {
      appName: appId,
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [extractContentLambda.arn, summariseDocumentLambda.arn, aggregatorLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, summariseDocumentLambda.role, aggregatorLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
    });
  }
}
