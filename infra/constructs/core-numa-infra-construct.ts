import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { CognitoUser } from '@cdktf/provider-aws/lib/cognito-user';
import { CognitoUserInGroup } from '@cdktf/provider-aws/lib/cognito-user-in-group';
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
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { password } from '@cdktf/provider-random';
import { RandomProvider } from '@cdktf/provider-random/lib/provider';
import { Fn, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import { AdjustToken } from './adjust-token-construct';
import { CognitoEmailHandler } from './cognito-email-handler-construct';
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
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { ConfigBucket } from './config-bucket-construct';
import { z } from 'zod';
import { WebCrawlerConstruct } from './web-crawler-construct';
import { CognitoGroupsConstruct, FEATURE_SET_NAMES } from './cognito-groups-construct';
import { KnowledgeBase } from './knowledge-base-construct';

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
  readonly chatHistoryTable: DynamodbTable;
  readonly webCrawler: WebCrawlerConstruct;
  readonly cognitoGroups!: CognitoGroupsConstruct;

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

    // TODO: Typing
    let appIdentityConfig;
    let webexIdentityConfig;

    // Create Cognito email handler Lambda function
    const cognitoEmailHandler = new CognitoEmailHandler(this, 'cognito-email-handler', {
      nameSuffix: numaClient,
      domainName: props.domainName,
    });

    const at = new AdjustToken(this, 'token-adjuster', {
      nameSuffix: numaClient,
    });
    const cognitoDomain = numaClient;

    const mfa =
      (props.mfa ?? false)
        ? {
            mfaConfiguration: 'ON',
            softwareTokenMfaConfiguration: {
              enabled: true,
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
        customMessage: cognitoEmailHandler.function.arn,
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
      functionName: cognitoEmailHandler.function.functionName,
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
    const systemUser = new CognitoUser(this, 'system-user', {
      enabled: true,
      username: systemUserEmail,
      attributes: {
        email: systemUserEmail,
        email_verified: 'true',
      },
      password: systemUserPassword,
      userPoolId: userPool.id,
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
      callbackUrls: ['https://localhost'], // Placeholder, must be provided, but is replaced later.
      allowedOauthFlowsUserPoolClient: true,
      allowedOauthFlows: ['code'],
      allowedOauthScopes: ['openid', 'email', 'profile'],
      accessTokenValidity: 60,
      refreshTokenValidity: 60,
      idTokenValidity: 60,
      tokenValidityUnits: [{ accessToken: 'minutes', refreshToken: 'days', idToken: 'minutes' }],
      supportedIdentityProviders: ['COGNITO'],
      lifecycle: {
        ignoreChanges: ['callback_urls'],
      },
    });

    // Create data bucket
    this.dataBucket = new NumaCorsEnabledBucket(this, 'data-source-bucket', {
      bucketName: 'data',
      clientName: props.clientName,
      origin: props.domainName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });
    this.dataBucket.bucket.moveFromId('aws_s3_bucket.data-source-bucket_1F269801');

    // Create company bucket
    const companyBucket = new NumaCorsEnabledBucket(this, 'company-data-bucket', {
      bucketName: 'company',
      clientName: props.clientName,
      origin: props.domainName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });

    // Create outputs bucket
    this.outputsBucket = new NumaCorsEnabledBucket(this, 'outputs-bucket', {
      clientName: props.clientName,
      origin: props.domainName,
      clientAccountId: props.clientAccountId,
      environmentName: props.environmentName,
      bucketName: 'outputs',
      allowedMethods: ['GET', 'PUT'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });
    this.outputsBucket.bucket.moveFromId('aws_s3_bucket.outputs-bucket_1F269801');

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
    new TerraformOutput(this, 'company-bucket', { value: companyBucket.bucket.bucket });

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
      companyBucket: companyBucket,
      chatHistoryTable: this.chatHistoryTable,
      groups: props.groups,
      qBusinessApplicationId: qBusinessApplicationIdForIdp,
      knowledgeBase: props.knowledgeBase,
    });

    // Expose whichever role Cognito decided should be the default web‑identity role.
    this.defaultWebIdentityRoleArn = this.cognitoGroups.defaultWebIdentityRoleArn;
    this.groups = this.cognitoGroups.groups;

    // Add system user to admin group
    new CognitoUserInGroup(this, 'system-user-admin-group', {
      groupName: 'admin',
      username: systemUser.username,
      userPoolId: userPool.id,
      dependsOn: [this.cognitoGroups.cognitoGroups['admin']],
    });

    this.logGroup = new NumaLogGroup(this, 'core-log-group', {
      logGroupName: `${props.clientName}-core`,
    }).logGroup;

    this.logGroup.addMoveTarget(`${props.clientName}-core-log-group`);

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
    const models = [
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-haiku-20240307-v1:0',
      'anthropic.claude-sonnet-4-20250514-v1:0',
      'anthropic.claude-3-7-sonnet-20250219-v1:0',
      'amazon.titan-embed-text-v2:0',
    ];

    // Add region-specific models
    if (props.region === 'us-east-1') {
      models.push('amazon.nova-pro-v1:0');
      models.push('amazon.nova-premier-v1:0');
    }
    if (props.region === 'ap-southeast-2') {
      // Nova Premier is not available in ap-southeast-2
      models.push('amazon.nova-pro-v1:0');
    }

    // Provision each model only in the source region
    for (const modelId of models) {
      const input = JSON.stringify({
        model_id: modelId,
        region: props.region,
        trigger: '1',
      });

      new LambdaInvocation(this, `bedrock-model-manager-invocation_${modelId.replace(/[.:]/g, '-')}_${props.region}`, {
        functionName: bedrockModelManager.lambda.functionName,
        input,
        triggers: {
          bedrockModelManagerSourceHash: bedrockModelManager.lambda.sourceCodeHash,
          input,
        },
        dependsOn: [
          bedrockModelManager.lambda,
          ...bedrockModelManager.additionalPolicies,
          ...bedrockModelManager.policyAttachments,
        ],
      });
    }
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
  })
  .strict();

export const coreNumaInfraPropsSchema = _coreNumaInfraPropsSchema
  .merge(qBusinessChatControlConfigurerPropsSchema.omit({ applicationId: true, accountId: true }))
  .merge(
    z.object({
      groups: z.record(z.array(z.enum(FEATURE_SET_NAMES as [string, ...string[]]))).optional(),
    }),
  );
export type CoreNumaInfraProps = z.infer<typeof coreNumaInfraPropsSchema> & {
  clientName: string;
  domainName: string;
  /**
   * Provider for QBusiness resources.
   */
  qBusinessProvider?: AwsProvider;
  knowledgeBase: KnowledgeBase;
};
