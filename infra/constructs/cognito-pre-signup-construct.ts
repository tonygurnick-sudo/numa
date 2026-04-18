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
 * Pre Sign-up Lambda — links federated (SSO) users to existing native Cognito users.
 *
 * When an SSO user signs in for the first time, this trigger checks if a native user
 * with the same email already exists. If so, it links the federated identity to the
 * existing user (preserving their sub, chat history, settings, etc.). If not, Cognito
 * creates a new federated user as normal (JIT provisioning).
 *
 * Works with any IdP (SAML or OIDC) — IdP agnostic.
 */
export class CognitoPreSignup extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, name: string, props: CognitoPreSignupProps) {
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

    // Grant Cognito permissions for user lookup and identity linking.
    // Scoped to all pools in the account (cannot use exact pool ID due to circular dependency).
    const policy = new DataAwsIamPolicyDocument(this, 'policy-doc', {
      statement: [
        {
          effect: 'Allow',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
          resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
        },
      ],
    });
    new IamRolePolicy(this, 'policy', {
      role: role.name,
      policy: policy.json,
    });

    const lambdaPath = path.resolve(import.meta.dirname, '..', '..', 'lambdas', 'node', 'cognito-pre-signup');
    const lambdaFilename = path.resolve(lambdaPath, 'lambda_function.zip');

    this.function = new LambdaFunction(this, 'function', {
      runtime: 'nodejs22.x',
      handler: 'index.handler',
      functionName: `cognito-pre-signup-${props.nameSuffix}`,
      sourceCodeHash: Fn.filebase64sha256(lambdaFilename),
      role: role.arn,
      filename: lambdaFilename,
      timeout: 10,
    });
  }
}

export interface CognitoPreSignupProps {
  nameSuffix: string;
}
