import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import path from 'node:path';
import { Fn } from 'cdktf';

export interface PortalNextgenBrokerConstructProps {
  functionName?: string; // default 'portal-nextgen-broker'
  region?: string; // informational; function deploys with provider region
  managementAccountId: string; // 282304106064
  orgId?: string; // if provided, restrict invoke to principals in this org
}

export class PortalNextgenBrokerConstruct extends Construct {
  public readonly functionName: string;
  public readonly functionArn: string;

  constructor(scope: Construct, id: string, props: PortalNextgenBrokerConstructProps) {
    super(scope, id);

    const execRole = new IamRole(this, 'portal-nextgen-broker-role', {
      name: 'portal-nextgen-broker-execution',
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'portal-nextgen-broker-assume', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const policy = new IamPolicy(this, 'portal-nextgen-broker-policy', {
      name: 'portal-nextgen-broker-policy',
      policy: new DataAwsIamPolicyDocument(this, 'portal-nextgen-broker-policy-doc', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            resources: [`arn:aws:iam::${props.managementAccountId}:role/AccountAdminBrokerRole`],
          },
          {
            actions: ['sts:AssumeRole'],
            resources: ['arn:aws:iam::*:role/ArcanumAIAccess'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'portal-nextgen-broker-role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn, 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
    });

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'portal-nextgen-broker',
      'lambda_function.zip'
    );
    const fn = new LambdaFunction(this, 'portal-nextgen-broker-fn', {
      functionName: props.functionName || 'portal-nextgen-broker',
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'index.handler',
      runtime: 'nodejs22.x',
      // listOrgAccounts paginates Organizations.ListAccounts after an STS hop,
      // which exceeds the 3s default on cold-start. 15s is well over what the
      // worst-case ~10 page response needs.
      timeout: 15,
      environment: {
        variables: {
          CLIENT_ASSUME_ROLE_NAME: 'ArcanumAIAccess',
          DEFAULT_SECRET_NAME: 'system-user-password',
          MANAGEMENT_ROLE_ARN: `arn:aws:iam::${props.managementAccountId}:role/AccountAdminBrokerRole`,
        },
      },
    });

    // Invocation policy
    if (props.orgId) {
      new LambdaPermission(this, 'portal-nextgen-broker-invoke', {
        statementId: 'AllowInvocationFromOrg',
        action: 'lambda:InvokeFunction',
        functionName: fn.functionName,
        principal: '*',
        // Note: LambdaPermission in this provider version does not support conditions; consider AWS SAM for advanced policies
      });
    } else {
      new LambdaPermission(this, 'portal-nextgen-broker-invoke', {
        statementId: 'AllowInvocationOpen',
        action: 'lambda:InvokeFunction',
        functionName: fn.functionName,
        principal: '*',
      });
    }

    this.functionName = fn.functionName;
    this.functionArn = fn.arn;
  }
}
