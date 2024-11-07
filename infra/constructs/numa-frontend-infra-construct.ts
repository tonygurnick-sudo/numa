import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { Construct } from 'constructs';

export class NumaFrontendInfra extends Construct {
  readonly frontendBucket: S3Bucket;
  constructor(scope: Construct, name: string, props: NumaFrontendInfraProps) {
    super(scope, name);

    const numaClient = `numa-${props.client}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;
    this.frontendBucket = new PrivateBucket(this, 'frontend-bucket', {
      bucket: numaClient + '-fe',
    }).bucket;
  }
}

export interface NumaFrontendInfraProps {
  client: string;
  environmentName: string;
}
