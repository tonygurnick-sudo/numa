import { Construct } from 'constructs';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { CognitoIdentityPool } from '@cdktf/provider-aws/lib/cognito-identity-pool';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { CognitoIdentityPoolRolesAttachment } from '@cdktf/provider-aws/lib/cognito-identity-pool-roles-attachment';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { TerraformOutput, Fn } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CustomerSuccessPortalConstructProps {
  /**
   * The existing client config table to reference
   */
  clientConfigTable: DynamodbTable;

  /**
   * Domain name for the portal (e.g., portal.numa.arcanum.ai)
   */
  domainName: string;

  /**
   * Route53 hosted zone ID
   */
  hostedZoneId: string;

  /**
   * Optional provider for hosted zone operations
   */
  hostedZoneProvider?: AwsProvider;

  /** Optional: deployments history table ARN (to grant read access) */
  deploymentsTableArn?: string;
  /** Optional: deployments history table name (to surface in config) */
  deploymentsTableName?: string;
  /** Optional: Step Functions state machine ARN for portal deploys */
  deploymentStateMachineArn?: string;
  /** Optional: group deployments Step Functions state machine ARN */
  deploymentGroupStateMachineArn?: string;
  /** Optional: image metadata table ARN (to grant read/write access) */
  imageMetadataTableArn?: string;
  /** Optional: image metadata table name (to surface in config) */
  imageMetadataTableName?: string;
  /** Optional: deployment groups configuration table ARN */
  deploymentGroupsTableArn?: string;
  /** Optional: deployment groups configuration table name */
  deploymentGroupsTableName?: string;
  /** Optional: default concurrency for group deployments */
  deploymentGroupDefaultConcurrency?: number;
  /** Optional: absolute max concurrency for group deployments */
  deploymentGroupMaxConcurrency?: number;
  /** Optional: CloudWatch Logs group for deploy task output */
  logsGroupArn?: string;
  logsGroupName?: string;
  /** Optional: ECS cluster ARN used by portal deployments (for StopTask permissions + config) */
  ecsClusterArn?: string;
  /** Optional: NextGen broker Lambda name (for portal direct invoke) */
  nextgenBrokerLambdaName?: string;
  /** Optional: NextGen broker region */
  nextgenBrokerRegion?: string;
  /** Optional: support docs master bucket ARN for CS docs management */
  supportDocsBucketArn?: string;
  /** Optional: support docs master bucket name exposed to portal config */
  supportDocsBucketName?: string;
  /** Optional: name of the numa-portal-fleet-analytics DynamoDB table (Numa Dashboard) */
  fleetAnalyticsTableName?: string;
  /** Optional: ARN of the numa-portal-fleet-analytics DynamoDB table — granted Read+Query to the portal role */
  fleetAnalyticsTableArn?: string;
  /** Optional: ARN of the numa-fleet-analytics-rollup Lambda — granted InvokeFunction to the portal role */
  fleetAnalyticsLambdaArn?: string;
  /** Optional: name of the numa-fleet-analytics-rollup Lambda — surfaced into the portal config.json */
  fleetAnalyticsLambdaName?: string;
  /** FEAT-206 Arcanum agent library table — granted CRUD to the portal role + surfaced into config. */
  arcanumAgentLibraryTableArn?: string;
  arcanumAgentLibraryTableName?: string;
  /** FEAT-206 Arcanum agent deployments table — granted read to the portal role + surfaced into config. */
  arcanumAgentDeploymentsTableArn?: string;
  arcanumAgentDeploymentsTableName?: string;
  /** FEAT-206 Arcanum agent targets table (per-client deployed-agent selection) — granted CRUD + surfaced into config. */
  arcanumAgentTargetsTableArn?: string;
  arcanumAgentTargetsTableName?: string;
  /** FEAT-206 Arcanum agent library S3 bucket — granted CRUD to the portal role + surfaced into config. */
  arcanumAgentLibraryBucketArn?: string;
  arcanumAgentLibraryBucketName?: string;
  /** FEAT-206 Arcanum agent deployer Lambda — granted InvokeFunction + surfaced into config. */
  arcanumAgentDeployerLambdaArn?: string;
  arcanumAgentDeployerLambdaName?: string;
}

export class CustomerSuccessPortalConstruct extends Construct {
  readonly frontendBucket: S3Bucket;
  readonly distribution: CloudfrontDistribution;
  readonly userPool: CognitoUserPool;
  readonly userPoolClient: CognitoUserPoolClient;
  readonly identityPool: CognitoIdentityPool;
  readonly activityTable: DynamodbTable;
  readonly clientMetadataTable: DynamodbTable;
  /** Expose the authenticated role for further policy attachments if needed */
  readonly authenticatedRole: IamRole;

  constructor(scope: Construct, name: string, props: CustomerSuccessPortalConstructProps) {
    super(scope, name);

    // Activity tracking table for audit trail
    this.activityTable = new DynamodbTable(this, 'activity-table', {
      name: 'numa-portal-activity',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'activityId',
      rangeKey: 'timestamp',
      attribute: [
        {
          name: 'activityId',
          type: 'S',
        },
        {
          name: 'timestamp',
          type: 'S',
        },
        {
          name: 'type',
          type: 'S',
        },
      ],
      globalSecondaryIndex: [
        {
          name: 'type-timestamp-index',
          hashKey: 'type',
          rangeKey: 'timestamp',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
      lifecycle: {
        preventDestroy: true,
      },
    });

    // Client metadata table for non-deployment data (trial status, dates, notes)
    this.clientMetadataTable = new DynamodbTable(this, 'client-metadata-table', {
      name: 'numa-client-metadata',
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
      lifecycle: {
        preventDestroy: true,
      },
    });

    // Cognito User Pool for authentication
    this.userPool = new CognitoUserPool(this, 'user-pool', {
      name: 'customer-success-portal-user-pool',
      autoVerifiedAttributes: ['email'],
      // Enforce TOTP MFA for all users
      mfaConfiguration: 'ON',
      softwareTokenMfaConfiguration: {
        enabled: true,
      },
      passwordPolicy: {
        minimumLength: 8,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: false,
        requireUppercase: true,
      },
      schema: [
        {
          name: 'email',
          attributeDataType: 'String',
          required: true,
          mutable: true,
        },
        {
          name: 'name',
          attributeDataType: 'String',
          required: true,
          mutable: true,
        },
      ],
    });

    // Cognito User Pool Client
    this.userPoolClient = new CognitoUserPoolClient(this, 'user-pool-client', {
      name: 'customer-success-portal-client',
      userPoolId: this.userPool.id,
      generateSecret: false, // For frontend applications
      explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH', 'ALLOW_USER_SRP_AUTH'],
      preventUserExistenceErrors: 'ENABLED',
      tokenValidityUnits: [
        {
          accessToken: 'hours',
          idToken: 'hours',
          refreshToken: 'days',
        },
      ],
      accessTokenValidity: 1, // 1 hour
      idTokenValidity: 1, // 1 hour
      refreshTokenValidity: 30, // 30 days
    });

    // Cognito Identity Pool for AWS credentials
    this.identityPool = new CognitoIdentityPool(this, 'identity-pool', {
      identityPoolName: 'customer_portal_identity_pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.id,
          providerName: this.userPool.endpoint,
          serverSideTokenCheck: false,
        },
      ],
    });

    // Frontend hosting infrastructure
    this.frontendBucket = new S3Bucket(this, 'frontend-bucket', {
      bucket: 'numa-customer-success-portal-frontend',
      forceDestroy: true,
    });

    // CloudFront Origin Access Identity
    const oai = new CloudfrontOriginAccessIdentity(this, 'oai', {
      comment: 'Customer Portal OAI',
    });

    // S3 bucket policy for CloudFront access
    new S3BucketPolicy(this, 'frontend-bucket-policy', {
      bucket: this.frontendBucket.id,
      policy: new DataAwsIamPolicyDocument(this, 'frontend-bucket-policy-document', {
        statement: [
          {
            effect: 'Allow',
            principals: [
              {
                type: 'AWS',
                identifiers: [oai.iamArn],
              },
            ],
            actions: ['s3:GetObject'],
            resources: [`${this.frontendBucket.arn}/*`],
          },
        ],
      }).json,
    });

    // SSL Certificate for custom domain
    const certificate = new AcmCertificate(this, 'certificate', {
      domainName: props.domainName,
      validationMethod: 'DNS',
      provider: props.hostedZoneProvider,
      lifecycle: {
        createBeforeDestroy: true,
      },
    });

    const hostedZone = new DataAwsRoute53Zone(this, 'zone', {
      zoneId: props.hostedZoneId,
      provider: props.hostedZoneProvider,
    });

    // DNS validation for certificate
    const dvo = certificate.domainValidationOptions.get(0);
    const validationRecord = new Route53Record(this, 'certificate-validation', {
      allowOverwrite: true,
      name: dvo.resourceRecordName,
      records: [dvo.resourceRecordValue],
      ttl: 60,
      type: dvo.resourceRecordType,
      zoneId: hostedZone.zoneId,
      provider: props.hostedZoneProvider,
    });

    const certificateValidation = new AcmCertificateValidation(this, 'certificate-validation-waiter', {
      certificateArn: certificate.arn,
      provider: props.hostedZoneProvider,
      dependsOn: [validationRecord],
      timeouts: {
        create: '5m',
      },
    });

    // CloudFront Distribution
    this.distribution = new CloudfrontDistribution(this, 'distribution', {
      origin: [
        {
          domainName: this.frontendBucket.bucketDomainName,
          originId: 'S3-customer-success-portal',
          s3OriginConfig: {
            originAccessIdentity: oai.cloudfrontAccessIdentityPath,
          },
        },
      ],
      enabled: true,
      isIpv6Enabled: true,
      defaultRootObject: 'index.html',
      aliases: [props.domainName],
      defaultCacheBehavior: {
        targetOriginId: 'S3-customer-success-portal',
        viewerProtocolPolicy: 'redirect-to-https',
        compress: true,
        allowedMethods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
        cachedMethods: ['GET', 'HEAD'],
        forwardedValues: {
          queryString: false,
          cookies: {
            forward: 'none',
          },
        },
      },
      customErrorResponse: [
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
        },
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
        },
      ],
      restrictions: {
        geoRestriction: {
          restrictionType: 'none',
        },
      },
      viewerCertificate: {
        acmCertificateArn: certificateValidation.certificateArn,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      },
    });

    // DNS record for custom domain
    new Route53Record(this, 'portal-dns', {
      zoneId: hostedZone.zoneId,
      name: props.domainName,
      type: 'A',
      alias: {
        name: this.distribution.domainName,
        zoneId: this.distribution.hostedZoneId,
        evaluateTargetHealth: false,
      },
      provider: props.hostedZoneProvider,
    });

    // IAM role for authenticated users
    const authenticatedRole = new IamRole(this, 'authenticated-role', {
      name: 'customer-success-portal-authenticated-role',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'authenticated-assume-policy', {
        statement: [
          {
            effect: 'Allow',
            principals: [
              {
                type: 'Federated',
                identifiers: ['cognito-identity.amazonaws.com'],
              },
            ],
            actions: ['sts:AssumeRoleWithWebIdentity'],
            condition: [
              {
                test: 'StringEquals',
                variable: 'cognito-identity.amazonaws.com:aud',
                values: [this.identityPool.id],
              },
              {
                test: 'ForAnyValue:StringLike',
                variable: 'cognito-identity.amazonaws.com:amr',
                values: ['authenticated'],
              },
            ],
          },
        ],
      }).json,
    });

    // Policy for authenticated users to access AWS resources directly
    this.authenticatedRole = authenticatedRole;

    // Base policy for authenticated users
    const baseStatements: unknown[] = [
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [props.clientConfigTable.arn],
      },
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [this.activityTable.arn, `${this.activityTable.arn}/index/*`],
      },
      {
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [this.clientMetadataTable.arn],
      },
      {
        effect: 'Allow',
        actions: [
          'ecr:DescribeImages',
          'ecr:ListImages',
          // Optional for future repository metadata reads from UI
          'ecr:DescribeRepositories',
        ],
        resources: [
          // Images account/region used by the portal Containers page.
          // Both prod (numa-deploy) and dev (numa-deploy-dev) channels are listable.
          'arn:aws:ecr:ap-southeast-2:826326270637:repository/numa-deploy',
          'arn:aws:ecr:ap-southeast-2:826326270637:repository/numa-deploy-dev',
        ],
      },
      {
        effect: 'Allow',
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:ListUsers',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:DescribeUserPool',
        ],
        resources: [this.userPool.arn],
      },
      {
        effect: 'Allow',
        actions: ['sts:AssumeRole'],
        resources: [
          // Allow assuming ArcanumAIAccess role in any client account for tools execution
          'arn:aws:iam::*:role/ArcanumAIAccess',
        ],
        condition: [
          {
            test: 'StringEquals',
            variable: 'aws:RequestedRegion',
            values: ['us-east-1', 'ap-southeast-2', 'ap-southeast-3'], // Limit to supported regions
          },
        ],
      },
    ];

    // Optional: add Step Functions StartExecution and DDB read for deployments UI
    if (props.deploymentStateMachineArn) {
      const singleExecutionArnPrefix = props.deploymentStateMachineArn.replace(':stateMachine:', ':execution:');
      const singleStopResources = [props.deploymentStateMachineArn, `${singleExecutionArnPrefix}:*`];
      // StartExecution on the specific state machine
      baseStatements.push({
        effect: 'Allow',
        actions: ['states:StartExecution'],
        resources: [props.deploymentStateMachineArn],
      });
      // StopExecution on executions from that state machine (scoped via condition)
      baseStatements.push({
        effect: 'Allow',
        actions: ['states:StopExecution', 'states:DescribeExecution', 'states:GetExecutionHistory'],
        resources: singleStopResources,
      });
    }
    if (props.deploymentGroupStateMachineArn) {
      const groupExecutionArnPrefix = props.deploymentGroupStateMachineArn.replace(':stateMachine:', ':execution:');
      const groupStopResources = [props.deploymentGroupStateMachineArn, `${groupExecutionArnPrefix}:*`];
      baseStatements.push({
        effect: 'Allow',
        actions: ['states:StartExecution'],
        resources: [props.deploymentGroupStateMachineArn],
      });
      baseStatements.push({
        effect: 'Allow',
        actions: ['states:StopExecution', 'states:DescribeExecution', 'states:GetExecutionHistory'],
        resources: groupStopResources,
      });
    }
    if (props.deploymentsTableArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
          'dynamodb:Scan',
          'dynamodb:DeleteItem', // allow releasing stale locks from the portal
        ],
        resources: [props.deploymentsTableArn, `${props.deploymentsTableArn}/index/*`],
      });
    }
    if (props.deploymentGroupsTableArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [props.deploymentGroupsTableArn],
      });
    }
    if (props.imageMetadataTableArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Scan',
        ],
        resources: [props.imageMetadataTableArn],
      });
    }
    if (props.logsGroupArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: ['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'],
        resources: [props.logsGroupArn, `${props.logsGroupArn}:*`, `${props.logsGroupArn}:log-stream:*`],
      });
    }
    if (props.ecsClusterArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: ['ecs:StopTask', 'ecs:DescribeTasks'],
        resources: ['*'],
        condition: [
          {
            test: 'StringEquals',
            variable: 'ecs:cluster',
            values: [props.ecsClusterArn],
          },
        ],
      });
    }
    if (props.fleetAnalyticsTableArn) {
      baseStatements.push({
        sid: 'NumaDashboardReadFleetAnalytics',
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:BatchGetItem'],
        resources: [props.fleetAnalyticsTableArn, `${props.fleetAnalyticsTableArn}/index/*`],
      });
    }
    if (props.fleetAnalyticsLambdaArn) {
      baseStatements.push({
        sid: 'NumaDashboardInvokeRollup',
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [props.fleetAnalyticsLambdaArn],
      });
    }
    if (props.supportDocsBucketArn) {
      baseStatements.push({
        effect: 'Allow',
        actions: ['s3:ListBucket'],
        resources: [props.supportDocsBucketArn],
      });
      baseStatements.push({
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${props.supportDocsBucketArn}/*`],
      });
    }
    // FEAT-206 — Arcanum agent library authoring + deploy from the portal.
    if (props.arcanumAgentLibraryTableArn) {
      baseStatements.push({
        sid: 'ArcanumAgentLibraryCrud',
        effect: 'Allow',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [props.arcanumAgentLibraryTableArn, `${props.arcanumAgentLibraryTableArn}/index/*`],
      });
    }
    if (props.arcanumAgentDeploymentsTableArn) {
      baseStatements.push({
        sid: 'ArcanumAgentDeploymentsRead',
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
        resources: [props.arcanumAgentDeploymentsTableArn, `${props.arcanumAgentDeploymentsTableArn}/index/*`],
      });
    }
    if (props.arcanumAgentTargetsTableArn) {
      baseStatements.push({
        sid: 'ArcanumAgentTargetsCrud',
        effect: 'Allow',
        actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
        resources: [props.arcanumAgentTargetsTableArn],
      });
    }
    if (props.arcanumAgentLibraryBucketArn) {
      baseStatements.push({
        sid: 'ArcanumAgentLibraryBucketList',
        effect: 'Allow',
        actions: ['s3:ListBucket'],
        resources: [props.arcanumAgentLibraryBucketArn],
      });
      baseStatements.push({
        sid: 'ArcanumAgentLibraryBucketObjects',
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${props.arcanumAgentLibraryBucketArn}/*`],
      });
    }
    if (props.arcanumAgentDeployerLambdaArn) {
      baseStatements.push({
        sid: 'ArcanumAgentDeployerInvoke',
        effect: 'Allow',
        actions: ['lambda:InvokeFunction'],
        resources: [props.arcanumAgentDeployerLambdaArn],
      });
    }

    new IamRolePolicy(this, 'authenticated-policy', {
      name: 'customer-success-portal-authenticated-policy',
      role: authenticatedRole.id,
      policy: new DataAwsIamPolicyDocument(this, 'authenticated-policy-document', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        statement: baseStatements as any,
      }).json,
    });

    // Attach the authenticated role to the identity pool
    new CognitoIdentityPoolRolesAttachment(this, 'identity-pool-roles', {
      identityPoolId: this.identityPool.id,
      roles: {
        authenticated: authenticatedRole.arn,
      },
    });

    // Deploy frontend files and configuration
    const frontendPath = path.join(__dirname, '..', '..', 'numa-customer-success-portal', 'dist');
    const excludedFiles = ['config.json']; // We'll create config.json separately

    try {
      fs.readdirSync(frontendPath, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile())
        .filter((f) => !excludedFiles.includes(f.name))
        .map((f) => path.join(f.parentPath, f.name))
        .forEach((source) => {
          const contentType = {
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            json: 'application/json',
            svg: 'image/svg+xml',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            ico: 'image/x-icon',
            default: 'binary/octet-stream',
          }[source.split('.')?.pop() ?? 'default'];

          const relativePath = path.relative(frontendPath, source);
          // index.html must always revalidate so users pick up new hashed bundle refs after a deploy.
          const cacheControl = relativePath.endsWith('.html') ? 'no-cache' : undefined;
          new S3Object(this, `portal-file-${relativePath.replace(/[^a-zA-Z0-9]/g, '-')}`, {
            bucket: this.frontendBucket.bucket,
            contentType,
            cacheControl,
            key: relativePath,
            source,
            sourceHash: Fn.filemd5(source),
          });
        });
    } catch {
      console.warn('No frontend build found at: ' + frontendPath);
    }

    // Dynamic configuration file - deployed to S3 at runtime
    // Dynamic configuration file - deployed to S3 at runtime
    const portalConfig: Record<string, unknown> = {
      AWS_REGION: 'us-east-1',
      ECR_REGION: 'ap-southeast-2',
      ECR_REGISTRY_ID: '826326270637',
      USER_POOL_ID: this.userPool.id,
      USER_POOL_CLIENT_ID: this.userPoolClient.id,
      IDENTITY_POOL_ID: this.identityPool.id,
      ECR_REPOSITORY_URI: 'https://826326270637.dkr.ecr.ap-southeast-2.amazonaws.com/numa-deploy',
      CLIENT_CONFIG_TABLE: props.clientConfigTable.name,
      ACTIVITY_TABLE: this.activityTable.name,
      CLIENT_METADATA_TABLE: this.clientMetadataTable.name,
    };

    if (props.deploymentsTableName) {
      portalConfig['DEPLOYMENTS_TABLE'] = props.deploymentsTableName;
    }
    if (props.deploymentStateMachineArn) {
      portalConfig['DEPLOYMENT_SFN_ARN'] = props.deploymentStateMachineArn;
    }
    if (props.deploymentGroupStateMachineArn) {
      portalConfig['DEPLOYMENT_GROUP_SFN_ARN'] = props.deploymentGroupStateMachineArn;
    }
    if (props.imageMetadataTableName) {
      portalConfig['IMAGE_METADATA_TABLE'] = props.imageMetadataTableName;
    }
    if (props.deploymentGroupsTableName) {
      portalConfig['DEPLOYMENT_GROUPS_TABLE'] = props.deploymentGroupsTableName;
    }
    if (props.logsGroupName) {
      portalConfig['LOG_GROUP_NAME'] = props.logsGroupName;
    }
    if (props.logsGroupArn) {
      portalConfig['LOG_GROUP_ARN'] = props.logsGroupArn;
    }
    if (props.ecsClusterArn) {
      portalConfig['ECS_CLUSTER_ARN'] = props.ecsClusterArn;
    }
    if (props.nextgenBrokerLambdaName) {
      portalConfig['NEXTGEN_BROKER_LAMBDA'] = props.nextgenBrokerLambdaName;
    }
    if (props.nextgenBrokerRegion) {
      portalConfig['NEXTGEN_BROKER_REGION'] = props.nextgenBrokerRegion;
    }
    if (props.deploymentGroupDefaultConcurrency !== undefined) {
      portalConfig['DEPLOYMENT_GROUP_DEFAULT_CONCURRENCY'] = props.deploymentGroupDefaultConcurrency;
    }
    if (props.deploymentGroupMaxConcurrency !== undefined) {
      portalConfig['DEPLOYMENT_GROUP_MAX_CONCURRENCY'] = props.deploymentGroupMaxConcurrency;
    }
    if (props.supportDocsBucketName) {
      portalConfig['SUPPORT_DOCS_BUCKET'] = props.supportDocsBucketName;
    }
    if (props.fleetAnalyticsTableName) {
      portalConfig['FLEET_ANALYTICS_TABLE'] = props.fleetAnalyticsTableName;
    }
    if (props.fleetAnalyticsLambdaName) {
      portalConfig['FLEET_ANALYTICS_LAMBDA'] = props.fleetAnalyticsLambdaName;
    }
    if (props.arcanumAgentLibraryTableName) {
      portalConfig['ARCANUM_AGENT_LIBRARY_TABLE'] = props.arcanumAgentLibraryTableName;
    }
    if (props.arcanumAgentDeploymentsTableName) {
      portalConfig['ARCANUM_AGENT_DEPLOYMENTS_TABLE'] = props.arcanumAgentDeploymentsTableName;
    }
    if (props.arcanumAgentTargetsTableName) {
      portalConfig['ARCANUM_AGENT_TARGETS_TABLE'] = props.arcanumAgentTargetsTableName;
    }
    if (props.arcanumAgentLibraryBucketName) {
      portalConfig['ARCANUM_AGENT_LIBRARY_BUCKET'] = props.arcanumAgentLibraryBucketName;
    }
    if (props.arcanumAgentDeployerLambdaName) {
      portalConfig['ARCANUM_AGENT_DEPLOYER_LAMBDA'] = props.arcanumAgentDeployerLambdaName;
    }

    new S3Object(this, 'portal-config', {
      bucket: this.frontendBucket.bucket,
      key: 'config.json',
      content: JSON.stringify(portalConfig),
      contentType: 'application/json',
      // Per-deploy file — never let browsers serve a stale copy from heuristic cache.
      cacheControl: 'no-cache',
    });

    // Outputs
    new TerraformOutput(this, 'portal-url', {
      value: `https://${props.domainName}`,
      description: 'Customer Success Portal URL',
    });

    new TerraformOutput(this, 'customer-success-portal-frontend-bucket', {
      value: this.frontendBucket.id,
      description: 'Frontend S3 bucket for deployments',
    });

    new TerraformOutput(this, 'cloudfront-distribution-id', {
      value: this.distribution.id,
      description: 'CloudFront distribution ID for cache invalidation',
    });

    new TerraformOutput(this, 'user-pool-id', {
      value: this.userPool.id,
      description: 'Cognito User Pool ID for frontend configuration',
    });

    new TerraformOutput(this, 'user-pool-client-id', {
      value: this.userPoolClient.id,
      description: 'Cognito User Pool Client ID for frontend configuration',
    });

    new TerraformOutput(this, 'identity-pool-id', {
      value: this.identityPool.id,
      description: 'Cognito Identity Pool ID for AWS credentials',
    });

    new TerraformOutput(this, 'activity-table-name', {
      value: this.activityTable.name,
      description: 'Activity table name for audit logging',
    });

    // (Removed) Output for deployment history table – not needed
  }
}
