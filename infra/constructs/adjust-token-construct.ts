import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

export class AdjustToken extends Construct {
  readonly function;
  constructor(scope: Construct, name: string, props: AdjustTokenProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    new IamRolePolicyAttachment(this, 'role-policy-attachment', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    // Grant DynamoDB read for session/MFA settings, plus Cognito permissions
    // for MFA enforcement (DescribeUserPool to check pool config, AdminGetUser
    // to check individual user MFA status).
    if (props.mfaSettingsTableName) {
      const sessionPolicy = new DataAwsIamPolicyDocument(this, 'session-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['dynamodb:GetItem'],
            resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
          },
          {
            effect: 'Allow',
            actions: ['cognito-idp:AdminGetUser', 'cognito-idp:DescribeUserPool'],
            // We cannot use the exact pool ID here because the pool depends on
            // this Lambda (circular — the pool references our ARN in lambdaConfig).
            // Each client account has only one user pool, so scoping to all pools
            // in the account is effectively the same as scoping to the exact pool.
            resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
          },
        ],
      });
      new IamRolePolicy(this, 'session-policy', {
        role: role.name,
        policy: sessionPolicy.json,
      });
    }

    const adjusterPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'token-adjuster');
    const adjusterFilename = path.resolve(adjusterPath, 'lambda_function.zip');

    const oldFunction = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        runtime: 'nodejs22.x',
        functionName: 'token-adjuster-' + props.nameSuffix,
        role: role.arn,
      },
      path: adjusterPath,
    });
    oldFunction.lambdaFunction.moveTo('adjust_function');
    this.function = new LambdaFunction(this, 'adjuster-function', {
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      functionName: 'token-adjuster-' + props.nameSuffix,
      sourceCodeHash: Fn.filebase64sha256(adjusterFilename),
      role: role.arn,
      filename: adjusterFilename,
      environment: {
        variables: {
          ...(props.mfaSettingsTableName ? { MFA_SETTINGS_TABLE_NAME: props.mfaSettingsTableName } : {}),
        },
      },
    });
    this.function.addMoveTarget('adjust_function');
  }
}

export interface AdjustTokenProps {
  nameSuffix: string;
  /** MFA settings table name — used for server-side session duration enforcement. */
  mfaSettingsTableName?: string;
}
