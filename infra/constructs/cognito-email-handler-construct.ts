import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import * as path from 'node:path';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';

export class CognitoEmailHandler extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, name: string, props: CognitoEmailHandlerProps) {
    super(scope, name);

    const namePrefix = `cognito-email-handler-`;
    const nameSuffix = props.nameSuffix.slice(0, 64 - namePrefix.length);
    const roleName = namePrefix + nameSuffix;

    const role = new IamRole(this, 'role', {
      name: roleName,
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
      managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
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

    const lambdaPrefix = `cognito-email-handler-`;
    const lambdaSuffix = props.nameSuffix.slice(0, 64 - lambdaPrefix.length);
    const lambdaName = lambdaPrefix + lambdaSuffix;

    this.function = new LambdaFunction(this, 'lambda', {
      functionName: lambdaName,
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
