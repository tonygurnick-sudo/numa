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

const description =
  'Create and manage organizational policies with AI assistance. This tool helps draft, review, and format policies while ensuring compliance with industry standards and regulations.';

export class PolicyDrafter extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'policy-drafter', enableJobs: true });

    this.manifest = {
      appName: 'Policy Drafter',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.COMPLIANCE,
      createdDate: '2025-03-10',
      appDescription: description,
      tasks: [
        {
          id: 'policy-context',
          title: 'Policy Context',
          description:
            'Provide a brief description of your policy’s purpose, scope, and any relevant background information. Include details such as the industry or organization it applies to, key stakeholders, and specific goals or concerns. This context will help tailor the policy to your needs.',
          type: TEXT_INPUT_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'upload-example-policy',
          title: 'Example policy',
          description: 'Upload an example policy to guide the policy generation',
          type: S3_UPLOAD_TASK,
          order: 2,
        },
        {
          id: 'legislation-content',
          title: 'Legislation Content',
          description: 'Provide relevant legislation content or leave empty',
          default: '',
          type: TEXT_INPUT_TASK,
          order: 3,
        },
        {
          id: 'additional-instructions',
          title: 'Additional Instructions',
          description: 'Provide any additional instructions to guide the policy generation',
          default: '',
          type: TEXT_INPUT_TASK,
          order: 4,
        },
        {
          id: 'call-step-function',
          title: 'Generate Policy',
          type: HTTP_REQUEST_TASK,
          endpoint: 'policy-drafter',
          params: {
            payload: {
              additional_instructions: '@additional-instructions',
              legislation_content: '@legislation-content',
              policy_context: '@policy-context',
              uploaded_files: '@upload-example-policy',
            },
          },
          order: 5,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const policyDrafterLambdaPolicyStatements = [
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
    const policyDrafterLambda = this.addLambdaFunction(this, 'draft', {
      additionalPolicyStatements: policyDrafterLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/policy-drafter',
      timeout: 900,
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'additional_instructions.$': '$.additional_instructions',
            'example_policy_key.$': '$.uploaded_files[0]',
            'job_id.$': '$.job_id',
            'legislation_content.$': '$.legislation_content',
            'policy_context.$': '$.policy_context',
          },
          Next: 'CheckForExamplePolicy',
        },
        CheckForExamplePolicy: {
          Type: 'Choice',
          Choices: [
            {
              IsNull: true,
              Next: 'SetEmptyExamplePolicyKey',
              Variable: '$.example_policy_key',
            },
          ],
          Default: 'ExtractContent',
        },
        SetEmptyExamplePolicyKey: {
          Type: 'Pass',
          Result: {
            output_key: null,
          },
          ResultPath: '$.extracted',
          Next: 'PolicyDrafter',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.example_policy_key', 'PolicyDrafter'),
        PolicyDrafter: this.addLambdaTask(
          policyDrafterLambda.arn,
          {
            'additional_instructions.$': '$.additional_instructions',
            'extracted_example_policy_key.$': '$.extracted.output_key',
            'job_id.$': '$.job_id',
            'legislation_content.$': '$.legislation_content',
            'output_path.$': `States.Format('${this.appId}/{}', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, policyDrafterLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, policyDrafterLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
