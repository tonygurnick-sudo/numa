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
import { CustomerSuccessPortalConstruct } from '../constructs/customer-success-portal-construct';
import { PortalDeploymentsConstruct } from '../constructs/portal-deployments-construct';
import { PortalNextgenBrokerConstruct } from '../constructs/portal-nextgen-broker-construct';

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

    // Private bucket to host prebuilt artifacts (e.g., Claude CLI)
    // CI publishes s3://<bucket>/claude-artifacts/<version>/claude-x86_64.zip
    const claudeArtifactBucket = new PrivateBucket(this, 'claude-cli-artifact-bucket', {
      bucket: 'numa-claude-cli-artifacts',
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

    new TerraformOutput(this, 'claude-cli-layer-bucket-name', {
      value: claudeArtifactBucket.bucket,
    });

    // Customer Success Portal and Deployments orchestration (POC)
    if (props.enableCustomerSuccessPortal) {
      // Optional: portal-triggered deployments construct (keeps this stack light)
      const portalDeployments =
        props.enablePortalDeployments !== false
          ? new PortalDeploymentsConstruct(this, 'portal-deployments', {
              arcanumNumaAccount: props.arcanumNumaAccount,
              // Backend (Terraform state) lives in root account 442483608950
              backendRoleArn: 'arn:aws:iam::442483608950:role/terraform-backend-access',
            })
          : undefined;

      // Portal NextGen Broker deployed in the deployer account, restrict invoke to NextGen org if desired
      const broker = new PortalNextgenBrokerConstruct(this, 'portal-nextgen-broker', {
        functionName: 'portal-nextgen-broker',
        managementAccountId: '282304106064',
        orgId: 'o-apdsu3c1a7',
      });

      new CustomerSuccessPortalConstruct(this, 'customer-success-portal', {
        clientConfigTable,
        domainName: `customer-success-portal.${props.domainSuffix}`,
        hostedZoneId: zone.id,
        // Provide optional resources for StartExecution + DDB read and to surface config to the SPA
        deploymentsTableArn: portalDeployments?.table.arn,
        deploymentsTableName: portalDeployments?.table.name,
        deploymentStateMachineArn: portalDeployments?.stateMachine.arn,
        deploymentGroupStateMachineArn: portalDeployments?.groupStateMachine.arn,
        imageMetadataTableArn: portalDeployments?.imageMetadataTable.arn,
        imageMetadataTableName: portalDeployments?.imageMetadataTable.name,
        logsGroupArn: portalDeployments?.logGroup.arn,
        logsGroupName: portalDeployments?.logGroup.name,
        ecsClusterArn: portalDeployments?.cluster.arn,
        deploymentGroupsTableArn: portalDeployments?.groupsTable.arn,
        deploymentGroupsTableName: portalDeployments?.groupsTable.name,
        deploymentGroupDefaultConcurrency: portalDeployments?.groupDefaultConcurrency,
        deploymentGroupMaxConcurrency: portalDeployments?.groupMaxConcurrency,
        nextgenBrokerLambdaName: broker.functionName,
        nextgenBrokerRegion: 'us-east-1',
      });

      // Useful outputs
      if (portalDeployments) {
        new TerraformOutput(this, 'portal-deployments-table-name', {
          value: portalDeployments.table.name,
        });
        new TerraformOutput(this, 'portal-deployments-state-machine-arn', {
          value: portalDeployments.stateMachine.arn,
        });
        new TerraformOutput(this, 'portal-group-deployments-state-machine-arn', {
          value: portalDeployments.groupStateMachine.arn,
        });
        new TerraformOutput(this, 'portal-deployments-ecs-cluster', {
          value: portalDeployments.cluster.arn,
        });
        new TerraformOutput(this, 'portal-image-metadata-table-name', {
          value: portalDeployments.imageMetadataTable.name,
        });
        new TerraformOutput(this, 'portal-deployments-groups-table-name', {
          value: portalDeployments.groupsTable.name,
        });
      }
      // Inject broker config into portal config.json (see CustomerSuccessPortalConstruct)
      // We attach via outputs from the construct section below.
      new TerraformOutput(this, 'portal-nextgen-broker-name', { value: broker.functionName });
      new TerraformOutput(this, 'portal-nextgen-broker-arn', { value: broker.functionArn });
    }
  }
}

export interface QAppsDeployerStackProps extends ArcanumStackProps {
  templateBucketName: string;
  appsBucketName: string;
  arcanumNumaAccount: string;
  domainSuffix: string;
  /**
   * Enable Customer Success Portal (POC)
   * @default false
   */
  enableCustomerSuccessPortal?: boolean;
  /**
   * Enable portal-triggered deployments (Step Functions + ECS)
   * @default true (when enableCustomerSuccessPortal=true)
   */
  enablePortalDeployments?: boolean;
}
