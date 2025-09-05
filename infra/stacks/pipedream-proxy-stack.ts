import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { SecretsmanagerSecret } from '@cdktf/provider-aws/lib/secretsmanager-secret';
import { S3Backend, TerraformStack, Fn } from 'cdktf';
import { Construct } from 'constructs';
import path from 'node:path';

// Supported Pipedream integrations
// TODO: think of a better way to manage this list
const SUPPORTED_INTEGRATIONS = [
  'gmail',
  'microsoft_outlook',
  'slack',
  'google_calendar',
  'xero_accounting_api',
  'hubspot',
  'notion',
  'apollo_io',
  'pipedrive',
  'jira',
  'smartsheet',
  'airtable_oauth',
  'ringcentral',
  'linkedin',
  'google_drive',
  'google_analytics',
  'webflow',
  'sharepoint',
];

export interface PipedreamProxyStackProps {
  /**
   * Environment name (prod, dev) - we only use prod currently
   */
  environmentName: string;
  /**
   * AWS region for deployment
   */
  region: string;
  /**
   * Arcanum NUMA account ID for role assumption
   */
  arcanumNumaAccount: string;
}

export class PipedreamProxyStack extends TerraformStack {
  readonly proxyLambda: LambdaFunction;
  readonly securityMappingTable: DynamodbTable;
  readonly allowedAccountsTable: DynamodbTable;
  readonly accountSyncLambda: LambdaFunction;
  readonly pipedreamSecret: SecretsmanagerSecret;

  constructor(scope: Construct, name: string, props: PipedreamProxyStackProps) {
    super(scope, name);

    const proxyAccountId = '965745962688';
    const deployerRole = `arn:aws:iam::${props.arcanumNumaAccount}:role/admin-delegated-access`;
    const proxyRoleArn = `arn:aws:iam::${proxyAccountId}:role/ArcanumAIAccess`;

    // Terraform state backend configuration - following numa-client-stack pattern
    const keyName = [name, 'pipedream-proxy'].join('/') + '.tfstate';
    const key = ['product', 'pipedream-proxy', props.environmentName, keyName].filter((x) => x).join('/');
    new S3Backend(this, {
      bucket: 'arcanum-terraform-state',
      region: 'ap-southeast-2',
      key,
      dynamodbTable: 'arcanum-terraform-lock',
    });

    // AWS Provider configuration - following numa-client-stack pattern
    new AwsProvider(this, 'default-provider', {
      assumeRole: [{ roleArn: deployerRole }, { roleArn: proxyRoleArn }],
      region: props.region,
      defaultTags: [
        {
          tags: {
            Arcanum: 'true',
            CreatedBy: 'CDKTF',
            Repository: process.env['CI_PROJECT_PATH'] ?? 'unknown',
            ServiceName: 'pipedream-proxy',
            StackName: name,
            Environment: props.environmentName,
          },
        },
      ],
    });

    // CloudWatch Log Group for proxy lambda
    const logGroup = new CloudwatchLogGroup(this, 'proxy-log-group', {
      name: '/aws/lambda/pipedream-proxy',
      tags: {
        Name: 'pipedream-proxy-logs',
        Environment: props.environmentName,
      },
    });

    // CloudWatch Log Group for account sync lambda
    const syncLogGroup = new CloudwatchLogGroup(this, 'sync-log-group', {
      name: '/aws/lambda/pipedream-account-sync',
      tags: {
        Name: 'pipedream-account-sync-logs',
        Environment: props.environmentName,
      },
    });

    // DynamoDB table for security mapping
    this.securityMappingTable = new DynamodbTable(this, 'security-mapping-table', {
      name: 'pipedream-user-mappings',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'external_user_id',
      attribute: [
        {
          name: 'external_user_id',
          type: 'S',
        },
        {
          name: 'account_id',
          type: 'S',
        },
      ],

      globalSecondaryIndex: [
        {
          name: 'account-id-index',
          hashKey: 'account_id',
          projectionType: 'ALL',
        },
      ],

      tags: {
        Name: 'pipedream-user-mappings',
        Environment: props.environmentName,
        Purpose: 'security-mapping',
      },
    });

    // DynamoDB table for allowed client accounts (synced from deployer account)
    this.allowedAccountsTable = new DynamodbTable(this, 'allowed-accounts-table', {
      name: 'pipedream-allowed-accounts',
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'account_id',
      attribute: [
        {
          name: 'account_id',
          type: 'S',
        },
      ],

      tags: {
        Name: 'pipedream-allowed-accounts',
        Environment: props.environmentName,
        Purpose: 'account-allowlist',
      },
    });

    // Create Pipedream credentials secret with placeholder values
    // This secret will be created empty and must be populated manually via AWS console
    this.pipedreamSecret = new SecretsmanagerSecret(this, 'pipedream-credentials', {
      name: `pipedream/credentials-prod`,
      description: 'Pipedream OAuth credentials for secure proxy access - POPULATE MANUALLY',
      tags: {
        Name: 'pipedream-credentials',
        Environment: props.environmentName,
        Purpose: 'authentication',
        Status: 'REQUIRES_MANUAL_POPULATION',
      },
    });

    // IAM role for the proxy lambda
    const proxyLambdaRole = new IamRole(this, 'proxy-lambda-role', {
      name: 'pipedream-proxy-lambda-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      tags: {
        Name: 'pipedream-proxy-lambda-role',
        Environment: props.environmentName,
      },
    });

    // IAM policy for the proxy lambda
    new IamRolePolicy(this, 'proxy-lambda-policy', {
      name: 'pipedream-proxy-lambda-policy',
      role: proxyLambdaRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          // CloudWatch Logs permissions
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: `${logGroup.arn}:*`,
          },
          // DynamoDB permissions for security mapping table
          {
            Effect: 'Allow',
            Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
            Resource: [this.securityMappingTable.arn, `${this.securityMappingTable.arn}/index/*`],
          },
          // DynamoDB permissions for allowed accounts table
          {
            Effect: 'Allow',
            Action: ['dynamodb:GetItem', 'dynamodb:Query'],
            Resource: this.allowedAccountsTable.arn,
          },
          // Secrets Manager permissions for Pipedream credentials
          {
            Effect: 'Allow',
            Action: ['secretsmanager:GetSecretValue'],
            Resource: this.pipedreamSecret.arn,
          },
        ],
      }),
    });

    // IAM role for the account sync lambda
    const syncLambdaRole = new IamRole(this, 'sync-lambda-role', {
      name: 'pipedream-account-sync-lambda-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      tags: {
        Name: 'pipedream-account-sync-lambda-role',
        Environment: props.environmentName,
      },
    });

    // IAM policy for the account sync lambda
    new IamRolePolicy(this, 'sync-lambda-policy', {
      name: 'pipedream-account-sync-lambda-policy',
      role: syncLambdaRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          // CloudWatch Logs permissions
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: `${syncLogGroup.arn}:*`,
          },
          // DynamoDB permissions for allowed accounts table (write access)
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Scan',
            ],
            Resource: this.allowedAccountsTable.arn,
          },
          // Cross-account DynamoDB permissions for numa-client-config table
          {
            Effect: 'Allow',
            Action: ['dynamodb:Scan', 'dynamodb:Query'],
            Resource: `arn:aws:dynamodb:us-east-1:${props.arcanumNumaAccount}:table/numa-client-config`,
          },
        ],
      }),
    });

    // The proxy lambda function
    const lambdaFilename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'pipedream-proxy',
      'lambda_function.zip',
    );
    this.proxyLambda = new LambdaFunction(this, 'pipedream-proxy-lambda', {
      functionName: 'pipedream-proxy',
      role: proxyLambdaRole.arn,
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      timeout: 30,
      memorySize: 128,
      filename: lambdaFilename,
      sourceCodeHash: Fn.filebase64sha256(lambdaFilename),

      environment: {
        variables: {
          SECURITY_MAPPING_TABLE: this.securityMappingTable.name,
          ALLOWED_ACCOUNTS_TABLE: this.allowedAccountsTable.name,
          PIPEDREAM_SECRET_ARN: this.pipedreamSecret.arn,
          LOG_LEVEL: 'INFO',
          ENVIRONMENT: props.environmentName,
          SUPPORTED_INTEGRATIONS: JSON.stringify(SUPPORTED_INTEGRATIONS),
        },
      },

      dependsOn: [logGroup],

      tags: {
        Name: 'pipedream-proxy',
        Environment: props.environmentName,
        Purpose: 'secure-proxy',
      },
    });

    // The account sync lambda function
    const syncLambdaFilename = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'python',
      'pipedream-account-sync',
      'lambda_function.zip',
    );
    this.accountSyncLambda = new LambdaFunction(this, 'pipedream-account-sync-lambda', {
      functionName: 'pipedream-account-sync',
      role: syncLambdaRole.arn,
      handler: 'lambda_function.handler',
      runtime: 'python3.13',
      timeout: 300, // Increased timeout just in case for cross account dynamo operations
      memorySize: 128,
      filename: syncLambdaFilename,
      sourceCodeHash: Fn.filebase64sha256(syncLambdaFilename),

      environment: {
        variables: {
          ENVIRONMENT: props.environmentName,
          ALLOWED_ACCOUNTS_TABLE: this.allowedAccountsTable.name,
          NUMA_CLIENT_CONFIG_TABLE_ARN: `arn:aws:dynamodb:us-east-1:${props.arcanumNumaAccount}:table/numa-client-config`,
          LOG_LEVEL: 'INFO',
        },
      },

      dependsOn: [syncLogGroup],

      tags: {
        Name: 'pipedream-account-sync',
        Environment: props.environmentName,
        Purpose: 'account-sync',
      },
    });

    // EventBridge rule for hourly account sync
    const syncScheduleRule = new CloudwatchEventRule(this, 'sync-schedule-rule', {
      name: 'pipedream-account-sync-schedule',
      description: 'Trigger account sync every hour',
      scheduleExpression: 'rate(1 hour)',
      tags: {
        Name: 'pipedream-account-sync-schedule',
        Environment: props.environmentName,
      },
    });

    // EventBridge target for the sync lambda
    new CloudwatchEventTarget(this, 'sync-schedule-target', {
      rule: syncScheduleRule.name,
      arn: this.accountSyncLambda.arn,
    });

    // Lambda permission for EventBridge to invoke the sync lambda
    new LambdaPermission(this, 'sync-lambda-invoke-permission', {
      statementId: 'AllowEventBridgeInvocation',
      action: 'lambda:InvokeFunction',
      functionName: this.accountSyncLambda.functionName,
      principal: 'events.amazonaws.com',
      sourceArn: syncScheduleRule.arn,
    });

    // Allow cross-account invocation from Numa client accounts
    // The proxy lambda validates the caller's account against allowed organization accounts using STS identity
    new LambdaPermission(this, 'cross-account-invocation-permission', {
      statementId: 'AllowClientAccountInvocation',
      action: 'lambda:InvokeFunction',
      functionName: this.proxyLambda.functionName,
      principal: '*',
    });
  }
}
