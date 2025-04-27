import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { TypescriptLambdaConstruct } from '@arcanumai/typescript-lambda-construct';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';

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

    const policyAttachments = [
      new IamRolePolicyAttachment(this, 'role-policy-attachment-basic', {
        role: role.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      }),
      new IamRolePolicyAttachment(this, 'role-policy-attachment-invalidate', {
        role: role.name,
        policyArn: invalidatePolicy.arn,
      }),
    ];

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
        sourceHash: Fn.sha256(
          Fn.join(
            '',
            props.dependsOn.map((dependency) => Fn.coalesce([dependency.sourceHash, dependency.content])),
          ),
        ),
      },
      dependsOn: [...props.dependsOn, func.lambdaFunction, ...policyAttachments],
    });
  }
}

export interface InvalidateCloudfrontProps {
  cloudfrontDistribution: CloudfrontDistribution;
  paths?: string[];
  dependsOn: S3Object[];
}
