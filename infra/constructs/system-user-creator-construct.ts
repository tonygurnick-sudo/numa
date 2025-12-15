import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { Fn, TerraformResource } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

/**
 * Creates a Cognito user idempotently using a Lambda invocation.
 * Unlike the CognitoUser resource, this won't fail if the user already exists.
 * Also adds the user to the specified group (e.g., admin).
 */
export class SystemUserCreator extends Construct {
  public readonly invocation: LambdaInvocation;
  public readonly username: string;

  constructor(scope: Construct, name: string, props: SystemUserCreatorProps) {
    super(scope, name);

    this.username = props.username;

    const role = new IamRole(this, 'role', {
      assumeRolePolicy: createAssumptionPolicy({
        Service: 'lambda.amazonaws.com',
      }),
    });

    const basicPolicyAttachment = new IamRolePolicyAttachment(this, 'role-policy-attachment-basic', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    // Use inline policy for Cognito permissions to avoid IAM eventual consistency issues
    const cognitoPolicy = new IamRolePolicy(this, 'cognito-policy', {
      role: role.name,
      policy: new DataAwsIamPolicyDocument(this, 'cognito-policy-document', {
        statement: [
          {
            actions: [
              'cognito-idp:AdminGetUser',
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminSetUserPassword',
              'cognito-idp:AdminListGroupsForUser',
              'cognito-idp:AdminAddUserToGroup',
            ],
            resources: [props.userPoolArn],
          },
        ],
      }).json,
    });

    const lambdaPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'system-user-creator');
    const lambdaFilename = path.resolve(lambdaPath, 'lambda_function.zip');

    const func = new LambdaFunction(this, 'function', {
      functionName: `${props.clientName}-system-user-creator`,
      role: role.arn,
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      filename: lambdaFilename,
      sourceCodeHash: Fn.filebase64sha256(lambdaFilename),
      timeout: 60, // Increased timeout for retries
    });

    const inputObject = {
      userPoolId: props.userPoolId,
      username: props.username,
      password: props.password,
      groupName: props.groupName,
    };

    this.invocation = new LambdaInvocation(this, 'invocation', {
      functionName: func.functionName,
      input: Fn.jsonencode(inputObject),
      triggers: {
        // Re-run when password or group changes
        inputHash: Fn.sha256(Fn.jsonencode(inputObject)),
      },
      dependsOn: [func, basicPolicyAttachment, cognitoPolicy],
    });
  }

  /**
   * Returns the resources that should be depended on when adding this user to groups
   */
  get dependsOn(): TerraformResource[] {
    return [this.invocation];
  }
}

export interface SystemUserCreatorProps {
  clientName: string;
  userPoolId: string;
  userPoolArn: string;
  username: string;
  password: string;
  groupName: string;
}
