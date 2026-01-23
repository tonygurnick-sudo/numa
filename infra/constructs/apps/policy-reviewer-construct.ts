import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  NumaAppManifest,
  S3_UPLOAD_TASK,
  TEXT_INPUT_TASK,
} from './base-numa-app-construct';

const description = 'Management of policies and legislation compliance.';

export class PolicyReviewer extends BaseNumaApp {
  readonly manifest: NumaAppManifest;

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
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload policy',
          type: S3_UPLOAD_TASK,
          order: 1,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 policy.',
          },
        },
        {
          id: 'policy-context',
          title: 'Policy Context',
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'legislation-content',
          title: 'Legislation Content',
          type: TEXT_INPUT_TASK,
          order: 3,
        },
      ],
      typicalDurationMinutes: 3,
    };

    // Use shared extract-content Lambda provided at core level

    const policyReviewerLambdaPolicyStatements = [
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
    const policyReviewerLambda = this.addLambdaFunction(this, 'review', {
      additionalPolicyStatements: policyReviewerLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/policy-reviewer',
      timeout: 900,
    });

    // Enable jobs API - setupJobs() is called in the constructor when enableJobs is true
    // This creates the jobs endpoints using the same pattern as policy-builder

    // Define step function
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.original_job_id',
            'user_id.$': '$$.Execution.Input.user_id',
            'policy_key.$': '$$.Execution.Input.uploaded_files[0].s3_key',
            'legislation_content.$': '$$.Execution.Input.legislation_content',
            'policy_context.$': '$$.Execution.Input.policy_context',
            app_id: this.appId,
            'output_path.$': `States.Format('${this.appId}/{}/{}', $$.Execution.Input.user_id, $$.Execution.Input.original_job_id)`,
            'language.$': '$$.Execution.Input.language',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTaskWithArn(
          props.sharedExtractContentLambdaArn!,
          '$.policy_key',
          'PolicyReviewer',
        ),
        PolicyReviewer: this.addLambdaTask(
          policyReviewerLambda.arn,
          {
            'input_key.$': '$.extracted.output_key',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'legislation_content.$': '$.legislation_content',
            'policy_context.$': '$.policy_context',
            app_id: this.appId,
            'output_path.$': `States.Format('${this.appId}/{}/{}', $.user_id, $.job_id)`,
            'language.$': '$.language',
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
          resources: [props.sharedExtractContentLambdaArn!, policyReviewerLambda.arn],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
