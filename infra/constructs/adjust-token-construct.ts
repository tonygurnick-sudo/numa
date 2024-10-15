import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';

export class AdjustToken extends Construct {
  readonly function;
  constructor(scope: Construct, name: string, props: AdjustTokenProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
      managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
    });

    this.function = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: 'token-adjuster-' + props.nameSuffix,
        role: role.arn,
      },
      path: 'constructs/token-adjuster/',
    });
  }
}

export interface AdjustTokenProps {
  nameSuffix: string;
}
