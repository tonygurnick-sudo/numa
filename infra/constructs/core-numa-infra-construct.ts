import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { CognitoUserPoolDomain } from '@cdktf/provider-aws/lib/cognito-user-pool-domain';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamServiceLinkedRole } from '@cdktf/provider-aws/lib/iam-service-linked-role';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { S3BucketCorsConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-cors-configuration';
import { S3BucketNotification } from '@cdktf/provider-aws/lib/s3-bucket-notification';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { password } from '@cdktf/provider-random';
import { RandomProvider } from '@cdktf/provider-random/lib/provider';
import { Fn, TerraformOutput, ITerraformDependable } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { AdjustToken } from './adjust-token-construct';
import { CognitoEmailHandler } from './cognito-email-handler-construct';
import { NoliaCognitoEmailHandler } from './nolia-cognito-email-handler-construct';
import { BoxDataSource, boxDataSourcePropsSchema } from './data-sources/box-datasource-construct';
import { S3DataSource, s3DataSourcePropsSchema } from './data-sources/s3-datasource-construct';
import { SharePointDataSource, sharePointDataSourcePropsSchema } from './data-sources/sharepoint-datasource-construct';
import { TeamsDataSource, teamsDataSourcePropsSchema } from './data-sources/teams-datasource-construct';
import { webCrawlerDataSourcePropsSchema, WebDataSourceConstruct } from './data-sources/web-datasource-construct';
import { NumaLambda } from './numa-lambda';
import { NumaLogGroup } from './numa-log-group';
import {
  QBusinessChatControlConfigurer,
  qBusinessChatControlConfigurerPropsSchema,
} from './q-business-chat-control-configurer-construct';
import { SetCallbackUrl } from './set-callback-url-construct';
import { SystemUserCreator } from './system-user-creator-construct';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { CloudwatchEventBus } from '@cdktf/provider-aws/lib/cloudwatch-event-bus';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { ConfigBucket } from './config-bucket-construct';
import { z } from 'zod';
import { WebCrawlerConstruct } from './web-crawler-construct';
import { CognitoGroupsConstruct, FEATURE_SET_NAMES } from './cognito-groups-construct';
import { KnowledgeBase } from './knowledge-base-construct';
import { PublicS3Bucket } from './public-s3-bucket-construct';

export class CoreNumaInfra extends Construct {
  readonly userPoolId: string;
  readonly userPoolClient: CognitoUserPoolClient;
  readonly groups: Record<string, { roleArn: string; features: string[] }>;
  readonly webExUrl?: string;
  readonly webExperienceRoleArn?: string;
  readonly qBusinessApplicationId?: string;
  readonly qBusinessIndexId?: string;
  readonly qBusinessRetrieverId?: string;
  readonly defaultWebIdentityRoleArn?: string;
  readonly logGroup: CloudwatchLogGroup;
  readonly outputsBucket: NumaCorsEnabledBucket;
  readonly otelConfigPath: string;
  readonly dataBucket: NumaCorsEnabledBucket;
  readonly companyBucket?: NumaCorsEnabledBucket;
  readonly chatHistoryTable: DynamodbTable;
  readonly brandingTable: DynamodbTable;
  readonly brandingAssetsBucket: PublicS3Bucket;
  readonly brandingAssetsBucketArn: string;
  readonly brandingAssetsBucketName: string;
  readonly brandingAssetsPrefix: string;
  readonly knowledgeBasesTable: DynamodbTable;
  readonly workspaceAgentsTable: DynamodbTable;
  readonly userAgentsTable: DynamodbTable;
  readonly agentsSettingsTable: DynamodbTable;
  readonly schedulingSettingsTable: DynamodbTable;
  readonly agentSchedulesTable: DynamodbTable;
  readonly notificationsTable: DynamodbTable;
  readonly chatSettingsTable: DynamodbTable;
  readonly dataConnectorsTable: DynamodbTable;
  readonly dataConnectorsSettingsTable: DynamodbTable;
  readonly capabilitiesTable: DynamodbTable;
  readonly dataConnectorsSyncConfigsTable: DynamodbTable;
  readonly vaultAuditLogTable: DynamodbTable;
  readonly sharedTable: DynamodbTable;
  readonly sharedChatHistoryTable: DynamodbTable;
  readonly mfaSettingsTable: DynamodbTable;
  readonly filesTable?: DynamodbTable;
  readonly webCrawler: WebCrawlerConstruct;
  readonly cognitoGroups!: CognitoGroupsConstruct;
  readonly pipedreamRelayLambdaArn?: string;
  readonly connectorEventsTable!: DynamodbTable;
  readonly connectorEventConfigsTable!: DynamodbTable;
  readonly connectorEventBusName!: string;
  readonly mcpPolicyTable?: DynamodbTable;
  readonly integrationsApprovalTable?: DynamodbTable;
  readonly usageAnalyticsEventsTable!: DynamodbTable;
  readonly usageAnalyticsKeysTable!: DynamodbTable;
  readonly usageAnalyticsCountersTable!: DynamodbTable;
  readonly auditWebCrawlerTable!: DynamodbTable;
  readonly auditAutomationTable!: DynamodbTable;
  readonly auditSearchIndexTable!: DynamodbTable;
  readonly auditKbIndexTable!: DynamodbTable;
  readonly auditScheduleTable!: DynamodbTable;
  readonly auditSyncTable!: DynamodbTable;
  readonly auditRecoveryTable!: DynamodbTable;
  readonly auditUserManagementTable!: DynamodbTable;

  constructor(scope: Construct, name: string, props: CoreNumaInfraProps) {
    super(scope, name);

    props.indexType ??= 'STARTER';
    props.loadSampleFile ??= true;
    props.createServiceLinkedRole ??= true;
    props.webCrawlerConfigs ??= [];
    props.temporaryPasswordValidityDays ??= 30;
    props.devInstance ??= false;
    props.provisionQResources ??= false; // false → skip Q‑Business resources by default

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {});

    const numaClient = `numa-${props.clientName}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;
    const brandingPrefix = '';

    // TODO: Typing
    let appIdentityConfig;
    let webexIdentityConfig;

    // Create Cognito email handler Lambda function
    const cognitoEmailHandler = new CognitoEmailHandler(this, 'cognito-email-handler', {
      nameSuffix: numaClient,
      domainName: props.emailDomain ?? props.domainName,
    });

    // Use Nolia-branded email handler for Nolia clients
    const emailDomain = props.emailDomain ?? props.domainName;
    let customMessageLambda = cognitoEmailHandler.function;

    if (emailDomain.includes('getnolia.io')) {
      const noliaCognitoEmailHandler = new NoliaCognitoEmailHandler(this, 'nolia-cognito-email-handler', {
        nameSuffix: numaClient,
        domainName: emailDomain,
      });
      customMessageLambda = noliaCognitoEmailHandler.function;
    }

    const at = new AdjustToken(this, 'token-adjuster', {
      nameSuffix: numaClient,
      mfaSettingsTableName: `${numaClient}-mfa-settings`,
    });
    const cognitoDomain = numaClient;

    const mfa =
      (props.mfa ?? false)
        ? {
            mfaConfiguration: 'ON',
            softwareTokenMfaConfiguration: {
              enabled: true,
            },
            deviceConfiguration: {
              challengeRequiredOnNewDevice: true,
              deviceOnlyRememberedOnUserPrompt: true,
            },
          }
        : {
            mfaConfiguration: 'OFF',
          };
    const userPool = new CognitoUserPool(this, 'user-pool', {
      name: numaClient,
      usernameAttributes: ['email'],
      lambdaConfig: {
        preTokenGenerationConfig: {
          lambdaArn: at.function.arn,
          lambdaVersion: 'V2_0',
        },
        customMessage: customMessageLambda.arn,
      },
      userPoolAddOns: {
        advancedSecurityMode: 'AUDIT',
      },
      passwordPolicy: {
        minimumLength: props.passwordLength ?? 8,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
        requireUppercase: true,
        passwordHistorySize: 18,
        temporaryPasswordValidityDays: props.temporaryPasswordValidityDays,
      },
      ...mfa,
    });
    this.userPoolId = userPool.id;

    new LambdaPermission(this, 'cognito-token-adjuster-permission', {
      statementId: 'cognito-token-adjuster',
      functionName: at.function.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: userPool.arn,
    });

    new TerraformOutput(this, 'user-pool-id', {
      value: userPool.id,
    });

    new CognitoUserPoolDomain(this, 'domain', {
      userPoolId: userPool.id,
      domain: cognitoDomain,
    });

    // Grant permissions for Cognito to invoke the email handler Lambda
    new LambdaPermission(this, 'cognito-email-permission', {
      statementId: 'cognito-email-handler',
      functionName: customMessageLambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: userPool.arn,
    });

    new RandomProvider(this, 'random-provider', {});
    const systemUserPassword = new password.Password(this, 'password', {
      length: 64,
      minLower: 5,
      minNumeric: 5,
      minSpecial: 5,
      minUpper: 5,
    }).result;
    const systemUserEmail = 'numa-system-user@arcanum.ai';
    // Use SystemUserCreator for idempotent user creation and admin group membership
    // This won't fail if user already exists and ensures they're always in the admin group
    new SystemUserCreator(this, 'system-user', {
      clientName: props.clientName,
      userPoolId: userPool.id,
      userPoolArn: userPool.arn,
      username: systemUserEmail,
      password: systemUserPassword,
      groupName: 'admin',
    });
    const systemUserSecret = new SecretsmanagerSecret(this, 'system-user-secret-manager-secret', {
      name: `${props.clientName}-system-user-password`,
    });
    new SecretsmanagerSecretVersion(this, 'system-user-secret-version', {
      secretId: systemUserSecret.arn,
      secretString: JSON.stringify({
        username: systemUserEmail,
        password: systemUserPassword,
      }),
    });

    new TerraformOutput(this, 'system-user-secret', {
      value: systemUserSecret.arn,
    });

    this.userPoolClient = new CognitoUserPoolClient(this, 'client', {
      userPoolId: userPool.id,
      name: numaClient,
      generateSecret: true,
      callbackUrls: [`https://${props.domainName}/`],
      allowedOauthFlowsUserPoolClient: true,
      allowedOauthFlows: ['code'],
      allowedOauthScopes: ['openid', 'email', 'profile'],
      accessTokenValidity: 60,
      refreshTokenValidity: 60,
      idTokenValidity: 60,
      tokenValidityUnits: [{ accessToken: 'minutes', refreshToken: 'days', idToken: 'minutes' }],
      supportedIdentityProviders: ['COGNITO'],
      // DANGER: Conditional lifecycle management for Cognito OAuth callback URLs
      //
      // PROBLEM: The previous unconditional `ignoreChanges: ['callback_urls']` was preventing
      // Terraform from setting initial OAuth callback URLs, causing deployment failures with:
      // "CallbackUrls can not be empty when code flow or implicit flow is selected"
      //
      // SOLUTION: Only ignore callback_urls changes when Q Business is provisioned, because
      // in that case the SetCallbackUrl construct's Lambda will manage them dynamically.
      // For non-Q Business clients, Terraform should manage callback URLs normally.
      //
      // RISK: This change affects OAuth flow initialization. Test thoroughly before production.
      lifecycle: {
        ignoreChanges: props.provisionQResources ? ['callback_urls'] : [],
      },
    });

    // Create data bucket
    this.dataBucket = new NumaCorsEnabledBucket(this, 'data-source-bucket', {
      bucketName: 'data',
      clientName: props.clientName,
      origin: props.domainName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      additionalOrigins: props.additionalOrigins,
      region: props.region,
    });
    this.dataBucket.bucket.moveFromId('aws_s3_bucket.data-source-bucket_1F269801');

    // Create company bucket
    this.companyBucket = new NumaCorsEnabledBucket(this, 'company-data-bucket', {
      bucketName: 'company',
      clientName: props.clientName,
      origin: props.domainName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      additionalOrigins: props.additionalOrigins,
      region: props.region,
    });

    // Create outputs bucket
    this.outputsBucket = new NumaCorsEnabledBucket(this, 'outputs-bucket', {
      clientName: props.clientName,
      origin: props.domainName,
      clientAccountId: props.clientAccountId,
      environmentName: props.environmentName,
      bucketName: 'outputs',
      allowedMethods: ['GET', 'HEAD', 'PUT'],
      allowLocalhostOrigin: props.devInstance,
      additionalOrigins: props.additionalOrigins,
      region: props.region,
    });
    this.outputsBucket.bucket.moveFromId('aws_s3_bucket.outputs-bucket_1F269801');

    const brandingBucketName = `${numaClient}-branding`;
    this.brandingAssetsBucket = new PublicS3Bucket(this, 'branding-assets-bucket', {
      bucket: brandingBucketName,
      forceDestroy: props.environmentName !== 'prod',
      tags: {
        Name: brandingBucketName,
        Environment: props.environmentName,
        Purpose: 'branding-assets',
      },
    });

    const brandingAllowedOrigins = [`https://${props.domainName}`];
    // TODO: Remove once Nolia whitelabel moves to HTTPS and uses additionalOrigins config
    brandingAllowedOrigins.push('http://worldbank.getnolia.io');
    if (props.devInstance ?? props.environmentName !== 'prod') {
      brandingAllowedOrigins.push('http://localhost:5173');
    }
    if (props.additionalOrigins) {
      brandingAllowedOrigins.push(...props.additionalOrigins);
    }

    new S3BucketCorsConfiguration(this, 'branding-assets-cors', {
      bucket: this.brandingAssetsBucket.id,
      corsRule: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
          allowedOrigins: brandingAllowedOrigins,
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3000,
        },
      ],
    });

    new S3Object(this, 'branding-prefix-placeholder', {
      bucket: this.brandingAssetsBucket.bucket,
      key: brandingPrefix ? `${brandingPrefix}.keep` : '.keep',
      content: 'placeholder',
    });

    this.brandingAssetsBucketArn = this.brandingAssetsBucket.arn;
    this.brandingAssetsBucketName = this.brandingAssetsBucket.bucket;
    this.brandingAssetsPrefix = brandingPrefix;

    // Create chat history table
    this.chatHistoryTable = new DynamodbTable(this, 'numa-chat-history-table', {
      name: `${numaClient}-chat-history`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'sk',
      attribute: [
        {
          name: 'user_id',
          type: 'S',
        },
        {
          name: 'sk',
          type: 'S',
        },
      ],
    });

    this.brandingTable = new DynamodbTable(this, 'numa-branding-config-table', {
      name: `${numaClient}-branding-config`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'client_id',
      rangeKey: 'config_id',
      attribute: [
        {
          name: 'client_id',
          type: 'S',
        },
        {
          name: 'config_id',
          type: 'S',
        },
      ],
      tags: {
        Name: `${numaClient}-branding-config`,
        Environment: props.environmentName,
        Purpose: 'branding-config',
      },
    });

    // Create knowledge bases table for logical KB partitioning
    this.knowledgeBasesTable = new DynamodbTable(this, 'numa-knowledge-bases-table', {
      name: `${numaClient}-knowledge-bases`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'PK',
      rangeKey: 'SK',
      attribute: [
        {
          name: 'PK',
          type: 'S',
        },
        {
          name: 'SK',
          type: 'S',
        },
        {
          name: 'GSI1PK',
          type: 'S',
        },
        {
          name: 'GSI1SK',
          type: 'S',
        },
      ],
      globalSecondaryIndex: [
        {
          name: 'GSI1',
          hashKey: 'GSI1PK',
          rangeKey: 'GSI1SK',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-knowledge-bases`,
        Environment: props.environmentName,
        Purpose: 'knowledge-base-management',
      },
    });

    // Create log group for core resources (needs to be before lambdas)
    this.logGroup = new NumaLogGroup(this, 'core-log-group', {
      logGroupName: `${props.clientName}-core`,
    }).logGroup;

    this.logGroup.addMoveTarget(`${props.clientName}-core-log-group`);

    // Create seed-default-kb Lambda to initialize default knowledge base
    const seedDefaultKbLambda = new NumaLambda(this, 'seed-default-kb', {
      clientName: props.clientName,
      lambdaDirectory: 'python/seed-default-kb/',
      logGroup: this.logGroup,
      resourceNameSuffix: '_seed-default-kb',
      environment: {
        CLIENT_NAME: props.clientName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          resources: [this.knowledgeBasesTable.arn],
        },
      ],
    });

    // Invoke seed-default-kb Lambda once on stack creation
    new LambdaInvocation(this, 'seed-default-kb-invocation', {
      functionName: seedDefaultKbLambda.lambda.functionName,
      input: JSON.stringify({}),
      triggers: {
        knowledgeBasesTableName: this.knowledgeBasesTable.name,
        seedDefaultKbSourceHash: seedDefaultKbLambda.lambda.sourceCodeHash,
      },
      dependsOn: [
        this.knowledgeBasesTable,
        seedDefaultKbLambda.lambda,
        ...seedDefaultKbLambda.additionalPolicies,
        ...seedDefaultKbLambda.policyAttachments,
      ],
    });

    // Create backfill-metadata Lambda (idempotent; safe to run once post-deploy)
    // For Q Business clients, this also deletes metadata under documents/company/
    const backfillMetadataLambda = new NumaLambda(this, 'backfill-metadata', {
      clientName: props.clientName,
      lambdaDirectory: 'python/backfill-metadata/',
      logGroup: this.logGroup,
      resourceNameSuffix: '_backfill-metadata',
      environment: {
        CLIENT_NAME: props.clientName,
        BUCKET_NAME: this.dataBucket.bucket.bucket,
        PREFERRED_KNOWLEDGE_BASE: props.provisionQResources ? 'q' : 'bedrock',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:HeadObject', 's3:DeleteObject'],
          resources: [this.dataBucket.bucket.arn, `${this.dataBucket.bucket.arn}/*`],
        },
      ],
    });

    // Backfill metadata sidecars for any files that are missing them.
    // Runs on every deploy as a safety net (idempotent - skips existing sidecars).
    new LambdaInvocation(this, 'backfill-metadata-invocation', {
      functionName: backfillMetadataLambda.lambda.functionName,
      input: JSON.stringify({}),
      triggers: {
        dataBucketName: this.dataBucket.bucket.bucket,
        backfillSourceHash: backfillMetadataLambda.lambda.sourceCodeHash,
        // Force re-run on every deploy as a safety net for missing metadata
        deployTimestamp: Date.now().toString(),
      },
      dependsOn: [
        this.dataBucket.bucket,
        backfillMetadataLambda.lambda,
        ...backfillMetadataLambda.additionalPolicies,
        ...backfillMetadataLambda.policyAttachments,
      ],
    });

    // Agents tables
    this.workspaceAgentsTable = new DynamodbTable(this, 'numa-workspace-agents-table', {
      name: `${numaClient}-agents`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'tenant_id',
      rangeKey: 'agent_id',
      attribute: [
        { name: 'tenant_id', type: 'S' },
        { name: 'agent_id', type: 'S' },
        { name: 'created_by_user_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'agent-id-index',
          hashKey: 'agent_id',
          projectionType: 'ALL',
        },
        {
          name: 'agent-creator-index',
          hashKey: 'created_by_user_id',
          projectionType: 'ALL',
        },
      ],
    });

    this.userAgentsTable = new DynamodbTable(this, 'numa-user-agents-table', {
      name: `${numaClient}-user-agents`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'agent_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'agent_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'agent-id-index',
          hashKey: 'agent_id',
          projectionType: 'ALL',
        },
      ],
    });

    // Agents settings table (company-wide policy)
    this.agentsSettingsTable = new DynamodbTable(this, 'numa-agents-settings-table', {
      name: `${numaClient}-agents-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'setting',
      attribute: [{ name: 'setting', type: 'S' }],
      tags: {
        Name: `${numaClient}-agents-settings`,
        Environment: props.environmentName,
        Purpose: 'agents-settings',
      },
    });

    // Scheduling settings table (client-admin minimum interval override)
    this.schedulingSettingsTable = new DynamodbTable(this, 'numa-scheduling-settings-table', {
      name: `${numaClient}-scheduling-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'setting',
      attribute: [{ name: 'setting', type: 'S' }],
      tags: {
        Name: `${numaClient}-scheduling-settings`,
        Environment: props.environmentName,
        Purpose: 'scheduling-settings',
      },
    });

    // MFA settings table (device remember duration + per-device trust records)
    this.mfaSettingsTable = new DynamodbTable(this, 'numa-mfa-settings-table', {
      name: `${numaClient}-mfa-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'setting',
      attribute: [{ name: 'setting', type: 'S' }],
      ttl: {
        attributeName: 'ttl',
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-mfa-settings`,
        Environment: props.environmentName,
        Purpose: 'mfa-settings',
      },
    });

    this.agentSchedulesTable = new DynamodbTable(this, 'numa-agent-schedules-table', {
      name: `${numaClient}-agent-schedules`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'schedule_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'schedule_id', type: 'S' },
        { name: 'event_type', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'schedule-id-index',
          hashKey: 'schedule_id',
          projectionType: 'ALL',
        },
        {
          name: 'event-type-index',
          hashKey: 'event_type',
          rangeKey: 'user_id',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-agent-schedules`,
        Environment: props.environmentName,
        Purpose: 'agent-schedules',
      },
    });

    // Notifications table for schedule events
    this.notificationsTable = new DynamodbTable(this, 'numa-notifications-table', {
      name: `${numaClient}-notifications`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'notification_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'notification_id', type: 'S' },
        { name: 'schedule_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'schedule-id-index',
          hashKey: 'schedule_id',
          projectionType: 'ALL',
        },
      ],
      ttl: {
        attributeName: 'expires_at',
        enabled: true,
      },
      pointInTimeRecovery: {
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-notifications`,
        Environment: props.environmentName,
        Purpose: 'notifications',
      },
    });

    // User chat settings table (per-user defaults for tools, KBs, integrations)
    this.chatSettingsTable = new DynamodbTable(this, 'user-chat-settings-table', {
      name: `${numaClient}-chat-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      attribute: [{ name: 'user_id', type: 'S' }],
      tags: {
        Name: `${numaClient}-chat-settings`,
        Environment: props.environmentName,
        Purpose: 'user-chat-settings',
      },
    });

    this.dataConnectorsTable = new DynamodbTable(this, 'data-connectors-table', {
      name: `${numaClient}-data-connectors`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'connector_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'connector_id', type: 'S' },
      ],
      tags: {
        Name: `${numaClient}-data-connectors`,
        Environment: props.environmentName,
        Purpose: 'data-connectors',
      },
    });

    this.dataConnectorsSettingsTable = new DynamodbTable(this, 'global-data-connectors-settings', {
      name: `${numaClient}-global-data-connector-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'connector',
      attribute: [{ name: 'connector', type: 'S' }],
      tags: {
        Name: `${numaClient}-global-data-connector-settings`,
        Environment: props.environmentName,
        Purpose: 'global-data-connector-settings',
      },
    });

    this.capabilitiesTable = new DynamodbTable(this, 'capabilities-table', {
      name: `${numaClient}-capabilities`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'flag',
      attribute: [{ name: 'flag', type: 'S' }],
      tags: {
        Name: `${numaClient}-capabilities`,
        Environment: props.environmentName,
        Purpose: 'capabilities',
      },
    });

    this.dataConnectorsSyncConfigsTable = new DynamodbTable(this, 'data-connector-sync-configs', {
      name: `${numaClient}-data-connector-sync-configs`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'sync_config_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'sync_config_id', type: 'S' },
      ],
      tags: {
        Name: `${numaClient}-data-connector-sync-configs`,
        Environment: props.environmentName,
        Purpose: 'data-connector-sync-configs',
      },
    });

    // Connector events table (permanent record of connector-produced events)
    this.connectorEventsTable = new DynamodbTable(this, 'connector-events-table', {
      name: `${numaClient}-connector-events`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'pk',
      rangeKey: 'sk',
      attribute: [
        { name: 'pk', type: 'S' },
        { name: 'sk', type: 'S' },
      ],
      tags: {
        Name: `${numaClient}-connector-events`,
        Environment: props.environmentName,
        Purpose: 'connector-events',
      },
    });

    // Connector event configs table (admin toggle/tags per event type)
    this.connectorEventConfigsTable = new DynamodbTable(this, 'connector-event-configs-table', {
      name: `${numaClient}-connector-event-configs`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'connector_id',
      rangeKey: 'event_type',
      attribute: [
        { name: 'connector_id', type: 'S' },
        { name: 'event_type', type: 'S' },
      ],
      tags: {
        Name: `${numaClient}-connector-event-configs`,
        Environment: props.environmentName,
        Purpose: 'connector-event-configs',
      },
    });

    // EventBridge custom bus for connector events
    const connectorEventBus = new CloudwatchEventBus(this, 'connector-event-bus', {
      name: `numa-${numaClient}-connector-events`,
      tags: {
        Name: `numa-${numaClient}-connector-events`,
        Environment: props.environmentName,
        Purpose: 'connector-events',
      },
    });
    this.connectorEventBusName = connectorEventBus.name;

    // Vault audit log table (tracks secret access by users and AI)
    // NOTE: Vault secrets are now stored directly in AWS Secrets Manager as consolidated JSON per user
    this.vaultAuditLogTable = new DynamodbTable(this, 'vault-audit-log-table', {
      name: `${numaClient}-vault-audit-log`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'timestamp_audit_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'timestamp_audit_id', type: 'S' },
      ],
      ttl: { attributeName: 'ttl', enabled: true },
      tags: {
        Name: `${numaClient}-vault-audit-log`,
        Environment: props.environmentName,
        Purpose: 'vault-audit-log',
      },
    });

    // Shared document Q&A table for public sharing feature
    this.sharedTable = new DynamodbTable(this, 'numa-shared-table', {
      name: `${numaClient}-shared`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'uuid',
      attribute: [
        { name: 'uuid', type: 'S' },
        { name: 'created_by', type: 'S' },
        { name: 'created_at', type: 'N' },
      ],
      globalSecondaryIndex: [
        {
          name: 'created_by-created_at-index',
          hashKey: 'created_by',
          rangeKey: 'created_at',
          projectionType: 'ALL',
        },
      ],
      ttl: {
        attributeName: 'expiry',
        enabled: false,
      },
      tags: {
        Name: `${numaClient}-shared`,
        Environment: props.environmentName,
        Purpose: 'shared-document-qa',
      },
    });

    // Shared chat history table for public sharing feature with TTL auto-cleanup
    this.sharedChatHistoryTable = new DynamodbTable(this, 'numa-shared-chat-history-table', {
      name: `${numaClient}-shared-chat-history`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'uuid',
      rangeKey: 'sk',
      attribute: [
        { name: 'uuid', type: 'S' },
        { name: 'sk', type: 'S' },
      ],
      ttl: {
        attributeName: 'expiry',
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-shared-chat-history`,
        Environment: props.environmentName,
        Purpose: 'shared-document-chat-history',
      },
    });

    // Files table for per-user virtual file system (My Files, Company, Projects)
    if (props.numaFiles) {
      this.filesTable = new DynamodbTable(this, 'numa-files-table', {
        name: `${numaClient}-files`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'scope_key',
        rangeKey: 'sk',
        attribute: [
          { name: 'scope_key', type: 'S' },
          { name: 'sk', type: 'S' },
        ],
        tags: {
          Name: `${numaClient}-files`,
          Environment: props.environmentName,
          Purpose: 'user-file-system',
        },
      });

      // S3 → DynamoDB index sync Lambda (keeps DynamoDB cache in sync with S3 source of truth)
      const filesIndexSyncLambda = new NumaLambda(this, 'files-index-sync', {
        clientName: props.clientName,
        lambdaDirectory: 'node/files-index-sync/',
        logGroup: this.logGroup,
        resourceNameSuffix: '_files-index-sync',
        environment: {
          FILES_TABLE_NAME: this.filesTable.name,
          DATA_BUCKET_NAME: this.dataBucket.bucket.bucket,
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
            resources: [this.filesTable.arn],
          },
          {
            effect: 'Allow',
            actions: ['s3:GetObject'],
            resources: [`${this.dataBucket.bucket.arn}/files/*`],
          },
        ],
      });

      // Permission for S3 to invoke the sync Lambda
      const filesIndexSyncS3Permission = new LambdaPermission(this, 'files-index-sync-s3-permission', {
        statementId: 'AllowS3InvokeFilesIndexSync',
        functionName: filesIndexSyncLambda.lambda.functionName,
        action: 'lambda:InvokeFunction',
        principal: 's3.amazonaws.com',
        sourceArn: this.dataBucket.bucket.arn,
      });

      // S3 bucket notification: trigger sync Lambda on metadata.json and _folder.json changes
      // dependsOn ensures the Lambda permission exists before S3 tries to validate the destination
      new S3BucketNotification(this, 'files-data-bucket-notification', {
        bucket: this.dataBucket.bucket.id,
        dependsOn: [filesIndexSyncS3Permission],
        lambdaFunction: [
          {
            events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
            filterPrefix: 'files/',
            filterSuffix: 'metadata.json',
            lambdaFunctionArn: filesIndexSyncLambda.lambda.arn,
          },
          {
            events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
            filterPrefix: 'files/',
            filterSuffix: '_folder.json',
            lambdaFunctionArn: filesIndexSyncLambda.lambda.arn,
          },
        ],
      });
    }

    // Create config bucket and otel config
    const otelConfigKey = 'otel-config.yaml';
    const configBucket = new ConfigBucket(this, 'config-bucket', {
      clientName: props.clientName,
      clientAccountId: props.clientAccountId,
    });

    const source = path.resolve(import.meta.dirname, '..', 'assets', 'otel-config.yaml');
    new S3Object(this, 'honeycomb-config-file', {
      bucket: configBucket.bucket.bucket,
      key: otelConfigKey,
      source,
    });

    this.otelConfigPath = `${configBucket.bucket.bucketRegionalDomainName}/${otelConfigKey}`;

    const webCrawlerLogGroup = new CloudwatchLogGroup(this, 'web-crawler-log-group', {
      name: `/numa/${props.clientName}-web-crawler`,
    });

    this.webCrawler = new WebCrawlerConstruct(this, 'web-crawler', {
      clientName: props.clientName,
      environmentName: props.environmentName,
      dataBucket: this.dataBucket,
      logGroup: webCrawlerLogGroup,
      region: props.region,
      provisionQResources: props.provisionQResources,
    });

    // We'll create the Cognito IDP construct after determining Q Business configuration
    let qBusinessApplicationIdForIdp: string | undefined = undefined;

    /* ──────────────────────────────
     * Optional Amazon Q‑Business
     * ────────────────────────────── */
    if (props.provisionQResources) {
      const oidc = new CloudcontrolapiResource(this, 'idp', {
        typeName: 'AWS::IAM::OIDCProvider',
        desiredState: Fn.jsonencode({
          Url: `https://${userPool.endpoint}`,
          ClientIdList: [this.userPoolClient.id],
        }),
      });
      const oidcArn = Fn.lookup(Fn.jsondecode(oidc.properties), 'Arn');

      const secret = new SecretsmanagerSecret(this, 'secret', {
        namePrefix: `QBusiness-oidc-client-secret-${numaClient}-`,
      });

      const secretsPolicyDocument = new DataAwsIamPolicyDocument(this, 'secrets-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['secretsmanager:GetSecretValue'],
            resources: [secret.arn],
          },
        ],
      });

      const secretsTrustPolicyDocument = new DataAwsIamPolicyDocument(this, 'secrets-policy-trust-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole', 'sts:SetContext'],
            principals: [
              {
                identifiers: ['application.qbusiness.amazonaws.com'],
                type: 'Service',
              },
            ],
          },
        ],
      });

      const secretsRole = new IamRole(this, 'secrets-role', {
        name: `numa-secrets-role-${numaClient}`,
        assumeRolePolicy: secretsTrustPolicyDocument.json,
      });

      new IamRolePolicy(this, 'secrets-role-policy', {
        name: 'policy',
        role: secretsRole.name,
        policy: secretsPolicyDocument.json,
      });

      if (props.createServiceLinkedRole) {
        new IamServiceLinkedRole(this, 'q-service-role', {
          awsServiceName: 'qbusiness.amazonaws.com',
        });
      }

      new SecretsmanagerSecretVersion(this, 'secret-version', {
        secretId: secret.id,
        secretString: `{"client_secret": "${this.userPoolClient.clientSecret}"}`,
      });

      appIdentityConfig = {
        IdentityType: 'AWS_IAM_IDP_OIDC',
        ClientIdsForOIDC: [this.userPoolClient.id],
        IamIdentityProviderArn: oidcArn,
        RoleArn: `arn:aws:iam::${callerId.accountId}:role/aws-service-role/qbusiness.amazonaws.com/AWSServiceRoleForQBusiness`, // TODO: Dynamic.
      };

      webexIdentityConfig = {
        IdentityProviderConfiguration: {
          OpenIDConnectConfiguration: {
            SecretsArn: secret.arn,
            SecretsRole: secretsRole.arn,
          },
        },
      };

      // TODO: Set this up as per https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/making-sigv4-authenticated-api-calls-iam.html#control-plane-setup-iam
      const rolePolicyDocument = new DataAwsIamPolicyDocument(this, 'role-policy-doc', {
        version: '2012-10-17',
        statement: [
          {
            effect: 'Allow',
            actions: ['*'],
            resources: ['*'],
          },
        ],
      });

      const webExArn = `arn:aws:iam::${callerId.accountId}:oidc-provider/cognito-idp.${props.region}.amazonaws.com/${userPool.id}`;

      const webExperienceTrustDocument = new DataAwsIamPolicyDocument(this, 'webex-policy-trust-doc', {
        statement: [
          {
            actions: ['sts:AssumeRoleWithWebIdentity'],
            principals: [
              {
                type: 'Federated',
                identifiers: [webExArn],
              },
            ],
          },
          {
            actions: ['sts:TagSession'],
            principals: [
              {
                type: 'Federated',
                identifiers: [webExArn],
              },
            ],
            condition: [
              {
                test: 'StringLike',
                values: ['*'],
                variable: 'aws:RequestTag/Email',
              },
              {
                test: 'ForAllValues:StringEquals',
                values: ['Email'],
                variable: 'sts:TransitiveTagKeys',
              },
            ],
          },
        ],
      });

      const role = new IamRole(this, 'web-experience-role', {
        // TODO: Does this need to be different for IDC?

        name: `web-experience-role-${numaClient}`,
        assumeRolePolicy: webExperienceTrustDocument.json,
      });
      this.webExperienceRoleArn = role.arn;
      // When Q‑Business is enabled, prefer its WebExperience role as the default role for the front‑end.
      this.defaultWebIdentityRoleArn = role.arn;

      new IamRolePolicy(this, 'web-experience-policy', {
        name: 'policy',
        role: role.name,
        policy: rolePolicyDocument.json,
      });

      const application = new CloudcontrolapiResource(this, 'qbus', {
        typeName: 'AWS::QBusiness::Application',
        desiredState: Fn.jsonencode({
          DisplayName: numaClient,
          AutoSubscriptionConfiguration: {
            AutoSubscribe: 'ENABLED',
            DefaultSubscriptionType: 'Q_LITE',
          },
          ...appIdentityConfig,
        }),
        provider: props.qBusinessProvider,
      });
      this.qBusinessApplicationId = Fn.lookup(Fn.jsondecode(application.properties), 'ApplicationId');
      qBusinessApplicationIdForIdp = this.qBusinessApplicationId;

      const origins = props.enableIFrame
        ? {
            Origins: [`https://${props.domainName}`],
          }
        : {};

      if (!this.qBusinessApplicationId) {
        throw new Error('Q Business application ID is required for chat control configuration');
      }

      new QBusinessChatControlConfigurer(this, 'chat-control', {
        applicationId: this.qBusinessApplicationId,
        enableDirectLLMAccess: props.enableDirectLLMAccess,
        enableLLMKnowledgeFallback: props.enableLLMKnowledgeFallback,
        region: props.qBusinessProvider?.region ?? props.region,
        accountId: callerId.accountId,
      });

      const webexperience = new CloudcontrolapiResource(this, 'web-experience', {
        typeName: 'AWS::QBusiness::WebExperience',
        desiredState: Fn.jsonencode({
          ApplicationId: this.qBusinessApplicationId,
          RoleArn: role.arn,
          ...webexIdentityConfig,
          ...origins,
        }),
        provider: props.qBusinessProvider,
      });

      this.webExUrl = Fn.lookup(Fn.jsondecode(webexperience.properties), 'DefaultEndpoint');

      new SetCallbackUrl(this, 'callback', {
        callbackAddress: this.webExUrl + 'authorization-code/callback',
        userPoolClientId: this.userPoolClient.id,
        userPoolId: userPool.id,
        region: props.region,
      });

      if (props.indexUnits) {
        if (props.indexType === 'ENTERPRISE' && (props.indexUnits < 1 || props.indexUnits > 50)) {
          throw new Error('Enterprise index units must be between 1 and 50');
        }
        if (props.indexType === 'STARTER' && (props.indexUnits < 1 || props.indexUnits > 5)) {
          throw new Error('Starter index units must be between 1 and 5');
        }
      }

      const index = new CloudcontrolapiResource(this, 'index', {
        typeName: 'AWS::QBusiness::Index',
        desiredState: Fn.jsonencode({
          ApplicationId: this.qBusinessApplicationId,
          DisplayName: numaClient,
          Type: props.indexType,
          CapacityConfiguration: {
            Units: props.indexUnits ?? 1,
          },
        }),
        provider: props.qBusinessProvider,
      });
      this.qBusinessIndexId = Fn.lookup(Fn.jsondecode(index.properties), 'IndexId');

      const retriever = new CloudcontrolapiResource(this, 'retriever', {
        typeName: 'AWS::QBusiness::Retriever',
        desiredState: Fn.jsonencode({
          ApplicationId: this.qBusinessApplicationId,
          DisplayName: numaClient,
          Configuration: {
            NativeIndexConfiguration: {
              IndexId: this.qBusinessIndexId,
            },
          },
          Type: 'NATIVE_INDEX',
        }),
        provider: props.qBusinessProvider,
      });
      this.qBusinessRetrieverId = Fn.lookup(Fn.jsondecode(retriever.properties), 'RetrieverId');

      if (props.loadSampleFile) {
        const sampleFile = 'numa-one-pager.pdf';
        new S3Object(this, 'sample-file', {
          bucket: this.dataBucket.bucket.bucket,
          key: sampleFile,
          source: path.join(import.meta.dirname, '..', 'assets', sampleFile),
        });
      }

      const dataSourceRoleAssumptionDoc = new DataAwsIamPolicyDocument(this, 'data-source-role-assumption', {
        statement: [
          {
            effect: 'Allow',
            principals: [
              {
                type: 'Service',
                identifiers: ['qbusiness.amazonaws.com'],
              },
            ],
            actions: ['sts:AssumeRole'],
            condition: [
              {
                test: 'StringEquals',
                variable: 'aws:SourceAccount',
                values: [callerId.accountId],
              },
            ],
          },
        ],
      });

      const dataRole = new IamRole(this, 'data-source-role', {
        name: `data-source-role-${numaClient}`,
        assumeRolePolicy: dataSourceRoleAssumptionDoc.json,
      });

      // TODO: Correctly scope this policy to avoid being overly permissive.
      const dataSourcePolicyDoc = new DataAwsIamPolicyDocument(this, 'data-source-role-policy-doc', {
        statement: [
          {
            actions: ['*'],
            resources: ['*'],
            effect: 'Allow',
          },
        ],
      });

      new IamRolePolicy(this, 'data-source-policy', {
        name: 'policy',
        role: dataRole.name,
        policy: dataSourcePolicyDoc.json,
      });

      const mainS3DataSource = new CloudcontrolapiResource(this, 'data-source', {
        typeName: 'AWS::QBusiness::DataSource',
        desiredState: Fn.jsonencode({
          ApplicationId: application.id,
          Configuration: {
            type: 'S3',
            syncMode: 'FULL_CRAWL',
            connectionConfiguration: {
              repositoryEndpointMetadata: {
                BucketName: this.dataBucket.bucket.bucket,
              },
            },
            // Restrict sync to company KB folder only - User KBs use Bedrock KB instead
            // Exclude metadata sidecar files as Q Business can't parse our format
            additionalProperties: {
              inclusionPrefixes: ['documents/company/'],
            },
            repositoryConfigurations: {
              document: {
                fieldMappings: [
                  {
                    dataSourceFieldName: 'content',
                    indexFieldName: 'document_content',
                    indexFieldType: 'STRING',
                  },
                ],
              },
            },
          },
          DisplayName: numaClient,
          IndexId: this.qBusinessIndexId,
          RoleArn: dataRole.arn,
          SyncSchedule: 'cron(0/30 * ? * * *)',
        }),
        provider: props.qBusinessProvider,
      });
      const dataSourceId = Fn.lookup(Fn.jsondecode(mainS3DataSource.properties), 'DataSourceId');

      const siteMapBucket = new PrivateBucket(this, 'site-map-bucket', {
        bucket: numaClient + '-sitemaps',
      });

      for (const crawlerDataSource of props.webCrawlerConfigs) {
        const siteMapFiles = crawlerDataSource.siteMapFiles || [];
        if (!crawlerDataSource.url && siteMapFiles.length == 0) {
          throw new Error('Empty web crawler configuration');
        }

        const cleanedUrl = (crawlerDataSource.url ?? siteMapFiles[0]).replace(/[^a-zA-Z0-9_-]/g, '-');

        new WebDataSourceConstruct(this, `data-source-${cleanedUrl}`, {
          applicationId: application.id,
          configuration: crawlerDataSource.configuration ?? {},
          dataSourceRoleArn: dataRole.arn,
          displayName: `${numaClient}-web-${cleanedUrl}`,
          indexId: this.qBusinessIndexId!,
          region: props.region,
          siteMapBucket: siteMapBucket.bucket,
          siteMapFiles,
          url: crawlerDataSource.url,
        });

        // TODO: Trigger an initial crawl.
      }

      for (const sharePointDataSource of props.sharePointConfigs ?? []) {
        const cleanedDomain = sharePointDataSource.domain.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
        new SharePointDataSource(this, `data-source-sharepoint-${cleanedDomain}`, {
          displayName: `${numaClient}-share-point-${cleanedDomain}`,
          siteUrls: sharePointDataSource.siteUrls,
          applicationId: this.qBusinessApplicationId!,
          indexId: this.qBusinessIndexId!,
          domain: sharePointDataSource.domain,
          tenantId: sharePointDataSource.tenantId,
          region: props.region,
          configuration: sharePointDataSource.configuration,
          dataSourceRoleArn: dataRole.arn,
        });
      }

      for (const boxDataSource of props.boxConfigs ?? []) {
        new BoxDataSource(this, `data-source-box-${boxDataSource.enterpriseId}`, {
          displayName: `${numaClient}-box-${boxDataSource.enterpriseId}`,
          enterpriseId: boxDataSource.enterpriseId,
          applicationId: this.qBusinessApplicationId!,
          indexId: this.qBusinessIndexId!,
          region: props.region,
          configuration: boxDataSource.configuration,
          dataSourceRoleArn: dataRole.arn,
        });
      }

      for (const teamsDataSource of props.teamsConfigs ?? []) {
        new TeamsDataSource(this, `data-source-teams-${teamsDataSource.tenantId}`, {
          displayName: `${numaClient}-teams-${teamsDataSource.tenantId}`,
          tenantId: teamsDataSource.tenantId,
          applicationId: this.qBusinessApplicationId!,
          indexId: this.qBusinessIndexId!,
          region: props.region,
          configuration: teamsDataSource.configuration,
          dataSourceRoleArn: dataRole.arn,
        });
      }

      for (const s3DataSource of props.s3Configs ?? []) {
        new S3DataSource(this, `data-source-s3-${s3DataSource.bucketName}`, {
          displayName: `${numaClient}-s3-${s3DataSource.bucketName}`,
          bucketName: s3DataSource.bucketName,
          applicationId: this.qBusinessApplicationId!,
          indexId: this.qBusinessIndexId!,
          region: props.region,
          dataSourceRoleArn: dataRole.arn,
          configuration: s3DataSource.configuration,
        });
      }

      new TerraformOutput(this, 'webex-url', {
        value: this.webExUrl,
      });

      new TerraformOutput(this, 'application-id', { value: this.qBusinessApplicationId });
      new TerraformOutput(this, 'data-source-id', { value: dataSourceId });
      new TerraformOutput(this, 'index-id', { value: this.qBusinessIndexId });
      new TerraformOutput(this, 'retriever-id', { value: this.qBusinessRetrieverId });
    } // end optional Q‑Business block

    // Always output bucket information
    new TerraformOutput(this, 'data-bucket', { value: this.dataBucket.bucket.bucket });
    if (this.companyBucket) {
      new TerraformOutput(this, 'company-bucket', { value: this.companyBucket.bucket.bucket });
    }

    // Create approval table if either integrations or ops is enabled.
    // Used for human-in-the-loop approval of integration actions and ops write operations.
    if (props.pipedreamIntegrations || props.numaOps) {
      this.integrationsApprovalTable = new DynamodbTable(this, 'integrations-approval', {
        name: `${props.clientName}-integrations-approval`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'approval_id',
        attribute: [{ name: 'approval_id', type: 'S' }],
        ttl: { attributeName: 'ttl', enabled: true },
        tags: {
          Name: `${props.clientName}-integrations-approval`,
          Environment: props.environmentName,
          Purpose: 'tool-approval-workflow',
        },
      });
    }

    // Create Pipedream relay lambda if Pipedream integrations are enabled
    let pipedreamRelayLambda: NumaLambda | undefined;
    if (props.pipedreamIntegrations) {
      // Create per-user MCP tool policy table in client account
      this.mcpPolicyTable = new DynamodbTable(this, 'mcp-tool-policies', {
        name: `${props.clientName}-mcp-tool-policies`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'pk',
        rangeKey: 'sk',
        attribute: [
          { name: 'pk', type: 'S' },
          { name: 'sk', type: 'S' },
        ],
        tags: {
          Name: `${props.clientName}-mcp-tool-policies`,
          Environment: props.environmentName,
          Purpose: 'per-user-mcp-tool-policy',
        },
      });

      // Create global integration settings table in client account
      const globalIntegrationSettingsTable = new DynamodbTable(this, 'global-integration-settings', {
        name: `${props.clientName}-global-integration-settings`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'integration',
        attribute: [{ name: 'integration', type: 'S' }],
        tags: {
          Name: `${props.clientName}-global-integration-settings`,
          Environment: props.environmentName,
          Purpose: 'global-integration-settings',
        },
      });

      // Usage Analytics: Events table
      this.usageAnalyticsEventsTable = new DynamodbTable(this, 'usage-analytics-events', {
        name: `${props.clientName}-usage-analytics`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'PK',
        rangeKey: 'SK',
        attribute: [
          { name: 'PK', type: 'S' }, // USER#{userId}
          { name: 'SK', type: 'S' }, // EVENT#{timestamp}#{eventId}
          { name: 'eventType', type: 'S' },
          { name: 'timestamp', type: 'N' },
          { name: 'isTest', type: 'S' }, // "true" | "false" (DynamoDB doesn't support bool in GSI)
        ],
        globalSecondaryIndex: [
          {
            name: 'EventTypeIndex',
            hashKey: 'eventType',
            rangeKey: 'timestamp',
            projectionType: 'ALL',
          },
          {
            name: 'TestDataIndex',
            hashKey: 'isTest',
            rangeKey: 'timestamp',
            projectionType: 'KEYS_ONLY',
          },
        ],
        ttl: {
          enabled: true,
          attributeName: 'ttl',
        },
        pointInTimeRecovery: { enabled: true },
        tags: {
          Name: `${props.clientName}-usage-analytics`,
          Environment: props.environmentName,
          Purpose: 'usage-analytics-events',
        },
      });

      // Usage Analytics: API Keys table
      this.usageAnalyticsKeysTable = new DynamodbTable(this, 'usage-analytics-keys', {
        name: `${props.clientName}-usage-analytics-keys`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'PK',
        rangeKey: 'SK',
        attribute: [
          { name: 'PK', type: 'S' }, // CLIENT#{clientName}
          { name: 'SK', type: 'S' }, // KEY#active
        ],
        pointInTimeRecovery: { enabled: true },
        tags: {
          Name: `${props.clientName}-usage-analytics-keys`,
          Environment: props.environmentName,
          Purpose: 'usage-analytics-api-keys',
        },
      });

      // Usage Analytics: Counters table (pre-aggregated login counts per user per day)
      this.usageAnalyticsCountersTable = new DynamodbTable(this, 'usage-analytics-counters', {
        name: `${props.clientName}-usage-analytics-counters`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'PK',
        rangeKey: 'SK',
        attribute: [
          { name: 'PK', type: 'S' }, // USER#{userId}
          { name: 'SK', type: 'S' }, // EVENT#{eventType}#DATE#{YYYY-MM-DD}
        ],
        pointInTimeRecovery: { enabled: true },
        tags: {
          Name: `${props.clientName}-usage-analytics-counters`,
          Environment: props.environmentName,
          Purpose: 'usage-analytics-counters',
        },
      });

      // Audit Log tables — 5 system log tables for different audit categories
      const auditTableConfigs = [
        { id: 'audit-web-crawler', purpose: 'audit-web-crawler', prop: 'auditWebCrawlerTable' as const },
        { id: 'audit-automation', purpose: 'audit-automation', prop: 'auditAutomationTable' as const },
        { id: 'audit-search-index', purpose: 'audit-search-index', prop: 'auditSearchIndexTable' as const },
        { id: 'audit-kb-index', purpose: 'audit-kb-index', prop: 'auditKbIndexTable' as const },
        // CHOSE HEAD: additional audit tables added after the original rebuild commit.
        // To revert: remove the three entries below.
        { id: 'audit-schedule', purpose: 'audit-schedule', prop: 'auditScheduleTable' as const },
        { id: 'audit-sync', purpose: 'audit-sync', prop: 'auditSyncTable' as const },
        { id: 'audit-recovery', purpose: 'audit-recovery', prop: 'auditRecoveryTable' as const },
        { id: 'audit-user-management', purpose: 'audit-user-management', prop: 'auditUserManagementTable' as const },
      ];

      for (const cfg of auditTableConfigs) {
        (this as Record<string, unknown>)[cfg.prop] = new DynamodbTable(this, cfg.id, {
          name: `${props.clientName}-${cfg.id}`,
          billingMode: 'PAY_PER_REQUEST',
          hashKey: 'logId',
          rangeKey: 'timestamp',
          attribute: [
            { name: 'logId', type: 'S' },
            { name: 'timestamp', type: 'N' },
            { name: 'status', type: 'S' },
            { name: 'action', type: 'S' },
          ],
          globalSecondaryIndex: [
            {
              name: 'StatusIndex',
              hashKey: 'status',
              rangeKey: 'timestamp',
              projectionType: 'ALL',
            },
            {
              name: 'ActionIndex',
              hashKey: 'action',
              rangeKey: 'timestamp',
              projectionType: 'ALL',
            },
          ],
          ttl: {
            enabled: true,
            attributeName: 'ttl',
          },
          pointInTimeRecovery: { enabled: true },
          tags: {
            Name: `${props.clientName}-${cfg.id}`,
            Environment: props.environmentName,
            Purpose: cfg.purpose,
          },
        });
      }

      // Usage Analytics: Seed initial API key
      const seedApiKeyLambda = new NumaLambda(this, 'seed-api-key', {
        clientName: props.clientName,
        lambdaDirectory: 'node/seed-api-key',
        logGroup: this.logGroup,
        resourceNameSuffix: '_seed-api-key',
        runtime: 'nodejs22.x',
        handler: 'index.handler',
        environment: {
          CLIENT_NAME: props.clientName,
          KEYS_TABLE_NAME: this.usageAnalyticsKeysTable.name,
          REGION: props.region,
        },
        additionalPolicyStatements: [
          {
            effect: 'Allow',
            actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
            resources: [this.usageAnalyticsKeysTable.arn],
          },
        ],
      });

      // Invoke seed Lambda once on stack creation
      new LambdaInvocation(this, 'seed-api-key-invocation', {
        functionName: seedApiKeyLambda.lambda.functionName,
        input: JSON.stringify({}),
        triggers: {
          keysTableName: this.usageAnalyticsKeysTable.name,
          seedApiKeySourceHash: seedApiKeyLambda.lambda.sourceCodeHash,
        },
        dependsOn: [
          this.usageAnalyticsKeysTable,
          seedApiKeyLambda.lambda,
          ...seedApiKeyLambda.additionalPolicies,
          ...seedApiKeyLambda.policyAttachments,
        ],
      });

      const pipedreamRelayPolicyStatements = [
        {
          actions: ['lambda:InvokeFunction'],
          effect: 'Allow',
          resources: [
            // Allow invoking cross-account Pipedream proxy lambda
            // Note: pipedream-proxy is deployed to us-east-1 regardless of client region
            'arn:aws:lambda:us-east-1:965745962688:function:pipedream-proxy',
          ],
        },
        {
          actions: ['sts:GetCallerIdentity'],
          effect: 'Allow',
          resources: ['*'],
        },
        // Allow reading/writing MCP policy table
        ...(this.mcpPolicyTable
          ? [
              {
                actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
                effect: 'Allow',
                resources: [this.mcpPolicyTable.arn],
              },
            ]
          : []),
        // Allow reading global integration settings table
        {
          actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
          effect: 'Allow',
          resources: [globalIntegrationSettingsTable.arn],
        },
        // Allow reading/writing integrations approval table (for approval flow)
        ...(this.integrationsApprovalTable
          ? [
              {
                actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
                effect: 'Allow',
                resources: [this.integrationsApprovalTable.arn],
              },
            ]
          : []),
      ];

      pipedreamRelayLambda = new NumaLambda(this, 'pipedream-relay', {
        additionalPolicyStatements: pipedreamRelayPolicyStatements,
        clientName: props.clientName,
        lambdaDirectory: 'python/pipedream-relay/',
        logGroup: this.logGroup,
        resourceNameSuffix: '_pipedream-relay',
        environment: {
          PIPEDREAM_PROXY_LAMBDA_ARN: 'arn:aws:lambda:us-east-1:965745962688:function:pipedream-proxy',
          ENVIRONMENT: props.environmentName,
          ...(this.mcpPolicyTable && { USER_INTEGRATION_SETTINGS_TABLE_NAME: this.mcpPolicyTable.name }),
          GLOBAL_INTEGRATION_SETTINGS_TABLE_NAME: globalIntegrationSettingsTable.name,
        },
      });
    }

    // Create the Cognito IDP construct to manage identity pools and groups
    // Pass Q Business application ID only if Q Business resources were created
    this.cognitoGroups = new CognitoGroupsConstruct(this, 'cognito-groups', {
      clientName: props.clientName,
      environmentName: props.environmentName,
      region: props.region,
      userPoolId: userPool.id,
      userPoolEndpoint: userPool.endpoint,
      userPoolClientId: this.userPoolClient.id,
      callerAccountId: callerId.accountId,
      dataBucket: this.dataBucket,
      outputsBucket: this.outputsBucket,
      companyBucket: this.companyBucket,
      chatHistoryTable: this.chatHistoryTable,
      groups: props.groups,
      pipedreamIntegrations: props.pipedreamIntegrations,
      pipedreamRelayLambdaArn: pipedreamRelayLambda?.lambda.arn,
      qBusinessApplicationId: qBusinessApplicationIdForIdp,
      brandingTable: this.brandingTable,
      knowledgeBase: props.knowledgeBase,
      brandingAssetsBucketArn: this.brandingAssetsBucketArn,
      brandingAssetsPrefix: this.brandingAssetsPrefix,
    });

    // Expose whichever role Cognito decided should be the default web‑identity role.
    this.defaultWebIdentityRoleArn = this.cognitoGroups.defaultWebIdentityRoleArn;
    this.groups = this.cognitoGroups.groups;

    // Expose pipedream relay lambda ARN if created
    this.pipedreamRelayLambdaArn = pipedreamRelayLambda?.lambda.arn;

    // Output Pipedream relay lambda ARN if enabled
    if (pipedreamRelayLambda) {
      new TerraformOutput(this, 'pipedream-relay-lambda-arn', { value: pipedreamRelayLambda.lambda.arn });
    }

    // Note: OAuth integration construct is created in the client stack (like OpsConstruct)
    // when oauthIntegrationsEnabled is true. It extends ApiGatewayLambdaCollection and
    // wires its own Lambda functions to API Gateway routes.

    // Note: System user admin group membership is now handled by the SystemUserCreator Lambda
    // This ensures the user is always in the admin group, even if previous deployments failed

    const bedrockModelManagerPolicyStatements = [
      {
        actions: [
          'aws-marketplace:Subscribe',
          'aws-marketplace:ViewSubscriptions',
          'bedrock:CreateFoundationModelAgreement',
          'bedrock:ListFoundationModelAgreementOffers',
          'bedrock:PutFoundationModelEntitlement',
          'bedrock:PutUseCaseForModelAccess',
        ],
        effect: 'Allow',
        resources: ['*'],
      },
    ];

    const bedrockModelManager = new NumaLambda(this, 'bedrock-model-manager', {
      additionalPolicyStatements: bedrockModelManagerPolicyStatements,
      clientName: props.clientName,
      lambdaDirectory: 'python/bedrock-model-manager/',
      logGroup: this.logGroup,
      resourceNameSuffix: '_bedrock-model-manager',
    });

    // Cross-region inference profiles handle routing automatically - only provision in source region
    // If a model isn't available in a region, the lambda will log a warning and continue (soft failure)
    const models = [
      // Claude 3.x models
      'anthropic.claude-3-haiku-20240307-v1:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-7-sonnet-20250219-v1:0',
      // Claude 4.x models
      'anthropic.claude-sonnet-4-20250514-v1:0',
      'anthropic.claude-haiku-4-5-20251001-v1:0',
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'anthropic.claude-opus-4-5-20251101-v1:0',
      // Claude 4.6 models
      'anthropic.claude-sonnet-4-6',
      'anthropic.claude-opus-4-6-v1',
      // Amazon models
      'amazon.titan-embed-text-v2:0',
      'amazon.nova-lite-v1:0',
      'amazon.nova-pro-v1:0',
      'amazon.nova-premier-v1:0',
    ];

    // Provision each model only in the source region
    // Invocations are serialized (each depends on previous) to avoid AWS rate limits
    const modelAccessInvocations: LambdaInvocation[] = [];
    let previousInvocation: LambdaInvocation | undefined;

    for (const modelId of models) {
      const input = JSON.stringify({
        model_id: modelId,
        region: props.region,
        trigger: '1',
      });

      const dependsOnList: ITerraformDependable[] = [
        bedrockModelManager.lambda,
        ...bedrockModelManager.additionalPolicies,
        ...bedrockModelManager.policyAttachments,
      ];

      // Chain to previous invocation to serialize execution and avoid rate limits
      if (previousInvocation) {
        dependsOnList.push(previousInvocation);
      }

      const invocation = new LambdaInvocation(
        this,
        `bedrock-model-manager-invocation_${modelId.replace(/[.:]/g, '-')}_${props.region}`,
        {
          functionName: bedrockModelManager.lambda.functionName,
          input,
          triggers: {
            bedrockModelManagerSourceHash: bedrockModelManager.lambda.sourceCodeHash,
            input,
          },
          dependsOn: dependsOnList,
        }
      );
      modelAccessInvocations.push(invocation);
      previousInvocation = invocation;
    }

    // Output model access results for pipeline visibility
    // Shows status and warnings inline for partial results
    const modelResults = modelAccessInvocations.map((inv) => {
      const result = Fn.jsondecode(inv.result);
      const modelId = Fn.lookup(result, 'model_id', 'unknown');
      const status = Fn.lookup(result, 'status', 'unknown');
      const warnings = Fn.lookup(result, 'warnings', []);

      // Fn.can returns bool - true if expression succeeds (has warnings), false if empty list errors
      const hasWarnings = Fn.can(Fn.element(warnings, 0));
      const warningText = Fn.conditional(hasWarnings, Fn.format('\n      ⚠ %s', [Fn.element(warnings, 0)]), '');

      return Fn.format('  %s: %s%s', [modelId, status, warningText]);
    });

    new TerraformOutput(this, 'bedrock-model-access-results', {
      value: Fn.format('\n%s', [Fn.join('\n', modelResults)]),
      description: 'Results from Bedrock model access requests',
    });
  }
}

const _coreNumaInfraPropsSchema = z
  .object({
    environmentName: z.string(),
    /**
     * Enable iFrame support. Not supported on every account.
     *
     * @default false
     */
    enableIFrame: z.boolean().optional(),
    indexType: z.union([z.literal('ENTERPRISE'), z.literal('STARTER')]).optional(),
    indexUnits: z.number().optional(),
    clientAccountId: z.string(),
    loadSampleFile: z.boolean().optional(),
    createServiceLinkedRole: z.boolean().optional(),
    webCrawlerConfigs: z.array(webCrawlerDataSourcePropsSchema).optional(),
    temporaryPasswordValidityDays: z.number().optional(),
    passwordLength: z.number().optional(),
    mfa: z.boolean().optional(),
    sharePointConfigs: z.array(sharePointDataSourcePropsSchema).optional(),
    boxConfigs: z.array(boxDataSourcePropsSchema).optional(),
    teamsConfigs: z.array(teamsDataSourcePropsSchema).optional(),
    s3Configs: z.array(s3DataSourcePropsSchema).optional(),
    /**
     * Various settings to make development easier:
     *
     * - add localhost CORS value to outputs bucket.
     * - add localhost CORS value to data bucket.
     *
     * @default false
     */
    devInstance: z.boolean().optional(),
    /**
     * When **true**, provision Amazon Q‑Business resources.
     * When **false**, skip Q‑Business resource creation.
     * Default is `false` (resources are NOT created unless explicitly enabled).
     */
    provisionQResources: z.boolean().optional(),
    /**
     * Whether to enable Pipedream integrations functionality
     *
     * @default false
     */
    pipedreamIntegrations: z.boolean().optional().default(false),
    /**
     * Whether to enable Data Connectors UI in the frontend.
     *
     * @default false
     */
    dataConnectorsEnabled: z.boolean().optional().default(false),
    /**
     * Feature flag to enable Agents UI and related functionality in the frontend.
     * Infrastructure resources can still be deployed; this controls UX visibility.
     *
     * @default false
     */
    agents: z.boolean().optional().default(false),
    /**
     * Whether to enable Secrets Vault functionality for secure credential storage.
     *
     * @default false
     */
    secretsVaultEnabled: z.boolean().optional().default(false),
    /**
     * Whether to enable Numa Ops (work management, kanban boards, CRM).
     * When true, the integrations-approval DynamoDB table is created even without
     * Pipedream integrations (used for ops tool approval flow).
     *
     * @default false
     */
    numaOps: z.boolean().optional().default(false),
    /**
     * Whether to enable the Numa Files feature (file management page and backend).
     *
     * @default false
     */
    numaFiles: z.boolean().optional().default(false),
    /**
     * Whether to enable Drop Zone creation (shared upload folders for external users).
     *
     * @default false
     */
    numaDropZones: z.boolean().optional().default(false),
    /**
     * Whether to enable Sharing creation (share documents with external users for Q&A).
     *
     * @default false
     */
    numaSharing: z.boolean().optional().default(false),
    /**
     * Whether to enable OAuth integrations for cloud storage providers (Google Drive, OneDrive, Dropbox).
     * Allows users to connect and access files from their cloud storage accounts.
     * @default false
     */
    oauthIntegrationsEnabled: z.boolean().optional().default(false),
    /**
     * Configuration for OAuth providers. Only used when oauthIntegrationsEnabled is true.
     */
    oauthProviders: z
      .record(
        z.string(),
        z.object({
          enabled: z.boolean(),
          clientId: z.string().optional().default(''),
          clientSecret: z.string().optional().default(''),
          scopes: z.array(z.string()),
        })
      )
      .optional(),
    /**
     * Additional origins to allow in the S3 bucket CORS policies.
     * Useful for whitelabel frontends that need to access the same S3 buckets.
     * Each origin should be a full URL with protocol (e.g., "https://worldbank.getnolia.io").
     */
    additionalOrigins: z.array(z.string()).optional(),
  })
  .strict();

export const coreNumaInfraPropsSchema = _coreNumaInfraPropsSchema
  .merge(qBusinessChatControlConfigurerPropsSchema.omit({ applicationId: true, accountId: true }))
  .merge(
    z.object({
      groups: z.record(z.string(), z.array(z.enum(FEATURE_SET_NAMES as [string, ...string[]]))).optional(),
      brandingAssetsBucketArn: z.string().optional(),
      brandingAssetsPrefix: z.string().optional(),
    })
  );
export type CoreNumaInfraProps = z.infer<typeof coreNumaInfraPropsSchema> & {
  clientName: string;
  domainName: string;
  /** Override domain for Cognito emails (welcome, password reset). Falls back to domainName. */
  emailDomain?: string;
  /**
   * Provider for QBusiness resources.
   */
  qBusinessProvider?: AwsProvider;
  knowledgeBase?: KnowledgeBase;
};
