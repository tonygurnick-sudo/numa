import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface VoiceConfigWriterConstructProps {
  /** ARN of the numa-client-config DynamoDB table (for IAM Scan/UpdateItem). */
  clientConfigTableArn: string;
  /** Name of the numa-client-config DynamoDB table (passed as env var). */
  clientConfigTableName: string;
}

/**
 * Numa Voice config write-back infrastructure (deployer account, FEAT-169).
 *
 * Creates the `numa-voice-config-writer` Lambda — the deployer-side half of the
 * STS-proof relay that lets a client-account `{client}_voice-admin` Lambda persist
 * its Connect/Voice values (recordingsBucket, didNumbers, connectInstanceUrl) back
 * into the central `numa-client-config` table WITHOUT granting client accounts any
 * direct access to the table. Identical security shape to numa-email-sender: the
 * cross-account invoke permission is wildcard, with STS-proof validation performed
 * inside the handler, and the clientName written is derived server-side from the
 * validated caller account (never from the request body).
 */
export class VoiceConfigWriterConstruct extends Construct {
  public readonly functionArn: string;
  public readonly functionName: string;

  constructor(scope: Construct, id: string, props: VoiceConfigWriterConstructProps) {
    super(scope, id);

    const functionName = 'numa-voice-config-writer';

    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/lambda/${functionName}`,
      retentionInDays: 30,
    });

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
            // GetItem authorizes the caller account against the target client's
            // clientAccountId; UpdateItem writes the scoped nested config fields.
            sid: 'WriteClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
            resources: [props.clientConfigTableArn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'numa-voice-config-writer',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      memorySize: 256,
      timeout: 30,
      loggingConfig: {
        logGroup: logGroup.name,
        logFormat: 'Text',
      },
      environment: {
        variables: {
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
        },
      },
    });

    // Cross-account invocation: wildcard principal, STS validation in handler code
    // (mirrors numa-email-sender's cross-account-invocation permission).
    new LambdaPermission(this, 'cross-account-invocation', {
      statementId: 'AllowClientAccountInvocation',
      action: 'lambda:InvokeFunction',
      functionName: fn.functionName,
      principal: '*',
    });

    new TerraformOutput(this, 'function-arn', {
      value: fn.arn,
      description: 'ARN of the Numa Voice config write-back Lambda',
    });

    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
  }
}
