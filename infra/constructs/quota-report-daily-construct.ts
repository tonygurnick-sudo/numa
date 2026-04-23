import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface QuotaReportDailyConstructProps {
  /** ARN of the numa-client-config DynamoDB table */
  clientConfigTableArn: string;
  /** Name of the numa-client-config DynamoDB table */
  clientConfigTableName: string;
  /** HQ client account ID where the report CSV is uploaded */
  hqAccountId: string;
  /** HQ data bucket name (e.g. 'numa-hq-data') */
  hqDataBucket: string;
  /** S3 key prefix for reports (default: Ian's Customer Success KB Daily folder) */
  s3Prefix?: string;
  /** KB ID for metadata sidecar files */
  kbId?: string;
  /** Cron schedule expression (default: daily 18:00 UTC = 06:00 NZT) */
  scheduleExpression?: string;
  /** Max concurrency for cross-account quota fetches */
  concurrency?: number;
}

export class QuotaReportDailyConstruct extends Construct {
  public readonly functionArn: string;
  public readonly functionName: string;

  constructor(scope: Construct, id: string, props: QuotaReportDailyConstructProps) {
    super(scope, id);

    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});
    const functionName = 'numa-quota-report-daily';
    const s3Prefix = props.s3Prefix ?? 'documents/kb-b4ac6b7e-aad7-4fc1-af77-a1d7b83a97cb/Daily';
    const scheduleExpression = props.scheduleExpression ?? 'cron(0 18 * * ? *)';
    const concurrency = props.concurrency ?? 6;
    const writerRoleArn = `arn:aws:iam::${props.hqAccountId}:role/ArcanumAIAccess`;

    // ── CloudWatch Logs ──

    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/lambda/${functionName}`,
      retentionInDays: 30,
    });

    // ── Lambda Execution Role ──

    const execRole = new IamRole(this, 'execution-role', {
      name: `${functionName}-execution`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'assume-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const policy = new IamPolicy(this, 'execution-policy', {
      name: `${functionName}-policy`,
      policy: new DataAwsIamPolicyDocument(this, 'policy-doc', {
        statement: [
          {
            sid: 'CloudWatchLogs',
            effect: 'Allow',
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.arn, `${logGroup.arn}:*`],
          },
          {
            sid: 'ReadClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [props.clientConfigTableArn],
          },
          {
            sid: 'AssumeRoleIntoClientAccounts',
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            resources: ['arn:aws:iam::*:role/ArcanumAIAccess'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    // ── Lambda Function ──

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'numa-quota-report-daily',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'index.handler',
      runtime: 'nodejs22.x',
      memorySize: 512,
      timeout: 900,
      loggingConfig: {
        logGroup: logGroup.name,
        logFormat: 'Text',
      },
      environment: {
        variables: {
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
          QUOTA_WRITER_ROLE_ARN: writerRoleArn,
          HQ_DATA_BUCKET: props.hqDataBucket,
          S3_PREFIX: s3Prefix,
          CONCURRENCY: String(concurrency),
          ARCANUM_AI_ACCESS_ROLE_NAME: 'ArcanumAIAccess',
          KB_ID: props.kbId ?? 'b4ac6b7e-aad7-4fc1-af77-a1d7b83a97cb',
        },
      },
    });

    // ── EventBridge Scheduler (daily) ──

    const schedulerRole = new IamRole(this, 'scheduler-role', {
      name: `${functionName}-scheduler`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'scheduler-assume-role', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['scheduler.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const schedulerPolicy = new IamPolicy(this, 'scheduler-policy', {
      name: `${functionName}-scheduler-invoke`,
      policy: new DataAwsIamPolicyDocument(this, 'scheduler-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [fn.arn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'scheduler-role-policy-attachments', {
      roleName: schedulerRole.name,
      policyArns: [schedulerPolicy.arn],
    });

    new SchedulerSchedule(this, 'daily-schedule', {
      name: `${functionName}-daily`,
      groupName: 'default',
      scheduleExpression: scheduleExpression,
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: fn.arn,
        roleArn: schedulerRole.arn,
      },
    });

    new LambdaPermission(this, 'scheduler-invoke-permission', {
      statementId: 'AllowEventBridgeSchedulerInvoke',
      action: 'lambda:InvokeFunction',
      functionName: fn.functionName,
      principal: 'scheduler.amazonaws.com',
      sourceArn: `arn:aws:scheduler:us-east-1:${callerIdentity.accountId}:schedule/default/${functionName}-daily`,
    });

    // ── Outputs ──

    new TerraformOutput(this, 'function-arn', {
      value: fn.arn,
      description: 'ARN of the daily quota report Lambda',
    });

    new TerraformOutput(this, 'function-name', {
      value: fn.functionName,
      description: 'Name of the daily quota report Lambda',
    });

    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
  }
}
