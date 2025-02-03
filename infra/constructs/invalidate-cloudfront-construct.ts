import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { hash } from 'node:crypto';

export class InvalidateCloudfront extends Construct {
  constructor(scope: Construct, name: string, props: InvalidateCloudfrontProps) {
    super(scope, name);

    const invalidatePolicy = new IamPolicy(this, 'invalidate-domain-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'domain-invalidation-policy-document', {
        statement: [
          {
            actions: ['cloudfront:CreateInvalidation'],
            resources: [props.cloudfrontDistribution.arn],
          },
        ],
      }).json,
    });
    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const policyAttachment = new IamRolePolicyAttachmentsExclusive(this, 'attach-roles', {
      policyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', invalidatePolicy.arn],
      roleName: role.name,
    });

    const func = new TypescriptLambdaConstruct(this, 'function', {
      lambdaProps: {
        functionName: 'cloudfront-invalidater-' + props.cloudfrontDistribution.id,
        role: role.arn,
      },
      path: 'constructs/cloudfront-invalidater/',
    });

    const input = JSON.stringify({
      distributionId: props.cloudfrontDistribution.id,
      paths: props.paths?.join(','),
    });

    new LambdaInvocation(this, 'invocation', {
      functionName: func.lambdaFunction.functionName,
      input,
      triggers: {
        // This causes the lambda to trigger on every source change.
        sourceHash: hash('sha256', props.dependsOn.map((dep) => dep.sourceHash).join('')),
      },
      dependsOn: [...props.dependsOn, func.lambdaFunction, policyAttachment],
    });
  }
}

export interface InvalidateCloudfrontProps {
  cloudfrontDistribution: CloudfrontDistribution;
  paths?: string[];
  dependsOn: S3Object[];
}
