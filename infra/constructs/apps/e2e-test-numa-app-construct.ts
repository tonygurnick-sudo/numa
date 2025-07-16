import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  TEXT_INPUT_TASK,
} from './base-numa-app-construct';

const description = `A simple test app that completes after 30 seconds to test polling and job creation`;

export class E2ETestNumaApp extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'e2e-test', enableJobs: true });

    this.manifest = {
      appName: 'E2E Test App',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-03-26',
      appDescription: description,
      tasks: [
        {
          id: 'test-job-id',
          title: 'Test Job ID',
          description: 'Enter a job ID to run the test',
          required: true,
          type: TEXT_INPUT_TASK,
          order: 1,
        },
        {
          id: 'run-test',
          title: 'Run E2E Test',
          description: 'Start a test job that will complete after 30 seconds',
          type: HTTP_REQUEST_TASK,
          endpoint: 'e2e-test',
          params: {
            payload: {},
          },
          order: 2,
        },
      ],
    };

    const e2eTestLambda = this.addLambdaFunction(this, 'test', {
      lambdaDirectory: 'python/e2e-test',
      timeout: 60, // 60 seconds timeout to ensure the 30-second delay can complete
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
          },
          Next: 'Test',
        },
        Test: this.addLambdaTask(
          e2eTestLambda.arn,
          {
            'job_id.$': '$.job_id',
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
          resources: [e2eTestLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [e2eTestLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
