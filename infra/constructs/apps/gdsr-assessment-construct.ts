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

const description = `Application assessment based on the Game Development Sector Rebate (GDSR) framework`;

export class GdsrAssessment extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'gdsr-assessment', enableJobs: true });

    this.manifest = {
      appName: 'GDSR Assessment',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-04-17',
      appDescription: description,
      tags: ['gdsr', 'assessment', 'rebate', 'funding'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload Application',
          description: 'Upload the GDSR application document you want to assess',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 GDSR application document.',
          },
        },
        {
          id: 'call-step-function',
          title: 'Process Application',
          type: HTTP_REQUEST_TASK,
          endpoint: 'gdsr-assessment',
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

    const assessGdsrLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        effect: 'Allow',
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const assessGdsrLambda = this.addLambdaFunction(this, 'assess', {
      additionalPolicyStatements: assessGdsrLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/gdsr-assessment',
      timeout: 900,
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$.job_id',
            'application_key.$': '$.uploaded_files[0].s3_key',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.application_key', 'GdsrAssessment'),
        GdsrAssessment: this.addLambdaTask(
          assessGdsrLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_key.$': '$.extracted.output_key',
            'output_key.$': `States.Format('${this.appId}/{}/assessment.md', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, assessGdsrLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          effect: 'Allow',
          resources: [extractContentLambda.role, assessGdsrLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
