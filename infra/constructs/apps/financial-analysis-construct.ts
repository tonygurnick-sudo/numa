import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
} from './base-numa-app-construct';

const description = `Create financial analysis of one or multiple documents`;

export class FinancialAnalysis extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'financial-analysis', enableJobs: true });

    this.manifest = {
      appName: 'Financial Analysis',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.FINANCE,
      createdDate: '2025-01-31',
      appDescription: description,
      tags: ['finance', 'data-extraction', 'reports', 'financial-insights'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload documents',
          description: 'Upload the documents you would like analysed',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'call-step-function',
          title: 'Process Documents',
          type: HTTP_REQUEST_TASK,
          endpoint: 'financial-analysis',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
            },
          },
          order: 2,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const extractFinancialDataLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
    ];
    const extractFinancialDataLambda = this.addLambdaFunction(this, 'extract-financial-data', {
      additionalPolicyStatements: extractFinancialDataLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/financial-analysis-data-extraction',
      timeout: 900,
    });

    const financialAnalysisLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
    ];
    const financialAnalysisLambda = this.addLambdaFunction(this, 'analyse', {
      additionalPolicyStatements: financialAnalysisLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/financial-analysis-analysis',
      timeout: 900,
    });

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
          Next: 'ExtractAndAnalyseMap',
        },
        ExtractAndAnalyseMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          Parameters: {
            'job_id.$': '$.job_id',
            'key.$': '$$.Map.Item.Value.s3_key',
            'key_parts.$': `States.StringSplit($$.Map.Item.Value.s3_key, '/')`,
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
                  'output_key.$': `States.Format('${this.appId}/{}/extracted/{}.json',  $.job_id, States.ArrayGetItem($.key_parts[-1:], 0))`,
                  input_bucket: props.outputsBucket.bucket,
                },
                'ExtractFinancialData',
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.extracted',
                },
              ),
              ExtractFinancialData: this.addLambdaTask(
                extractFinancialDataLambda.arn,
                {
                  app_id: this.appId,
                  'job_id.$': '$.job_id',
                  'input_key.$': '$.extracted.output_key',
                  'output_key.$': `States.Format('${this.appId}/{}/structured/{}.json',  $.job_id, States.ArrayGetItem($.key_parts[-1:], 0))`,
                },
                null,
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.structured',
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
          Next: 'AnalyseResults',
        },
        AnalyseResults: this.addLambdaTask(
          financialAnalysisLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'inputs.$': '$.mapped',
            'output_prefix.$': `States.Format('${this.appId}/{}', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, extractFinancialDataLambda.arn, financialAnalysisLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, extractFinancialDataLambda.role, financialAnalysisLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
