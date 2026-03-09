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

    // Grant read access to the MFA settings table for session duration enforcement
    if (props.mfaSettingsTableName) {
      const sessionPolicy = new DataAwsIamPolicyDocument(this, 'session-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['dynamodb:GetItem'],
            resources: [`arn:aws:dynamodb:*:*:table/${props.mfaSettingsTableName}`],
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
