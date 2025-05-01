import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
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

    const adjusterPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'cloudfront-invalidator');
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
    });
    this.function.addMoveTarget('adjust_function');
  }
}

export interface AdjustTokenProps {
  nameSuffix: string;
}
