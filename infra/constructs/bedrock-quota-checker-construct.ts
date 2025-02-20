import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { TerraformOutput } from 'cdktf';
import * as path from 'node:path';

export class BedrockQuotaChecker extends Construct {
  readonly result: LambdaInvocation;

  constructor(scope: Construct, name: string, props: BedrockQuotaCheckerProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const policyDoc = new DataAwsIamPolicyDocument(this, 'policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: ['servicequotas:GetServiceQuota', 'support:CreateCase', 'support:DescribeCases'],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*'],
        },
      ],
    });

    new IamRolePolicy(this, 'policy', {
      role: role.name,
      policy: policyDoc.json,
    });

    const func = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: `bedrock-quota-check-${props.client}`,
        role: role.arn,
        runtime: 'nodejs18.x',
        handler: 'index.handler',
      },
      path: path.join('constructs', 'bedrock-quota-checker'),
    });

    this.result = new LambdaInvocation(this, 'check', {
      functionName: func.lambdaFunction.functionName,
      input: JSON.stringify({
        client: props.client,
        timestamp: new Date().toISOString(),
      }),
      triggers: {
        timestamp: new Date().toISOString(),
      },
    });

    new TerraformOutput(this, 'quota-check-result', {
      value: this.result.result,
    });
  }
}

export interface BedrockQuotaCheckerProps {
  client: string;
}
