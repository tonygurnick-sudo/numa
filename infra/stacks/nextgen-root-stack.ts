import { Fn, TerraformOutput, TerraformStack } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import { DataAwsSsoadminInstances } from '@cdktf/provider-aws/lib/data-aws-ssoadmin-instances';
import { OrganizationsOrganization } from '@cdktf/provider-aws/lib/organizations-organization';
import { OrganizationsOrganizationalUnit } from '@cdktf/provider-aws/lib/organizations-organizational-unit';
import { OrganizationsPolicyAttachment } from '@cdktf/provider-aws/lib/organizations-policy-attachment';
import { OrganizationsPolicy } from '@cdktf/provider-aws/lib/organizations-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IdentitystoreUser } from '@cdktf/provider-aws/lib/identitystore-user';
import { IdentitystoreGroup } from '@cdktf/provider-aws/lib/identitystore-group';
import { IdentitystoreGroupMembership } from '@cdktf/provider-aws/lib/identitystore-group-membership';
import { SsoadminPermissionSet } from '@cdktf/provider-aws/lib/ssoadmin-permission-set';
import { SsoadminManagedPolicyAttachment } from '@cdktf/provider-aws/lib/ssoadmin-managed-policy-attachment';
import { SsoadminAccountAssignment } from '@cdktf/provider-aws/lib/ssoadmin-account-assignment';
import { OrganizationsAccount } from '@cdktf/provider-aws/lib/organizations-account';

export class NextGenRootStack extends TerraformStack {
  readonly testGroup;
  readonly clientGroup;

  constructor(parent: Construct, name: string, props: NextGenRootStackProps) {
    super(parent, name);

    const region = props.region ?? 'ap-southeast-2';
    const managementAccountId = '282304106064';
    // const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    // const nextGenRootRole = 'arn:aws:iam::282304106064:role/temp-dave-test-role';

    new AwsProvider(this, 'default-provider', {
      // assumeRole: [{ roleArn: deployerRole }, { roleArn: nextGenRootRole }],
      profile: 'nextgen-management', // TODO: Reconsider this.
      allowedAccountIds: [managementAccountId],
      region,
      defaultTags: [
        {
          tags: {
            Arcanum: 'true',
            CreatedBy: 'CDKTF',
            Repository: process.env['CI_PROJECT_PATH'] ?? 'unknown',
            ServiceName: 'arcanum-numa-accounts',
            StackName: name,
          },
        },
      ],
    });

    const idcData = new DataAwsSsoadminInstances(this, 'arcanum-nextgen-identity-centres', {});
    const idcId = Fn.lookupNested(idcData, ['identity_store_ids', '0']);
    const idcArn = Fn.lookupNested(idcData, ['arns', '0']);

    const orgData = new OrganizationsOrganization(this, 'arcanum-nextgen-org', {
      enabledPolicyTypes: ['SERVICE_CONTROL_POLICY'],
      awsServiceAccessPrincipals: ['sso.amazonaws.com'],
      lifecycle: {
        preventDestroy: true,
      },
    });
    const rootId = Fn.lookupNested(orgData.roots, ['0', 'id']);
    const workloadsGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-accounts-group', {
      name: 'Workloads',
      parentId: rootId,
    });
    this.clientGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-client-group', {
      name: 'Clients',
      parentId: workloadsGroup.id,
    });
    this.testGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-test-group', {
      name: 'Test',
      parentId: workloadsGroup.id,
    });

    const workloadsDoc = new DataAwsIamPolicyDocument(this, 'workloads-policy-document', {
      statement: [
        {
          effect: 'Deny',
          actions: ['iam:CreateUser'],
          resources: ['*'],
        },
      ],
    });
    const workloadsPolicy = new OrganizationsPolicy(this, 'workloads-policy', {
      name: 'Workloads',
      content: workloadsDoc.json,
    });
    new OrganizationsPolicyAttachment(this, 'root-attach-scp', {
      policyId: workloadsPolicy.id,
      targetId: workloadsGroup.id,
    });

    const rootAccessGroup = new IdentitystoreGroup(this, 'root-access-group', {
      displayName: 'root access',
      identityStoreId: Fn.element(idcData.identityStoreIds, 0),
      lifecycle: {
        preventDestroy: true,
      },
    });
    const adminAccessGroup = new IdentitystoreGroup(this, 'admin-access-group', {
      displayName: 'Admin',
      identityStoreId: Fn.element(idcData.identityStoreIds, 0),
      lifecycle: {
        preventDestroy: true,
      },
    });

    for (const user of props.users) {
      const idcUser = new IdentitystoreUser(this, `${user.givenName}-${user.familyName}`, {
        identityStoreId: idcId,
        emails: {
          primary: true,
          value: user.email,
          type: 'work',
        },
        displayName: `${user.givenName} ${user.familyName}`,
        userName: user.email,
        name: {
          givenName: user.givenName,
          familyName: user.familyName,
        },
      });
      new IdentitystoreGroupMembership(this, `${user.givenName}-${user.familyName}-admin-membership`, {
        identityStoreId: idcId,
        groupId: adminAccessGroup.groupId,
        memberId: idcUser.userId,
      });
      if (user.rootAccess) {
        new IdentitystoreGroupMembership(this, `${user.givenName}-${user.familyName}-root-membership`, {
          identityStoreId: idcId,
          groupId: rootAccessGroup.groupId,
          memberId: idcUser.userId,
        });
      }
    }

    const adminPermissionSet = new SsoadminPermissionSet(this, 'admin-permission-set', {
      name: 'AdministratorAccess',
      instanceArn: idcArn,
      lifecycle: {
        preventDestroy: true,
      },
    });
    new SsoadminManagedPolicyAttachment(this, 'admin-permission-attach', {
      managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
      instanceArn: idcArn,
      permissionSetArn: adminPermissionSet.arn,
      lifecycle: {
        preventDestroy: true,
      },
    });

    new SsoadminAccountAssignment(this, 'root-admin-access', {
      instanceArn: idcArn,
      permissionSetArn: adminPermissionSet.arn,
      principalId: rootAccessGroup.groupId,
      principalType: 'GROUP',
      targetId: managementAccountId,
      targetType: 'AWS_ACCOUNT',
      lifecycle: {
        preventDestroy: true,
      },
    });

    for (const account of props.clientAccounts) {
      const orgAccount = new OrganizationsAccount(this, `numa-${account}-client-account`, {
        name: account,
        email: `aws-prod+numa-${account}@arcanum.ai`,
        parentId: this.clientGroup.id,
        closeOnDeletion: true,
        roleName: 'OrganizationAccountAccessRole',
        lifecycle: {
          ignoreChanges: ['role_name'],
          preventDestroy: true, // For now, prevent deletes. Work out how to improve that later.
        },
      });
      new SsoadminAccountAssignment(this, 'admin-access', {
        instanceArn: idcArn,
        permissionSetArn: adminPermissionSet.arn,
        principalId: adminAccessGroup.groupId,
        principalType: 'GROUP',
        targetId: orgAccount.id,
        targetType: 'AWS_ACCOUNT',
      });
    }

    new TerraformOutput(this, 'client-group-id', {
      value: this.clientGroup.id,
    });
    new TerraformOutput(this, 'test-group-id', {
      value: this.testGroup.id,
    });
  }
}

interface User {
  email: string;
  givenName: string;
  familyName: string;
  rootAccess?: boolean;
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
  users: User[];
  /**
   * Ids for client accounts.
   */
  clientAccounts: string[];
}
