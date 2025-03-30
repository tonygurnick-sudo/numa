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

const description = 'Review a policy';

export class PolicyReviewer extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'policy-reviewer', enableJobs: true });

    this.manifest = {
      appName: 'Policy Reviewer',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.COMPLIANCE,
      createdDate: '2025-02-31',
      appDescription: description,
      tags: ['compliance', 'policy-review', 'legal-analysis', 'governance'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload policy',
          description: 'Upload the policy you would like reviewed',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'policy-context',
          title: 'Policy Context',
          description:
            'Provide a brief description of your policy’s purpose, scope, and any relevant background information. Include details such as the industry or organization it applies to, key stakeholders, and specific goals or concerns. This context will help tailor the review to your needs.',
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'legislation-content',
          title: 'Legislation Content',
          description: 'Provide relevant legislation content or leave empty',
          type: TEXT_INPUT_TASK,
          order: 3,
        },
        {
          id: 'call-step-function',
          title: 'Review Policy',
          type: HTTP_REQUEST_TASK,
          endpoint: 'policy-reviewer',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              legislation_content: '@legislation-content',
              policy_context: '@policy-context',
            },
          },
          order: 4,
        },
        {
          id: 'initial-analysis',
          title: 'Initial Analysis',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/initial_analysis',
          },
          order: 5,
        },
        {
          id: 'policy-review',
          title: 'Review',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/policy_review',
          },
          order: 6,
        },
        {
          id: 'recommended-updates',
          title: 'Recommended Updates',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/recommended_updates',
          },
          order: 7,
        },
        {
          id: 'updated-policy',
          title: 'Updated Policy',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/updated_policy',
          },
          order: 8,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const policyReviewerLambdaPolicyStatements = [
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
    const policyReviewerLambda = this.addLambdaFunction(this, 'review', {
      additionalPolicyStatements: policyReviewerLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/policy-reviewer',
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
            'policy_key.$': '$.uploaded_files[0]',
            'legislation_content.$': '$.legislation_content',
            'policy_context.$': '$.policy_context',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.policy_key', 'PolicyReviewer'),
        PolicyReviewer: this.addLambdaTask(
          policyReviewerLambda.arn,
          {
            'input_key.$': '$.extracted.output_key',
            'job_id.$': '$.job_id',
            'legislation_content.$': '$.legislation_content',
            'policy_context.$': '$.policy_context',
            app_id: this.appId,
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
          resources: [extractContentLambda.arn, policyReviewerLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, policyReviewerLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
