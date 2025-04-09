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
    super(scope, name, { ...props, appId: 'document-summariser', enableJobs: true });

    this.manifest = {
      appName: 'Document Summariser',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-31',
      appDescription: description,
      tags: ['document', 'summary', 'text-extraction', 'content-analysis'],
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
            },
          },
          order: 2,
        },
        {
          id: 'summaries',
          title: 'Summaries',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/content',
          },
          order: 3,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const summariseDocumentLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
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
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
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

    const extractedSuffix = '.extracted.json';
    const summarisedSuffix = '.summarised.txt';
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.job_id',
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
          },
          Next: 'ExtractAndSummariseMap',
        },
        ExtractAndSummariseMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          Parameters: {
            'job_id.$': '$.job_id',
            'key.$': '$$.Map.Item.Value.s3_key',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractContent',
            States: {
              ExtractContent: this.addLambdaTask(
                extractContentLambda.arn,
                {
                  'input_key.$': '$.key',
                  'output_key.$': `States.Format('{}${extractedSuffix}', $.key)`,
                  input_bucket: props.outputsBucket.bucket,
                },
                'SummariseDocument',
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.extracted',
                },
              ),
              SummariseDocument: this.addLambdaTask(
                summariseDocumentLambda.arn,
                {
                  app_id: this.appId,
                  'job_id.$': '$.job_id',
                  'input_key.$': '$.extracted.output_key',
                  'output_key.$': `States.Format('{}${summarisedSuffix}', $.key)`,
                },
                null,
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.summarised',
                },
              ),
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
        AggregateResults: this.addLambdaTask(
          aggregatorLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_keys.$': '$.mapped[*].summarised.output_key',
            key_suffix: summarisedSuffix,
            'output_key.$': `States.Format('${this.appId}/{}/aggregated.md', $$.Execution.Input.job_id)`,
          },
          'WriteSuccessStatus',
          {
            OutputPath: '$.Payload',
          },
        ),
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: {
          Type: 'Succeed',
        },
        Failure: {
          Type: 'Fail',
        },
      },
    };

    this.addStepFunction(this, 'main', {
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
      urlPath: 'main',
    });
  }
}
