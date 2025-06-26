import { OrganizationsOrganization } from '@cdktf/provider-aws/lib/organizations-organization';
import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import { DataAwsSsoadminInstances } from '@cdktf/provider-aws/lib/data-aws-ssoadmin-instances';
import { OrganizationsOrganizationalUnit } from '@cdktf/provider-aws/lib/organizations-organizational-unit';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { OrganizationsPolicy } from '@cdktf/provider-aws/lib/organizations-policy';
import { OrganizationsPolicyAttachment } from '@cdktf/provider-aws/lib/organizations-policy-attachment';
import { IdentitystoreGroup } from '@cdktf/provider-aws/lib/identitystore-group';
import { SsoadminPermissionSet } from '@cdktf/provider-aws/lib/ssoadmin-permission-set';
import { SsoadminManagedPolicyAttachment } from '@cdktf/provider-aws/lib/ssoadmin-managed-policy-attachment';
import { SsoadminAccountAssignment } from '@cdktf/provider-aws/lib/ssoadmin-account-assignment';
import { IdentitystoreUser } from '@cdktf/provider-aws/lib/identitystore-user';
import { IdentitystoreGroupMembership } from '@cdktf/provider-aws/lib/identitystore-group-membership';

export class NextGenAccount extends Construct {
  readonly orgData;
  readonly idcArn;
  readonly idcId;
  readonly rootId;
  readonly workloadsGroup;
  readonly clientGroup;
  readonly testGroup;
  readonly adminPermissionSet;
  readonly adminAccessGroup;
  constructor(parent: Construct, name: string, props: NextGenAccountProps) {
    super(parent, name);

    const idcData = new DataAwsSsoadminInstances(this, 'arcanum-nextgen-identity-centres', {});
    this.idcId = Fn.lookupNested(idcData, ['identity_store_ids', '0']);
    this.idcArn = Fn.lookupNested(idcData, ['arns', '0']);

    this.orgData = new OrganizationsOrganization(this, 'arcanum-nextgen-org', {
      enabledPolicyTypes: ['SERVICE_CONTROL_POLICY'],
      awsServiceAccessPrincipals: ['sso.amazonaws.com', 'account.amazonaws.com'],
      lifecycle: {
        preventDestroy: true,
      },
    });
    this.rootId = Fn.lookupNested(this.orgData.roots, ['0', 'id']);

    // Organizational Units
    this.workloadsGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-accounts-group', {
      name: 'Workloads',
      parentId: this.rootId,
    });
    this.clientGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-client-group', {
      name: 'Clients',
      parentId: this.workloadsGroup.id,
    });
    this.testGroup = new OrganizationsOrganizationalUnit(this, 'arcanum-nextgen-test-group', {
      name: 'Test',
      parentId: this.workloadsGroup.id,
    });

    // SCPs
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
      targetId: this.workloadsGroup.id,
    });

    // Access Groups
    const rootAccessGroup = new IdentitystoreGroup(this, 'root-access-group', {
      displayName: 'root access',
      identityStoreId: this.idcId,
      lifecycle: {
        preventDestroy: true,
      },
    });
    rootAccessGroup.moveFromId('aws_ssoadmin_permission_set.root-access-group');
    this.adminAccessGroup = new IdentitystoreGroup(this, 'admin-access-group', {
      displayName: 'Admin',
      identityStoreId: this.idcId,
      lifecycle: {
        preventDestroy: true,
      },
    });
    this.adminAccessGroup.moveFromId('aws_ssoadmin_permission_set.admin-access-group');

    // Permission Sets
    this.adminPermissionSet = new SsoadminPermissionSet(this, 'admin-permission-set', {
      name: 'AdministratorAccess',
      instanceArn: this.idcArn,
      lifecycle: {
        preventDestroy: true,
      },
    });
    this.adminPermissionSet.moveFromId('aws_ssoadmin_permission_set.admin-permission-set');
    new SsoadminManagedPolicyAttachment(this, 'admin-permission-attach', {
      managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
      instanceArn: this.idcArn,
      permissionSetArn: this.adminPermissionSet.arn,
      lifecycle: {
        preventDestroy: true,
      },
    });

    new SsoadminAccountAssignment(this, 'root-admin-access', {
      instanceArn: this.idcArn,
      permissionSetArn: this.adminPermissionSet.arn,
      principalId: rootAccessGroup.groupId,
      principalType: 'GROUP',
      targetId: props.managementAccountId,
      targetType: 'AWS_ACCOUNT',
      lifecycle: {
        preventDestroy: true,
      },
    });

    // Users
    for (const user of props.users) {
      const idcUser = new IdentitystoreUser(this, `${user.givenName}-${user.familyName}`, {
        identityStoreId: this.idcId,
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
        identityStoreId: this.idcId,
        groupId: this.adminAccessGroup.groupId,
        memberId: idcUser.userId,
      });
      if (user.rootAccess) {
        new IdentitystoreGroupMembership(this, `${user.givenName}-${user.familyName}-root-membership`, {
          identityStoreId: this.idcId,
          groupId: rootAccessGroup.groupId,
          memberId: idcUser.userId,
        });
      }
    }
  }
}

export interface NextGenUser {
  email: string;
  givenName: string;
  familyName: string;
  rootAccess?: boolean;
}

export interface NextGenAccountProps {
  users: NextGenUser[];
  managementAccountId: string;
}
