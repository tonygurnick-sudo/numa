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

const description = `Assess RFP (Request for Proposal) submissions against procurement criteria`;

export class ProcurementRfpAssessment extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'procurement-rfp-assessment', enableJobs: true });

    this.manifest = {
      appName: 'Procurement RFP Assessment',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-04-22',
      appDescription: description,
      tags: ['procurement', 'rfp', 'assessment', 'evaluation'],
      tasks: [
        {
          id: 'upload-application',
          title: 'Upload Application',
          description: 'Upload the RFP application document you want to assess',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 RFP application document.',
          },
        },
        {
          id: 'upload-rfp-reference',
          title: 'Upload RFP Reference File',
          description: 'Upload the RFP reference document containing criteria',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 2,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 RFP reference document with assessment criteria.',
          },
        },
        {
          id: 'assessment-instructions',
          title: 'Assessment Instructions',
          description: 'Additional instructions for the assessment (optional)',
          type: TEXT_INPUT_TASK,
          required: false,
          order: 3,
          parameters: {
            defaultValue: '',
            placeholder: 'Enter any specific instructions or context for this assessment...',
          },
        },
        {
          id: 'call-step-function',
          title: 'Process Documents',
          type: HTTP_REQUEST_TASK,
          endpoint: 'procurement-rfp-assessment',
          params: {
            payload: {
              application_file: '@upload-application',
              rfp_reference_file: '@upload-rfp-reference',
              assessment_instructions: '@assessment-instructions',
            },
          },
          order: 4,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const policyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        effect: 'Allow',
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
    ];

    const rfpAssessmentLambda = this.addLambdaFunction(this, 'assess', {
      additionalPolicyStatements: policyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/procurement-rfp-assessment',
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
            'input_key.$': '$.application_file[0].s3_key',
            'rfp_reference_key.$': '$.rfp_reference_file[0].s3_key',
            'assessment_instructions.$': '$.assessment_instructions',
          },
          Next: 'ExtractApplicationContent',
        },
        ExtractApplicationContent: this.addExtractContentTask(
          extractContentLambda,
          '$.input_key',
          'ExtractRfpReferenceContent',
        ),
        ExtractRfpReferenceContent: {
          Type: 'Task',
          Resource: extractContentLambda.arn,
          ResultPath: '$.rfp_reference_extracted',
          Parameters: {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_key.$': '$.rfp_reference_key',
            input_bucket: this.outputsBucket.bucket,
            'output_key.$': `States.Format('${this.appId}/{}/rfp_reference_extracted.json', $.job_id)`,
          },
          Next: 'RfpAssessment',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.error',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        RfpAssessment: this.addLambdaTask(
          rfpAssessmentLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_key.$': '$.extracted.output_key',
            'rfp_reference_key.$': '$.rfp_reference_extracted.output_key',
            'assessment_instructions.$': '$.assessment_instructions',
            'output_path.$': `States.Format('${this.appId}/{}', $$.Execution.Input.job_id)`,
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
          effect: 'Allow',
          resources: [extractContentLambda.arn, rfpAssessmentLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          effect: 'Allow',
          resources: [extractContentLambda.role, rfpAssessmentLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
