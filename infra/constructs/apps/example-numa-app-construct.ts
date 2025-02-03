import * as asl from 'asl-types';
import { Construct } from 'constructs';
import { AppCategory, AppStatus, AppType, BaseNumaApp, BaseNumaAppProps } from './base-numa-app-construct';

export class ExampleNumaApp extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: ExampleNumaAppProps) {
    props.pathPrefix ??= 'example';
    props.enableJobs = true;
    super(scope, name, props);

    this.manifest = {
      appName: 'Example',
      appDescription: 'Example app',
      id: props.pathPrefix,
      status: AppStatus.ACTIVE,
      category: AppCategory.GENERAL,
      type: AppType.NUMA,
      createdDate: '2024-01-01',
      tasks: [],
    };

    // Add a lambda that responds to a POST at ${prefix}/a
    this.addLambdaFunction(this, 'post-lambda-example', {
      route: {
        verb: 'POST',
        path: 'a',
      },
      lambdaDirectory: 'python/example-1',
    });

    // Add a lambda that responds to a GET at ${prefix}/b
    this.addLambdaFunction(this, 'get-lambda-example', {
      route: {
        verb: 'GET',
        path: 'b',
      },
      lambdaDirectory: 'python/example-2',
    });

    // Add a lambda that doesn't have a route, e.g. for use in a Step Function.
    const stepFunctionLambda = this.addLambdaFunction(this, 'non-routed-lambda-example', {
      lambdaDirectory: 'python/example-3',
      timeout: 900,
    });

    const stepFunctionDefinition: asl.StateMachine = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: {
          Type: 'Task',
          Next: 'RunLambda',
          Parameters: {
            Body: '{"status":"PROCESSING"}',
            Bucket: `${props.outputsBucket}`,
            'Key.$': `States.Format('{}/{}/status.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)`,
          },
          Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        },
        RunLambda: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: `${stepFunctionLambda.arn}`,
            Payload: {},
          },
          Next: 'WriteSuccessStatus',
        },
        WriteSuccessStatus: {
          Type: 'Task',
          Next: 'Success',
          Parameters: {
            Body: '{"status":"SUCCESS","result":{}}',
            Bucket: `${props.outputsBucket}`,
            'Key.$': `States.Format('{}/{}/status.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)`,
          },
          Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        },
        Success: {
          Type: 'Succeed',
        },
      },
    };

    this.addStepFunction(this, 'example-step-function', {
      appName: name,
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [stepFunctionLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [stepFunctionLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
    });
  }
}

export interface ExampleNumaAppProps extends BaseNumaAppProps {} // eslint-disable-line @typescript-eslint/no-empty-object-type
