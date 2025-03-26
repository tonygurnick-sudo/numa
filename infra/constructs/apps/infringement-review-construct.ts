import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
  TEXT_INPUT_TASK,
} from './base-numa-app-construct';

const description = 'Review parking infringement evidence and provide recommendations';

export class InfringementReview extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'infringement-review', enableJobs: true });

    this.manifest = {
      appName: 'Infringement Review',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.LEGAL,
      createdDate: '2025-03-19',
      appDescription: description,
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload Evidence',
          description: 'Upload the evidence file you would like reviewed',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'infringement-details',
          title: 'Infringement Details',
          description:
            'Provide details about the infringement including ticket number, issue date, issue time, location, and reason for the infringement.',
          type: TEXT_INPUT_TASK,
          required: true,
          order: 2,
        },
        {
          id: 'call-step-function',
          title: 'Review Infringement',
          type: HTTP_REQUEST_TASK,
          endpoint: 'infringement-review',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              infringement_details: '@infringement-details',
            },
          },
          order: 3,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const infringementReviewLambdaPolicyStatements = [
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
    const infringementReviewLambda = this.addLambdaFunction(this, 'review', {
      additionalPolicyStatements: infringementReviewLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/infringement-review',
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
            'evidence_key.$': '$.uploaded_files[0]',
            'infringement_details.$': '$.infringement_details',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.evidence_key', 'InfringementReview'),
        InfringementReview: this.addLambdaTask(
          infringementReviewLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_key.$': '$.extracted.output_key',
            'infringement_details.$': '$.infringement_details',
            'output_key.$': `States.Format('${this.appId}/{}/infringement-review.json', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, infringementReviewLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, infringementReviewLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
