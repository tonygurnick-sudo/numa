import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { S3BucketNotification } from '@cdktf/provider-aws/lib/s3-bucket-notification';
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';
import { Construct } from 'constructs';
import { v4 as uuidv4 } from 'uuid';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLambda } from './numa-lambda';
import { NumaLogGroup } from './numa-log-group';

// Glenn's server IPs — only sources allowed to call the API and use the
// generated presigned URLs. Changing these requires a redeploy.
const ALLOWED_IPS = ['101.100.128.241', '165.232.141.91'];

// S3 prefix where Racetech daily SQLite files are stored in the data bucket.
const UPLOAD_PREFIX = 'documents/company/racetech-data/';

export interface RacetechDataFeedConstructProps extends ApiGatewayLambdaCollectionProps {
  /** ARN of the client's S3 data bucket. */
  dataBucketArn: string;
  /** Name of the client's S3 data bucket. */
  dataBucketName: string;
}

/**
 * Racetech External Data Feed
 *
 * Provisions everything needed for Glenn (Racetech's external developer) to
 * upload daily SQLite database exports from Moneyworks/Opencart to the client's
 * S3 data bucket without needing direct AWS credentials:
 *
 *   1. Public API Gateway route: POST /api/racetech/upload
 *      - Protected by shared API key (auto-generated in SSM)
 *      - Lambda validates source IP matches one of Glenn's static IPs before issuing URL
 *
 *   2. Presigned PUT URL (1 hour TTL) for s3://{bucket}/documents/company/racetech-data/{filename}
 *      - Signed with STS session credentials that include an aws:SourceIp condition
 *      - URL is cryptographically bound to ALLOWED_IPS — useless from any other address
 *
 *   3. S3 versioning on the data bucket + lifecycle rule scoped to the racetech/
 *      prefix (expires non-current versions after 30 days)
 *
 *   4. Auto-unzip Lambda triggered by S3 on .zip uploads — extracts .sqlite files
 *      and removes the original .zip so the workspace agent sees raw databases.
 */
export class RacetechDataFeedConstruct extends ApiGatewayLambdaCollection {
  protected logGroup: CloudwatchLogGroup;

  constructor(scope: Construct, id: string, props: RacetechDataFeedConstructProps) {
    super(scope, id, props);

    const clientName = props.clientName;

    // ── Log group ─────────────────────────────────────────────────────────────
    this.logGroup = new NumaLogGroup(this, 'racetech-log-group', {
      logGroupName: `${clientName}-racetech-data-feed`,
    }).logGroup;

    // ── S3 versioning (per-bucket; lifecycle rule scopes cost to racetech/) ──
    new S3BucketVersioningA(this, 'data-bucket-versioning', {
      bucket: props.dataBucketName,
      versioningConfiguration: { status: 'Enabled' },
    });

    // Expire non-current versions older than 30 days for the racetech/ prefix only.
    // With daily uploads Glenn overwrites the same filenames — versioning keeps
    // ~30 previous copies as a rollback safety net without unbounded growth.
    new S3BucketLifecycleConfiguration(this, 'racetech-lifecycle', {
      bucket: props.dataBucketName,
      rule: [
        {
          id: 'racetech-expire-old-versions',
          status: 'Enabled',
          filter: [{ prefix: UPLOAD_PREFIX }],
          noncurrentVersionExpiration: [{ noncurrentDays: 30 }],
        },
      ],
    });

    // ── IAM role that the Lambda assumes to generate the presigned URL ────────
    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const uploadRole = new IamRole(this, 'racetech-s3-upload-role', {
      name: `${clientName}-racetech-s3-upload`,
      maxSessionDuration: 7200,
      assumeRolePolicy: new DataAwsIamPolicyDocument(this, 'upload-role-trust', {
        statement: [
          {
            actions: ['sts:AssumeRole'],
            principals: [
              {
                type: 'AWS',
                identifiers: [`arn:aws:iam::${callerIdentity.accountId}:root`],
              },
            ],
          },
        ],
      }).json,
    });

    // Role policy: PutObject limited to racetech/ prefix AND ALLOWED_IPS.
    new IamRolePolicy(this, 'racetech-upload-role-policy', {
      role: uploadRole.name,
      policy: new DataAwsIamPolicyDocument(this, 'upload-role-policy-doc', {
        statement: [
          {
            actions: ['s3:PutObject'],
            resources: [`${props.dataBucketArn}/${UPLOAD_PREFIX}*`],
            condition: [
              {
                test: 'IpAddress',
                variable: 'aws:SourceIp',
                values: ALLOWED_IPS,
              },
            ],
          },
        ],
      }).json,
    });

    // ── SSM: API key (auto-generated at first deploy, never rotated by Terraform)
    const apiKeyParam = new SsmParameter(this, 'racetech-api-key', {
      name: `${clientName}_racetech-upload-api-key`,
      type: 'String',
      value: uuidv4(),
      lifecycle: { createBeforeDestroy: true, ignoreChanges: ['value'] },
    });

    // ── Upload URL Lambda + public API Gateway route ──────────────────────────
    this.addLambdaFunction(this, 'racetech-upload-url', {
      addAuthorizer: false, // No Cognito — Glenn is an external user
      lambdaDirectory: 'python/racetech-upload-url',
      handler: 'lambda_function.lambda_handler',
      route: { verb: 'POST', path: 'racetech/upload' },
      timeout: 29,
      memorySize: 256,
      environment: {
        DATA_BUCKET_NAME: props.dataBucketName,
        ALLOWED_IPS: ALLOWED_IPS.join(','),
        UPLOAD_ROLE_ARN: uploadRole.arn,
        API_KEY_PARAM: apiKeyParam.name,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          resources: [uploadRole.arn],
        },
        {
          effect: 'Allow',
          actions: ['ssm:GetParameter'],
          resources: [apiKeyParam.arn],
        },
      ],
    });

    // ── Auto-unzip Lambda (S3 triggered) ──────────────────────────────────────
    // Glenn uploads .sqlite.zip files. This Lambda extracts the .sqlite and
    // removes the .zip so the workspace agent always sees raw databases.
    const unzipLambda = new NumaLambda(this, 'racetech-unzip', {
      clientName,
      lambdaDirectory: 'python/racetech-unzip',
      handler: 'lambda_function.handler',
      logGroup: this.logGroup,
      resourceNameSuffix: '_racetech-unzip',
      timeout: 300,
      memorySize: 512,
      ephemeralStorageMb: 2048,
      environment: {
        DATA_BUCKET_NAME: props.dataBucketName,
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.dataBucketArn}/${UPLOAD_PREFIX}*`],
        },
      ],
    });

    const unzipS3Permission = new LambdaPermission(this, 'racetech-unzip-s3-permission', {
      statementId: 'AllowS3InvokeRacetechUnzip',
      functionName: unzipLambda.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 's3.amazonaws.com',
      sourceArn: `${props.dataBucketArn}`,
    });

    // Trigger on .zip uploads to the racetech-data prefix only.
    // Loop-safe: extracted .sqlite files don't match the .zip suffix filter.
    // Note: racetech has numaFiles=false so no existing S3BucketNotification
    // on this bucket — safe to create one here without conflict.
    new S3BucketNotification(this, 'racetech-data-bucket-notification', {
      bucket: props.dataBucketName,
      dependsOn: [unzipS3Permission],
      lambdaFunction: [
        {
          events: ['s3:ObjectCreated:*'],
          filterPrefix: UPLOAD_PREFIX,
          filterSuffix: '.zip',
          lambdaFunctionArn: unzipLambda.lambda.arn,
        },
      ],
    });
  }
}
