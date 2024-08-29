import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Bucket, S3BucketConfig } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketOwnershipControls } from '@cdktf/provider-aws/lib/s3-bucket-ownership-controls';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block';
import { Construct } from 'constructs';

export class PublicS3Bucket extends S3Bucket {
  constructor(scope: Construct, name: string, props: S3BucketConfig) {
    const clientProfile = process.env['AWS_CLIENT_PROFILE'] ?? process.env['AWS_PROFILE'];
    const clientRoleArn = process.env['AWS_CLIENT_ROLE_ARN'];
    const provider = new AwsProvider(scope, 'us-east-1-provider', {
      profile: clientProfile,
      alias: 'us-east-1-for-s3',
      region: 'us-east-1',
      assumeRole: [
        {
          roleArn: clientRoleArn,
        },
      ],
    });

    super(scope, name, {
      ...props,
      provider,
    });

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {
      provider: this.provider,
    });

    const bucketOwnershipControls = new S3BucketOwnershipControls(this, 'ownership-controls', {
      provider: this.provider,
      bucket: this.id,
      rule: {
        objectOwnership: 'BucketOwnerEnforced',
      },
    });
    const bucketPublicAccessBlock = new S3BucketPublicAccessBlock(this, 'public-access-block', {
      provider: this.provider,
      bucket: this.id,
      blockPublicAcls: true,
      blockPublicPolicy: false,
      ignorePublicAcls: true,
      restrictPublicBuckets: false,
    });
    new S3BucketPolicy(this, 'public-access-policy', {
      provider: this.provider,
      dependsOn: [bucketOwnershipControls, bucketPublicAccessBlock],
      bucket: this.id,
      policy: new DataAwsIamPolicyDocument(this, 'public-access-policy-document', {
        statement: [
          {
            actions: ['s3:GetObject'],
            resources: [this.arn + '/*'],
            principals: [
              {
                identifiers: ['*'],
                type: 'AWS',
              },
            ],
          },
          {
            actions: ['s3:ListBucket'],
            resources: [this.arn],
            effect: 'Deny',
            principals: [
              {
                identifiers: ['*'],
                type: 'AWS',
              },
            ],
            condition: [
              {
                test: 'ArnNotEquals',
                values: [`arn:aws:iam::${callerId.accountId}:*/*`],
                variable: 'aws:PrincipalArn',
              },
            ],
          },
        ],
      }).json,
    });
  }
}
