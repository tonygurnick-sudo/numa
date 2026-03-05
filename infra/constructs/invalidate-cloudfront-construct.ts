import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

export class InvalidateCloudfront extends Construct {
  constructor(scope: Construct, name: string, props: InvalidateCloudfrontProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    // Use inline policy instead of managed policy attachment to avoid IAM eventual consistency issues
    // Inline policies propagate immediately, preventing AccessDenied errors on first deploy
    const basicPolicyAttachment = new IamRolePolicyAttachment(this, 'role-policy-attachment-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const inlinePolicy = new IamRolePolicy(this, 'invalidate-policy', {
      role: role.name,
      policy: new DataAwsIamPolicyDocument(this, 'domain-invalidation-policy-document', {
        statement: [
          {
            actions: ['cloudfront:CreateInvalidation'],
            resources: [props.cloudfrontDistribution.arn],
          },
        ],
      }).json,
    });

    const invalidaterPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'cloudfront-invalidator');
    const invalidaterFilename = path.resolve(invalidaterPath, 'lambda_function.zip');
    const oldfunc = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: `${props.clientName}-cloudfront-invalidator`,
        role: role.arn,
        runtime: 'nodejs22.x',
      },
      path: invalidaterPath,
    });
    oldfunc.lambdaFunction.moveTo('invalidater_function');
    const func = new LambdaFunction(this, 'invalidator-function', {
      functionName: `${props.clientName}-cloudfront-invalidator`,
      role: role.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: invalidaterFilename,
      sourceCodeHash: Fn.filebase64sha256(invalidaterFilename),
      timeout: 30,
    });
    func.addMoveTarget('invalidater_function');

    const input = JSON.stringify({
      distributionId: props.cloudfrontDistribution.id,
      paths: props.paths?.join(','),
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.functionName,
      input,
      triggers: {
        // This causes the lambda to trigger on every source change.
        sourceHash: Fn.sha256(
          Fn.join(
            '',
            props.dependsOn.map((dependency) => Fn.coalesce([dependency.sourceHash, dependency.content]))
          )
        ),
      },
      dependsOn: [...props.dependsOn, func, basicPolicyAttachment, inlinePolicy],
    });
  }
}

export interface InvalidateCloudfrontProps {
  clientName: string;
  cloudfrontDistribution: CloudfrontDistribution;
  paths?: string[];
  dependsOn: S3Object[];
}
