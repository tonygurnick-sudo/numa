import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { Construct } from 'constructs';

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

    const func = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: 'cognito-callback-setter-' + props.userPoolClientId,
        role: role.arn,
        environment: {
          variables: {
            Q_BUSINESS_REGION: props.region,
          },
        },
        runtime: 'nodejs22.x',
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
        // This causes the lambda to trigger on config changes.
        input,
      },
      dependsOn: [func.lambdaFunction, ...policyAttachments],
    });
  }
}

export interface SetCallbackUrlProps {
  userPoolClientId: string;
  userPoolId: string;
  callbackAddress: string;
  region: string;
}
