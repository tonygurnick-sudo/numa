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
  TEXT_OUTPUT_TASK,
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
          id: 'upload-evidence',
          title: 'Upload Customer Evidence',
          description: 'Upload all relevant evidence files (documents, photographs, PDFs, etc.)',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            allowedFileTypes: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.txt'],
            maximumFileSize: 10, // 10MB max
          },
        },
        {
          id: 'infringement-details',
          title: 'Infringement Details',
          description: 'Provide details about the infringement including ticket number, date, location, and reason',
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
              uploaded_files: '@upload-evidence',
              infringement_details: '@infringement-details',
            },
          },
          order: 3,
        },
        {
          id: 'evidence-analysis',
          title: 'Evidence Analysis',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/evidence_analysis',
          },
          order: 4,
        },
        {
          id: 'legislation-comparison',
          title: 'Legislation Comparison',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/legislation_comparison',
          },
          order: 5,
        },
        {
          id: 'decision-determination',
          title: 'Decision & Rationale',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/decision_determination',
          },
          order: 6,
        },
        {
          id: 'response-letter',
          title: 'Response Letter',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/response_letter',
          },
          order: 7,
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
            'evidence_keys.$': '$.uploaded_files',
            'infringement_details.$': '$.infringement_details',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: {
          Type: 'Map',
          ItemsPath: '$.evidence_keys',
          Parameters: {
            'input_key.$': '$$.Map.Item.Value',
            'output_key.$': `States.Format('${this.appId}/{}/extracted_$.json', $$.Execution.Input.job_id)`,
            input_bucket: this.outputsBucket.bucket,
          },
          Iterator: {
            StartAt: 'ExtractFile',
            States: {
              ExtractFile: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: extractContentLambda.arn,
                  Payload: {
                    'input_key.$': '$.input_key',
                    'output_key.$': '$.output_key',
                    input_bucket: this.outputsBucket.bucket,
                  },
                },
                End: true,
              },
            },
          },
          ResultPath: '$.extracted_files',
          Next: 'InfringementReview',
        },
        InfringementReview: this.addLambdaTask(
          infringementReviewLambda.arn,
          {
            app_id: this.appId,
            'input_keys.$': '$.evidence_keys',
            'infringement_details.$': '$.infringement_details',
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
