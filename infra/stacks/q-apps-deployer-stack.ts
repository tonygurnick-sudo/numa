import { ArcanumStack, ArcanumStackProps } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { DynamodbResourcePolicy } from '@cdktf/provider-aws/lib/dynamodb-resource-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { TerraformOutput } from 'cdktf';
import { Honeycomb } from '../constructs/honeycomb-construct';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';

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

    // Resource policy to allow pipedream-account-sync lambda access from proxy account
    const clientConfigResourcePolicyDoc = new DataAwsIamPolicyDocument(this, 'client-config-resource-policy-doc', {
      statement: [
        {
          sid: 'AllowPipedreamProxyAccountAccess',
          effect: 'Allow',
          principals: [
            {
              type: 'AWS',
              identifiers: ['arn:aws:iam::965745962688:role/pipedream-account-sync-lambda-role'],
            },
          ],
          actions: ['dynamodb:Scan', 'dynamodb:Query'],
          resources: [clientConfigTable.arn],
        },
      ],
    });

    new DynamodbResourcePolicy(this, 'client-config-resource-policy', {
      resourceArn: clientConfigTable.arn,
      policy: clientConfigResourcePolicyDoc.json,
    });

    const honeycomb = new Honeycomb(this, 'honeycomb', {
      name: 'numa-' + props.environmentName,
    });

    new SsmParameter(this, 'frontend-key', {
      name: '/honeycomb/frontend-key',
      type: 'SecureString',
      value: honeycomb.frontendKey,
    });
    new SsmParameter(this, 'backend-key', {
      name: '/honeycomb/backend-key',
      type: 'SecureString',
      value: honeycomb.backendKey,
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
