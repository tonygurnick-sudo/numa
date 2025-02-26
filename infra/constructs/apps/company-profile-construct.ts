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
  }
}
