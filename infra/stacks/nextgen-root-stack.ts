import { TerraformStack, S3Backend, Fn } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { StateMachine } from 'asl-types';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { DataAwsDynamodbTable } from '@cdktf/provider-aws/lib/data-aws-dynamodb-table';
import { NextGenAccount, NextGenUser } from '../constructs/nextgen-account-construct';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import path from 'node:path';

// Patch asl-types to support Credentials.
declare module 'asl-types' {
  export interface Task {
    Credentials: Record<string, string>;
  }
}

export class NextGenRootStack extends TerraformStack {
  constructor(parent: Construct, name: string, props: NextGenRootStackProps) {
    super(parent, name);

    const managementRegion = 'ap-southeast-2';
    const deployerRegion = props.deployerRegion ?? 'us-east-1';
    const managementAccountId = '282304106064';
    const deployerAccountId = '207567759910';
    const organizationRoleName = 'OrganizationAccountAccessRole';

    const defaultTags = [
      {
        tags: {
          Arcanum: 'true',
          CreatedBy: 'CDKTF',
          Repository: process.env['CI_PROJECT_PATH'] ?? 'unknown',
          ServiceName: 'arcanum-numa-accounts',
          StackName: name,
        },
      },
    ];

    const key = ['core', 'nextgen-management'].join('/');
    new S3Backend(this, {
      bucket: 'arcanum-terraform-state',
      region: 'ap-southeast-2',
      key,
      dynamodbTable: 'arcanum-terraform-lock',
    });
    const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    // const nextGenRootRole = 'arn:aws:iam::282304106064:role/temp-dave-test-role';
    const deployerProvider = new AwsProvider(this, 'deployer-account', {
      assumeRole: [{ roleArn: deployerRole }],
      alias: 'deployer',
      allowedAccountIds: [deployerAccountId],
      region: deployerRegion,
      defaultTags,
    });

    new AwsProvider(this, 'default-provider', {
      // assumeRole: [{ roleArn: deployerRole }, { roleArn: nextGenRootRole }],
      profile: 'nextgen-management', // TODO: Reconsider this.
      allowedAccountIds: [managementAccountId],
      region: managementRegion,
      defaultTags,
    });

    const nextGenAccount = new NextGenAccount(this, 'nextgen', {
      users: props.users,
      managementAccountId,
    });

    // Role in the management account for the broker to rename accounts
    const accountAdminBrokerRole = new IamRole(this, 'account-admin-broker-role', {
      name: 'AccountAdminBrokerRole',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'account-admin-broker-assume', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [
              // Narrow to the deployer lambda execution role; consider hardening further if needed
              { type: 'AWS', identifiers: [`arn:aws:iam::${deployerAccountId}:role/portal-nextgen-broker-execution`] },
            ],
          },
        ],
      }).json,
    });
    const accountAdminBrokerPolicy = new IamPolicy(this, 'account-admin-broker-policy', {
      name: 'AccountAdminBrokerPolicy',
      policy: new DataAwsIamPolicyDocument(this, 'account-admin-broker-policy-doc', {
        statement: [
          {
            actions: ['organizations:UpdateAccount', 'organizations:DescribeAccount', 'organizations:ListAccounts'],
            resources: ['*'],
          },
        ],
      }).json,
    });
    new IamRolePolicyAttachment(this, 'account-admin-broker-policy-attachment', {
      role: accountAdminBrokerRole.name,
      policyArn: accountAdminBrokerPolicy.arn,
    });

    // Unfortunately, we can't use DataAwsIamPolicyDocument for this as it causes in the StepFunction definition.
    const arcanumAIAccessRoleAssumeRolePolicyDocument = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${deployerAccountId}:root`,
          },
          Action: 'sts:AssumeRole',
        },
      ],
    });

    const accountCreationPolicy = new IamPolicy(this, 'account-creation-policy', {
      name: 'AccountCreationPolicy',
      policy: new DataAwsIamPolicyDocument(this, 'account-creation-policy-document', {
        statement: [
          {
            actions: ['organizations:CreateAccount', 'organizations:DescribeCreateAccountStatus'],
            resources: ['*'],
          },
          {
            actions: ['organizations:MoveAccount'],
            resources: [
              `arn:aws:organizations::${managementAccountId}:account/${nextGenAccount.orgData.id}/*`,
              nextGenAccount.clientGroup.arn,
              `arn:aws:organizations::${managementAccountId}:root/${nextGenAccount.orgData.id}/${nextGenAccount.rootId}`,
            ],
          },
          {
            actions: ['sso:CreateAccountAssignment'],
            resources: ['arn:aws:sso:::account/*', nextGenAccount.idcArn, nextGenAccount.adminPermissionSet.arn],
          },
          {
            actions: ['sts:AssumeRole'],
            resources: ['arn:aws:iam::*:role/OrganizationAccountAccessRole'],
          },
        ],
      }).json,
    });

    const createAccountFunction: StateMachine = {
      StartAt: 'CreateAccount',
      States: {
        CreateAccount: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:organizations:createAccount',
          Parameters: {
            'AccountName.$': '$.accountName',
            'Email.$': "States.Format('aws-prod+{}@arcanum.ai', $.accountName)",
            RoleName: organizationRoleName,
          },
          Next: 'DescribeCreateAccountStatus',
        },
        // Wait for account to be created
        DescribeCreateAccountStatus: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:organizations:describeCreateAccountStatus',
          Parameters: {
            'CreateAccountRequestId.$': '$.CreateAccountStatus.Id',
          },
          Next: 'CheckIfAccountCreated',
        },
        CheckIfAccountCreated: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.CreateAccountStatus.AccountId',
              IsPresent: true,
              Next: 'MoveAccount',
            },
            {
              Next: 'Success',
              And: [
                {
                  Variable: '$.CreateAccountStatus.State',
                  StringEquals: 'FAILED',
                },
                {
                  Variable: '$.CreateAccountStatus.FailureReason',
                  StringEquals: 'EMAIL_ALREADY_EXISTS',
                },
              ],
            },
            {
              Variable: '$.CreateAccountStatus.State',
              StringEquals: 'FAILED',
              Next: 'Failure',
            },
          ],
          Default: 'Sleep5',
        },
        Sleep5: {
          Type: 'Wait',
          Seconds: 5,
          Next: 'DescribeCreateAccountStatus',
        },
        MoveAccount: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:organizations:moveAccount',
          ResultPath: '$.Output',
          Parameters: {
            'AccountId.$': '$.CreateAccountStatus.AccountId',
            SourceParentId: nextGenAccount.rootId,
            DestinationParentId: nextGenAccount.clientGroup.id,
          },
          Next: 'AssignAccess',
        },
        AssignAccess: {
          Type: 'Task',
          Resource: 'arn:aws:states:::aws-sdk:ssoadmin:createAccountAssignment',
          ResultPath: '$.Output',
          Parameters: {
            InstanceArn: nextGenAccount.idcArn,
            PermissionSetArn: nextGenAccount.adminPermissionSet.arn,
            PrincipalId: nextGenAccount.adminAccessGroup.groupId,
            PrincipalType: 'GROUP',
            'TargetId.$': '$.CreateAccountStatus.AccountId',
            TargetType: 'AWS_ACCOUNT',
          },
          Next: 'CreateRole',
        },
        CreateRole: {
          Type: 'Task',
          ResultPath: '$.Output',
          Parameters: {
            RoleName: 'ArcanumAIAccess',
            AssumeRolePolicyDocument: arcanumAIAccessRoleAssumeRolePolicyDocument,
          },
          Resource: 'arn:aws:states:::aws-sdk:iam:createRole',
          Credentials: {
            'RoleArn.$': `States.Format('arn:aws:iam::{}:role/${organizationRoleName}', $.CreateAccountStatus.AccountId)`,
          },
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed'],
              BackoffRate: 2,
              IntervalSeconds: 3,
              MaxAttempts: 5,
              Comment: 'Organization access is sometimes not provisioned, so retry if we fail.',
            },
          ],
          Next: 'AttachPolicy',
        },
        AttachPolicy: {
          Type: 'Task',
          ResultPath: '$.Output',
          Parameters: {
            RoleName: 'ArcanumAIAccess',
            PolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
          },
          Resource: 'arn:aws:states:::aws-sdk:iam:attachRolePolicy',
          Credentials: {
            'RoleArn.$': `States.Format('arn:aws:iam::{}:role/${organizationRoleName}', $.CreateAccountStatus.AccountId)`,
          },
          Retry: [
            {
              ErrorEquals: ['States.TaskFailed'],
              BackoffRate: 2,
              IntervalSeconds: 3,
              MaxAttempts: 5,
              Comment: 'Organization access is sometimes not provisioned, so retry if we fail.',
            },
          ],
          End: true,
        },
        Success: {
          Type: 'Succeed',
        },
        Failure: {
          Type: 'Fail',
        },
      },
    };

    const createAccountRole = new IamRole(this, 'create-account-role', {
      name: 'AccountCreationRole',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'create-account-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['states.amazonaws.com'], // TODO: Restrict
              },
            ],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachment(this, 'create-account-policy-attachment', {
      role: createAccountRole.name,
      policyArn: accountCreationPolicy.arn,
    });

    const createAccountStateMachine = new SfnStateMachine(this, 'create-account', {
      name: 'createAccount',
      roleArn: createAccountRole.arn,
      definition: JSON.stringify(createAccountFunction),
    });

    const startCreateAccountPolicy = new IamPolicy(this, 'start-create-account-policy', {
      name: 'startCreateAccount',
      policy: new DataAwsIamPolicyDocument(this, 'start-create-account-policy-document', {
        statement: [
          {
            actions: ['states:StartExecution'],
            resources: [createAccountStateMachine.arn],
          },
          {
            actions: ['states:DescribeExecution'],
            resources: [
              `arn:aws:states:${managementRegion}:${managementAccountId}:execution:${createAccountStateMachine.name}:*`,
            ],
          },
        ],
      }).json,
    });

    const startCreateAccountRole = new IamRole(this, 'start-create-account-role', {
      name: 'StartCreateAccountRole',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'start-create-account-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'AWS',
                identifiers: [`arn:aws:iam::${deployerAccountId}:root`], // TODO: Restrict
              },
            ],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachment(this, 'start-create-account-policy-attachment', {
      role: startCreateAccountRole.name,
      policyArn: startCreateAccountPolicy.arn,
    });

    const shimRole = new IamRole(this, 'create-account-start-shim-role', {
      name: 'CreateAccountStartShim',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'create-account-start-shim-role-assumption-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['lambda.amazonaws.com'], // TODO: Restrict
              },
            ],
          },
        ],
      }).json,
      provider: deployerProvider,
    });

    const shimPolicy = new IamPolicy(this, 'create-account-start-shim-policy', {
      policy: new DataAwsIamPolicyDocument(this, 'create-account-start-shim-policy-document', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            resources: [startCreateAccountRole.arn],
          },
        ],
      }).json,
      provider: deployerProvider,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'create-account-start-shim-role-policy-attachment', {
      roleName: shimRole.name,
      policyArns: [shimPolicy.arn, 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      provider: deployerProvider,
    });

    const shimPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'step-function-shim');
    const shimFilename = path.resolve(shimPath, 'lambda_function.zip');
    const shimLambda = new LambdaFunction(this, 'create-account-state-shim-function', {
      functionName: 'createAccountStartShim',
      runtime: 'nodejs22.x',
      role: shimRole.arn,
      handler: 'index.handler',
      filename: shimFilename,
      environment: {
        variables: {
          TARGET_REGION: managementRegion,
          TARGET_STATE_MACHINE: createAccountStateMachine.arn,
          START_ROLE_ARN: startCreateAccountRole.arn,
        },
      },
      timeout: 300,
      sourceCodeHash: Fn.filebase64sha256(shimFilename),
      provider: deployerProvider,
    });

    const createAccountAndConfigFunction: StateMachine = {
      StartAt: 'Lookup',
      States: {
        Lookup: {
          Type: 'Task',
          Resource: 'arn:aws:states:::dynamodb:getItem',
          Parameters: {
            TableName: props.configTable,
            Key: {
              clientName: {
                'S.$': '$.clientName',
              },
            },
          },
          Next: 'CheckForExisting',
        },
        CheckForExisting: {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Item',
              IsPresent: false,
              Next: 'CallCreateLambda',
            },
          ],
          Default: 'AccountAlreadyExists',
        },
        AccountAlreadyExists: {
          Type: 'Fail',
        },
        CallCreateLambda: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            Payload: { 'clientName.$': '$$.Execution.Input.clientName' },
            FunctionName: `${shimLambda.arn}:$LATEST`,
          },
          Retry: [
            {
              ErrorEquals: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException',
              ],
              IntervalSeconds: 1,
              MaxAttempts: 3,
              BackoffRate: 2,
              JitterStrategy: 'FULL',
            },
          ],
          Next: 'WriteConfig',
        },
        WriteConfig: {
          Type: 'Task',
          Resource: 'arn:aws:states:::dynamodb:putItem',
          Parameters: {
            TableName: props.configTable,
            Item: {
              clientName: {
                'S.$': '$$.Execution.Input.clientName',
              },
              config: {
                M: {
                  region: { S: 'us-east-1' }, // TODO: Support Sydney too
                  allProdApps: { BOOL: true },
                  clientAccountId: { 'S.$': '$.Payload' },
                },
              },
              parent: 'NextGen',
            },
          },
          End: true,
        },
      },
    };

    const createAccountAndConfigRole = new IamRole(this, 'create-account-and-config-role', {
      name: 'AccountAndConfigCreationRole',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'create-account-and-config-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'Service',
                identifiers: ['states.amazonaws.com'], // TODO: Restrict
              },
            ],
          },
        ],
      }).json,
      provider: deployerProvider,
    });

    const table = new DataAwsDynamodbTable(this, 'table', {
      name: props.configTable,
      provider: deployerProvider,
    });

    const createAccountAndConfigPolicy = new IamPolicy(this, 'create-account-and-config-policy', {
      name: 'AccountAndConfigCreationPolicy',
      policy: new DataAwsIamPolicyDocument(this, 'create-account-and-config-policy-doc', {
        statement: [
          {
            actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
            resources: [table.arn],
          },
          {
            actions: ['lambda:InvokeFunction'],
            resources: [shimLambda.arn + ':$LATEST'],
          },
        ],
      }).json,
      provider: deployerProvider,
    });

    new IamRolePolicyAttachment(this, 'create-account-and-config-role-policy-attachment', {
      role: createAccountAndConfigRole.name,
      policyArn: createAccountAndConfigPolicy.arn,
      provider: deployerProvider,
    });

    new SfnStateMachine(this, 'create-account-and-config', {
      name: 'createAccountAndConfig',
      roleArn: createAccountAndConfigRole.arn,
      definition: JSON.stringify(createAccountAndConfigFunction),
      provider: deployerProvider,
    });
  }
}

export interface NextGenRootStackProps {
  /**
   * Region to deploy to.
   *
   * @default 'us-east-1'
   */
  region?: string;
  /**
   * The AWS account number for Arcanum Numa deployer account
   */
  arcanumNumaAccount: string;
  /**
   * List of users to provision into the admin group
   */
  users: NextGenUser[];
  deployerRegion?: string;
  configTable: string;
}
