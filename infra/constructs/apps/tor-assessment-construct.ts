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

const description = `Assessment of Terms of Reference (ToR) documents with detailed evaluation and suggested improvements`;

export class TorAssessment extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'tor-assessment', enableJobs: true });

    this.manifest = {
      appName: 'ToR Assessment',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-16',
      appDescription: description,
      tags: ['tor', 'assessment', 'terms-of-reference'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload ToR Document',
          description: 'Upload the Terms of Reference document you want to assess',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 Terms of Reference document.',
          },
        },
        {
          id: 'call-step-function',
          title: 'Process ToR Assessment',
          type: HTTP_REQUEST_TASK,
          endpoint: 'tor-assessment',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
            },
          },
          order: 2,
        },
      ],
      typicalDurationMinutes: 3,
    };

    const extractContentLambda = this.addExtractContentLambda();

    const assessTorLambdaPolicyStatements = [
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
    ];
    const assessTorLambda = this.addLambdaFunction(this, 'assess', {
      additionalPolicyStatements: assessTorLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/tor-assessment',
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
            'user_id.$': '$$.Execution.Input.user_id',
            'tor_document_key.$': '$$.Execution.Input.uploaded_files[0].s3_key',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.tor_document_key', 'TorAssessment'),
        TorAssessment: this.addLambdaTask(
          assessTorLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'input_key.$': '$.extracted.output_key',
            'assessment_output_key.$': `States.Format('${this.appId}/{}/{}/assessment.md', $.user_id, $.job_id)`,
            'suggestions_output_key.$': `States.Format('${this.appId}/{}/{}/suggestions.md', $.user_id, $.job_id)`,
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
          effect: 'Allow',
          resources: [extractContentLambda.arn, assessTorLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          effect: 'Allow',
          resources: [extractContentLambda.role, assessTorLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
