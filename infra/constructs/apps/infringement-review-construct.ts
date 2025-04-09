import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  DROPDOWN_TABLE_TASK,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
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
          description: 'Please provide details about the infringement and the applicant requesting the review.',
          type: DROPDOWN_TABLE_TASK,
          required: true,
          order: 2,
          params: {
            fields: [
              {
                id: 'applicant_type',
                label: 'Type of applicant',
                type: 'dropdown' as const,
                options: [
                  'Person named on the infringement',
                  'Other person with consent',
                  'Authorised company representative',
                ],
                required: true,
              },
              {
                id: 'full_name',
                label: 'Full Name',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'corporate_name',
                label: 'Corporate Name and ACN (if applicable)',
                type: 'text' as const,
                required: false,
              },
              {
                id: 'contact_method',
                label: 'Preferred method of contact (outcome will be sent here)',
                type: 'dropdown' as const,
                options: ['Mail', 'Email'],
                required: true,
              },
              {
                id: 'street_address',
                label: 'Street address',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'city',
                label: 'City',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'state',
                label: 'State',
                type: 'dropdown' as const,
                options: ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'],
                required: true,
              },
              {
                id: 'postcode',
                label: 'Postcode',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'email',
                label: 'Email Address',
                type: 'text' as const,
                required: false,
              },
              {
                id: 'phone',
                label: 'Phone Number',
                type: 'text' as const,
                required: false,
              },
              {
                id: 'infringement_number',
                label: 'Infringement Notice Number',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'registration_number',
                label: 'Vehicle Registration/Animal Number',
                type: 'text' as const,
                required: true,
              },
              {
                id: 'grounds',
                label: 'Grounds for application',
                type: 'dropdown' as const,
                options: [
                  'Person unaware: you did not know about the fine',
                  'Contrary to law: the fine is invalid or was improperly issued to you',
                  'Mistake of identity: the fine was issued to the wrong person',
                  'Exceptional circumstances: the offence occurred due to an extraordinary or unavoidable situation',
                  'Special circumstances: you have serious personal issues, conditions or difficulties',
                ],
                required: true,
              },
              {
                id: 'explanation',
                label: 'Explanation of circumstances and ground(s) in support of application',
                type: 'text' as const,
                required: true,
              },
            ],
          },
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
