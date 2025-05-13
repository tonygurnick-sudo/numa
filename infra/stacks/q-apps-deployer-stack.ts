import { ArcanumStack, ArcanumStackProps } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { TerraformOutput } from 'cdktf';

export class QAppsDeployerStack extends ArcanumStack {
  constructor(scope: Construct, name: string, props: QAppsDeployerStackProps) {
    props.assumeRoleList = [
      {
        roleArn: `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`,
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
      name: props.domainSuffix,
    });

    const clientConfigTable = new DynamodbTable(this, 'client-config-table', {
      name: 'numa-client-config',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'clientName',
      attribute: [
        {
          name: 'clientName',
          type: 'S',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
      deletionProtectionEnabled: true,
      lifecycle: {
        preventDestroy: true,
      },
    });

    new TerraformOutput(this, 'client-config-table-arn', {
      value: clientConfigTable.arn,
    });

    new TerraformOutput(this, 'zone-id', {
      value: zone.id,
    });
  }
}

export interface QAppsDeployerStackProps extends ArcanumStackProps {
  templateBucketName: string;
  appsBucketName: string;
  arcanumNumaAccount: string;
  domainSuffix: string;
}
