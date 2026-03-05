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

const description = `Transform raw meeting data into comprehensive summaries,
insightful analyses, and actionable outputs. Whether your meetings are in
person, virtual, or a blend of both, this app helps you make the most out of
your meeting notes and transcripts by providing structured, automated reports
and follow-up resources.`.replace('\n', ' ');

export class MeetingAnalyser extends BaseNumaApp {
  readonly manifest;

  constructor(scope: Construct, name: string, props: BaseNumaAppProps) {
    props.enableJobs = true;
    super(scope, name, { ...props, appId: 'meeting-analyser' });

    this.manifest = {
      appName: 'Meeting Analyser',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-01-31',
      appDescription: description,
      tags: ['meeting', 'transcription', 'action-items', 'summary'],
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
      ],
      typicalDurationMinutes: 3,
    };

    // Use shared extract-content Lambda provided at core level

    const analyserLambdaPolicyStatements = [
      {
        actions: ['s3:PutObject'],
        effect: 'Allow',
        resources: [`${props.outputsBucket.arn}${this.s3KeyPrefix}/*`],
      },
      {
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      },
      ...(this.jobsTable
        ? [
            {
              actions: ['dynamodb:UpdateItem'],
              effect: 'Allow' as const,
              resources: [this.jobsTable.arn],
            },
          ]
        : []),
    ];
    const analyserLambda = this.addLambdaFunction(this, 'analyse', {
      additionalPolicyStatements: analyserLambdaPolicyStatements,
      environment: {
        BUCKET: props.outputsBucket.bucket,
        ...(this.jobsTable ? { DYNAMODB_TABLE: this.jobsTable.name } : {}),
      },
      lambdaDirectory: 'python/meeting-analyser',
      timeout: 900,
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
            'uploaded_files.$': '$$.Execution.Input.uploaded_files',
            'language.$': '$$.Execution.Input.language',
          },
          Next: 'ExtractContentMap',
        },
        ExtractContentMap: {
          Type: 'Map',
          ItemsPath: '$.uploaded_files',
          Parameters: {
            'item.$': '$$.Map.Item.Value',
            'user_id.$': '$.user_id',
            'job_id.$': '$.job_id',
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
                  'input_key.$': '$.item.s3_key',
                  'user_id.$': '$.user_id',
                  'job_id.$': '$.job_id',
                  app_id: this.appId,
                  input_bucket: props.outputsBucket.bucket,
                  return_content: true, // if content sizes exceed 256 KiB the step function needs to change to do content merging and saving in a separate lambda
                  stream_events: true,
                  ...(this.jobsTable ? { table_name: this.jobsTable.name } : {}),
                },
                null,
                {
                  Catch: [],
                }
              ),
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
            'Key.$': `States.Format('${this.appId}/{}/{}/extracted_content.json', $$.Execution.Input.user_id, $$.Execution.Input.job_id)`,
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
        Analyse: this.addLambdaTask(
          analyserLambda.arn,
          {
            app_id: this.appId,
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            'meeting_notes_and_or_transcript.$': '$.extracted[*].Payload.content',
            'other_notes.$': '$$.Execution.Input.other_notes',
            'output_path.$': `States.Format('${this.appId}/{}/{}', $$.Execution.Input.user_id, $$.Execution.Input.job_id)`,
            'template.$': '$$.Execution.Input.template',
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
        { actions: ['lambda:InvokeFunction'], resources: [props.sharedExtractContentLambdaArn!, analyserLambda.arn] },
      ],
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
    });
  }
}
