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

const description = 'Compare and contrast multiple RFP response documents using a Comparative Assessment Framework';

export class RfpResponseComparison extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, {
      ...props,
      appId: 'rfp-response-comparison',
      enableJobs: true,
    });

    this.manifest = {
      appName: 'RFP Response Comparison',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-04-22',
      appDescription: description,
      tags: ['rfp', 'comparison', 'evaluation', 'document-analysis'],
      tasks: [
        {
          id: 'upload-responses',
          title: 'Upload RFP Responses',
          description: 'Upload the RFP response documents',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: { minFiles: 2, maxFiles: 3, userMessage: 'Please upload at least 2 RFP response documents' },
        },
        {
          id: 'upload-framework',
          title: 'Upload Assessment Framework',
          description: 'Upload the Comparative Assessment Guide File',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 2,
          parameters: { minFiles: 1, maxFiles: 1, userMessage: 'Please upload your Comparative Assessment Framework' },
        },
        {
          id: 'compare-responses',
          title: 'Compare Responses',
          type: HTTP_REQUEST_TASK,
          endpoint: 'rfp-response-comparison',
          params: {
            payload: {
              responses: '@upload-responses',
              framework: '@upload-framework',
            },
          },
          order: 3,
        },
      ],
      typicalDurationMinutes: 3,
    };

    // Use shared extract-content Lambda provided at core level
    const compareLambda = this.addLambdaFunction(this, 'compare', {
      additionalPolicyStatements: [
        {
          actions: ['s3:GetObject', 's3:PutObject'],
          effect: 'Allow',
          resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
        },
        {
          actions: ['bedrock:InvokeModel'],
          effect: 'Allow',
          resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
        },
      ],
      environment: { BUCKET: props.outputsBucket.bucket },
      lambdaDirectory: 'python/rfp-response-comparison',
      timeout: 900,
    });

    const stepDef = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        // (optional) map/extract each file …
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
            'responses.$': '$$.Execution.Input.responses',
            'framework.$': '$$.Execution.Input.framework',
            'language.$': '$$.Execution.Input.language',
          },
          Next: 'ExtractResponses',
        },
        // Map state: extract each response in parallel
        ExtractResponses: {
          Type: 'Map',
          ItemsPath: '$.responses',
          ResultPath: '$.extracted',
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'Extract',
            States: {
              Extract: this.addLambdaTask(
                props.sharedExtractContentLambdaArn!,
                {
                  input_bucket: props.outputsBucket.bucket,
                  'input_key.$': '$.s3_key',
                  output_bucket: props.outputsBucket.bucket,
                  // output_key will default to input_key + '.json' if not specified
                  return_content: false,
                },
                null,
                { Catch: [] }
              ),
            },
          },
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'PrepareComparison',
        },
        PrepareComparison: {
          Type: 'Pass',
          Parameters: {
            'extracted_keys.$': '$.extracted[*].Payload.output_key',
            'responses.$': '$$.Execution.Input.responses',
            'framework.$': '$.framework[0].s3_key',
            'job_id.$': '$.job_id',
            'output_path.$': `States.Format('${this.appId}/{}/{}/comparison', $$.Execution.Input.user_id, $$.Execution.Input.job_id)`,
            app_id: this.appId,
            'language.$': '$.language',
          },
          Next: 'ExtractAndCompare',
        },
        ExtractAndCompare: this.addLambdaTask(
          compareLambda.arn,
          {
            'responses.$': '$.responses',
            'extracted_keys.$': '$.extracted_keys',
            'framework.$': '$.framework',
            'job_id.$': '$.job_id',
            'output_path.$': '$.output_path',
            app_id: this.appId,
            'language.$': '$.language',
          },
          'WriteSuccessStatus',
          { OutputPath: '$.Payload' }
        ),
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: { Type: 'Succeed' },
        Failure: { Type: 'Fail' },
      },
    };

    this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        { actions: ['lambda:InvokeFunction'], resources: [props.sharedExtractContentLambdaArn!, compareLambda.arn] },
      ],
      stepFunctionDefinition: JSON.stringify(stepDef),
      urlPath: 'main',
    });
  }
}
