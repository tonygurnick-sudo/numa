import { CloudcontrolapiResource } from '@cdktf/provider-aws/lib/cloudcontrolapi-resource';
import { CognitoIdentityPool } from '@cdktf/provider-aws/lib/cognito-identity-pool';
import { CognitoIdentityPoolRolesAttachment } from '@cdktf/provider-aws/lib/cognito-identity-pool-roles-attachment';
import { CognitoUser } from '@cdktf/provider-aws/lib/cognito-user';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { CognitoUserPoolDomain } from '@cdktf/provider-aws/lib/cognito-user-pool-domain';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamServiceLinkedRole } from '@cdktf/provider-aws/lib/iam-service-linked-role';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { SecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/secretsmanager-secret-version';
import { password } from '@cdktf/provider-random';
import { RandomProvider } from '@cdktf/provider-random/lib/provider';
import { Fn, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import { z } from 'zod';
import { AdjustToken } from './adjust-token-construct';
import { CognitoEmailHandler } from './cognito-email-handler-construct';
import { CognitoUserGroup } from '@cdktf/provider-aws/lib/cognito-user-group';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamPolicyAttachment } from '@cdktf/provider-aws/lib/iam-policy-attachment';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { CognitoIdentityPoolProviderPrincipalTag } from '@cdktf/provider-aws/lib/cognito-identity-pool-provider-principal-tag';

export const cognitoConstructPropsSchema = z.object({
  clientName: z.string(),
  environmentName: z.string().optional().default('dev'),
  domainName: z.string(),
  region: z.string(),
  devInstance: z.boolean().optional().default(false),
  mfa: z.boolean().optional().default(false),
  passwordLength: z.number().optional().default(8),
  temporaryPasswordValidityDays: z.number().optional().default(30),
  createServiceLinkedRole: z.boolean().optional().default(true),
  dataBucket: z.any().optional(),
  outputsBucket: z.any().optional(),
  companyBucket: z.any().optional(),
  chatHistoryTable: z.any().optional(),
  callerAccountId: z.string(),
  featureSets: z.record(z.array(z.any())).optional(),
  groups: z.record(z.array(z.string())).optional(),
});

// Helper type for policy statements to avoid TypeScript errors
interface PolicyStatement {
  effect: string;
  actions: string[];
  resources?: string[];
  condition?: {
    test: string;
    values: string[];
    variable: string;
  }[];
}

// Define the feature set types
export type FeatureSetName = 'chat' | 'useCompanyData' | 'editCompanyData' | 'manageUsers';

export class CognitoConstruct extends Construct {
  readonly userPoolId: string;
  readonly userPoolClient: CognitoUserPoolClient;
  readonly oidcArn: string;
  readonly secretsRole: IamRole;
  readonly secretsManagerSecret: SecretsmanagerSecret;
  readonly identityPools: Record<string, { id: string; features: FeatureSetName[] }> = {};

  // Feature Set Policies - dynamically generated based on input
  readonly featureSetPolicies: Record<string, IamPolicy> = {};

  // Group-specific identity pools and roles
  readonly groupIdentityPools: Record<string, { pool: CognitoIdentityPool; role: IamRole }> = {};
  readonly cognitoGroups: Record<string, CognitoUserGroup> = {};

  constructor(scope: Construct, name: string, props: CognitoConstructProps) {
    super(scope, name);

    // Define the groups and their feature sets
    const defaultGroups: Record<string, FeatureSetName[]> = {
      // The standard group should always be the least privileged group of all groups
      standard: ['chat', 'useCompanyData'],
      admin: ['chat', 'useCompanyData', 'editCompanyData', 'manageUsers'],
    };

    // Use props.groups if provided, otherwise use default groups
    const groups = props.groups ?? defaultGroups;

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    // Create Cognito email handler Lambda function
    const cognitoEmailHandler = new CognitoEmailHandler(this, 'cognito-email', {
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

    // Create User Pool
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
        temporaryPasswordValidityDays: props.temporaryPasswordValidityDays,
      },
      ...mfa,
      lifecycle: {
        preventDestroy: true,
      },
    });
    this.userPoolId = userPool.id;

    new TerraformOutput(this, 'user-pool-id', {
      value: userPool.id,
    });

    // Create User Pool Domain
    new CognitoUserPoolDomain(this, 'domain', {
      userPoolId: userPool.id,
      domain: cognitoDomain,
    });

    // Grant permissions for Cognito to invoke the email handler Lambda
    // Placed here rather than in the CognitoEmailHandler construct to avoid circular dependency.
    new LambdaPermission(this, 'cognito-email-permission', {
      functionName: cognitoEmailHandler.function.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: userPool.arn,
    });

    // Create system user
    new RandomProvider(this, 'random-provider', {});
    const systemUserPassword = new password.Password(this, 'password', {
      length: 64,
      minLower: 5,
      minNumeric: 5,
      minSpecial: 5,
      minUpper: 5,
    }).result;
    const systemUserEmail = 'numa-system-user@arcanum.ai';

    new CognitoUser(this, 'system-user', {
      enabled: true,
      username: systemUserEmail,
      attributes: {
        email: systemUserEmail,
        email_verified: 'true',
      },
      password: systemUserPassword,
      userPoolId: userPool.id,
      lifecycle: {
        preventDestroy: true,
      },
    });

    const systemUserSecret = new SecretsmanagerSecret(this, 'system-user-secret-manager-secret', {
      name: `${props.clientName}-system-user-password`,
      lifecycle: {
        preventDestroy: true,
      },
    });

    new SecretsmanagerSecretVersion(this, 'system-user-secret-version', {
      secretId: systemUserSecret.arn,
      secretString: JSON.stringify({
        username: systemUserEmail,
        password: systemUserPassword,
      }),
      // Ensures that the secret is only created once.
      // A secret is generated every deploy, but changes to the secret are ignored.
      lifecycle: {
        ignoreChanges: ['secret_string'],
      },
    });

    new TerraformOutput(this, 'system-user-secret', {
      value: systemUserSecret.arn,
    });

    // Create User Pool Client
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

    // Define the feature sets and their policy statements
    const featureSets: Record<string, PolicyStatement[]> = {
      // Chat Feature Set
      chat: [
        // Outputs bucket permissions
        ...(props.outputsBucket
          ? [
              {
                effect: 'Allow',
                actions: ['s3:PutObject', 's3:GetObject'],
                // Given the issues with the inclusion of sub, we may need to use username instead
                resources: [`${props.outputsBucket.bucket.arn}/outputs/$\${cognito-identity.amazonaws.com:sub}/*`],
              },
            ]
          : []),
        // Chat history permissions with row-level security
        ...(props.chatHistoryTable
          ? [
              // https://stackoverflow.com/questions/56801845/iam-policy-cognito-variables-for-dynamodb-leadingkeys-restriction
              // https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html
              // Must have the session tags and mappings to be able to use the RLS
              {
                effect: 'Allow',
                actions: [
                  'dynamodb:PutItem',
                  'dynamodb:GetItem',
                  'dynamodb:Query',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                ],
                resources: ['*'],
                condition: [
                  {
                    test: 'ForAllValues:StringEquals',
                    values: ['$\${aws:PrincipalTag/username}'],
                    variable: 'dynamodb:LeadingKeys',
                  },
                ],
              },
            ]
          : []),
        // Company Context permissions
        ...(props.companyBucket
          ? [
              {
                effect: 'Allow',
                actions: ['s3:GetObject'],
                resources: [`${props.companyBucket.bucket.arn}/company-data.json`],
              },
            ]
          : []),
        // Bedrock permissions
        {
          effect: 'Allow',
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'], // TODO: Update to specific models and agents when implemented
        },
        // KMS permissions (only when invoked by Q)
        {
          effect: 'Allow',
          actions: ['kms:GenerateDataKey'],
          resources: ['*'], // TODO: Update to specific KMS keys when implemented
          condition: [
            {
              test: 'StringEquals',
              variable: 'aws:SourceService',
              values: ['qbusiness.amazonaws.com'],
            },
          ],
        },
        {
          effect: 'Allow',
          actions: ['kms:Decrypt'],
          resources: [`arn:aws:kms:${props.region}:${props.callerAccountId}:key/*`],
          condition: [
            {
              test: 'StringLike',
              variable: 'kms:ViaService',
              values: [`qbusiness.${props.region}.amazonaws.com`, `qapps.${props.region}.amazonaws.com`],
            },
          ],
        },
      ],

      // Use Company Data Feature Set
      useCompanyData: [
        ...(props.dataBucket
          ? [
              {
                effect: 'Allow',
                actions: ['s3:ListBucket'],
                resources: [props.dataBucket.bucket.arn],
              },
              {
                effect: 'Allow',
                actions: ['s3:GetObject'],
                resources: [`${props.dataBucket.bucket.arn}/*`],
              },
              {
                effect: 'Allow',
                actions: ['qbusiness:SearchRelevantContent'],
                resources: ['*'], // TODO: Change to specific resource
              },
              {
                effect: 'Allow',
                actions: ['qbusiness:ListDataSources'],
                resources: ['*'], // TODO: Change to specific resource
              },
              {
                effect: 'Allow',
                resources: ['*'], // TODO: Change to specific resource
                actions: ['qbusiness:ListDataSourceSyncJobs'],
              },
            ]
          : []),
      ],

      // Edit Company Data Feature Set
      editCompanyData: [
        ...(props.dataBucket
          ? [
              {
                effect: 'Allow',
                actions: ['s3:PutObject', 's3:DeleteObject'],
                resources: [`${props.dataBucket.bucket.arn}/*`],
              },
              // ListDocuments is only used in company file uploader. Only 'editors' need it.
              {
                effect: 'Allow',
                actions: ['qbusiness:ListDocuments'],
                resources: ['*'], // TODO: Change to specific resource
              },
            ]
          : []),
      ],

      // Manage Users Feature Set
      manageUsers: [
        {
          effect: 'Allow',
          actions: [
            'cognito-idp:ListUsers',
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminDeleteUser',
            'cognito-idp:AdminResetUserPassword',
            'cognito-idp:AdminSetUserPassword',
            'cognito-idp:AdminGetUser',
          ],
          resources: [userPool.arn],
        },
        {
          effect: 'Allow',
          actions: ['qbusiness:DeleteUser', 'qbusiness:GetUser'],
          resources: [`arn:aws:qbusiness:${props.region}:${props.callerAccountId}:application/${numaClient}`],
        },
      ],
    };

    // Create a managed policy, store it in the featureSetPolicies object to attach it to the role
    for (const [featureSetName, policyStatements] of Object.entries(featureSets)) {
      const policyDocument = new DataAwsIamPolicyDocument(this, `${featureSetName}-policy`, {
        statement: policyStatements,
      });

      const policy = new IamPolicy(this, `${featureSetName}-permissions-policy`, {
        name: `${featureSetName}-permissions-policy`,
        policy: policyDocument.json,
      });

      this.featureSetPolicies[featureSetName] = policy;
    }

    // Create Cognito user groups, identity pools, and roles for each group
    for (const groupName of Object.keys(groups)) {
      // Create the Cognito user group
      const userGroup = new CognitoUserGroup(this, `${groupName}-group`, {
        name: groupName,
        userPoolId: userPool.id,
        description: `${groupName} user group with specific permissions`,
      });
      this.cognitoGroups[groupName] = userGroup;

      // Create a separate identity pool for this group
      const groupIdentityPool = new CognitoIdentityPool(this, `${groupName}-identity-pool`, {
        identityPoolName: `${numaClient}-${groupName}`,
        allowUnauthenticatedIdentities: false,
        allowClassicFlow: true,
        cognitoIdentityProviders: [
          {
            clientId: this.userPoolClient.id,
            providerName: userPool.endpoint,
          },
        ],
      });

      // Create an Identity Provider so that username can be used as the sub claim
      new CognitoIdentityPoolProviderPrincipalTag(this, `${groupName}-identity-provider-principal-tag`, {
        identityPoolId: groupIdentityPool.id,
        identityProviderName: userPool.endpoint,
        principalTags: {
          username: 'sub',
        },
      });

      // Create a trust policy for this group's roles in the identity pool
      const groupTrustPolicy = new DataAwsIamPolicyDocument(this, `${groupName}-trust-policy`, {
        statement: [
          // First statement - must be authenticated
          {
            effect: 'Allow',
            principals: [
              {
                type: 'Federated',
                identifiers: ['cognito-identity.amazonaws.com'],
              },
            ],
            // The sts:TagSession is removed from the trust policy in console,
            // but the identity pool breaks without it.
            actions: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
            condition: [
              {
                test: 'StringEquals',
                values: [groupIdentityPool.id],
                variable: 'cognito-identity.amazonaws.com:aud',
              },
              {
                test: 'ForAnyValue:StringLike',
                values: ['authenticated'],
                variable: 'cognito-identity.amazonaws.com:amr',
              },
            ],
          },
          // Only add second statement for non-standard groups
          // These statements MUST be split out. We want to check if a user is authenticated and then check if they are in the group.
          // AND have the group name in the amr. CDKTF deduplicates the amr check, so we need to split it out.
          // If we don't have two statements, the check would be ForAnyValue:StringLike which is an OR
          // So an authenticated user would be able to access the role even if they are not in the group.

          // TODO: Uncomment this when we have groups being used to dynamically render features
          // ...(groupName !== 'standard'
          //   ? [
          //       {
          //         effect: 'Allow',
          //         principals: [
          //           {
          //             type: 'Federated',
          //             identifiers: ['cognito-identity.amazonaws.com'],
          //           },
          //         ],
          //         actions: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
          //         condition: [
          //           {
          //             test: 'StringEquals',
          //             values: [groupIdentityPool.id],
          //             variable: 'cognito-identity.amazonaws.com:aud',
          //           },
          //           {
          //             test: 'ForAnyValue:StringLike',
          //             values: [groupName],
          //             variable: 'cognito-identity.amazonaws.com:amr',
          //           },
          //         ],
          //       },
          //     ]
          //   : []),
        ],
      });

      // Create the role for this group
      const groupRole = new IamRole(this, `${groupName}-role`, {
        name: `${numaClient}-${groupName}-role`,
        assumeRolePolicy: groupTrustPolicy.json,
      });

      // Loop through all the feature sets and attach the managed policy to the role if the group has the feature set
      for (const featureSetName of Object.keys(this.featureSetPolicies)) {
        if (groups[groupName].includes(featureSetName)) {
          new IamRolePolicyAttachment(this, `${groupName}-${featureSetName}-policy`, {
            policyArn: this.featureSetPolicies[featureSetName].arn,
            role: groupRole.name,
          });
        }
      }

      // Attach the base policy to the role
      const basePolicyStatements = new DataAwsIamPolicyDocument(this, `${groupName}-base-policy-statements`, {
        statement: [
          {
            effect: 'Allow',
            actions: ['cognito-identity:GetCredentialsForIdentity'],
            resources: [groupIdentityPool.arn],
          },
        ],
      });

      const basePolicy = new IamPolicy(this, `${groupName}-base-permissions-policy`, {
        name: `${groupName}-base-permissions-policy`,
        policy: basePolicyStatements.json,
      });

      new IamPolicyAttachment(this, `${groupName}-base-policy`, {
        policyArn: basePolicy.arn,
        roles: [groupRole.name],
        name: `${groupName}-base-attachment-policy`,
      });

      // Create identity pool roles attachment for this group
      new CognitoIdentityPoolRolesAttachment(this, `${groupName}-identity-pool-role-attachment`, {
        identityPoolId: groupIdentityPool.id,
        roles: {
          authenticated: groupRole.arn,
        },
      });

      // Store the identity pool and role for this group
      this.groupIdentityPools[groupName] = {
        pool: groupIdentityPool,
        role: groupRole,
      };
    }

    // Create a TerraformOutput for all identity pools
    for (const groupName of Object.keys(groups)) {
      const identityPoolInfo = {
        id: this.groupIdentityPools[groupName].pool.id,
        features: groups[groupName] as FeatureSetName[],
      };
      this.identityPools[groupName] = identityPoolInfo;
    }

    // Output all identity pools as a single JSON object
    new TerraformOutput(this, 'identity-pools', {
      value: this.identityPools,
    });

    // Grant permission for adjust token lambda
    new LambdaPermission(this, 'permission', {
      functionName: at.function.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'cognito-idp.amazonaws.com',
    });

    // Create OIDC provider
    const oidc = new CloudcontrolapiResource(this, 'idp', {
      typeName: 'AWS::IAM::OIDCProvider',
      desiredState: Fn.jsonencode({
        Url: `https://${userPool.endpoint}`,
        ClientIdList: [this.userPoolClient.id],
      }),
    });
    this.oidcArn = Fn.lookup(Fn.jsondecode(oidc.properties), 'Arn');

    // Create secrets for OIDC
    const secret = new SecretsmanagerSecret(this, 'secret', {
      namePrefix: `QBusiness-oidc-client-secret-${numaClient}-`,
    });
    this.secretsManagerSecret = secret;

    // Create secrets policy
    const secretsPolicyDocument = new DataAwsIamPolicyDocument(this, 'secrets-policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [secret.arn],
        },
      ],
    });

    // Create secrets trust policy
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

    // Create secrets role
    this.secretsRole = new IamRole(this, 'secrets-role', {
      name: `numa-secrets-role-${numaClient}`,
      assumeRolePolicy: secretsTrustPolicyDocument.json,
    });

    // Attach policy to secrets role
    new IamRolePolicy(this, 'secrets-role-policy', {
      name: `secrets-role-policy`,
      role: this.secretsRole.name,
      policy: secretsPolicyDocument.json,
    });

    // Create service linked role if needed
    if (props.createServiceLinkedRole) {
      new IamServiceLinkedRole(this, 'q-service-role', {
        awsServiceName: 'qbusiness.amazonaws.com',
      });
    }

    // Store client secret in SecretsManager
    new SecretsmanagerSecretVersion(this, 'secret-version', {
      secretId: secret.id,
      secretString: `{"client_secret": "${this.userPoolClient.clientSecret}"}`,
      // Ensures that the secret is only created once.
      // A secret is generated every deploy, but changes to the secret are ignored.
      lifecycle: {
        ignoreChanges: ['secret_string'],
      },
    });
  }
}

export type CognitoConstructProps = z.infer<typeof cognitoConstructPropsSchema>;
