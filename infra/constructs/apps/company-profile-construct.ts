import * as asl from 'asl-types';
import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  TEXT_INPUT_TASK,
  TEXT_OUTPUT_TASK,
} from './base-numa-app-construct';

const description = `Generate a structured company profile from information and documents`;

export class CompanyProfile extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'company-profile', enableJobs: true });

    this.manifest = {
      appName: 'Company Profile',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-02-26',
      appDescription: description,
      tasks: [
        {
          id: 'company-details',
          title: 'Company Details',
          description: 'Enter basic information about the company',
          type: TEXT_INPUT_TASK,
          order: 1,
        },
        {
          id: 'company-about',
          title: 'About the Company',
          description: 'Enter a description of the company',
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'upload-supporting-docs',
          title: 'Upload Supporting Documents',
          description: 'Upload any additional documents about the company (optional)',
          type: TEXT_INPUT_TASK,
          order: 3,
        },
        {
          id: 'call-profile-generator',
          title: 'Generate Profile',
          type: HTTP_REQUEST_TASK,
          endpoint: 'company-profile',
          params: {
            payload: {
              app_name: this.appId,
              details: '@company-details',
              about: '@company-about',
              documentation_text: '@upload-supporting-docs',
            },
          },
          order: 4,
        },
        {
          id: 'profile-output',
          title: 'Company Profile',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-profile-generator/output_key',
          },
          order: 5,
        },
      ],
    };

    const companyProfileLambdaPolicyStatements = [
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

    const companyProfileLambda = this.addLambdaFunction(this, 'profile', {
      additionalPolicyStatements: companyProfileLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
          APP_ID: this.appId,
        },
      },
      lambdaDirectory: 'python/company-profile',
      timeout: 900,
    });

    const writeStatus = (body: Record<string, string | Record<string, string>>, next: string): asl.State => {
      return {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        Parameters: {
          Body: body,
          Bucket: props.outputsBucket.bucket,
          'Key.$': `States.Format('${this.appId}/{}/status.json', $$.Execution.Input.job_id)`,
        },
        ResultPath: null,
        Next: next,
      };
    };

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: writeStatus({ status: 'PROCESSING' }, 'Initialize'),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.job_id',
            'details.$': '$$.Execution.Input.details',
            'about.$': '$$.Execution.Input.about',
            'documentation_text.$': '$$.Execution.Input.documentation_text',
          },
          Next: 'GenerateProfile',
        },
        GenerateProfile: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: companyProfileLambda.arn,
            Payload: {
              app_name: this.appId,
              'job_id.$': '$.job_id',
              'details.$': '$.details',
              'about.$': '$.about',
              'documentation_text.$': '$.documentation_text',
            },
          },
          Retry: [
            {
              BackoffRate: 2,
              ErrorEquals: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException',
              ],
              IntervalSeconds: 1,
              JitterStrategy: 'FULL',
              MaxAttempts: 3,
            },
          ],
          ResultSelector: {
            'output_key.$': '$.Payload.output_key',
          },
          OutputPath: '$.Payload',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'WriteSuccessStatus',
        },
        WriteFailureStatus: writeStatus(
          {
            status: 'FAILURE',
            'message.$': "States.Format('{}: {}', $.CatcherOutput.Error, $.CatcherOutput.Cause)",
          },
          'Failure',
        ),
        WriteSuccessStatus: writeStatus(
          {
            status: 'SUCCESS',
            'result.$': '$',
          },
          'Success',
        ),
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
          resources: [companyProfileLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [companyProfileLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
