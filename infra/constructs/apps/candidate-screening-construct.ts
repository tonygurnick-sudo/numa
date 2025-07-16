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

const description = `Screen candidates by extracting resume content and matching them against company profile and job requirements.`;
// TODO: Add cover letter functionality in the future

export class CandidateScreening extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    super(scope, name, { ...props, appId: 'candidate-screening', enableJobs: true });

    this.manifest = {
      appName: 'Candidate Screening',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-31',
      appDescription: description,
      tags: ['recruitment', 'hr', 'resume-analysis', 'job-matching'],
      tasks: [
        {
          id: 'upload-candidate-documents',
          title: 'Upload Candidate Documents',
          description: 'Upload candidate resumes (each file will be treated as a separate candidate)',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
          parameters: {
            minFiles: 1,
            userMessage: 'Please upload atleast 1 candidate resume. Each resume will be analyzed separately.',
          },
        },
        {
          id: 'company-profile',
          title: 'Company Profile',
          description: 'Enter details about your company',
          type: TEXT_INPUT_TASK,
          required: true,
          order: 2,
        },
        {
          id: 'job-requirements',
          title: 'Job Requirements',
          description: 'Enter the requirements for this position',
          type: TEXT_INPUT_TASK,
          required: true,
          order: 3,
        },
        {
          id: 'call-step-function',
          title: 'Process Candidates',
          type: HTTP_REQUEST_TASK,
          endpoint: 'candidate-screening',
          params: {
            payload: {
              candidate_documents: '@upload-candidate-documents',
              company_profile: '@company-profile',
              job_requirements: '@job-requirements',
            },
          },
          order: 4,
        },
      ],
    };

    const extractContentLambda = this.addExtractContentLambda();

    const candidateScreeningLambdaPolicyStatements = [
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
    const candidateScreeningLambda = this.addLambdaFunction(this, 'screen', {
      additionalPolicyStatements: candidateScreeningLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/candidate-screening',
      timeout: 900,
    });

    const aggregatorLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['s3:ListBucket'],
        effect: 'Allow',
        resources: [props.outputsBucket.arn],
      },
    ];
    const aggregatorLambda = this.addLambdaFunction(this, 'aggregate', {
      additionalPolicyStatements: aggregatorLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
      },
      lambdaDirectory: 'python/aggregate-candidate-results',
      timeout: 900,
    });

    // TODO: The step function currently includes cover letter handling logic, but this feature is not yet exposed in the UI.
    // For now, each uploaded document is treated as a separate candidate resume.
    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: this.writeProcessingStatus(),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'job_id.$': '$[0].job_id',
            'user_id.$': '$[0].user_id',
            'candidate_documents.$': '$[0].candidate_documents',
            'company_profile.$': '$[0].company_profile',
            'job_requirements.$': '$[0].job_requirements',
            'app_id.$': '$[0].app_id',
          },
          Next: 'LoopThroughCandidates',
        },
        LoopThroughCandidates: {
          Type: 'Map',
          ItemsPath: '$.candidate_documents',
          Parameters: {
            // Cover letter functionality is preserved in the backend but not currently used
            'resume_key.$': '$$.Map.Item.Value.s3_key',
            'company_profile.$': '$.company_profile',
            'job_requirements.$': '$.job_requirements',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'app_id.$': '$.app_id',
          },
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractResumeContent',
            States: {
              ExtractResumeContent: this.addLambdaTask(
                extractContentLambda.arn,
                {
                  input_bucket: props.outputsBucket.bucket,
                  'input_key.$': '$.resume_key',
                  'user_id.$': '$.user_id',
                  output_bucket: props.outputsBucket.bucket,
                  'output_key.$':
                    "States.Format('{}/{}/{}/extracted/{}.extracted.json', $.app_id, $.user_id, $.job_id, $.resume_key)",
                },
                'NoCoverLetter',
                {
                  ResultSelector: {
                    'resume_extracted_key.$': '$.Payload.output_key',
                  },
                  ResultPath: '$.resumeExtractOutput',
                  Catch: [],
                },
              ),
              NoCoverLetter: {
                Type: 'Pass',
                Parameters: {
                  cover_letter_extracted_key: '',
                },
                ResultPath: '$.coverLetterExtractOutput',
                Next: 'CandidateScreeningAndMatching',
              },
              CandidateScreeningAndMatching: this.addLambdaTask(
                candidateScreeningLambda.arn,
                {
                  'resume_text_s3_key.$': '$.resumeExtractOutput.resume_extracted_key',
                  'cover_letter_text_s3_key.$': '$.coverLetterExtractOutput.cover_letter_extracted_key',
                  'company_profile.$': '$.company_profile',
                  'job_requirements.$': '$.job_requirements',
                  'resume_key.$': '$.resume_key',
                  cover_letter_key: '',
                  'app_id.$': '$.app_id',
                  'job_id.$': '$.job_id',
                  'user_id.$': '$.user_id',
                  'output_key.$':
                    "States.Format('{}/{}/{}/results/{}.json', $.app_id, $.user_id, $.job_id, $.resume_key)",
                },
                null,
                {
                  Catch: [],
                },
              ),
            },
          },
          ResultPath: '$.processedCandidates',
          Next: 'AggregateCandidateResults',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              ResultPath: '$.CatcherOutput',
              Next: 'WriteFailureStatus',
            },
          ],
        },
        AggregateCandidateResults: this.addLambdaTask(
          aggregatorLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
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
          resources: [extractContentLambda.arn, candidateScreeningLambda.arn, aggregatorLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, candidateScreeningLambda.role, aggregatorLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
