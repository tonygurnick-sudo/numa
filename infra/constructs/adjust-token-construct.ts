import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { Construct } from 'constructs';

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

    this.function = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        runtime: 'nodejs22.x',
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
