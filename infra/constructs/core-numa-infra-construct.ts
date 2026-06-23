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
import { SchedulerSchedule } from '@cdktf/provider-aws/lib/scheduler-schedule';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { S3BucketCorsConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-cors-configuration';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { password } from '@cdktf/provider-random';
import { RandomProvider } from '@cdktf/provider-random/lib/provider';
import { Fn, TerraformOutput, ITerraformDependable } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { AdjustToken } from './adjust-token-construct';
import { CognitoPreSignup } from './cognito-pre-signup-construct';
import { SSOGroupMapper } from './sso-group-mapper-construct';
import { CognitoEmailHandler } from './cognito-email-handler-construct';
import { NoliaCognitoEmailHandler } from './nolia-cognito-email-handler-construct';
import { CognitoCustomEmailSender } from './cognito-custom-email-sender-construct';
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
import { SynergyKbCrawlerConstruct } from './synergy-kb-crawler-construct';
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
  readonly dataBucket: NumaCorsEnabledBucket;
  readonly companyBucket?: NumaCorsEnabledBucket;
  readonly chatHistoryTable: DynamodbTable;
  readonly creditLedgerTable: DynamodbTable;
  readonly creditDebitLambda: NumaLambda;
  readonly brandingTable: DynamodbTable;
  readonly brandingAssetsBucket: PublicS3Bucket;
  readonly brandingAssetsBucketArn: string;
  readonly brandingAssetsBucketName: string;
  readonly brandingAssetsPrefix: string;
  readonly knowledgeBasesTable: DynamodbTable;
  readonly workspaceAgentsTable: DynamodbTable;
  readonly userAgentsTable: DynamodbTable;
  readonly agentsSettingsTable: DynamodbTable;
  readonly agentUserPrefsTable: DynamodbTable;
  readonly agentTeamsTable: DynamodbTable;
  readonly agentTeamMembersTable: DynamodbTable;
  readonly agentSharingTable: DynamodbTable;
  readonly schedulingSettingsTable: DynamodbTable;
  readonly agentSchedulesTable: DynamodbTable;
  readonly notificationsTable: DynamodbTable;
  /** Idempotent system-user creator — exposed so feature constructs (e.g. Numa
   *  Voice's seed) can depend on the system user existing before they run. */
  readonly systemUserCreator: SystemUserCreator;
  readonly chatSettingsTable: DynamodbTable;
  readonly dataConnectorsTable: DynamodbTable;
  readonly dataConnectorsSettingsTable: DynamodbTable;
  readonly capabilitiesTable: DynamodbTable;
  readonly dataConnectorsSyncConfigsTable: DynamodbTable;
  readonly vaultAuditLogTable: DynamodbTable;
  readonly sharedTable: DynamodbTable;
  readonly sharedChatHistoryTable: DynamodbTable;
  readonly mfaSettingsTable: DynamodbTable;
  readonly webCrawler: WebCrawlerConstruct;
  readonly synergyKbCrawler?: SynergyKbCrawlerConstruct;
  /** Synergy extraction SQS FIFO queue URL/ARN ('' when the crawler is disabled)
   *  — the on-visit hook enqueues a per-job message onto it. */
  readonly synergyExtractQueueUrl: string;
  readonly synergyExtractQueueArn: string;
  /** Synergy crawl-state table name/ARN ('' when disabled) — sync-config/status API + on-visit sync. */
  readonly synergyCrawlStateTableName: string;
  readonly synergyCrawlStateTableArn: string;
  /** Synergy coordinator Lambda name/ARN ('' when disabled) — manual "Sync now"
   *  invokes it to enumerate + enqueue. */
  readonly synergyCoordinatorFunctionName: string;
  readonly synergyCoordinatorFunctionArn: string;
  /** Synergy per-run/per-query credit-debit Lambda name/ARN ('' when disabled) —
   *  the workspace-tools query handlers fire-and-forget it to meter portfolio /
   *  exact-term query read-capacity under the real caller. */
  readonly synergyCreditDebitFunctionName: string;
  readonly synergyCreditDebitFunctionArn: string;
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
  readonly configBucket!: ConfigBucket;
  readonly extApiDocBucket!: PrivateBucket;
  readonly sitemapsBucket?: PrivateBucket;

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

    const preSignup = new CognitoPreSignup(this, 'cognito-pre-signup', {
      nameSuffix: numaClient,
    });

    const groupMapper = new SSOGroupMapper(this, 'sso-group-mapper', {
      nameSuffix: numaClient,
      groupMappingTableName: `${numaClient}-mfa-settings`,
    });

    const cognitoDomain = numaClient;

    // MFA set to OPTIONAL — Cognito does NOT enforce MFA itself. Instead, the
    // pre-token-generation Lambda (token-adjuster) enforces MFA at the application
    // level by checking if the user has TOTP configured via AdminGetUser. This is
    // required because with ON, you cannot reset a user's TOTP — there is no
    // fallback auth method to obtain an access token for AssociateSoftwareToken.
    // OPTIONAL + app-level enforcement is the industry best practice for this.
    const mfa =
      (props.mfa ?? false)
        ? {
            mfaConfiguration: 'OPTIONAL',
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
    // CustomEmailSender trigger (BUG-188): route all Cognito auth emails
    // (verification / activation / password reset) through the centralized
    // numa-email-sender (our DKIM/SPF/DMARC-aligned notifications.numa.arcanum.ai
    // domain) instead of Cognito's default verificationemail.com sender, which is
    // silently dropped or spam-foldered by many Microsoft 365 / Google tenants.
    // Created before the user pool so its Lambda ARN + KMS key can be wired into
    // lambdaConfig below. This fully replaces Cognito's own sending, so the
    // customMessage trigger (which only customizes Cognito-sent mail) is left
    // wired but unused.
    if (!props.emailSenderLambdaArn) {
      throw new Error('emailSenderLambdaArn is required to wire the Cognito CustomEmailSender trigger');
    }
    const customEmailSender = new CognitoCustomEmailSender(this, 'cognito-custom-email-sender', {
      clientName: props.clientName,
      nameSuffix: numaClient,
      domainName: emailDomain,
      emailSenderLambdaArn: props.emailSenderLambdaArn,
    });

    const userPool = new CognitoUserPool(this, 'user-pool', {
      name: numaClient,
      usernameAttributes: ['email'],
      lambdaConfig: {
        preSignUp: preSignup.function.arn,
        postAuthentication: groupMapper.function.arn,
        preTokenGenerationConfig: {
          lambdaArn: at.function.arn,
          lambdaVersion: 'V2_0',
        },
        customMessage: customMessageLambda.arn,
        customEmailSender: {
          lambdaArn: customEmailSender.function.arn,
          lambdaVersion: 'V1_0',
        },
        kmsKeyId: customEmailSender.kmsKeyArn,
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

    new LambdaPermission(this, 'cognito-pre-signup-permission', {
      statementId: 'cognito-pre-signup',
      functionName: preSignup.function.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: userPool.arn,
    });

    new LambdaPermission(this, 'cognito-group-mapper-permission', {
      statementId: 'cognito-group-mapper',
      functionName: groupMapper.function.functionName,
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

    // Grant Cognito permission to invoke the CustomEmailSender trigger (BUG-188)
    new LambdaPermission(this, 'cognito-custom-email-sender-permission', {
      statementId: 'cognito-custom-email-sender',
      functionName: customEmailSender.function.functionName,
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
    this.systemUserCreator = new SystemUserCreator(this, 'system-user', {
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
      // `aws.cognito.signin.user.admin` is required for SAML/OAuth federated
      // users — without it, access tokens can't call GetUser/GlobalSignOut,
      // which validateTokenWithCognito relies on.
      allowedOauthScopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
      accessTokenValidity: 60,
      refreshTokenValidity: 60,
      idTokenValidity: 60,
      authSessionValidity: 5,
      tokenValidityUnits: [{ accessToken: 'minutes', refreshToken: 'days', idToken: 'minutes' }],
      supportedIdentityProviders: ['COGNITO'],
      logoutUrls: [`https://${props.domainName}/`, `https://${props.domainName}/login`],
      // Lifecycle: ignore fields managed dynamically by Lambdas at runtime.
      //
      // - supported_identity_providers: Managed by admin-sso-settings Lambda when
      //   admins configure SAML SSO. Without this, deploys revert SSO config.
      // - logout_urls: Set here as initial value but ignored so SSO Lambda can update.
      // - callback_urls: Only ignored when Q Business is provisioned, because the
      //   SetCallbackUrl Lambda manages them dynamically. For non-Q Business clients,
      //   Terraform manages callback URLs normally.
      lifecycle: {
        ignoreChanges: [
          'supported_identity_providers',
          'logout_urls',
          ...(props.provisionQResources ? ['callback_urls'] : []),
        ],
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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

    // Create per-client credit ledger (Numa Credit System / SPK-015).
    // Single-table design:
    //   PK=CONV#<id>      SK=META | MSG#<ts>            per-conversation cost + credit rows
    //   PK=CLIENT#<name>  SK=BALANCE | MONTH#<YYYY-MM>  balance + monthly reconciliation rows
    // GSI1 (USER#<sub> / TS#<ts>): list a user's conversations, newest first (sparse: META rows only)
    // GSI2 (MONTH#<YYYY-MM> / CONV#<id>): per-client monthly billing rollup (sparse: META rows only)
    // GSI3 (AGENT#<agentId> / TS#<lastTs>): per-agent credit analytics (FEAT-246). Sparse — only META
    //   rows that carry an agentId (agent chats + scheduled runs) get GSI3 keys, so plain chats never
    //   index here. Powers the per-agent Credits section on the agent card.
    this.creditLedgerTable = new DynamodbTable(this, 'numa-credit-ledger-table', {
      name: `${numaClient}-credit-ledger`,
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
        {
          name: 'GSI2PK',
          type: 'S',
        },
        {
          name: 'GSI2SK',
          type: 'S',
        },
        {
          name: 'GSI3PK',
          type: 'S',
        },
        {
          name: 'GSI3SK',
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
        {
          name: 'GSI2',
          hashKey: 'GSI2PK',
          rangeKey: 'GSI2SK',
          projectionType: 'ALL',
        },
        {
          name: 'GSI3',
          hashKey: 'GSI3PK',
          rangeKey: 'GSI3SK',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: {
        enabled: true,
      },
      tags: {
        Name: `${numaClient}-credit-ledger`,
        Environment: props.environmentName,
        Purpose: 'credit-ledger',
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

    // Dedicated log group for the Numa Credit System lambdas (debit + nightly), so all credit
    // metering / classification / settlement logs live in one place instead of the busy
    // <client>-core group. Within it, filter by per-event `_name` (CREDIT_*) or the bound
    // `domain="credits"` field. (The workspace-agent meter-emit log still lands in the agent's own
    // container group — `domain="credits"` lets one query span both.) Created directly (not via
    // NumaLogGroup, whose hardcoded inner id would collide with core-log-group under this scope);
    // the `/numa/*` resource policy from the core NumaLogGroup already covers this prefix.
    const creditLogGroup = new CloudwatchLogGroup(this, 'credits-log-group', {
      name: `/numa/${props.clientName}-credits`,
    });

    // Credit-debit Lambda — live credit metering (Numa Credit System / SPK-015). The workspace
    // agent async-invokes this after each turn (when CREDIT_METERING_ENABLED); it reads the
    // conversation trace from the outputs bucket, recomputes cost, classifies + titles via Nova,
    // and writes the credit-ledger rows. Shares all billing logic with the backfill (lib/credit-pricing).
    this.creditDebitLambda = new NumaLambda(this, 'credit-debit', {
      clientName: props.clientName,
      lambdaDirectory: 'python/credit-debit/',
      logGroup: creditLogGroup,
      resourceNameSuffix: '_credit-debit',
      environment: {
        CLIENT_NAME: props.clientName,
        CREDITS_TABLE_NAME: this.creditLedgerTable.name,
        OUTPUTS_BUCKET_NAME: this.outputsBucket.bucket.bucket,
        // Read-only: recover a scheduled run's agentId from its chat-history rows when the metering
        // event lacks one (so the run attributes to its agent in the dashboard's Top-5-agents).
        CHAT_HISTORY_TABLE_NAME: this.chatHistoryTable.name,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          // Query: orphan-MSG cleanup (table) + monthly reconciliation rollup (GSI2 index).
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:BatchWriteItem', 'dynamodb:Query'],
          resources: [this.creditLedgerTable.arn, `${this.creditLedgerTable.arn}/index/*`],
        },
        {
          // Read-only Query for the scheduled-run agentId recovery above.
          effect: 'Allow',
          actions: ['dynamodb:Query'],
          resources: [this.chatHistoryTable.arn],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${this.outputsBucket.bucket.arn}/*`],
        },
        {
          // Nova 2 Lite for title + tier classification. Broad InvokeModel; scope to the Nova
          // foundation-model / inference-profile ARNs later if desired.
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        },
      ],
    });

    // Credit-nightly Lambda — runs just after midnight NZ (Pacific/Auckland). Two jobs: (1) writes
    // ADMIN-SAFE anonymised title + deliverables onto that day's ledger META rows (Nova 2 Lite via the
    // shared lib); (2) month-close settlement — locks the previous NZ month's overflow into the top-up
    // balance as a settlement TXN. The admin view shows live credits/tier immediately; labels lag ~1 day.
    const creditNightlyLambda = new NumaLambda(this, 'credit-nightly', {
      clientName: props.clientName,
      lambdaDirectory: 'python/credit-nightly/',
      logGroup: creditLogGroup,
      resourceNameSuffix: '_credit-nightly',
      timeout: 600,
      environment: {
        CLIENT_NAME: props.clientName,
        CREDITS_TABLE_NAME: this.creditLedgerTable.name,
        OUTPUTS_BUCKET_NAME: this.outputsBucket.bucket.bucket,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          // Summariser: Query GSI2 + UpdateItem META rows. Settlement: GetItem the MONTH aggregate,
          // Put/Delete the settlement TXN row.
          actions: [
            'dynamodb:Query',
            'dynamodb:UpdateItem',
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:DeleteItem',
          ],
          resources: [this.creditLedgerTable.arn, `${this.creditLedgerTable.arn}/index/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:GetObject'],
          resources: [`${this.outputsBucket.bucket.arn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        },
      ],
    });

    // Schedule on the NZ billing calendar via EventBridge Scheduler (DST-aware ScheduleExpressionTimezone
    // — unlike CloudwatchEventRule, which is UTC-only). Fires 00:30 NZ so the previous month is freshly
    // closed when settlement runs. Scheduler invokes the Lambda via an assumed role (no resource policy).
    const creditNightlySchedulerRole = new IamRole(this, 'credit-nightly-scheduler-role', {
      name: `${props.clientName}-credit-nightly-scheduler`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'credit-nightly-scheduler-assume', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [{ identifiers: ['scheduler.amazonaws.com'], type: 'Service' }],
          },
        ],
      }).json,
    });
    new IamRolePolicy(this, 'credit-nightly-scheduler-policy', {
      name: `${props.clientName}-credit-nightly-scheduler`,
      role: creditNightlySchedulerRole.name,
      policy: new DataAwsIamPolicyDocument(this, 'credit-nightly-scheduler-policy-doc', {
        statement: [
          {
            effect: 'Allow',
            actions: ['lambda:InvokeFunction'],
            resources: [creditNightlyLambda.lambda.arn, `${creditNightlyLambda.lambda.arn}:*`],
          },
        ],
      }).json,
    });
    new SchedulerSchedule(this, 'credit-nightly-schedule', {
      name: `${props.clientName}-credit-nightly`,
      description: 'Numa Credit System: nightly receipt summariser + NZ month-close settlement',
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(30 0 * * ? *)',
      scheduleExpressionTimezone: 'Pacific/Auckland',
      target: {
        arn: creditNightlyLambda.lambda.arn,
        roleArn: creditNightlySchedulerRole.arn,
      },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
    });

    // Agents settings table (company-wide policy)
    this.agentsSettingsTable = new DynamodbTable(this, 'numa-agents-settings-table', {
      name: `${numaClient}-agents-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'setting',
      attribute: [{ name: 'setting', type: 'S' }],
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${numaClient}-agents-settings`,
        Environment: props.environmentName,
        Purpose: 'agents-settings',
      },
    });

    // Agent user preferences table (per-user favorites, hidden, usage tracking)
    this.agentUserPrefsTable = new DynamodbTable(this, 'numa-agent-user-prefs-table', {
      name: `${numaClient}-agent-user-prefs`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'user_id',
      rangeKey: 'agent_id',
      attribute: [
        { name: 'user_id', type: 'S' },
        { name: 'agent_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'agent-prefs-index',
          hashKey: 'agent_id',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // Agent teams table (team metadata)
    this.agentTeamsTable = new DynamodbTable(this, 'numa-agent-teams-table', {
      name: `${numaClient}-agent-teams`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'team_id',
      rangeKey: 'sk',
      attribute: [
        { name: 'team_id', type: 'S' },
        { name: 'sk', type: 'S' },
        { name: 'tenant_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'tenant-index',
          hashKey: 'tenant_id',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // Agent team members table (team membership + roles)
    this.agentTeamMembersTable = new DynamodbTable(this, 'numa-agent-team-members-table', {
      name: `${numaClient}-agent-team-members`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'team_id',
      rangeKey: 'user_id',
      attribute: [
        { name: 'team_id', type: 'S' },
        { name: 'user_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'user-teams-index',
          hashKey: 'user_id',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // Agent sharing table (per-agent access control)
    this.agentSharingTable = new DynamodbTable(this, 'numa-agent-sharing-table', {
      name: `${numaClient}-agent-sharing`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'agent_id',
      rangeKey: 'principal_id',
      attribute: [
        { name: 'agent_id', type: 'S' },
        { name: 'principal_id', type: 'S' },
      ],
      globalSecondaryIndex: [
        {
          name: 'principal-agents-index',
          hashKey: 'principal_id',
          projectionType: 'ALL',
        },
      ],
      pointInTimeRecovery: { enabled: true },
    });

    // Scheduling settings table (client-admin minimum interval override)
    this.schedulingSettingsTable = new DynamodbTable(this, 'numa-scheduling-settings-table', {
      name: `${numaClient}-scheduling-settings`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'setting',
      attribute: [{ name: 'setting', type: 'S' }],
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
        { name: 'agent_id', type: 'S' },
        { name: 'app_id', type: 'S' },
        // Pipedream-trigger lookup: deployed_trigger_id (dc_xxx) is the only
        // identifier the receiver lambda has on inbound webhook events.
        { name: 'deployed_trigger_id', type: 'S' },
        { name: 'tenant_id', type: 'S' },
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
        {
          name: 'agent-id-index',
          hashKey: 'agent_id',
          projectionType: 'ALL',
        },
        {
          name: 'app-id-index',
          hashKey: 'app_id',
          projectionType: 'ALL',
        },
        {
          // Used by pipedream-event-receiver to map x-pd-emitter-id → schedule.
          // INCLUDE projection: just the fields needed for HMAC verify + the
          // user/schedule identity check. Cheaper than ALL since the receiver
          // doesn't need cron/agent/notification fields.
          name: 'deployed-trigger-id-index',
          hashKey: 'deployed_trigger_id',
          projectionType: 'INCLUDE',
          nonKeyAttributes: ['user_id', 'schedule_id', 'trigger', 'status'],
        },
        {
          // Used by `agent-schedules` for tenant-scope queries (admin audit
          // screen, quota aggregation). Avoids Scan on the schedules table.
          // Sort client-side — keeping the GSI definition minimal.
          name: 'tenant-id-index',
          hashKey: 'tenant_id',
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
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
      pointInTimeRecovery: { enabled: true },
      tags: {
        Name: `${numaClient}-shared-chat-history`,
        Environment: props.environmentName,
        Purpose: 'shared-document-chat-history',
      },
    });

    // Create config bucket
    this.configBucket = new ConfigBucket(this, 'config-bucket', {
      clientName: props.clientName,
      clientAccountId: props.clientAccountId,
    });

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
      deployerRoleArn: props.deployerRoleArn!,
    });

    // Synergy 12d → Bedrock KB crawler (only when explicitly enabled). Gated so
    // clients without it never create the ECR repo / container Lambda / SFN, and
    // synth never needs the worker image.tar.
    let synergyExtractQueueUrl = '';
    let synergyExtractQueueArn = '';
    let synergyCrawlStateTableName = '';
    let synergyCrawlStateTableArn = '';
    let synergyCoordinatorFunctionName = '';
    let synergyCoordinatorFunctionArn = '';
    let synergyCreditDebitFunctionName = '';
    let synergyCreditDebitFunctionArn = '';
    if (props.synergyEnabled) {
      const synergyCrawlLogGroup = new CloudwatchLogGroup(this, 'synergy-kb-crawl-log-group', {
        name: `/numa/${props.clientName}-synergy-kb-crawl`,
      });
      this.synergyKbCrawler = new SynergyKbCrawlerConstruct(this, 'synergy-kb-crawler', {
        clientName: props.clientName,
        environmentName: props.environmentName,
        dataBucket: this.dataBucket,
        logGroup: synergyCrawlLogGroup,
        region: props.region,
        creditLedgerTableName: this.creditLedgerTable.name,
        // Live credit metering is fleet-wide ON (see numa-client-stack) — the
        // per-crawl ingestion debit follows the same policy.
        creditMeteringEnabled: true,
        // Exact-term index follows the single Synergy flag — it provisions
        // whenever the rest of the Synergy surface does.
        termIndexEnabled: props.synergyEnabled ?? false,
      });
      synergyExtractQueueUrl = this.synergyKbCrawler.extractQueueUrl;
      synergyExtractQueueArn = this.synergyKbCrawler.extractQueue.arn;
      synergyCrawlStateTableName = this.synergyKbCrawler.stateTable.name;
      synergyCrawlStateTableArn = this.synergyKbCrawler.stateTable.arn;
      synergyCoordinatorFunctionName = this.synergyKbCrawler.coordinatorLambda.functionName;
      synergyCoordinatorFunctionArn = this.synergyKbCrawler.coordinatorLambda.arn;
      synergyCreditDebitFunctionName = this.synergyKbCrawler.creditDebitLambda.functionName;
      synergyCreditDebitFunctionArn = this.synergyKbCrawler.creditDebitLambda.arn;
    }
    this.synergyExtractQueueUrl = synergyExtractQueueUrl;
    this.synergyExtractQueueArn = synergyExtractQueueArn;
    this.synergyCrawlStateTableName = synergyCrawlStateTableName;
    this.synergyCrawlStateTableArn = synergyCrawlStateTableArn;
    this.synergyCoordinatorFunctionName = synergyCoordinatorFunctionName;
    this.synergyCoordinatorFunctionArn = synergyCoordinatorFunctionArn;
    this.synergyCreditDebitFunctionName = synergyCreditDebitFunctionName;
    this.synergyCreditDebitFunctionArn = synergyCreditDebitFunctionArn;

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
        // Numa frontend URL must survive every write to this client's
        // CallbackURLs, forever. The Lambda enforces this — no caller
        // (this construct or any future federation add-on) can drop it.
        baselineCallbackUrls: [`https://${props.domainName}/`],
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
      this.sitemapsBucket = siteMapBucket;

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
        pointInTimeRecovery: { enabled: true },
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
        pointInTimeRecovery: { enabled: true },
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
        pointInTimeRecovery: { enabled: true },
        tags: {
          Name: `${props.clientName}-global-integration-settings`,
          Environment: props.environmentName,
          Purpose: 'global-integration-settings',
        },
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

    // Audit Log tables — system log tables for different audit categories
    const auditTableConfigs = [
      { id: 'audit-web-crawler', purpose: 'audit-web-crawler', prop: 'auditWebCrawlerTable' as const },
      { id: 'audit-automation', purpose: 'audit-automation', prop: 'auditAutomationTable' as const },
      { id: 'audit-search-index', purpose: 'audit-search-index', prop: 'auditSearchIndexTable' as const },
      { id: 'audit-kb-index', purpose: 'audit-kb-index', prop: 'auditKbIndexTable' as const },
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
      voiceIntakeBucketArn: props.voiceIntakeBucketArn,
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

    // ── ext-api-doc bucket (at END to avoid shifting resource addresses) ──
    this.extApiDocBucket = new PrivateBucket(this, 'ext-api-doc-bucket', {
      bucket: `${numaClient}-ext-api-doc`,
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
    /**
     * Single Synergy gate. When **true**, provision the entire Synergy 12d
     * surface — the → Bedrock KB crawler (state table, coordinator/worker/restart
     * Lambdas, Step Function) AND the exact-term inverted index. Already gated on
     * data connectors by the caller.
     *
     * @default false
     */
    synergyEnabled: z.boolean().optional(),
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
     * @deprecated Secrets Vault is now gated on `dataConnectorsEnabled` (TASK-146).
     * Field kept on the schema as `.optional()` so existing client configs that
     * still set it parse without error — the value is ignored by infra and the
     * frontend.
     */
    secretsVaultEnabled: z.boolean().optional(),
    /**
     * Whether to enable Numa Ops (work management, kanban boards, CRM).
     * When true, the integrations-approval DynamoDB table is created even without
     * Pipedream integrations (used for ops tool approval flow).
     *
     * @default false
     */
    numaOps: z.boolean().optional().default(false),
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
      /** FEAT-167: voice prospect-intake bucket ARN (set only when numaVoice is
       *  on) — threaded to CognitoGroupsConstruct for the browser upload grant. */
      voiceIntakeBucketArn: z.string().optional(),
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
  /** Deployer role ARN for chain assume during ECR image push (container Lambdas) */
  deployerRoleArn?: string;
  /**
   * ARN of the centralized numa-email-sender Lambda (deployer account). Required
   * so the Cognito CustomEmailSender trigger can route auth emails through it.
   * (BUG-188)
   */
  emailSenderLambdaArn?: string;
};
