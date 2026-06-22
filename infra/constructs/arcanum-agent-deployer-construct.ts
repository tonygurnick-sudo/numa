import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachmentsExclusive } from '@cdktf/provider-aws/lib/iam-role-policy-attachments-exclusive';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { S3BucketCorsConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-cors-configuration';
import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { TerraformOutput, Fn } from 'cdktf';
import path from 'node:path';

export interface ArcanumAgentDeployerConstructProps {
  /** ARN of the numa-client-config table (deployer account). */
  clientConfigTableArn: string;
  /** Name of the numa-client-config table. */
  clientConfigTableName: string;
  /** Portal origin allowed to upload library reference files directly to S3 (CORS). */
  portalOrigin: string;
}

/**
 * Arcanum Agent Deployer (FEAT-206) — deployer-account resources that let the
 * Customer Success Portal maintain a central library of curated "Arcanum"
 * agents and push them into client Numa instances without a full Numa deploy.
 *
 * Provisions:
 *   • DynamoDB `numa-arcanum-agent-library`     — agent definitions (PK library_agent_id).
 *   • DynamoDB `numa-arcanum-agent-deployments` — deploy audit/status (PK deployment_id; GSI client-index).
 *   • S3 `numa-arcanum-agent-library`           — raw reference files (browser-uploaded via CORS).
 *   • Lambda `numa-arcanum-agent-deployer`      — the push engine.
 *
 * The Lambda assumes `ArcanumAIAccess` per target client and writes agent rows +
 * reference files directly into the client account. The portal invokes it
 * same-account (its authenticated role is granted lambda:InvokeFunction in
 * customer-success-portal-construct.ts).
 */
export class ArcanumAgentDeployerConstruct extends Construct {
  public readonly functionArn: string;
  public readonly functionName: string;
  public readonly libraryTableArn: string;
  public readonly libraryTableName: string;
  public readonly deploymentsTableArn: string;
  public readonly deploymentsTableName: string;
  public readonly targetsTableArn: string;
  public readonly targetsTableName: string;
  public readonly libraryBucketArn: string;
  public readonly libraryBucketName: string;

  constructor(scope: Construct, id: string, props: ArcanumAgentDeployerConstructProps) {
    super(scope, id);

    const functionName = 'numa-arcanum-agent-deployer';
    const libraryTableName = 'numa-arcanum-agent-library';
    const deploymentsTableName = 'numa-arcanum-agent-deployments';
    // Per-client deploy targets (which library agents each client should have).
    // Deliberately NOT stored in numa-client-config: that table is strict-parsed
    // by every client stack synth, so a new key there blocks unrelated deploys on
    // any build that predates the schema change. Keeping it here decouples it.
    const targetsTableName = 'numa-arcanum-agent-targets';
    const libraryBucketName = 'numa-arcanum-agent-library';

    // ── DynamoDB ────────────────────────────────────────────────────────
    const libraryTable = new DynamodbTable(this, 'library-table', {
      name: libraryTableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'library_agent_id',
      attribute: [{ name: 'library_agent_id', type: 'S' }],
      pointInTimeRecovery: { enabled: true },
      deletionProtectionEnabled: true,
      lifecycle: { preventDestroy: true },
      tags: { Name: libraryTableName, ManagedBy: 'cdktf', Component: 'arcanum-agent-deployer' },
    });

    const deploymentsTable = new DynamodbTable(this, 'deployments-table', {
      name: deploymentsTableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'deployment_id',
      attribute: [
        { name: 'deployment_id', type: 'S' },
        { name: 'client_name', type: 'S' },
        { name: 'created_at', type: 'N' },
      ],
      globalSecondaryIndex: [
        {
          name: 'client-index',
          hashKey: 'client_name',
          rangeKey: 'created_at',
          projectionType: 'ALL',
        },
      ],
      ttl: { attributeName: 'ttl', enabled: true },
      pointInTimeRecovery: { enabled: true },
      tags: { Name: deploymentsTableName, ManagedBy: 'cdktf', Component: 'arcanum-agent-deployer' },
    });

    const targetsTable = new DynamodbTable(this, 'targets-table', {
      name: targetsTableName,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'client_name',
      attribute: [{ name: 'client_name', type: 'S' }],
      pointInTimeRecovery: { enabled: true },
      tags: { Name: targetsTableName, ManagedBy: 'cdktf', Component: 'arcanum-agent-deployer' },
    });

    // ── S3 (library reference files) ────────────────────────────────────
    const libraryBucket = new PrivateBucket(this, 'library-bucket', { bucket: libraryBucketName });

    // CORS so the CS Portal (browser) can upload/list/delete reference files
    // directly via the AWS SDK with deployer Identity Pool creds.
    new S3BucketCorsConfiguration(this, 'library-bucket-cors', {
      bucket: libraryBucket.bucket.id,
      corsRule: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'HEAD', 'PUT', 'DELETE'],
          allowedOrigins: [props.portalOrigin],
          exposeHeaders: ['ETag', 'Content-Type', 'Content-Length'],
          maxAgeSeconds: 3600,
        },
      ],
    });

    // ── CloudWatch Logs ─────────────────────────────────────────────────
    const logGroup = new CloudwatchLogGroup(this, 'log-group', {
      name: `/aws/lambda/${functionName}`,
      retentionInDays: 30,
    });

    // ── Lambda execution role ───────────────────────────────────────────
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
            sid: 'ReadClientConfig',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
            resources: [props.clientConfigTableArn],
          },
          {
            sid: 'ReadLibraryTable',
            effect: 'Allow',
            actions: ['dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:Query'],
            resources: [libraryTable.arn, `${libraryTable.arn}/index/*`],
          },
          {
            sid: 'WriteDeploymentsTable',
            effect: 'Allow',
            actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
            resources: [deploymentsTable.arn, `${deploymentsTable.arn}/index/*`],
          },
          {
            sid: 'ReadWriteTargetsTable',
            effect: 'Allow',
            actions: ['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
            resources: [targetsTable.arn],
          },
          {
            sid: 'ReadLibraryBucket',
            effect: 'Allow',
            actions: ['s3:GetObject', 's3:ListBucket'],
            resources: [libraryBucket.bucket.arn, `${libraryBucket.bucket.arn}/*`],
          },
          {
            // Cross-account work happens through the assumed role; everything
            // else (client DDB/S3/Lambda) is authorised by ArcanumAIAccess.
            sid: 'AssumeRoleIntoClientAccounts',
            effect: 'Allow',
            actions: ['sts:AssumeRole'],
            resources: ['arn:aws:iam::*:role/ArcanumAIAccess'],
          },
        ],
      }).json,
    });

    new IamRolePolicyAttachmentsExclusive(this, 'role-policy-attachments', {
      roleName: execRole.name,
      policyArns: [policy.arn],
    });

    // ── Lambda function ─────────────────────────────────────────────────
    const zip = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'lambdas',
      'node',
      'arcanum-agent-deployer',
      'lambda_function.zip'
    );

    const fn = new LambdaFunction(this, 'function', {
      functionName,
      role: execRole.arn,
      filename: zip,
      sourceCodeHash: Fn.filebase64sha256(zip),
      handler: 'index.handler',
      runtime: 'nodejs22.x',
      // Per invoke: assume-role hop + per-agent reference-file copy + a synchronous
      // extract-content invoke per file. A deploy of several agents with files can
      // run for a few minutes; generous headroom under the 15min ceiling.
      timeout: 600,
      memorySize: 512,
      loggingConfig: { logGroup: logGroup.name, logFormat: 'Text' },
      environment: {
        variables: {
          LIBRARY_TABLE: libraryTable.name,
          DEPLOYMENTS_TABLE: deploymentsTable.name,
          TARGETS_TABLE: targetsTable.name,
          LIBRARY_BUCKET: libraryBucket.bucket.bucket,
          CLIENT_CONFIG_TABLE_NAME: props.clientConfigTableName,
          CLIENT_ASSUME_ROLE_NAME: 'ArcanumAIAccess',
        },
      },
    });

    // No resource-based LambdaPermission — the portal invokes same-account and
    // is granted lambda:InvokeFunction on this ARN via its authenticated role.

    // ── Outputs ─────────────────────────────────────────────────────────
    new TerraformOutput(this, 'function-arn', { value: fn.arn });
    new TerraformOutput(this, 'library-table-name', { value: libraryTable.name });
    new TerraformOutput(this, 'deployments-table-name', { value: deploymentsTable.name });
    new TerraformOutput(this, 'targets-table-name', { value: targetsTable.name });
    new TerraformOutput(this, 'library-bucket-name', { value: libraryBucket.bucket.bucket });

    this.functionArn = fn.arn;
    this.functionName = fn.functionName;
    this.libraryTableArn = libraryTable.arn;
    this.libraryTableName = libraryTable.name;
    this.deploymentsTableArn = deploymentsTable.arn;
    this.deploymentsTableName = deploymentsTable.name;
    this.targetsTableArn = targetsTable.arn;
    this.targetsTableName = targetsTable.name;
    this.libraryBucketArn = libraryBucket.bucket.arn;
    this.libraryBucketName = libraryBucket.bucket.bucket;
  }
}
