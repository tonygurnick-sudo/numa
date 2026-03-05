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
      tags: ['business', 'company-info', 'organization', 'profile-generation'],
      tasks: [
        {
          id: 'company-about',
          title: 'About the Company',
          description: 'Enter a description of the company',
          required: true,
          type: TEXT_INPUT_TASK,
          order: 1,
        },
        {
          id: 'contact-information',
          title: 'Company Contact Information',
          description: "Enter company's contact information",
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'upload-supporting-docs',
          title: 'Upload Supporting Documents',
          description: 'Upload any additional documents about the company',
          type: S3_UPLOAD_TASK,
          order: 3,
        },
        {
          id: 'call-profile-generator',
          title: 'Generate Profile',
          type: HTTP_REQUEST_TASK,
          endpoint: 'company-profile',
          params: {
            payload: {
              about: '@company-about',
              contact_information: '@contact-information',
              uploaded_files: '@upload-supporting-docs',
            },
          },
          order: 4,
        },
      ],
      typicalDurationMinutes: 1,
    };

    // Use shared extract-content Lambda provided at core level

    const companyProfileLambdaPolicyStatements = [
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

    const companyProfileLambda = this.addLambdaFunction(this, 'profile', {
      additionalPolicyStatements: companyProfileLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/company-profile',
      timeout: 900,
    });

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'about.$': '$$.Execution.Input.about',
            'contact_information.$': '$$.Execution.Input.contact_information',
            'job_id.$': '$$.Execution.Input.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
            'language.$': '$$.Execution.Input.language',
          },
          Next: 'ExtractMap',
        },
        ExtractMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          Parameters: {
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'key.$': '$$.Map.Item.Value.s3_key',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractContent',
            States: {
              ExtractContent: this.addLambdaTask(
                props.sharedExtractContentLambdaArn!,
                {
                  'input_key.$': '$.key',
                  'user_id.$': '$.user_id',
                  'output_key.$': `States.Format('{}.extracted', $.key)`,
                  app_id: this.appId,
                  input_bucket: props.outputsBucket.bucket,
                },
                null,
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.extracted',
                }
              ),
            },
          },
          ResultPath: '$.mapped',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'GenerateProfile',
        },
        GenerateProfile: this.addLambdaTask(
          companyProfileLambda.arn,
          {
            'about.$': '$.about',
            'contact_information.$': '$.contact_information',
            'input_keys.$': '$.mapped[*].extracted.output_key',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'output_key.$': `States.Format('${this.appId}/{}/{}/profile.json', $.user_id, $.job_id)`,
            app_id: this.appId,
            'language.$': '$.language',
          },
          'WriteSuccessStatus',
          {
            OutputPath: '$.Payload',
          }
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
          resources: [props.sharedExtractContentLambdaArn!, companyProfileLambda.arn],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
