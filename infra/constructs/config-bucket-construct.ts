import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { Construct } from 'constructs';

export class ConfigBucket extends Construct {
  readonly bucket: S3Bucket;

  constructor(scope: Construct, name: string, props: ConfigBucketProps) {
    super(scope, name);

    this.bucket = new S3Bucket(this, 'config-bucket', {
      bucket: `numa-${props.client}-config`,
    });

    const configKey = 'otel-config.yaml';

    const configBucketPolicy = new DataAwsIamPolicyDocument(this, 'config-bucket-policy-doc', {
      statement: [
        {
          resources: [`${this.bucket.arn}/${configKey}`],
          actions: ['s3:GetObject'],
          principals: [
            {
              type: 'AWS',
              identifiers: ['*'],
            },
          ],
          condition: [
            {
              values: [props.clientAccountId],
              variable: 'aws:PrincipalAccount',
              test: 'StringEquals',
            },
          ],
        },
      ],
    });

    new S3BucketPolicy(this, 'config-bucket-policy', {
      bucket: this.bucket.bucket,
      policy: configBucketPolicy.json,
    });
  }
}

export interface ConfigBucketProps {
  client: string;
  clientAccountId: string;
}
