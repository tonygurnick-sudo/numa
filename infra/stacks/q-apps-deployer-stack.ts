import { ArcanumStack, ArcanumStackProps } from '@arcanumai/cdktf-util';
import { Construct } from 'constructs';
import { PublicS3Bucket } from '../constructs/public-s3-bucket-construct';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { S3BucketCorsConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-cors-configuration';
import { DynamodbResourcePolicy } from '@cdktf/provider-aws/lib/dynamodb-resource-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { Route53Zone } from '@cdktf/provider-aws/lib/route53-zone';
import { TerraformOutput } from 'cdktf';
import { CustomerSuccessPortalConstruct } from '../constructs/customer-success-portal-construct';
import { PortalDeploymentsConstruct } from '../constructs/portal-deployments-construct';
import { PortalNextgenBrokerConstruct } from '../constructs/portal-nextgen-broker-construct';
import { EmailSenderConstruct } from '../constructs/email-sender-construct';
import { NumaStandardModelRelayConstruct } from '../constructs/numa-standard-model-relay-construct';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { VoiceConfigWriterConstruct } from '../constructs/voice-config-writer-construct';
import { QuotaReportDailyConstruct } from '../constructs/quota-report-daily-construct';
import { NumaDashboardRollupConstruct } from '../constructs/numa-dashboard-rollup-construct';
import { ArcanumAgentDeployerConstruct } from '../constructs/arcanum-agent-deployer-construct';

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

    const supportDocsMasterBucket = new PrivateBucket(this, 'numa-support-docs-master-bucket', {
      bucket: 'numa-support-docs-master',
    });

    // CORS is required because the CS Portal (browser) calls S3 directly via
    // presigned URLs and the AWS SDK. Without this, ListObjects / PutObject /
    // DeleteObject calls are blocked by the browser's same-origin policy.
    new S3BucketCorsConfiguration(this, 'support-docs-master-cors', {
      bucket: supportDocsMasterBucket.bucket.id,
      corsRule: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'HEAD', 'PUT', 'DELETE'],
          allowedOrigins: [`https://customer-success-portal.${props.domainSuffix}`],
          exposeHeaders: ['ETag', 'Content-Type', 'Content-Length', 'x-amz-meta-uploaded_by'],
          maxAgeSeconds: 3600,
        },
      ],
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

    // Global capabilities metadata table — shared across all clients.
    // Stores display metadata (title, description, icon, system_only) for feature flags.
    // Populated via tools/seed-capabilities-metadata.ts.
    const capabilitiesMetadataTable = new DynamodbTable(this, 'capabilities-metadata-table', {
      name: 'numa-capabilities-metadata',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'flag',
      attribute: [
        {
          name: 'flag',
          type: 'S',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
    });

    new TerraformOutput(this, 'capabilities-metadata-table-arn', {
      value: capabilitiesMetadataTable.arn,
    });

    // Centralized email sender -- SES domain + Lambda for cross-account email delivery
    const emailSender = new EmailSenderConstruct(this, 'email-sender', {
      zoneId: zone.id,
      domainSuffix: props.domainSuffix,
      clientConfigTableArn: clientConfigTable.arn,
      clientConfigTableName: clientConfigTable.name,
    });

    new TerraformOutput(this, 'email-sender-lambda-arn', {
      value: emailSender.functionArn,
    });

    new TerraformOutput(this, 'email-sender-function-name', {
      value: emailSender.functionName,
    });

    // Numa Standard Model relay — deployer-account streaming egress chokepoint
    // for the opaque `numa-standard-model`. The only place that knows the real
    // upstream (DeepSeek via OpenRouter→Novita) + holds the OpenRouter key.
    // Per-tenant AgentCore containers reach it cross-account via STS proof
    // (same pattern as the email sender).
    //
    // The OpenRouter key secret is created empty here and must be populated
    // manually via the AWS console (same convention as the Pipedream
    // credentials secret). The relay resolves it at deploy time into the
    // OPENROUTER_API_KEY env var, so the secret must be populated before the
    // relay can serve traffic (re-deploy after first populating).
    const openRouterKeySecret = new SecretsmanagerSecret(this, 'openrouter-api-key', {
      name: 'numa-standard-model-relay/openrouter-api-key',
      description: 'OpenRouter API key for the Numa Standard Model relay (populate manually).',
    });

    const standardModelRelay = new NumaStandardModelRelayConstruct(this, 'numa-standard-model-relay', {
      openRouterApiKeySecretArn: openRouterKeySecret.arn,
      clientConfigTableArn: clientConfigTable.arn,
      clientConfigTableName: clientConfigTable.name,
      region: 'us-east-1',
    });

    new TerraformOutput(this, 'numa-standard-model-relay-function-url', {
      value: standardModelRelay.functionUrl,
    });

    new TerraformOutput(this, 'numa-standard-model-relay-function-arn', {
      value: standardModelRelay.functionArn,
    });

    // Numa Voice config write-back (FEAT-169) — STS-proof relay that lets a
    // client-account voice-admin Lambda persist Connect/Voice values back into
    // numa-client-config without any direct cross-account table access.
    const voiceConfigWriter = new VoiceConfigWriterConstruct(this, 'voice-config-writer', {
      clientConfigTableArn: clientConfigTable.arn,
      clientConfigTableName: clientConfigTable.name,
    });

    new TerraformOutput(this, 'voice-config-writer-lambda-arn', {
      value: voiceConfigWriter.functionArn,
    });

    // Daily quota report — snapshots Bedrock quotas across all client accounts,
    // uploads CSV to HQ's company knowledge base for agent-driven alerting
    if (props.enableQuotaReportDaily) {
      if (!props.hqAccountId || !props.hqDataBucket) {
        throw new Error('enableQuotaReportDaily requires hqAccountId and hqDataBucket');
      }
      new QuotaReportDailyConstruct(this, 'quota-report-daily', {
        clientConfigTableArn: clientConfigTable.arn,
        clientConfigTableName: clientConfigTable.name,
        hqAccountId: props.hqAccountId,
        hqDataBucket: props.hqDataBucket,
      });
    }

    new TerraformOutput(this, 'client-config-table-arn', {
      value: clientConfigTable.arn,
    });

    new TerraformOutput(this, 'zone-id', {
      value: zone.id,
    });

    new TerraformOutput(this, 'claude-cli-layer-bucket-name', {
      value: claudeArtifactBucket.bucket,
    });

    new TerraformOutput(this, 'numa-support-docs-master-bucket-name', {
      value: supportDocsMasterBucket.bucket.bucket,
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

      // Numa Dashboard fleet-analytics rollup — provisioned BEFORE the portal
      // construct so we can pass its table/lambda ARNs into the portal's
      // config and IAM policy for on-demand refresh.
      const numaDashboardRollup =
        (props.enableNumaDashboard ?? true)
          ? new NumaDashboardRollupConstruct(this, 'numa-dashboard-rollup', {
              clientConfigTableArn: clientConfigTable.arn,
              clientConfigTableName: clientConfigTable.name,
            })
          : undefined;

      // Arcanum Agent Deployer (FEAT-206) — library + deploy engine for pushing
      // curated "Arcanum" agents into client instances without a full Numa deploy.
      const arcanumAgentDeployer = new ArcanumAgentDeployerConstruct(this, 'arcanum-agent-deployer', {
        clientConfigTableArn: clientConfigTable.arn,
        clientConfigTableName: clientConfigTable.name,
        portalOrigin: `https://customer-success-portal.${props.domainSuffix}`,
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
        supportDocsBucketArn: supportDocsMasterBucket.bucket.arn,
        supportDocsBucketName: supportDocsMasterBucket.bucket.bucket,
        fleetAnalyticsTableArn: numaDashboardRollup?.tableArn,
        fleetAnalyticsTableName: numaDashboardRollup?.tableName,
        fleetAnalyticsLambdaArn: numaDashboardRollup?.functionArn,
        fleetAnalyticsLambdaName: numaDashboardRollup?.functionName,
        arcanumAgentLibraryTableArn: arcanumAgentDeployer.libraryTableArn,
        arcanumAgentLibraryTableName: arcanumAgentDeployer.libraryTableName,
        arcanumAgentDeploymentsTableArn: arcanumAgentDeployer.deploymentsTableArn,
        arcanumAgentDeploymentsTableName: arcanumAgentDeployer.deploymentsTableName,
        arcanumAgentTargetsTableArn: arcanumAgentDeployer.targetsTableArn,
        arcanumAgentTargetsTableName: arcanumAgentDeployer.targetsTableName,
        arcanumAgentLibraryBucketArn: arcanumAgentDeployer.libraryBucketArn,
        arcanumAgentLibraryBucketName: arcanumAgentDeployer.libraryBucketName,
        arcanumAgentDeployerLambdaArn: arcanumAgentDeployer.functionArn,
        arcanumAgentDeployerLambdaName: arcanumAgentDeployer.functionName,
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
  /**
   * Enable daily quota report snapshot Lambda + EventBridge schedule.
   * Fetches Bedrock quotas across all client accounts and uploads CSV to HQ KB.
   * @default false
   */
  enableQuotaReportDaily?: boolean;
  /**
   * Enable the Numa Dashboard fleet-analytics rollup table + Lambda + scheduler.
   * Provides the data backing the portal's Numa Dashboard tab.
   * @default true
   */
  enableNumaDashboard?: boolean;
  /** HQ client account ID for quota report S3 upload — required when enableQuotaReportDaily is true */
  hqAccountId?: string;
  /** HQ data bucket name — required when enableQuotaReportDaily is true */
  hqDataBucket?: string;
}
