import { ArcanumStack, ArcanumStackProps, EnvironmentName } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { TerraformOutput } from 'cdktf';

export class QAppsDeployerStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: QAppsDeployerStackProps) {
    const environmentConfig = (props.environmentName as EnvironmentName) == EnvironmentName.prod ? {
      deployerAccount: '207567759910',
      domainSuffix: 'numa.arcanum.ai',
    } : {
      deployerAccount: '324037291751',
      domainSuffix: 'numa-dev.arcanum.ai',
    };
    props.assumeRoleList = [
      {
        roleArn: `arn:aws:iam::${environmentConfig.deployerAccount}:role/admin-delegated-access`,
      },
    ];
    super(scope, name, props);

    new PublicS3Bucket(this, 'template-bucket', {
      bucket: props.templateBucketName,
    });

    new PrivateBucket(this, 'numa-apps-bucket', {
      bucket: props.appsBucketName,
    });

    const zone = new Route53Zone(this, 'route53-zone', {
      name: environmentConfig.domainSuffix,
    });

    new TerraformOutput(this, 'zone-id', {
      value: zone.id,
    })
  }
}

export interface QAppsDeployerStackProps extends ArcanumStackProps {
  templateBucketName: string;
  appsBucketName: string;
}
