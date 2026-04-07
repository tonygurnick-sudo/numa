import { PrivateBucket } from '@arcanumai/private-bucket-construct';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { DataAwsIamPolicyDocument } from '@cdktf/provider-aws/lib/data-aws-iam-policy-document';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { KmsKey } from '@cdktf/provider-aws/lib/kms-key';
import { KmsAlias } from '@cdktf/provider-aws/lib/kms-alias';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { S3BucketReplicationConfigurationA } from '@cdktf/provider-aws/lib/s3-bucket-replication-configuration';
import { S3BucketServerSideEncryptionConfigurationA } from '@cdktf/provider-aws/lib/s3-bucket-server-side-encryption-configuration';
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning';
import { Construct } from 'constructs';
import { NumaLambda } from './numa-lambda';
import { NumaLogGroup } from './numa-log-group';
import type { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';

interface SourceBucket {
  label: string;
  name: string;
  arn: string;
  /** Skip creating versioning if another construct already manages it (e.g. racetech) */
  skipVersioning?: boolean;
}

export interface DisasterRecoveryConstructProps {
  clientName: string;
  environmentName: string;
  clientAccountId: string;
  region: string;

  /** All source buckets to replicate into the recovery bucket */
  sourceBuckets: SourceBucket[];

  /** Cognito User Pool ID for user/group export */
  userPoolId: string;
}

export class DisasterRecoveryConstruct extends Construct {
  readonly recoveryBucketName: string;
  readonly recoveryBucketArn: string;
  readonly logGroup: CloudwatchLogGroup;

  constructor(scope: Construct, id: string, props: DisasterRecoveryConstructProps) {
    super(scope, id);

    const namespace = `numa-${props.clientName}${props.environmentName !== 'prod' ? `-${props.environmentName}` : ''}`;
    this.recoveryBucketName = `${namespace}-recovery`;

    // ── 1. Recovery bucket ──────────────────────────────────────────────────
    const recoveryBucket = new PrivateBucket(this, 'recovery-bucket', {
      bucket: this.recoveryBucketName,
    });
    this.recoveryBucketArn = recoveryBucket.bucket.arn;

    // ── 2. Recovery bucket versioning (required for replication destination) ─
    const recoveryVersioning = new S3BucketVersioningA(this, 'recovery-versioning', {
      bucket: recoveryBucket.bucket.bucket,
      versioningConfiguration: { status: 'Enabled' },
    });

    // ── 3. KMS key for secrets encryption ───────────────────────────────────
    const kmsKey = new KmsKey(this, 'recovery-kms-key', {
      description: `DR encryption key for ${props.clientName}`,
      enableKeyRotation: true,
      deletionWindowInDays: 14,
      tags: {
        Name: `${props.clientName}-dr-recovery-key`,
        Environment: props.environmentName,
        Purpose: 'disaster-recovery-encryption',
      },
    });

    new KmsAlias(this, 'recovery-kms-alias', {
      name: `alias/${props.clientName}-dr-recovery`,
      targetKeyId: kmsKey.keyId,
    });

    // ── 4. SSE-KMS encryption on recovery bucket ────────────────────────────
    new S3BucketServerSideEncryptionConfigurationA(this, 'recovery-encryption', {
      bucket: recoveryBucket.bucket.bucket,
      rule: [
        {
          applyServerSideEncryptionByDefault: {
            sseAlgorithm: 'aws:kms',
            kmsMasterKeyId: kmsKey.arn,
          },
          bucketKeyEnabled: true,
        },
      ],
    });

    // ── 5. Lifecycle rules ──────────────────────────────────────────────────
    new S3BucketLifecycleConfiguration(this, 'recovery-lifecycle', {
      bucket: recoveryBucket.bucket.bucket,
      rule: [
        {
          id: 'expire-old-s3-versions',
          status: 'Enabled',
          noncurrentVersionExpiration: [{ noncurrentDays: 14 }],
        },
        {
          id: 'expire-dynamodb-exports',
          status: 'Enabled',
          filter: [{ prefix: 'dynamodb/' }],
          expiration: [{ days: 14 }],
        },
        {
          id: 'expire-cognito-snapshots',
          status: 'Enabled',
          filter: [{ prefix: 'cognito/' }],
          expiration: [{ days: 14 }],
        },
        {
          id: 'expire-secrets-snapshots',
          status: 'Enabled',
          filter: [{ prefix: 'secrets/' }],
          expiration: [{ days: 14 }],
        },
      ],
    });

    // ── 6. IAM replication role ─────────────────────────────────────────────
    const replicationTrustPolicy = new DataAwsIamPolicyDocument(this, 'replication-trust', {
      statement: [
        {
          actions: ['sts:AssumeRole'],
          principals: [{ type: 'Service', identifiers: ['s3.amazonaws.com'] }],
        },
      ],
    });

    const replicationRole = new IamRole(this, 'replication-role', {
      name: `${props.clientName}-s3-replication-role`,
      assumeRolePolicy: replicationTrustPolicy.json,
      tags: {
        Name: `${props.clientName}-s3-replication-role`,
        Environment: props.environmentName,
        Purpose: 'disaster-recovery-replication',
      },
    });

    // Build source bucket ARN list for IAM policy
    const sourceArns = props.sourceBuckets.map((b) => b.arn);
    const sourceArnObjects = props.sourceBuckets.map((b) => `${b.arn}/*`);

    const replicationPolicyDoc = new DataAwsIamPolicyDocument(this, 'replication-policy-doc', {
      statement: [
        {
          sid: 'SourceBucketPermissions',
          actions: ['s3:GetReplicationConfiguration', 's3:ListBucket'],
          resources: sourceArns,
        },
        {
          sid: 'SourceObjectPermissions',
          actions: ['s3:GetObjectVersionForReplication', 's3:GetObjectVersionAcl', 's3:GetObjectVersionTagging'],
          resources: sourceArnObjects,
        },
        {
          sid: 'DestinationPermissions',
          actions: [
            's3:ReplicateObject',
            's3:ReplicateDelete',
            's3:ReplicateTags',
            's3:ObjectOwnerOverrideToBucketOwner',
          ],
          resources: [`${recoveryBucket.bucket.arn}/*`],
        },
        {
          sid: 'KmsDecryptSource',
          actions: ['kms:Decrypt'],
          resources: ['*'],
        },
        {
          sid: 'KmsEncryptDestination',
          actions: ['kms:Encrypt'],
          resources: [kmsKey.arn],
        },
      ],
    });

    const replicationRolePolicy = new IamRolePolicy(this, 'replication-role-policy', {
      name: `${props.clientName}-s3-replication-policy`,
      role: replicationRole.id,
      policy: replicationPolicyDoc.json,
    });

    // ── 7. Source bucket versioning + replication configs ────────────────────
    const sourceVersioningResources: S3BucketVersioningA[] = [];

    for (const source of props.sourceBuckets) {
      // Enable versioning on source bucket (required for replication)
      if (!source.skipVersioning) {
        const versioning = new S3BucketVersioningA(this, `versioning-${source.label}`, {
          bucket: source.name,
          versioningConfiguration: { status: 'Enabled' },
        });
        sourceVersioningResources.push(versioning);
      }

      // Replication rule: replicate all objects to recovery bucket
      new S3BucketReplicationConfigurationA(this, `replicate-${source.label}`, {
        bucket: source.name,
        role: replicationRole.arn,
        dependsOn: [recoveryVersioning, replicationRolePolicy, ...sourceVersioningResources],
        rule: [
          {
            id: `replicate-to-recovery`,
            status: 'Enabled',
            filter: {},
            deleteMarkerReplication: { status: 'Enabled' },
            destination: {
              bucket: recoveryBucket.bucket.arn,
              storageClass: 'STANDARD',
              encryptionConfiguration: {
                replicaKmsKeyId: kmsKey.arn,
              },
            },
            sourceSelectionCriteria: {
              sseKmsEncryptedObjects: { status: 'Enabled' },
            },
          },
        ],
      });
    }

    // ── 8. DR export Lambda ─────────────────────────────────────────────────
    this.logGroup = new NumaLogGroup(this, 'dr-export-log-group', {
      logGroupName: `${props.clientName}-dr-export`,
    }).logGroup;

    const drExportLambda = new NumaLambda(this, 'dr-export', {
      clientName: props.clientName,
      lambdaDirectory: 'python/numa-dr-export/',
      logGroup: this.logGroup,
      resourceNameSuffix: '_dr-export',
      timeout: 900,
      environment: {
        RECOVERY_BUCKET: this.recoveryBucketName,
        CLIENT_NAME: props.clientName,
        USER_POOL_ID: props.userPoolId,
        KMS_KEY_ID: kmsKey.keyId,
      },
      additionalPolicyStatements: [
        // DynamoDB export permissions
        {
          effect: 'Allow',
          actions: [
            'dynamodb:ExportTableToPointInTime',
            'dynamodb:DescribeExport',
            'dynamodb:ListTables',
            'dynamodb:DescribeTable',
            'dynamodb:DescribeContinuousBackups',
          ],
          resources: ['*'],
        },
        // S3 write to recovery bucket
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:AbortMultipartUpload'],
          resources: [`${recoveryBucket.bucket.arn}/*`],
        },
        // Cognito read
        {
          effect: 'Allow',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:ListGroups', 'cognito-idp:AdminListGroupsForUser'],
          resources: [`arn:aws:cognito-idp:${props.region}:${props.clientAccountId}:userpool/${props.userPoolId}`],
        },
        // Secrets Manager read
        {
          effect: 'Allow',
          actions: ['secretsmanager:ListSecrets', 'secretsmanager:GetSecretValue'],
          resources: ['*'],
        },
        // KMS encrypt for secrets
        {
          effect: 'Allow',
          actions: ['kms:Encrypt', 'kms:GenerateDataKey'],
          resources: [kmsKey.arn],
        },
      ],
    });

    // ── 9. EventBridge schedule (every 6 hours) ─────────────────────────────
    const schedule = new CloudwatchEventRule(this, 'dr-export-schedule', {
      name: `${props.clientName}-dr-export-schedule`,
      description: `Trigger DR export for ${props.clientName} every 6 hours`,
      scheduleExpression: 'rate(6 hours)',
      tags: {
        Name: `${props.clientName}-dr-export-schedule`,
        Environment: props.environmentName,
        Purpose: 'disaster-recovery-export',
      },
    });

    new LambdaPermission(this, 'dr-export-eventbridge-permission', {
      statementId: 'AllowEventBridgeInvoke',
      functionName: drExportLambda.lambda.functionName,
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: schedule.arn,
    });

    new CloudwatchEventTarget(this, 'dr-export-target', {
      rule: schedule.name,
      arn: drExportLambda.lambda.arn,
      targetId: `${props.clientName}-dr-export`,
    });
  }
}
