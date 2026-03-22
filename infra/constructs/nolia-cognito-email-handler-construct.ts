import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import * as path from 'node:path';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';

export class NoliaCognitoEmailHandler extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, name: string, props: NoliaCognitoEmailHandlerProps) {
    super(scope, name);

    const namePrefix = `nolia-cognito-email-`;
    const nameSuffix = props.nameSuffix.slice(0, 64 - namePrefix.length);
    const roleName = namePrefix + nameSuffix;

    const role = new IamRole(this, 'role', {
      name: roleName,
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    new IamRolePolicyAttachment(this, 'execution-attachment', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const lambdaPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'nolia-cognito-email-handler',
      'lambda_function.zip'
    );

    const lambdaPrefix = `nolia-cognito-email-`;
    const lambdaSuffix = props.nameSuffix.slice(0, 64 - lambdaPrefix.length);
    const lambdaName = lambdaPrefix + lambdaSuffix;

    this.function = new LambdaFunction(this, 'lambda', {
      functionName: lambdaName,
      role: role.arn,
      filename: lambdaPath,
      sourceCodeHash: Fn.filebase64sha256(lambdaPath),
      handler: 'index.handler',
      runtime: 'nodejs20.x',
      timeout: 10,
      environment: {
        variables: {
          DOMAIN: props.domainName,
        },
      },
    });
  }
}

export interface NoliaCognitoEmailHandlerProps {
  nameSuffix: string;
  domainName: string;
}
