import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import { z } from 'zod';
import { CognitoUserGroup } from '@cdktf/provider-aws/lib/cognito-user-group';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { KnowledgeBase } from './knowledge-base-construct';

// Define the feature set types
export type FeatureSetName = 'chat' | 'useCompanyData' | 'deleteFromCompanyData' | 'addToCompanyData' | 'manageUsers';

// Define specific bucket type for AWS S3 buckets
const bucketSchema = z.object({
  bucket: z.object({
    arn: z.string(),
  }),
});

// Define table type for DynamoDB tables
const tableSchema = z.object({
  name: z.string().optional(),
  arn: z.string().optional(),
});

export const cognitoIdpConstructPropsSchema = z.object({
  clientName: z.string(),
  environmentName: z.string().optional().default('dev'),
  region: z.string(),
  userPoolId: z.string(),
  userPoolEndpoint: z.string(),
  userPoolClientId: z.string(),
  callerAccountId: z.string(),
  dataBucket: bucketSchema,
  outputsBucket: bucketSchema,
  companyBucket: bucketSchema,
  chatHistoryTable: tableSchema,
  qBusinessApplicationId: z.string().optional(), // Add optional Q Business application ID
  featureSets: z
    .record(z.array(z.enum(['chat', 'useCompanyData', 'deleteFromCompanyData', 'addToCompanyData', 'manageUsers'])))
    .optional(),
  groups: z
    .record(z.array(z.enum(['chat', 'useCompanyData', 'deleteFromCompanyData', 'addToCompanyData', 'manageUsers'])))
    .optional(),
  knowledgeBase: z.instanceof(KnowledgeBase),
});

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

export class CognitoIdpConstruct extends Construct {
  readonly groups: Record<string, { roleArn: string; features: FeatureSetName[] }> = {};
  readonly featureSetPolicies: Record<string, IamPolicy> = {};
  readonly cognitoGroups: Record<string, CognitoUserGroup> = {};
  readonly defaultWebIdentityRoleArn!: string;

  constructor(scope: Construct, name: string, props: CognitoIdpConstructProps) {
    super(scope, name);

    // Define the groups and their feature sets
    const defaultGroups: Record<string, FeatureSetName[]> = {
      // The standard group should always be the least privileged group of all groups
      standard: ['chat', 'useCompanyData'],
      admin: ['chat', 'useCompanyData', 'deleteFromCompanyData', 'addToCompanyData', 'manageUsers'],
    };

    // Use props.groups if provided, otherwise use default groups which allows for stack specific permissions
    const groups = props.groups ?? defaultGroups;

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    // Define the feature sets and their policy statements
    const featureSets: Record<string, PolicyStatement[]> = {
      // Chat Feature Set
      chat: [
        // Outputs bucket permissions
        ...(props.outputsBucket
          ? [
              {
                effect: 'Allow',
                actions: ['s3:PutObject', 's3:GetObject', 's3:GetObjectTagging'],
                resources: [`${props.outputsBucket.bucket.arn}/outputs/$\${aws:PrincipalTag/username}/*`],
              },
            ]
          : []),
        // Chat history permissions with row-level security
        ...(props.chatHistoryTable
          ? [
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
        // Bedrock knowledge base retrieval for chat
        {
          effect: 'Allow',
          actions: ['bedrock:Retrieve'],
          resources: [props.knowledgeBase.knowledgeBaseArn],
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
                actions: ['s3:GetObject', 's3:GetObjectTagging'],
                resources: [`${props.dataBucket.bucket.arn}/*`],
              },
              // Only include Q Business permissions if Q Business is enabled
              ...(props.qBusinessApplicationId
                ? [
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
                    {
                      effect: 'Allow',
                      actions: ['qbusiness:ListDocuments'],
                      resources: ['*'], // TODO: Change to specific resource
                    },
                    {
                      effect: 'Allow',
                      actions: ['user-subscriptions:CreateClaim'],
                      resources: ['*'], // Wild card, because we don't know the user's subscription ID
                    },
                  ]
                : []),
              // ListDocuments is used in S3 uploader for knowledge base status. All users with data access need it.
              {
                effect: 'Allow',
                actions: ['qbusiness:ListDocuments'],
                resources: ['*'], // TODO: Change to specific resource
              },
            ]
          : []),
        // Bedrock knowledge base read-only permissions for viewing status
        {
          effect: 'Allow',
          actions: [
            'bedrock:ListKnowledgeBases',
            'bedrock:ListDataSources',
            'bedrock:ListIngestionJobs',
            'bedrock:ListKnowledgeBaseDocuments',
          ],
          resources: [props.knowledgeBase.knowledgeBaseArn],
        },
      ],

      // Delete from Company Data Feature Set
      deleteFromCompanyData: [
        {
          effect: 'Allow',
          actions: ['s3:DeleteObject'],
          resources: [`${props.dataBucket.bucket.arn}/*`],
        },
      ],

      // Add to Company Data Feature Set
      addToCompanyData: [
        {
          effect: 'Allow',
          actions: ['s3:PutObject'],
          resources: [`${props.dataBucket.bucket.arn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['qbusiness:ListDocuments'],
          resources: ['*'],
        },
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
            'cognito-idp:AdminAddUserToGroup',
            'cognito-idp:AdminRemoveUserFromGroup',
            'cognito-idp:AdminListGroupsForUser',
          ],
          resources: [`arn:aws:cognito-idp:${props.region}:${props.callerAccountId}:userpool/${props.userPoolId}`],
        },
        // Only include Q Business permissions if Q Business is enabled
        ...(props.qBusinessApplicationId
          ? [
              {
                effect: 'Allow',
                actions: ['qbusiness:DeleteUser', 'qbusiness:GetUser'],
                resources: [
                  `arn:aws:qbusiness:${props.region}:${props.callerAccountId}:application/${props.qBusinessApplicationId}`,
                ],
              },
            ]
          : []),
      ],
    };

    // Create a managed policy, store it in the featureSetPolicies object to attach it to the role
    for (const [featureSetName, policyStatements] of Object.entries(featureSets)) {
      const policyDocument = new DataAwsIamPolicyDocument(this, `${featureSetName}-policy`, {
        statement: policyStatements,
      });

      const policy = new IamPolicy(this, `${numaClient}-${featureSetName}-permissions-policy`, {
        name: `${numaClient}-${featureSetName}-permissions-policy`,
        policy: policyDocument.json,
      });

      this.featureSetPolicies[featureSetName] = policy;
    }

    // Create the generic identity-pool role (least-privilege, always safe for the front-end to assume)
    const identityPoolTrustPolicy = new DataAwsIamPolicyDocument(this, `identity-pool-trust-policy`, {
      statement: [
        {
          effect: 'Allow',
          principals: [
            {
              type: 'Federated',
              identifiers: [props.userPoolEndpoint],
            },
          ],
          actions: ['sts:AssumeRoleWithWebIdentity'],
          condition: [
            {
              test: 'StringEquals',
              values: [props.userPoolClientId],
              variable: `${props.userPoolEndpoint}:aud`,
            },
          ],
        },
      ],
    });
    const identityPoolRole = new IamRole(this, 'identity-pool-role', {
      name: `${numaClient}-identity-pool-role`,
      assumeRolePolicy: identityPoolTrustPolicy.json,
    });
    // This generic role is always safe for the front‑end to assume
    this.defaultWebIdentityRoleArn = identityPoolRole.arn;

    // Create Cognito user groups and roles for each group
    for (const groupName of Object.keys(groups)) {
      // Create the Cognito user group
      const userGroup = new CognitoUserGroup(this, `${groupName}-group`, {
        name: groupName,
        userPoolId: props.userPoolId,
        description: `${groupName} user group with specific permissions`,
      });
      this.cognitoGroups[groupName] = userGroup;

      const groupTrustPolicy = new DataAwsIamPolicyDocument(this, `${groupName}-trust-policy`, {
        statement: [
          {
            effect: 'Allow',
            principals: [
              {
                type: 'Federated',
                identifiers: [props.userPoolEndpoint],
              },
            ],
            actions: ['sts:AssumeRoleWithWebIdentity'],
            condition: [
              {
                test: 'StringEquals',
                values: [props.userPoolClientId],
                variable: `${props.userPoolEndpoint}:aud`,
              },
            ],
          },
          ...(groupName !== 'standard'
            ? [
                {
                  effect: 'Allow',
                  principals: [
                    {
                      type: 'Federated',
                      identifiers: [props.userPoolEndpoint],
                    },
                  ],
                  actions: ['sts:TagSession'],
                  condition: [
                    {
                      test: 'StringEquals',
                      values: [props.userPoolClientId],
                      variable: `${props.userPoolEndpoint}:aud`,
                    },
                    {
                      test: 'StringEquals',
                      values: [groupName],
                      variable: 'aws:RequestTag/Groups',
                    },
                  ],
                },
              ]
            : [
                {
                  effect: 'Allow',
                  principals: [
                    {
                      type: 'Federated',
                      identifiers: [props.userPoolEndpoint],
                    },
                  ],
                  actions: ['sts:TagSession'],
                  condition: [
                    {
                      test: 'StringEquals',
                      values: [props.userPoolClientId],
                      variable: `${props.userPoolEndpoint}:aud`,
                    },
                  ],
                },
              ]),
        ],
      });

      // Create the role for this group
      const groupRole = new IamRole(this, `${groupName}-role`, {
        name: `${numaClient}-${groupName}-role`,
        assumeRolePolicy: groupTrustPolicy.json,
      });

      // Loop through all the feature sets and attach the managed policy to the role if the group has the feature set
      for (const featureSetName of Object.keys(this.featureSetPolicies) as FeatureSetName[]) {
        if (groups[groupName].includes(featureSetName)) {
          new IamRolePolicyAttachment(this, `${groupName}-${featureSetName}-policy`, {
            policyArn: this.featureSetPolicies[featureSetName].arn,
            role: groupRole.name,
          });
        }
      }

      // Store the role for this group
      this.groups[groupName] = {
        roleArn: groupRole.arn,
        features: groups[groupName] as FeatureSetName[],
      };
    }
    // Output all roles as a single JSON object
    new TerraformOutput(this, 'roles', {
      value: Object.entries(this.groups).map(([groupName, { roleArn, features }]) => ({
        name: groupName,
        arn: roleArn,
        features,
      })),
    });
  }
}

export type CognitoIdpConstructProps = z.infer<typeof cognitoIdpConstructPropsSchema>;
