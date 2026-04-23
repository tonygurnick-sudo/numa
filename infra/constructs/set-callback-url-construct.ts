import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

export class SetCallbackUrl extends Construct {
  constructor(scope: Construct, name: string, props: SetCallbackUrlProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const policyAttachments = [
      new IamRolePolicyAttachment(this, 'role-policy-attachment-basic', {
        role: role.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'role-policy-attachment-cognito', {
        role: role.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonCognitoPowerUser', // FIXME: Replace this.
      }),
    ];

    const callbackPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'callback-renamer');
    const callbackFilename = path.resolve(callbackPath, 'lambda_function.zip');

    // BASELINE callback URLs are re-asserted on every write by the Lambda.
    // This makes it structurally impossible for one integration (e.g. Q
    // Business) to knock another (e.g. the Numa frontend for SSO login)
    // offline by calling this construct. See callback-renamer/index.ts.
    const baselineCallbackUrls = (props.baselineCallbackUrls ?? []).join(',');

    const oldFunc = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: 'cognito-callback-setter-' + props.userPoolClientId,
        role: role.arn,
        environment: {
          variables: {
            Q_BUSINESS_REGION: props.region,
            BASELINE_CALLBACK_URLS: baselineCallbackUrls,
          },
        },
      },
      path: callbackPath,
    });
    oldFunc.lambdaFunction.moveTo('callback_function');

    const func = new LambdaFunction(this, 'callback-function', {
      functionName: 'cognito-callback-setter-' + props.userPoolClientId,
      role: role.arn,
      environment: {
        variables: {
          Q_BUSINESS_REGION: props.region,
          BASELINE_CALLBACK_URLS: baselineCallbackUrls,
        },
      },
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: callbackFilename,
      sourceCodeHash: Fn.filebase64sha256(callbackFilename),
    });
    func.addMoveTarget('callback_function');

    const input = JSON.stringify({
      userPoolClientId: props.userPoolClientId,
      userPoolId: props.userPoolId,
      callbackAddress: props.callbackAddress,
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.functionName,
      input,
      triggers: {
        // Re-invoke when ANY of these change: the input payload (client id,
        // callback address), the baseline URL list (so a new baseline is
        // asserted into live Cognito without manual intervention), or the
        // Lambda source itself (so behaviour fixes land on the next deploy).
        // Without the last two, a `make deploy` that fixes merge logic or
        // baseline URLs would ship updated code but never re-run it against
        // the live User Pool Client — the broken state would persist.
        input,
        baselineCallbackUrls,
        sourceCodeHash: func.sourceCodeHash,
      },
      dependsOn: [func, ...policyAttachments],
    });
  }
}

export interface SetCallbackUrlProps {
  userPoolClientId: string;
  userPoolId: string;
  /** The new URL to add to the client's CallbackURLs list (e.g. a Q Business
   *  WebExperience callback). Appended, never replaces. */
  callbackAddress: string;
  region: string;
  /** URLs that the Lambda re-asserts on every write, so they can never be
   *  dropped by any caller. Pass the Numa frontend URL(s) here. */
  baselineCallbackUrls?: string[];
}
