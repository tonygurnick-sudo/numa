import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Fn, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
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
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { NumaCorsEnabledBucket } from './cors-enabled-bucket';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { ConfigBucket } from './config-bucket-construct';
import { z } from 'zod';
import { CognitoConstruct, CognitoConstructProps, FeatureSetName } from './cognito-construct';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { WebExperienceConstruct } from './web-experience-construct';

export class CoreNumaInfra extends Construct {
  readonly webExUrl: string;
  readonly userPoolId: string;
  readonly userPoolClient: CognitoUserPoolClient;
  readonly webExperienceRoleArn: string;
  readonly qBusinessApplicationId: string;
  readonly qBusinessIndexId: string;
  readonly qBusinessRetrieverId: string;
  readonly qBusinessApplicationArn: string;
  readonly logGroup: CloudwatchLogGroup;
  readonly outputsBucket: NumaCorsEnabledBucket;
  readonly otelConfigPath: string;
  readonly dataBucket: NumaCorsEnabledBucket;
  readonly chatHistoryTable: DynamodbTable;
  readonly identityPools: Record<string, { id: string; features: FeatureSetName[] }>;

  constructor(scope: Construct, name: string, props: CoreNumaInfraProps) {
    super(scope, name);

    props.indexType ??= 'STARTER';
    props.loadSampleFile ??= true;
    props.createServiceLinkedRole ??= true;
    props.webCrawlerConfigs ??= [];
    props.temporaryPasswordValidityDays ??= 30;
    props.devInstance ??= false;

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {});

    const numaClient = `numa-${props.clientName}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;

    // TODO: Typing
    let appIdentityConfig;
    let webexIdentityConfig;

    this.dataBucket = new NumaCorsEnabledBucket(this, 'data-source-bucket', {
      bucketName: 'data',
      clientName: props.clientName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'PUT', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });
    this.dataBucket.bucket.moveFromId('aws_s3_bucket.data-source-bucket_1F269801');

    const companyBucket = new NumaCorsEnabledBucket(this, 'company-data-bucket', {
      bucketName: 'company',
      clientName: props.clientName,
      environmentName: props.environmentName,
      clientAccountId: props.clientAccountId,
      allowedMethods: ['GET', 'PUT', 'DELETE'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });

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

    this.outputsBucket = new NumaCorsEnabledBucket(this, 'outputs-bucket', {
      clientName: props.clientName,
      clientAccountId: props.clientAccountId,
      environmentName: props.environmentName,
      bucketName: 'outputs',
      allowedMethods: ['GET', 'PUT'],
      allowLocalhostOrigin: props.devInstance,
      region: props.region,
    });
    this.outputsBucket.bucket.moveFromId('aws_s3_bucket.outputs-bucket_1F269801');

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

    // Create Cognito construct with all Cognito resources
    const cognitoProps: CognitoConstructProps = {
      clientName: props.clientName,
      environmentName: props.environmentName ?? 'dev',
      domainName: props.domainName,
      region: props.region,
      devInstance: props.devInstance ?? false,
      mfa: props.mfa ?? false,
      passwordLength: props.passwordLength ?? 8,
      temporaryPasswordValidityDays: props.temporaryPasswordValidityDays ?? 30,
      createServiceLinkedRole: props.createServiceLinkedRole ?? true,
      dataBucket: this.dataBucket,
      outputsBucket: this.outputsBucket,
      companyBucket: companyBucket,
      chatHistoryTable: this.chatHistoryTable,
      callerAccountId: callerId.accountId,
    };

    const cognitoConstruct = new CognitoConstruct(this, 'cognito', cognitoProps);
    this.identityPools = cognitoConstruct.identityPools;

    // Set Cognito-related properties to use values from the CognitoConstruct
    this.userPoolId = cognitoConstruct.userPoolId;
    this.userPoolClient = cognitoConstruct.userPoolClient;

    // Use the values from Cognito construct for QBusiness configuration
    appIdentityConfig = {
      IdentityType: 'AWS_IAM_IDP_OIDC',
      ClientIdsForOIDC: [this.userPoolClient.id],
      IamIdentityProviderArn: cognitoConstruct.oidcArn,
      RoleArn: `arn:aws:iam::${callerId.accountId}:role/aws-service-role/qbusiness.amazonaws.com/AWSServiceRoleForQBusiness`, // TODO: Dynamic.
    };

    webexIdentityConfig = {
      IdentityProviderConfiguration: {
        OpenIDConnectConfiguration: {
          SecretsArn: cognitoConstruct.secretsManagerSecret.arn,
          SecretsRole: cognitoConstruct.secretsRole.arn,
        },
      },
    };

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
    this.qBusinessApplicationArn = Fn.lookup(Fn.jsondecode(application.properties), 'ApplicationArn');

    // Create the WebExperienceConstruct
    const webExperience = new WebExperienceConstruct(this, 'web-experience-construct', {
      clientName: props.clientName,
      environmentName: props.environmentName,
      domainName: props.domainName,
      region: props.region,
      applicationId: this.qBusinessApplicationId,
      applicationArn: this.qBusinessApplicationArn,
      userPoolId: this.userPoolId,
      userPoolClientId: this.userPoolClient.id,
      enableIFrame: props.enableIFrame,
      webexIdentityConfig,
      qBusinessProvider: props.qBusinessProvider,
    });
    this.webExUrl = webExperience.webExUrl;
    this.webExperienceRoleArn = webExperience.webExperienceRoleArn;

    new QBusinessChatControlConfigurer(this, 'chat-control', {
      applicationId: this.qBusinessApplicationId,
      enableDirectLLMAccess: props.enableDirectLLMAccess,
      enableLLMKnowledgeFallback: props.enableLLMKnowledgeFallback,
      region: props.qBusinessProvider?.region ?? props.region,
      accountId: callerId.accountId,
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
        indexId: this.qBusinessIndexId,
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
        applicationId: this.qBusinessApplicationId,
        indexId: this.qBusinessIndexId,
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
        applicationId: this.qBusinessApplicationId,
        indexId: this.qBusinessIndexId,
        region: props.region,
        configuration: boxDataSource.configuration,
        dataSourceRoleArn: dataRole.arn,
      });
    }

    for (const teamsDataSource of props.teamsConfigs ?? []) {
      new TeamsDataSource(this, `data-source-teams-${teamsDataSource.tenantId}`, {
        displayName: `${numaClient}-teams-${teamsDataSource.tenantId}`,
        tenantId: teamsDataSource.tenantId,
        applicationId: this.qBusinessApplicationId,
        indexId: this.qBusinessIndexId,
        region: props.region,
        configuration: teamsDataSource.configuration,
        dataSourceRoleArn: dataRole.arn,
      });
    }

    for (const s3DataSource of props.s3Configs ?? []) {
      new S3DataSource(this, `data-source-s3-${s3DataSource.bucketName}`, {
        displayName: `${numaClient}-s3-${s3DataSource.bucketName}`,
        bucketName: s3DataSource.bucketName,
        applicationId: this.qBusinessApplicationId,
        indexId: this.qBusinessIndexId,
        region: props.region,
        dataSourceRoleArn: dataRole.arn,
        configuration: s3DataSource.configuration,
      });
    }

    new TerraformOutput(this, 'webex-url', {
      value: this.webExUrl,
    });

    new TerraformOutput(this, 'data-bucket', { value: this.dataBucket.bucket.bucket });
    new TerraformOutput(this, 'company-bucket', { value: companyBucket.bucket.bucket });
    new TerraformOutput(this, 'application-id', { value: this.qBusinessApplicationId });
    new TerraformOutput(this, 'data-source-id', { value: dataSourceId });
    new TerraformOutput(this, 'index-id', { value: this.qBusinessIndexId });
    new TerraformOutput(this, 'retriever-id', { value: this.qBusinessRetrieverId });

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

    // modify trigger to force re-run of lambda
    const models = [
      {
        model_id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        regions: [props.region],
        trigger: '1',
      },
      {
        model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        regions: [props.region],
        trigger: '1',
      },
      {
        model_id: 'anthropic.claude-3-haiku-20240307-v1:0',
        regions: [props.region],
        trigger: '1',
      },
      {
        model_id: 'anthropic.claude-sonnet-4-20250514-v1:0',
        regions: [props.region],
        trigger: '1',
      },
      {
        model_id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        regions: [props.region],
        trigger: '1',
      },
    ];

    for (const model of models) {
      for (const region of model.regions) {
        const input = JSON.stringify({
          model_id: model.model_id,
          region,
          trigger: model.trigger,
        });

        new LambdaInvocation(
          this,
          `bedrock-model-manager-invocation_${model.model_id.replace(/[.:]/g, '-')}_${region}`,
          {
            functionName: bedrockModelManager.lambda.functionName,
            input,
            triggers: {
              bedrockModelManagerSourceHash: bedrockModelManager.lambda.sourceCodeHash,
              input,
            },
            // this should make sure permissions are sorted before calling the
            // lambda, but there seems to be a problem with eventual
            // consistency at times
            dependsOn: [
              bedrockModelManager.lambda,
              ...bedrockModelManager.additionalPolicies,
              ...bedrockModelManager.policyAttachments,
            ],
          },
        );
      }
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
  })
  .strict();

export const coreNumaInfraPropsSchema = _coreNumaInfraPropsSchema.merge(
  qBusinessChatControlConfigurerPropsSchema.omit({ applicationId: true, accountId: true }),
);
export type CoreNumaInfraProps = z.infer<typeof coreNumaInfraPropsSchema> & {
  clientName: string;
  domainName: string;
  /**
   * Provider for QBusiness resources.
   */
  qBusinessProvider?: AwsProvider;
};
