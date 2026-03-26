import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning';
import { SsmParameter } from '@cdktf/provider-aws/lib/ssm-parameter';
import { Construct } from 'constructs';
import { v4 as uuidv4 } from 'uuid';
import { ApiGatewayLambdaCollection, ApiGatewayLambdaCollectionProps } from './api-gateway-lambda-collection';
import { NumaLogGroup } from './numa-log-group';

// Glenn's static server IP — only source allowed to call the API and use the
// generated presigned URL. Changing this requires a redeploy.
const ALLOWED_IP = '101.100.128.241';

// S3 prefix where Racetech daily SQLite files are stored in the data bucket.
// Must match the path referenced in the racetech-data workspace agent skill.
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
 *      - Lambda validates source IP matches Glenn's static IP before issuing URL
 *
 *   2. Presigned PUT URL (1 hour TTL) for s3://{bucket}/documents/company/racetech-data/{filename}
 *      - Signed with STS session credentials that include an aws:SourceIp condition
 *      - URL is cryptographically bound to ALLOWED_IP — useless from any other address
 *
 *   3. S3 versioning on the data bucket + lifecycle rule scoped to the racetech/
 *      prefix (expires non-current versions after 30 days)
 *
 * The workspace agent queries the uploaded files via the racetech-data skill.
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
    // Using the account root as the trusted principal (scoped to same account).
    // The Lambda execution role is granted sts:AssumeRole on this role via
    // additionalPolicyStatements below, so in practice only that Lambda can use it.
    const callerIdentity = new DataAwsCallerIdentity(this, 'caller-identity', {});

    const uploadRole = new IamRole(this, 'racetech-s3-upload-role', {
      name: `${clientName}-racetech-s3-upload`,
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

    // Role policy: PutObject limited to racetech/ prefix AND ALLOWED_IP.
    // This policy is also embedded as a session policy when generating the
    // presigned URL, binding the URL to ALLOWED_IP at the S3 evaluation layer.
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
                values: [ALLOWED_IP],
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

    // ── Lambda + public API Gateway route ─────────────────────────────────────
    this.addLambdaFunction(this, 'racetech-upload-url', {
      addAuthorizer: false, // No Cognito — Glenn is an external user
      lambdaDirectory: 'python/racetech-upload-url',
      handler: 'lambda_function.lambda_handler',
      route: { verb: 'POST', path: 'racetech/upload' },
      timeout: 29,
      memorySize: 256,
      environment: {
        DATA_BUCKET_NAME: props.dataBucketName,
        ALLOWED_IP,
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
  }
}
