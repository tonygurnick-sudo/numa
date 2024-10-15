import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';

export class SetCallbackUrl extends Construct {
  constructor(scope: Construct, name: string, props: SetCallbackUrlProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        'arn:aws:iam::aws:policy/AmazonCognitoPowerUser', // FIXME: Replace this.
      ],
    });

    const func = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: 'cognito-callback-setter-' + props.userPoolClientId,
        role: role.arn,
      },
      path: 'constructs/callback-renamer/',
    });

    const input = JSON.stringify({
      userPoolClientId: props.userPoolClientId,
      userPoolId: props.userPoolId,
      callbackAddress: props.callbackAddress,
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.lambdaFunction.functionName,
      input,
      triggers: {
        // This is to cause it to trigger every time.
        // We should consider whether this is neccessary.
        now: `${Date.now()}`,
      },
    });
  }
}

export interface SetCallbackUrlProps {
  userPoolClientId: string;
  userPoolId: string;
  callbackAddress: string;
}
