import { Construct } from 'constructs';
import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { CognitoUserPoolDomain } from '@cdktf/provider-aws/lib/cognito-user-pool-domain';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { TerraformOutput, Fn } from 'cdktf';
import { SetCallbackUrl } from './set-callback-url-construct';
import { AdjustToken } from './adjust-token-construct';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { CognitoIdentityPool } from '@cdktf/provider-aws/lib/cognito-identity-pool';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { CognitoIdentityPoolRolesAttachment } from '@cdktf/provider-aws/lib/cognito-identity-pool-roles-attachment';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamServiceLinkedRole } from '@cdktf/provider-aws/lib/iam-service-linked-role';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import * as path from 'node:path';

export class CoreNumaInfra extends Construct {
  constructor(scope: Construct, name: string, props: CoreNumaInfraProps) {
    super(scope, name);

    props.indexType ??= 'STARTER';
    props.identityProvider ??= 'oidc';
    const region = props.region ?? 'us-east-1';
    props.loadSampleFile ??= true;
    props.createServiceLinkedRole ??= true;
    props.webCrawlerConfigs ??= [];

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {});

    const numaClient = `numa-${props.client}${props.environmentName != 'prod' ? `-${props.environmentName}` : ''}`;

    // TODO: Typing
    let appIdentityConfig;
    let webexIdentityConfig;
    let pool = { id: '', name: '', endpoint: '' };
    let userPoolClient = { id: '', clientSecret: '' };

    if (props.identityProvider == 'oidc') {
      const at = new AdjustToken(this, 'token-adjuster', {
        nameSuffix: numaClient,
      });
      const cognitoDomain = numaClient;

      pool = new CognitoUserPool(this, 'user-pool', {
        name: numaClient,
        usernameAttributes: ['email'],
        lambdaConfig: {
          preTokenGenerationConfig: {
            lambdaArn: at.function.lambdaFunction.arn,
            lambdaVersion: 'V2_0',
          },
        },
        userPoolAddOns: {
          advancedSecurityMode: 'AUDIT',
        },
      });

      new TerraformOutput(this, 'user-pool-id', {
        value: pool.id,
      });

      new CognitoUserPoolDomain(this, 'domain', {
        userPoolId: pool.id,
        domain: cognitoDomain,
      });

      userPoolClient = new CognitoUserPoolClient(this, 'client', {
        userPoolId: pool.id,
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

      const identityPool = new CognitoIdentityPool(this, 'identity-pool', {
        identityPoolName: numaClient,
        allowUnauthenticatedIdentities: false,
        allowClassicFlow: true,
        cognitoIdentityProviders: [
          {
            clientId: userPoolClient.id,
            providerName: pool.endpoint,
          },
        ],
      });

      const identityPoolRoleTrustPolicy = new DataAwsIamPolicyDocument(this, 'identity-pool-role-trust-policy', {
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
                values: [identityPool.id],
                variable: 'cognito-identity.amazonaws.com:aud',
              },
              {
                test: 'ForAnyValue:StringLike',
                values: ['authenticated'],
                variable: 'cognito-identity.amazonaws.com:amr',
              },
            ],
          },
        ],
      });

      const identityPoolRolePolicy = new DataAwsIamPolicyDocument(this, 'identity-pool-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['cognito-identity:GetCredentialsForIdentity'],
            resources: ['*'],
          },
        ],
      });

      const identityPoolRole = new IamRole(this, 'identity-pool-role', {
        name: `${numaClient}-identity-role`,
        assumeRolePolicy: identityPoolRoleTrustPolicy.json,
      });

      new IamRolePolicy(this, 'identity-role-policy', {
        name: 'policy',
        role: identityPoolRole.name,
        policy: identityPoolRolePolicy.json,
      });

      new CognitoIdentityPoolRolesAttachment(this, 'identity-pool-role-attachment', {
        identityPoolId: identityPool.id,
        roles: {
          authenticated: identityPoolRole.arn,
        },
      });

      new LambdaPermission(this, 'permission', {
        statementId: 'cognito',

        functionName: at.function.lambdaFunction.functionName,
        action: 'lambda:InvokeFunction',
        principal: 'cognito-idp.amazonaws.com',
        // TODO: Add suitable condition.
      });

      const oidc = new CloudcontrolapiResource(this, 'idp', {
        typeName: 'AWS::IAM::OIDCProvider',
        desiredState: Fn.jsonencode({
          Url: `https://cognito-idp.${region}.amazonaws.com/${pool.id}`,
          ClientIdList: [userPoolClient.id],
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
        secretString: `{"client_secret": "${userPoolClient.clientSecret}"}`,
      });

      appIdentityConfig = {
        IdentityType: 'AWS_IAM_IDP_OIDC',
        ClientIdsForOIDC: [userPoolClient.id],
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
    } else if (props.identityProvider == 'idc') {
      const idc = new CloudcontrolapiResource(this, 'idc', {
        typeName: 'AWS::Iam::SsoInstance',
        desiredState: Fn.jsonencode({
          Name: numaClient,
        }),
      });
      const idcProps = Fn.jsondecode(idc.properties);

      // TODO: MFA settings.

      appIdentityConfig = {
        identityType: 'AWS_IAM_IDC',
        identityCenterInstanceArn: Fn.lookup(idcProps, 'InstanceArn'),
      };

      webexIdentityConfig = {
        IdentityProviderConfiguration: {},
      };
      new TerraformOutput(this, 'idc-arn', {
        value: Fn.lookup(idcProps, 'IdentityStoreId'),
      });
    } else {
      // TODO: Rethink this.
      throw new Error('Bad identity provider.');
    }

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

    const webExArn = `arn:aws:iam::${callerId.accountId}:oidc-provider/cognito-idp.${region}.amazonaws.com/${pool.id}`;

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
          DefaultSubscriptionType: 'Q_BUSINESS',
        },
        ...appIdentityConfig,
      }),
    });
    const applicationId = Fn.lookup(Fn.jsondecode(application.properties), 'ApplicationId');

    const webexperience = new CloudcontrolapiResource(this, 'web-experience', {
      typeName: 'AWS::QBusiness::WebExperience',
      desiredState: Fn.jsonencode({
        ApplicationId: applicationId,
        RoleArn: role.arn,
        ...webexIdentityConfig,
      }),
    });

    const webexEndpoint = Fn.lookup(Fn.jsondecode(webexperience.properties), 'DefaultEndpoint');

    // TODO: Workout how this will work for IdC and how to incorporate it.
    new SetCallbackUrl(this, 'callback', {
      callbackAddress: webexEndpoint + 'authorization-code/callback',
      userPoolClientId: userPoolClient.id,
      userPoolId: pool.id,
    });

    const index = new CloudcontrolapiResource(this, 'index', {
      typeName: 'AWS::QBusiness::Index',
      desiredState: Fn.jsonencode({
        ApplicationId: applicationId,
        DisplayName: numaClient,
        Type: props.indexType,
      }),
    });
    const indexId = Fn.lookup(Fn.jsondecode(index.properties), 'IndexId');

    new CloudcontrolapiResource(this, 'retriever', {
      typeName: 'AWS::QBusiness::Retriever',
      desiredState: Fn.jsonencode({
        ApplicationId: applicationId,
        DisplayName: numaClient,
        Configuration: {
          NativeIndexConfiguration: {
            IndexId: indexId,
          },
        },
        Type: 'NATIVE_INDEX',
      }),
    });

    const dataBucket = new PrivateBucket(this, 'data-source-bucket', {
      bucket: numaClient + '-data',
    });

    if (props.loadSampleFile) {
      const sampleFile = 'numa-one-pager.pdf';
      new S3Object(this, 'sample-file', {
        bucket: dataBucket.bucket.bucket,
        key: sampleFile,
        source: path.join(import.meta.dirname, '..', 'assets', sampleFile),
      });
    }

    const dataRole = new IamRole(this, 'data-source-role', {
      name: `data-source-role-${numaClient}`,
      // TODO: Replace stringify with a proper document.
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Principal: {
            Service: ['qbusiness.amazonaws.com'],
          },
          Action: ['sts:AssumeRole'],
          // TODO: Set correct conditions to properly scope assumption.
          // Condition: {
          //   StringEquals: {
          //     'aws:SourceAccount': '',
          //   }
          // },
        },
      }),
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

    const s3DataSource = new CloudcontrolapiResource(this, 'data-source', {
      typeName: 'AWS::QBusiness::DataSource',
      desiredState: Fn.jsonencode({
        ApplicationId: application.id,
        Configuration: {
          type: 'S3',
          syncMode: 'FULL_CRAWL',
          connectionConfiguration: {
            repositoryEndpointMetadata: {
              BucketName: dataBucket.bucket.bucket,
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
        IndexId: indexId,
        RoleArn: dataRole.arn,
        SyncSchedule: 'cron(0 * ? * * *)',
      }),
    });
    const dataSourceId = Fn.lookup(Fn.jsondecode(s3DataSource.properties), 'DataSourceId');

    for (const crawlerDataSource of props.webCrawlerConfigs) {
      const cleanedUrl = crawlerDataSource.url.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
      new CloudcontrolapiResource(this, `data-source-${cleanedUrl}`, {
        typeName: 'AWS::QBusiness::DataSource',
        desiredState: Fn.jsonencode({
          ApplicationId: application.id,
          Configuration: {
            type: 'WEBCRAWLERV2',
            syncMode: 'FULL_CRAWL',
            connectionConfiguration: {
              repositoryEndpointMetadata: {
                seedUrlConnections: [
                  {
                    seedUrl: crawlerDataSource.url,
                  },
                ],
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
            additionalProperties: {
              rateLimit: '300',
              honorRobots: true,
              maxFileSize: '50',
              maxLinksPerUrl: '100',
              crawlDepth: '10',
              crawlSubDomain: true,
              crawlAllDomain: false,
              crawlAttachments: true,
              // TODO
            },
          },
          DisplayName: `${numaClient}-web-${cleanedUrl}`,
          IndexId: indexId,
          RoleArn: dataRole.arn,
          SyncSchedule: 'cron(0 0 ? * * *)',
        }),
      });
    }

    new TerraformOutput(this, 'webex-url', {
      value: webexEndpoint,
    });

    new TerraformOutput(this, 'data-bucket', { value: dataBucket.bucket.bucket });
    new TerraformOutput(this, 'application-id', { value: applicationId });
    new TerraformOutput(this, 'data-source-id', { value: dataSourceId });
    new TerraformOutput(this, 'index-id', { value: indexId });
  }
}

interface WebCrawlerConfig {
  url: string;
}

export interface CoreNumaInfraProps {
  client: string;
  environmentName: string;
  identityProvider?: 'oidc' | 'idc';
  indexType?: 'ENTERPRISE' | 'STARTER';
  region?: string;
  clientAccountId?: string;
  loadSampleFile?: boolean;
  createServiceLinkedRole?: boolean;
  webCrawlerConfigs?: WebCrawlerConfig[];
}
