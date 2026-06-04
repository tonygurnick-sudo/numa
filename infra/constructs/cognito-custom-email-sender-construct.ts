import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { KmsKey } from '@cdktf/provider-aws/lib/kms-key';
import { KmsAlias } from '@cdktf/provider-aws/lib/kms-alias';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { createAssumptionPolicy } from '@arcanumai/cdktf-util';
import { Fn } from 'cdktf';
import * as path from 'node:path';

/**
 * Cognito CustomEmailSender trigger (BUG-188).
 *
 * Provisions the Lambda + KMS key that let a client-account user pool send its
 * auth emails (verification / activation / password reset) through the
 * centralized numa-email-sender in the deployer account, from the
 * DKIM/SPF/DMARC-aligned notifications.numa.arcanum.ai domain — instead of
 * Cognito's default verificationemail.com sender, which is silently dropped or
 * spam-foldered by many Microsoft 365 / Google tenants.
 *
 * Cognito encrypts the code with the KMS key created here; the Lambda decrypts
 * it (AWS Encryption SDK) and invokes numa-email-sender cross-account via an STS
 * presigned-URL proof. The IAM role is named `{clientName}_cognito-custom-email-sender`
 * so it matches numa-email-sender's ALLOWED_ROLE_REGEX.
 *
 * The caller (core-numa-infra-construct) wires `function` into the user pool's
 * `lambdaConfig.customEmailSender` and `kmsKeyArn` into `lambdaConfig.kmsKeyId`,
 * and grants Cognito permission to invoke the Lambda.
 */
export class CognitoCustomEmailSender extends Construct {
  readonly function: LambdaFunction;
  readonly kmsKeyArn: string;

  constructor(scope: Construct, name: string, props: CognitoCustomEmailSenderProps) {
    super(scope, name);

    const callerId = new DataAwsCallerIdentity(this, 'caller-id', {});
    const accountId = callerId.accountId;

    // ── KMS key Cognito uses to encrypt codes / the Lambda uses to decrypt ──
    const keyPolicy = new DataAwsIamPolicyDocument(this, 'kms-key-policy', {
      statement: [
        {
          sid: 'EnableIamRootPermissions',
          effect: 'Allow',
          principals: [{ type: 'AWS', identifiers: [`arn:aws:iam::${accountId}:root`] }],
          actions: ['kms:*'],
          resources: ['*'],
        },
        {
          sid: 'AllowCognitoToEncrypt',
          effect: 'Allow',
          principals: [{ type: 'Service', identifiers: ['cognito-idp.amazonaws.com'] }],
          actions: ['kms:CreateGrant', 'kms:Encrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'],
          resources: ['*'],
          condition: [{ test: 'StringEquals', variable: 'aws:SourceAccount', values: [accountId] }],
        },
      ],
    });

    const kmsKey = new KmsKey(this, 'kms-key', {
      description: `Cognito CustomEmailSender code encryption for ${props.clientName}`,
      deletionWindowInDays: 7,
      policy: keyPolicy.json,
    });
    this.kmsKeyArn = kmsKey.arn;

    new KmsAlias(this, 'kms-alias', {
      name: `alias/${props.clientName}-cognito-custom-email-sender`,
      targetKeyId: kmsKey.keyId,
    });

    // ── IAM role (name must match numa-email-sender ALLOWED_ROLE_REGEX) ──
    const roleName = `${props.clientName}_cognito-custom-email-sender`;
    const role = new IamRole(this, 'role', {
      name: roleName,
      assumeRolePolicy: createAssumptionPolicy({ Service: 'lambda.amazonaws.com' }),
    });

    new IamRolePolicyAttachment(this, 'execution-attachment', {
      role: role.name,
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

    const inlinePolicy = new DataAwsIamPolicyDocument(this, 'role-policy', {
      statement: [
        {
          sid: 'DecryptCognitoCodes',
          effect: 'Allow',
          actions: ['kms:Decrypt', 'kms:DescribeKey'],
          resources: [kmsKey.arn],
        },
        {
          sid: 'InvokeCentralEmailSender',
          effect: 'Allow',
          actions: ['lambda:InvokeFunction'],
          resources: [props.emailSenderLambdaArn],
        },
      ],
    });

    new IamRolePolicy(this, 'role-inline-policy', {
      name: 'cognito-custom-email-sender',
      role: role.id,
      policy: inlinePolicy.json,
    });

    // ── Lambda ──
    const lambdaPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'cognito-custom-email-sender',
      'lambda_function.zip'
    );

    const lambdaPrefix = 'cognito-custom-email-sender-';
    const lambdaSuffix = props.nameSuffix.slice(0, 64 - lambdaPrefix.length);

    this.function = new LambdaFunction(this, 'lambda', {
      functionName: lambdaPrefix + lambdaSuffix,
      role: role.arn,
      filename: lambdaPath,
      sourceCodeHash: Fn.filebase64sha256(lambdaPath),
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      timeout: 15,
      environment: {
        variables: {
          KMS_KEY_ARN: kmsKey.arn,
          EMAIL_SENDER_LAMBDA_ARN: props.emailSenderLambdaArn,
          EMAIL_SENDER_REGION: 'us-east-1',
          STS_REGION: 'us-east-1',
          DEFAULT_DOMAIN: props.domainName,
          CLIENT_NAME: props.clientName,
          APP_NAME: props.appName ?? 'Numa',
          ...(props.replyToEmail ? { REPLY_TO_EMAIL: props.replyToEmail } : {}),
        },
      },
    });
  }
}

export interface CognitoCustomEmailSenderProps {
  /** Bare client name (e.g. "pcl"); used for the role name + CLIENT_NAME env. */
  clientName: string;
  /** Suffix for the Lambda function name (e.g. numa-{client}{-env}). */
  nameSuffix: string;
  /** Frontend domain used for the create-password link + logo URL. */
  domainName: string;
  /** ARN of the deployer-account numa-email-sender Lambda. */
  emailSenderLambdaArn: string;
  /** Friendly product name used in subjects/titles. Defaults to "Numa". */
  appName?: string;
  /** Optional Reply-To address for auth emails. */
  replyToEmail?: string;
}
