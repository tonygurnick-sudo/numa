import { Construct } from 'constructs';
import {
  AppCategory,
  AppStatus,
  AppType,
  BaseNumaApp,
  BaseNumaAppProps,
  HTTP_REQUEST_TASK,
  TEXT_INPUT_TASK,
  AdditionalLambdaParameters,
} from './base-numa-app-construct';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import * as asl from 'asl-types';
import { SesEmailConfig } from '../ses-email-construct';

const description = 'Analyse application error logs to identify patterns and issues';

// Constants
const ERROR_LOG_BUCKET = 'apical-log-data';
const ERROR_LOG_PREFIX = 'error-logs/';

export interface BeyondExpectationsAppProps extends BaseNumaAppProps {
  scheduleExpression?: string;
}

export class BeyondExpectations extends BaseNumaApp {
  readonly manifest;
  private scheduleExpression: string;

  /**
   * Helper: Lambda task without the global Catch (for nested Map usage)
   */
  private createLambdaTaskNoCatch(): (
    lambdaArn: string,
    payload: Record<string, string | boolean>,
    next: string | null,
    extra?: AdditionalLambdaParameters,
  ) => asl.State {
    return (lambdaArn, payload, next, extra = {}) =>
      this.addLambdaTask(lambdaArn, payload, next, { ...extra, Catch: [] });
  }

  constructor(scope: Construct, name: string, props: BeyondExpectationsAppProps) {
    super(scope, name, { ...props, appId: 'beyond-expectations', enableJobs: true });

    // Create the helper function
    const addLambdaTaskNoCatch = this.createLambdaTaskNoCatch();

    // Extract email configuration from props with fallback defaults
    const senderEmail = props.senderEmail && props.senderEmail.trim() !== '' ? props.senderEmail : '';
    const receiverEmails = props.receiverEmails && props.receiverEmails.length > 0 ? props.receiverEmails : [''];

    // Create SES configuration with all email addresses (sender + all receivers) if they are not empty
    const validEmails = [senderEmail, ...receiverEmails].filter((email) => email.trim() !== '');
    const sesConfig =
      validEmails.length > 0
        ? new SesEmailConfig(this, 'ses-config', {
            emailAddresses: validEmails,
            resourceNamePrefix: this.appId,
            configurationSetName: `${props.clientName}-${this.appId}-config-set`,
          })
        : null;

    // Default schedule is 9 am NZ time (not factored for daylight saving)
    this.scheduleExpression = props.scheduleExpression || 'cron(0 20 * * ? *)';

    /**
     * Manifest
     */
    this.manifest = {
      appName: 'Beyond Expectations',
      id: this.appId,
      type: AppType.NUMA,
      status: AppStatus.ACTIVE,
      category: AppCategory.PRODUCTIVITY,
      createdDate: '2025-05-12',
      appDescription: description,
      tags: ['error-analysis', 'monitoring', 'diagnostics', 'reporting'],
      tasks: [
        {
          id: 'time-window',
          title: 'Analysis Time Window',
          type: TEXT_INPUT_TASK,
          description: 'Time window for the analysis (e.g., 24h, 7d)',
          default: '24h',
          required: true,

          order: 1,
        },
        {
          id: 'call-log-analyser',
          title: 'Analyse Logs',
          type: HTTP_REQUEST_TASK,
          required: true,
          endpoint: 'beyond-expectations/main',
          params: {
            payload: {
              timeWindow: '@time-window',
            },
          },
          order: 2,
        },
      ],
    };

    /**
     * IAM policy
     */
    const commonPolicyStatements = [
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

    // Additional policy for format-error-logs Lambda to read from apical-log-data bucket
    const errorLogsPolicyStatements = [
      ...commonPolicyStatements,
      {
        actions: ['s3:GetObject', 's3:ListBucket'],
        effect: 'Allow',
        resources: [`arn:aws:s3:::${ERROR_LOG_BUCKET}`, `arn:aws:s3:::${ERROR_LOG_BUCKET}/*`],
      },
    ];

    const bedrockPolicyStatement = {
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      effect: 'Allow',
    };

    // Create SES policy statement only if we have valid email configuration
    const sesPolicyStatements = sesConfig
      ? [
          {
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: [
              // Include email identity ARNs
              ...sesConfig.emailIdentities.map((identity) => identity.arn),
              // Include the configuration set ARN with dynamic region
              `arn:aws:ses:${this.region}:*:configuration-set/${sesConfig.configurationSet.name}`,
            ],
            effect: 'Allow',
          },
        ]
      : [];

    /**
     * Lambdas
     */
    const formatErrorLogsLambda = this.addLambdaFunction(this, 'format-error-logs', {
      additionalPolicyStatements: errorLogsPolicyStatements,
      environment: { BUCKET: props.outputsBucket.bucket },
      lambdaDirectory: 'python/beyond-expectations-format-error-logs',
      memorySize: 1024,
      timeout: 900,
    });

    const analyseLogsLambda = this.addLambdaFunction(this, 'analyse-logs', {
      additionalPolicyStatements: [...commonPolicyStatements, bedrockPolicyStatement],
      environment: {
        BUCKET: props.outputsBucket.bucket,
        CONFIG_PATH: 'beyond-expectations/user_config.json',
      },
      lambdaDirectory: 'python/beyond-expectations-analyse-logs',
      memorySize: 1024,
      timeout: 900,
    });

    const reportAndEmailLambda = this.addLambdaFunction(this, 'report-and-email', {
      additionalPolicyStatements: [...commonPolicyStatements, bedrockPolicyStatement, ...sesPolicyStatements],
      environment: {
        BUCKET: props.outputsBucket.bucket,
        DEFAULT_SENDER_EMAIL: senderEmail,
        SES_CONFIGURATION_SET: sesConfig?.configurationSet.name || '',
      },
      lambdaDirectory: 'python/beyond-expectations-report-and-email',
      timeout: 900,
    });

    const sendEmailLambda = this.addLambdaFunction(this, 'send-email', {
      additionalPolicyStatements: [...commonPolicyStatements, ...sesPolicyStatements],
      environment: {
        BUCKET: props.outputsBucket.bucket,
        SES_CONFIGURATION_SET: sesConfig?.configurationSet.name || '',
      },
      lambdaDirectory: 'python/send-email',
      timeout: 900,
    });

    /**
     * Step‑Function definition
     */
    const stepFunctionDefinition: asl.StateMachine = {
      StartAt: 'WriteProcessingStatus',
      States: {
        // Write processing status to DynamoDB
        WriteProcessingStatus: this.writeProcessingStatus(),

        // Initialise context
        Initialize: {
          Type: 'Pass',
          Parameters: {
            'timeWindow.$': '$.timeWindow',
            notificationEmails: receiverEmails,
            'app_id.$': '$.app_id',
            'job_id.$': '$.job_id',
            'user_id.$': '$$.Execution.Input.user_id',
          },
          Next: 'FormatErrorLogs',
        },

        // Format raw logs into analysable chunks
        FormatErrorLogs: this.addLambdaTask(
          formatErrorLogsLambda.arn,
          {
            'timeWindow.$': '$.timeWindow',
            bucket: props.outputsBucket.bucket,
            errorBucket: ERROR_LOG_BUCKET,
            errorPrefix: ERROR_LOG_PREFIX,
            outputPrefix: 'beyond-expectations/logs_to_analyse/',
            chunkSize: 50,
            'app_id.$': '$.app_id',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
          },
          'PrepareChunksMap',
          { ResultPath: '$.formatResult' },
        ),

        // List generated chunks
        PrepareChunksMap: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:s3:listObjectsV2',
          Parameters: {
            Bucket: props.outputsBucket.bucket,
            'Prefix.$': '$.formatResult.Payload.chunkPrefix',
          },
          ResultPath: '$.listResult',
          Next: 'CheckForChunks',
        },

        // Decide whether there are any chunks
        CheckForChunks: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.listResult.KeyCount',
              NumericEquals: 0,
              Next: 'SkipAnalysis',
            },
          ],
          Default: 'ProcessMap',
        },

        // Nothing to analyse today
        SkipAnalysis: {
          Type: 'Pass',
          ResultPath: null,
          Next: 'GenerateReportAndEmail',
        },

        // Map → AnalyseLogChunk
        ProcessMap: {
          Type: 'Map',
          MaxConcurrency: 10,
          ItemsPath: '$.listResult.Contents',
          Parameters: {
            'job_id.$': '$.job_id',
            'app_id.$': '$.app_id',
            'user_id.$': '$.user_id',
            'chunkPath.$': '$$.Map.Item.Value.Key',
          },
          // @ts-expect-error - ItemProcessor is valid for Map states in AWS Step Function
          ItemProcessor: {
            ProcessorConfig: { Mode: 'INLINE' },
            StartAt: 'AnalyseLogChunk',
            States: {
              AnalyseLogChunk: addLambdaTaskNoCatch(
                analyseLogsLambda.arn,
                {
                  'chunkPath.$': '$.chunkPath',
                  'app_id.$': '$.app_id',
                  'job_id.$': '$.job_id',
                  'user_id.$': '$.user_id',
                } as Record<string, string | boolean>,
                null,
                { ResultPath: '$.analysisResult' },
              ),
            },
          },
          ResultPath: '$.chunkResults',
          Next: 'GenerateReportAndEmail',
          Catch: [
            {
              ErrorEquals: ['States.ALL'],
              Next: 'WriteFailureStatus',
              ResultPath: '$.CatcherOutput',
            },
          ],
        },

        // Collate results → Bedrock summary + SES email
        GenerateReportAndEmail: this.addLambdaTask(
          reportAndEmailLambda.arn,
          {
            'notificationEmails.$': '$.notificationEmails',
            'chunkPrefix.$': '$.formatResult.Payload.chunkPrefix',
            'app_id.$': '$.app_id',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
          },
          'SendEmail',
          { ResultPath: '$.reportResult' },
        ),

        // Send email
        SendEmail: this.addLambdaTask(
          sendEmailLambda.arn,
          {
            'email_data_s3_key.$': '$.reportResult.Payload.body.email_data_key',
            'app_id.$': '$.app_id',
            'job_id.$': '$.job_id',
            'user_id.$': '$.user_id',
            configuration_set: sesConfig?.configurationSet.name || '', // Explicitly pass the configuration set name
          },
          'WriteSuccessStatus',
          { ResultPath: '$.emailResult' },
        ),

        // Final status updates
        WriteFailureStatus: this.writeFailureStatus(),
        WriteSuccessStatus: this.writeSuccessStatus(),
        Success: { Type: 'Succeed' },
        Failure: { Type: 'Fail' },
      },
    };

    /**
     * Register the state‑machine
     */
    const stepFunction = this.addStepFunction(this, 'main', {
      outputsBucket: props.outputsBucket,
      stepFunctionDefinition: JSON.stringify(stepFunctionDefinition),
      urlPath: 'main',
      additionalPolicyStatements: [
        {
          actions: ['lambda:InvokeFunction'],
          resources: [formatErrorLogsLambda.arn, analyseLogsLambda.arn, reportAndEmailLambda.arn, sendEmailLambda.arn],
        },
        {
          actions: ['iam:PassRole'],
          resources: [
            formatErrorLogsLambda.role,
            analyseLogsLambda.role,
            reportAndEmailLambda.role,
            sendEmailLambda.role,
          ],
        },
        {
          actions: ['s3:ListBucket', 's3:ListObjects', 's3:ListObjectsV2'],
          resources: [props.outputsBucket.arn],
        },
      ],
    });

    /**
     * Daily EventBridge trigger
     */
    this.createScheduledEventRule(stepFunction);
  }

  /**
   * EventBridge scheduler helper
   */
  private createScheduledEventRule(stepFunction: SfnStateMachine): void {
    const eventBridgeRole = new IamRole(this, 'event-bridge-role', {
      name: this.getResourceName('_event_bridge_role'),
      assumeRolePolicy: createAssumptionPolicy({ Service: 'events.amazonaws.com' }),
    });

    const eventBridgePolicy = new IamPolicy(this, 'event-bridge-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'event-bridge-policy-document', {
        statement: [
          {
            actions: ['states:StartExecution'],
            resources: [stepFunction.arn],
            effect: 'Allow',
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachment(this, 'event-bridge-policy-attachment', {
      role: eventBridgeRole.name,
      policyArn: eventBridgePolicy.arn,
    });

    const rule = new CloudwatchEventRule(this, 'scheduled-rule', {
      name: this.getResourceName('_daily_execution'),
      description: 'Triggers Beyond Expectations analysis daily',
      scheduleExpression: this.scheduleExpression,
    });

    new CloudwatchEventTarget(this, 'step-function-target', {
      rule: rule.name,
      arn: stepFunction.arn,
      roleArn: eventBridgeRole.arn,

      inputTransformer: {
        // expose built-in fields from the scheduled event
        inputPaths: {
          evtId: '$.id', // unique EventBridge event id
          evtTime: '$.time', // ISO timestamp
        },
        inputTemplate: JSON.stringify({
          timeWindow: '24h',
          app_id: this.appId,
          job_id: '<evtTime>',
          user_id: 'numa', // Add user_id for scheduled executions
        }),
      },
    });
  }
}
