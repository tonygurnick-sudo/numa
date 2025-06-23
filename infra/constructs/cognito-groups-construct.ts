import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import { z } from 'zod';
import { CognitoUserGroup } from '@cdktf/provider-aws/lib/cognito-user-group';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { KnowledgeBase } from './knowledge-base-construct';

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

// Use Zod inferred types
type BucketType = z.infer<typeof bucketSchema>;
type TableType = z.infer<typeof tableSchema>;

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

// Factory function that creates feature sets - this is our single source of truth
const createFeatureSets = (props: {
  region: string;
  callerAccountId: string;
  userPoolId: string;
  outputsBucket: BucketType;
  chatHistoryTable: TableType;
  companyBucket: BucketType;
  dataBucket: BucketType;
  qBusinessApplicationId?: string;
  knowledgeBase: KnowledgeBase;
}): Record<string, PolicyStatement[]> => ({
  // Chat Feature Set
  chat: [
    // Outputs bucket permissions

    {
      effect: 'Allow',
      actions: ['s3:PutObject', 's3:GetObject', 's3:GetObjectTagging'],
      resources: [`${props.outputsBucket.bucket.arn}/outputs/$\${aws:PrincipalTag/username}/*`],
    },

    // Chat history permissions with row-level security
    {
      effect: 'Allow',
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: ['*'],
      condition: [
        {
          test: 'ForAllValues:StringEquals',
          values: ['$\${aws:PrincipalTag/username}'],
          variable: 'dynamodb:LeadingKeys',
        },
      ],
    },

    // Company Context permissions
    {
      effect: 'Allow',
      actions: ['s3:GetObject'],
      resources: [`${props.companyBucket.bucket.arn}/company-data.json`],
    },

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

    // ListDocuments is used in S3 uploader for knowledge base status. All users with data access need it.
    {
      effect: 'Allow',
      actions: ['qbusiness:ListDocuments'],
      resources: ['*'], // TODO: Change to specific resource
    },

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
});

// Derive feature set names from the factory function return type
export type FeatureSetName = keyof ReturnType<typeof createFeatureSets>;

// Create a constant array of feature set names for Zod schemas
// This is a hack to get all feature set names dynamically from the createFeatureSets function
// This means if a new feature set is added, it will be automatically added to the Zod schema
const dummyProps: {
  callerAccountId: string;
  region: string;
  userPoolId: string;
  outputsBucket: BucketType;
  chatHistoryTable: TableType;
  companyBucket: BucketType;
  dataBucket: BucketType;
  knowledgeBase: KnowledgeBase;
} = {
  callerAccountId: '123',
  region: 'fake-region-1',
  userPoolId: '123',
  outputsBucket: { bucket: { arn: '123' } },
  chatHistoryTable: { name: '123', arn: '123' },
  companyBucket: { bucket: { arn: '123' } },
  dataBucket: { bucket: { arn: '123' } },
  knowledgeBase: { knowledgeBaseArn: '' } as KnowledgeBase,
};
export const FEATURE_SET_NAMES = Object.keys(createFeatureSets(dummyProps)) as FeatureSetName[];

export const cognitoGroupsConstructPropsSchema = z.object({
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
  featureSets: z.record(z.array(z.enum(FEATURE_SET_NAMES as [FeatureSetName, ...FeatureSetName[]]))).optional(),
  groups: z.record(z.array(z.enum(FEATURE_SET_NAMES as [FeatureSetName, ...FeatureSetName[]]))).optional(),
  knowledgeBase: z.instanceof(KnowledgeBase),
});

export class CognitoGroupsConstruct extends Construct {
  readonly groups: Record<string, { roleArn: string; features: FeatureSetName[] }> = {};
  readonly featureSetPolicies: Record<string, IamPolicy> = {};
  readonly cognitoGroups: Record<string, CognitoUserGroup> = {};
  readonly defaultWebIdentityRoleArn!: string;

  constructor(scope: Construct, name: string, props: CognitoGroupsConstructProps) {
    super(scope, name);

    // Define the groups and their feature sets
    const defaultGroups: Record<string, FeatureSetName[]> = {
      // The standard group should always be the least privileged group of all groups
      standard: ['chat', 'useCompanyData'],
      admin: FEATURE_SET_NAMES as FeatureSetName[],
    };

    // Use props.groups if provided, otherwise use default groups which allows for stack specific permissions
    const groups = props.groups ?? defaultGroups;

    const numaClient = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;

    // Define the feature sets and their policy statements
    const featureSets: Record<string, PolicyStatement[]> = createFeatureSets({
      region: props.region,
      callerAccountId: props.callerAccountId,
      userPoolId: props.userPoolId,
      outputsBucket: props.outputsBucket,
      chatHistoryTable: props.chatHistoryTable,
      companyBucket: props.companyBucket,
      dataBucket: props.dataBucket,
      qBusinessApplicationId: props.qBusinessApplicationId,
      knowledgeBase: props.knowledgeBase,
    });

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
export type CognitoGroupsConstructProps = z.infer<typeof cognitoGroupsConstructPropsSchema>;
