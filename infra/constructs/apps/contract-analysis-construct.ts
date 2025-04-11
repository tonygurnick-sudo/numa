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

const description = 'Analyze contracts for clauses, risks, and improvement opportunities';

export class ContractAnalysis extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'contract-analysis', enableJobs: true });

    this.manifest = {
      appName: 'Contract Analysis',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.LEGAL,
      createdDate: '2025-03-11',
      appDescription: description,
      tags: ['legal', 'contract', 'risk-assessment', 'document-analysis'],
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload Contract',
          description: 'Upload the contract document you want to analyze (PDF, DOCX, etc.)',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            minFiles: 1,
            maxFiles: 1,
            userMessage: 'Please upload 1 contract.',
          },
        },
        {
          id: 'contract-context',
          title: 'Contract Context',
          description: 'Provide any relevant details about this contract that might help with the analysis (optional)',
          type: TEXT_INPUT_TASK,
          order: 2,
        },
        {
          id: 'call-step-function',
          title: 'Analyze Contract',
          type: HTTP_REQUEST_TASK,
          endpoint: 'contract-analysis',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              contract_context: '@contract-context',
            },
          },
          order: 3,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const contractAnalysisLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        effect: 'Allow',
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const contractAnalysisLambda = this.addLambdaFunction(this, 'analyze', {
      additionalPolicyStatements: contractAnalysisLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/contract-analysis',
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
            'contract_key.$': '$.uploaded_files[0].s3_key',
            'contract_context.$': '$.contract_context',
          },
          Next: 'ExtractContent',
        },
        ExtractContent: this.addExtractContentTask(extractContentLambda, '$.contract_key', 'ContractAnalyzer'),
        ContractAnalyzer: this.addLambdaTask(
          contractAnalysisLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'input_key.$': '$.extracted.output_key',
            'contract_context.$': '$.contract_context',
            'output_key.$': `States.Format('${this.appId}/{}/contract-analysis.json', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, contractAnalysisLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          effect: 'Allow',
          resources: [extractContentLambda.role, contractAnalysisLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
