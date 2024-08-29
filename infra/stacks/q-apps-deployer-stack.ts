import { ArcanumStack, ArcanumStackProps } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';

export class QAppsDeployerStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: QAppsDeployerStackProps) {
    super(scope, name, props);

    new PublicS3Bucket(this, 'template-bucket', {
      bucket: props.templateBucketName,
    });
  }
}

export interface QAppsDeployerStackProps extends ArcanumStackProps {
  templateBucketName: string;
}
