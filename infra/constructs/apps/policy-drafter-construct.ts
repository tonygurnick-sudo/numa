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
      tags: ['compliance', 'policy', 'regulations', 'documentation'],
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
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 example policy.',
          },
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
      typicalDurationMinutes: 3,
    };

    // Use shared extract-content Lambda provided at core level

    const policyDrafterLambdaPolicyStatements = [
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
    const policyDrafterLambda = this.addLambdaFunction(this, 'draft', {
      additionalPolicyStatements: policyDrafterLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
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
            'additional_instructions.$': '$$.Execution.Input.additional_instructions',
            'example_policy_key.$': '$$.Execution.Input.uploaded_files[0].s3_key',
            'job_id.$': '$$.Execution.Input.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
            'legislation_content.$': '$$.Execution.Input.legislation_content',
            'policy_context.$': '$$.Execution.Input.policy_context',
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
        ExtractContent: this.addExtractContentTaskWithArn(
          props.sharedExtractContentLambdaArn!,
          '$.example_policy_key',
          'PolicyDrafter',
        ),
        PolicyDrafter: this.addLambdaTask(
          policyDrafterLambda.arn,
          {
            'additional_instructions.$': '$.additional_instructions',
            'extracted_example_policy_key.$': '$.extracted.output_key',
            'job_id.$': '$.job_id',
            'legislation_content.$': '$.legislation_content',
            'output_path.$': `States.Format('${this.appId}/{}/{}', $.user_id, $.job_id)`,
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
          resources: [props.sharedExtractContentLambdaArn!, policyDrafterLambda.arn],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
