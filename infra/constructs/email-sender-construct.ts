import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { SesDomainIdentity } from '@cdktf/provider-aws/lib/ses-domain-identity';
import { SesDomainDkim } from '@cdktf/provider-aws/lib/ses-domain-dkim';
import { SesDomainMailFrom } from '@cdktf/provider-aws/lib/ses-domain-mail-from';
import { SesIdentityPolicy } from '@cdktf/provider-aws/lib/ses-identity-policy';
import { SesConfigurationSet } from '@cdktf/provider-aws/lib/ses-configuration-set';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface EmailSenderConstructProps {
  /** Route53 zone ID for the domain suffix (e.g. numa.arcanum.ai zone) */
  zoneId: string;
  /** Domain suffix, e.g. "numa.arcanum.ai" */
  domainSuffix: string;
  /** ARN of the numa-client-config DynamoDB table (for IAM read access) */
  clientConfigTableArn: string;
  /** Name of the numa-client-config DynamoDB table (passed as env var) */
  clientConfigTableName: string;
}

/**
 * Centralized email sender infrastructure for the deployer account.
 *
 * Creates:
 * - SES domain identity for notifications.{domainSuffix} with DKIM/SPF/MAIL FROM
 * - Route53 DNS records for domain verification, DKIM, SPF, and MAIL FROM MX
 * - SES configuration set with reputation metrics
 * - Lambda function for cross-account email sending (validated via STS proof)
 * - Cross-account invocation permission (principal: *, validation in handler)
 */
export class EmailSenderConstruct extends Construct {
  public readonly functionArn: string;
  public readonly functionName: string;

  constructor(scope: Construct, id: string, props: EmailSenderConstructProps) {
    super(scope, id);

    const emailDomain = `notifications.${props.domainSuffix}`;
    const mailFromDomain = `mail.${emailDomain}`;
    const fromAddress = `Numa <no-reply@${emailDomain}>`;
    const functionName = 'numa-email-sender';
    const configSetName = 'numa-email-sender-config-set';

    // ──────────────────────────────────────────────
    // SES Domain Identity + DKIM
    // ──────────────────────────────────────────────

    const domainIdentity = new SesDomainIdentity(this, 'domain-identity', {
      domain: emailDomain,
    });

    const dkim = new SesDomainDkim(this, 'domain-dkim', {
      domain: emailDomain,
    });

    // Domain verification TXT record
    new Route53Record(this, 'domain-verification-record', {
      allowOverwrite: true,
      zoneId: props.zoneId,
      name: `_amazonses.${emailDomain}`,
      type: 'TXT',
      ttl: 300,
      records: [domainIdentity.verificationToken],
    });

    // DKIM CNAME records (SES provides 3 tokens)
    for (let i = 0; i < 3; i++) {
      const token = Fn.element(dkim.dkimTokens, i);
      new Route53Record(this, `dkim-record-${i}`, {
        allowOverwrite: true,
        zoneId: props.zoneId,
        name: `${token}._domainkey.${emailDomain}`,
        type: 'CNAME',
        ttl: 300,
        records: [`${token}.dkim.amazonses.com`],
      });
    }

    // MAIL FROM domain
    new SesDomainMailFrom(this, 'mail-from', {
      domain: emailDomain,
      mailFromDomain: mailFromDomain,
      behaviorOnMxFailure: 'UseDefaultValue',
    });

    // SPF TXT record for MAIL FROM subdomain
    new Route53Record(this, 'spf-record', {
      allowOverwrite: true,
      zoneId: props.zoneId,
      name: mailFromDomain,
      type: 'TXT',
      ttl: 300,
      records: ['v=spf1 include:amazonses.com ~all'],
    });

    // MX record for MAIL FROM subdomain
    new Route53Record(this, 'mail-from-mx-record', {
      allowOverwrite: true,
      zoneId: props.zoneId,
      name: mailFromDomain,
      type: 'MX',
      ttl: 300,
      records: ['10 feedback-smtp.us-east-1.amazonses.com'],
    });

    // ──────────────────────────────────────────────
    // SES Configuration Set + Identity Policy
    // ──────────────────────────────────────────────

    new SesConfigurationSet(this, 'configuration-set', {
      name: configSetName,
      reputationMetricsEnabled: true,
      sendingEnabled: true,
    });

    // ──────────────────────────────────────────────
    // Lambda Function
    // ──────────────────────────────────────────────

    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/lambda/${functionName}`,
      retentionInDays: 30,
    });

    const execRole = new IamRole(this, 'execution-role', {
      name: `${functionName}-execution`,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'assume-role-policy', {
        statement: [
          {
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            principals: [{ type: 'Service', identifiers: ['lambda.amazonaws.com'] }],
          },
        ],
      }).json,
    });

    const policy = new IamPolicy(this, 'execution-policy', {
      name: `${functionName}-policy`,
      policy: new DataAwsIamPolicyDocument(this, 'policy-doc', {
        statement: [
          {
            sid: 'CloudWatchLogs',
            effect: 'Allow',
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [logGroup.arn, `${logGroup.arn}:*`],
          },
          {
            sid: 'SesSendEmail',
            effect: 'Allow',
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: [domainIdentity.arn, `arn:aws:ses:*:*:configuration-set/${configSetName}`],
          },
          {
            sid: 'ReadClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [props.clientConfigTableArn],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    // Identity policy allowing the Lambda role to send from this domain
    new SesIdentityPolicy(this, 'identity-policy', {
      identity: domainIdentity.domain,
      name: 'allow-email-sender-lambda',
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['ses:SendEmail', 'ses:SendRawEmail'],
            Resource: domainIdentity.arn,
            Principal: {
              AWS: execRole.arn,
            },
          },
        ],
      }),
    });

    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'numa-email-sender',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      memorySize: 512,
      timeout: 30,
      loggingConfig: {
        logGroup: logGroup.name,
        logFormat: 'Text',
      },
      environment: {
        variables: {
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
          SES_CONFIGURATION_SET: configSetName,
          SES_FROM_ADDRESS: fromAddress,
          SES_DOMAIN: emailDomain,
        },
      },
    });

    // Cross-account invocation: wildcard principal, STS validation in handler code
    new LambdaPermission(this, 'cross-account-invocation', {
      statementId: 'AllowClientAccountInvocation',
      action: 'lambda:InvokeFunction',
      functionName: fn.functionName,
      principal: '*',
    });

    // ──────────────────────────────────────────────
    // Outputs
    // ──────────────────────────────────────────────

    new TerraformOutput(this, 'function-arn', {
      value: fn.arn,
      description: 'ARN of the centralized email sender Lambda',
    });

    new TerraformOutput(this, 'function-name', {
      value: fn.functionName,
      description: 'Name of the centralized email sender Lambda',
    });

    new TerraformOutput(this, 'ses-domain', {
      value: emailDomain,
      description: 'SES verified domain for email sending',
    });

    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
  }
}
