import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

/**
 * Post-Authentication Lambda — maps IdP group claims to Cognito groups.
 *
 * Reads group mapping config from DynamoDB. When an SSO user authenticates,
 * checks their IdP group claims and adds/removes them from Cognito groups.
 */
export class SSOGroupMapper extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, name: string, props: SSOGroupMapperProps) {
    super(scope, name);

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    new IamRolePolicyAttachment(this, 'role-policy-attachment', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const policy = new DataAwsIamPolicyDocument(this, 'policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: [
            'cognito-idp:AdminAddUserToGroup',
            'cognito-idp:AdminRemoveUserFromGroup',
            'cognito-idp:AdminListGroupsForUser',
          ],
          resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem'],
          resources: [`arn:aws:dynamodb:*:*:table/${props.groupMappingTableName}`],
        },
      ],
    });
    new IamRolePolicy(this, 'policy', {
      role: role.name,
      policy: policy.json,
    });

    const lambdaPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'sso-group-mapper');
    const lambdaFilename = path.resolve(lambdaPath, 'lambda_function.zip');

    this.function = new LambdaFunction(this, 'function', {
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      functionName: `sso-group-mapper-${props.nameSuffix}`,
      sourceCodeHash: Fn.filebase64sha256(lambdaFilename),
      role: role.arn,
      filename: lambdaFilename,
      timeout: 10,
      environment: {
        variables: {
          GROUP_MAPPING_TABLE_NAME: props.groupMappingTableName,
        },
      },
    });
  }
}

export interface SSOGroupMapperProps {
  nameSuffix: string;
  /** DynamoDB table name for group mapping config (reuses mfa-settings table). */
  groupMappingTableName: string;
}
