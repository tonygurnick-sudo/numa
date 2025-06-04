import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import * as path from 'node:path';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';

export class CognitoEmailHandler extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, name: string, props: CognitoEmailHandlerProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    new IamRolePolicyAttachment(this, 'execution-attachment', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const emailsLambdaPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'cognito-email-handler',
      'lambda_function.zip',
    );

    this.function = new LambdaFunction(this, 'lambda', {
      functionName: `cognito-email-lambda-${props.nameSuffix}`,
      role: role.arn,
      filename: emailsLambdaPath,
      sourceCodeHash: Fn.filebase64sha256(emailsLambdaPath),
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      timeout: 10,
      environment: {
        variables: {
          DEFAULT_DOMAIN: props.domainName,
        },
      },
    });
  }
}

export interface CognitoEmailHandlerProps {
  nameSuffix: string;
  domainName: string;
}
