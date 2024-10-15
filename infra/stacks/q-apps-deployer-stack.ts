import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';

export class QAppsDeployerStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: QAppsDeployerStackProps) {
    const deployerAccount =
      (props.environmentName as EnvironmentName) == EnvironmentName.prod ? '207567759910' : '324037291751';
    props.assumeRoleList = [
      {
        roleArn: `arn:aws:iam::${deployerAccount}:role/admin-delegated-access`,
      },
    ];
    super(scope, name, props);

    new PublicS3Bucket(this, 'template-bucket', {
      bucket: props.templateBucketName,
    });

    new PrivateBucket(this, 'numa-apps-bucket', {
      bucket: props.appsBucketName,
    });
  }
}

export interface QAppsDeployerStackProps extends ArcanumStackProps {
  templateBucketName: string;
  appsBucketName: string;
}
