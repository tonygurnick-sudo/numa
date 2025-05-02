import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  S3_UPLOAD_TASK,
} from './base-numa-app-construct';

const description = `Analyze council references and applications for resource consents`;

export class CouncilResourceConsents extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'council-resource-consents', enableJobs: true });

    this.manifest = {
      appName: 'Council Resource Consents',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.LEGAL,
      createdDate: '2025-04-28',
      appDescription: description,
      tags: ['council', 'resource-consent', 'application', 'legal'],
      tasks: [
        {
          id: 'upload-council-references',
          title: 'Council References',
          description: 'Upload council reference documents (maximum 5)',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            maxFiles: 5,
            userMessage: 'Please upload up to 5 council reference documents',
          },
        },
        {
          id: 'upload-application',
          title: 'Application',
          description: 'Upload the application document',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 2,
          parameters: {
            maxFiles: 1,
            userMessage: 'Please upload a single application document',
          },
        },
        {
          id: 'call-step-function',
          title: 'Process Documents',
          type: HTTP_REQUEST_TASK,
          endpoint: 'council-resource-consents',
          params: {
            payload: {
              council_references: '@upload-council-references',
              application: '@upload-application',
            },
          },
          order: 3,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const analyzeDocumentsLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`, props.outputsBucket.arn],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const analyzeDocumentsLambda = this.addLambdaFunction(this, 'analyze', {
      additionalPolicyStatements: analyzeDocumentsLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/council-resource-consents',
      timeout: 900,
    });

    const extractedSuffix = '.extracted.json';
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$$.Execution.Input.job_id',
            'council_references.$': '$$.Execution.Input.council_references',
            'application.$': '$$.Execution.Input.application',
          },
          Next: 'ExtractCouncilReferencesMap',
        },
        ExtractCouncilReferencesMap: {
          Type: 'Map',
          ItemsPath: '$.council_references',
          Parameters: {
            'job_id.$': '$.job_id',
            'key.$': '$$.Map.Item.Value.s3_key',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractCouncilReferenceContent',
            States: {
              ExtractCouncilReferenceContent: this.addLambdaTask(
                extractContentLambda.arn,
                {
                  'input_key.$': '$.key',
                  'output_key.$': `States.Format('{}${extractedSuffix}', $.key)`,
                  input_bucket: props.outputsBucket.bucket,
                },
                null,
                {
                  Catch: [],
                  ResultSelector: {
                    'output_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.extracted',
                },
              ),
            },
          },
          ResultPath: '$.council_references_extracted',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'ExtractApplicationContent',
        },
        ExtractApplicationContent: this.addLambdaTask(
          extractContentLambda.arn,
          {
            'input_key.$': '$.application[0].s3_key',
            'output_key.$': `States.Format('{}${extractedSuffix}', $.application[0].s3_key)`,
            input_bucket: props.outputsBucket.bucket,
          },
          'AnalyzeDocuments',
          {
            Catch: [],
            ResultSelector: {
              'output_key.$': '$.Payload.output_key',
            },
            ResultPath: '$.application_extracted',
          },
        ),
        AnalyzeDocuments: this.addLambdaTask(
          analyzeDocumentsLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'council_references_extracted.$': '$.council_references_extracted[*].extracted.output_key',
            'application_extracted.$': '$.application_extracted.output_key',
            'output_key.$': `States.Format('${this.appId}/{}/analysis.md', $$.Execution.Input.job_id)`,
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
          resources: [extractContentLambda.arn, analyzeDocumentsLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, analyzeDocumentsLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
