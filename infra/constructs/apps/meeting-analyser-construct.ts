import * as asl from 'asl-types';
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
  TEXT_OUTPUT_TASK,
} from './base-numa-app-construct';

const description = `Transform raw meeting data into comprehensive summaries,
insightful analyses, and actionable outputs. Whether your meetings are in
person, virtual, or a blend of both, this app helps you make the most out of
your meeting notes and transcripts by providing structured, automated reports
and follow-up resources.`.replace('\n', ' ');

export class MeetingAnalyser extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    props.enableJobs = true;
    props.pathPrefix ??= 'meeting-analyser';
    super(scope, name, props);

    this.manifest = {
      appName: 'Meeting Analyser',
      id: props.pathPrefix,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-31',
      appDescription: description,
      tasks: [
        {
          id: 'upload-files-to-s3',
          title: 'Upload Files',
          description: 'Upload your notes or transcripts from your meeting',
          type: S3_UPLOAD_TASK,
          required: true,
          order: 1,
        },
        {
          id: 'template-task',
          description: 'The structure you would like your meeting summary to follow',
          title: 'Template',
          type: TEXT_INPUT_TASK,
          default: `
              - summarise the discussion
              - summarise the event
              - outline the requirements
              - actions and next steps
          `,
          order: 2,
        },
        {
          id: 'other-notes',
          title: 'Other Notes',
          description:
            'Any other notes that might be useful such as participants (if not in transcript), prior meeting context, etc',
          type: TEXT_INPUT_TASK,
          order: 3,
        },
        {
          id: 'call-step-function',
          title: 'Process Meeting Notes',
          type: HTTP_REQUEST_TASK,
          endpoint: 'meeting-analyser',
          params: {
            payload: {
              uploaded_files: '@upload-files-to-s3',
              template: '@template-task',
              other_notes: '@other-notes',
            },
          },
          order: 4,
        },
        {
          id: 'analysis-templated',
          title: 'Analysis based on template',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/template_output',
          },
          order: 5,
        },
        {
          id: 'summary',
          title: 'Summary',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/summary',
          },
          order: 6,
        },
        {
          id: 'topic-analysis',
          title: 'Topic Analysis',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/topic_analysis',
          },
          order: 7,
        },
        {
          id: 'participant-insights',
          title: 'Participant Insights',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/participant_insights',
          },
          order: 8,
        },
        {
          id: 'action-items',
          title: 'Action Items',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/action_items',
          },
          order: 9,
        },
        {
          id: 'follow-up-emails',
          title: 'Follow Up Emails',
          type: TEXT_OUTPUT_TASK,
          params: {
            dataRef: '@call-step-function/follow_up_emails',
          },
          order: 10,
        },
      ],
    };

    const extractContentLambdaPolicyStatements = [
      {
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/${props.pathPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
      {
        actions: ['textract:GetDocumentTextDetection', 'textract:StartDocumentTextDetection'],
        resources: ['*'],
      },
    ];
    const extractContentLambda = this.addLambdaFunction(this, 'extract', {
      additionalPolicyStatements: extractContentLambdaPolicyStatements,
      lambdaDirectory: 'python/extract-content-from-file',
      timeout: 900,
    });

    const analyserLambdaPolicyStatements = [
      {
        actions: ['s3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}/${name}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*'],
      },
    ];
    const analyserLambda = this.addLambdaFunction(this, 'analyse', {
      additionalPolicyStatements: analyserLambdaPolicyStatements,
      environment: {
        variables: {
          BUCKET: props.outputsBucket.bucket,
        },
      },
      lambdaDirectory: 'python/meeting-analyser',
      timeout: 900,
    });

    function writeStatus(body: Record<string, string | Record<string, string>>, next: string): asl.State {
      return {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
        Parameters: {
          Body: body,
          Bucket: props.outputsBucket.bucket,
          'Key.$': "States.Format('{}/{}/status.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)",
        },
        ResultPath: null,
        Next: next,
      };
    }

    const stepFunctionDefinition = {
      StartAt: 'WriteProcessingStatus',
      States: {
        WriteProcessingStatus: writeStatus({ status: 'PROCESSING' }, 'Initialize'),
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'app_name.$': '$$.Execution.Input.app_name',
            'job_id.$': '$$.Execution.Input.job_id',
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
          },
          Next: 'ExtractContentMap',
        },
        ExtractContentMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          ItemProcessor: {
            ProcessorConfig: {
              Mode: 'INLINE',
            },
            StartAt: 'ExtractContent',
            States: {
              ExtractContent: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: extractContentLambda.arn,
                  Payload: {
                    input_bucket: props.outputsBucket.bucket,
                    'input_key.$': '$',
                    return_content: true, // if content sizes exceed 256 KiB the step function needs to change to do content merging and saving in a separate lambda
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
                End: true,
              },
            },
          },
          ResultPath: '$.extracted',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'MergeAndStore',
        },
        MergeAndStore: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
          Parameters: {
            Bucket: props.outputsBucket.bucket,
            'Key.$':
              "States.Format('{}/{}/extracted_content.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)",
            'Body.$': '$.extracted[*].Payload.content',
            ContentType: 'text/json',
          },
          ResultPath: '$.s3UploadResult',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
          Next: 'Analyse',
        },
        Analyse: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: analyserLambda.arn,
            Payload: {
              'app_name.$': '$.app_name',
              'job_id.$': '$.job_id',
              'meeting_notes_and_or_transcript.$': '$.extracted[*].Payload.content',
              'other_notes.$': '$$.Execution.Input.other_notes',
              'output_key.$':
                "States.Format('{}/{}/analysis.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)",
              'template.$': '$$.Execution.Input.template',
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
            result: {
              output_bucket: props.outputsBucket.bucket,
              'output_key.$':
                "States.Format('{}/{}/analysis.json', $$.Execution.Input.app_name, $$.Execution.Input.job_id)",
            },
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
      appName: name,
      outputsBucket: props.outputsBucket,
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [extractContentLambda.arn, analyserLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [extractContentLambda.role, analyserLambda.role],
        },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
    });
  }
}
