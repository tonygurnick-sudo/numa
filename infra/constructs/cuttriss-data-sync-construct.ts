import { Construct } from 'constructs';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { NumaLambda } from './numa-lambda';
import { NumaLogGroup } from './numa-log-group';
import { z } from 'zod';

export const cuttrissDataSyncConfigSchema = z
  .object({
    baseUrl: z.string(),
    patSecretArn: z.string(),
    scheduleExpression: z.string().optional(),
    probeRangeStart: z.number().optional(),
    probeRangeEnd: z.number().optional(),
    probeChunkSize: z.number().optional(),
    probeStateKey: z.string().optional(),
    serverId: z.number().optional(),
    s3Prefix: z.string().optional(),
    enableDeletion: z.boolean().optional(),
  })
  .strict();

export type CuttrissDataSyncConfig = z.infer<typeof cuttrissDataSyncConfigSchema>;

export interface CuttrissDataSyncConstructProps {
  clientName: string;
  dataBucketName: string;
  dataBucketArn: string;
  config: CuttrissDataSyncConfig;
}

export class CuttrissDataSyncConstruct extends Construct {
  constructor(scope: Construct, name: string, props: CuttrissDataSyncConstructProps) {
    super(scope, name);

    const {
      config: {
        baseUrl,
        patSecretArn,
        scheduleExpression = 'rate(1 hour)',
        probeRangeStart = 1,
        probeRangeEnd = 60000,
        probeChunkSize = 250,
        probeStateKey = 'cuttriss',
        serverId = 1,
        s3Prefix = 'documents/company/synergy12d-documents/',
        enableDeletion = true,
      },
    } = props;

    const normalizedPrefix = s3Prefix.replace(/^\/+/, '').replace(/\/+$/, '') + '/';

    const cursorTable = new DynamodbTable(this, 'probe-cursor-table', {
      name: `${props.clientName}-cuttriss-sync-cursor`,
      billingMode: 'PAY_PER_REQUEST',
      hashKey: 'stateId',
      attribute: [
        {
          name: 'stateId',
          type: 'S',
        },
      ],
    });

    const logGroup = new NumaLogGroup(this, 'lambda-log-group', {
      logGroupName: `${props.clientName}-cuttriss-sync`,
    }).logGroup;

    const lambda = new NumaLambda(this, 'cuttriss-sync-lambda', {
      clientName: props.clientName,
      appId: 'cuttriss-data-sync',
      lambdaDirectory: 'python/cuttriss-data-retrieval',
      logGroup,
      resourceNameSuffix: '_cuttriss_sync',
      environment: {
        SYNERGY_BASE_URL: baseUrl,
        SYNERGY_PAT_SECRET_NAME: patSecretArn,
        S3_BUCKET: props.dataBucketName,
        S3_PREFIX: normalizedPrefix,
        PROBE_RANGE_START: probeRangeStart.toString(),
        PROBE_RANGE_END: probeRangeEnd.toString(),
        PROBE_CHUNK_SIZE: probeChunkSize.toString(),
        PROBE_STATE_TABLE: cursorTable.name,
        PROBE_STATE_KEY: probeStateKey,
        PROBE_STATE_PK_ATTR: 'stateId',
        SYNERGY_SERVER_ID: serverId.toString(),
        ENABLE_DELETION: enableDeletion ? 'true' : 'false',
      },
      additionalPolicyStatements: [
        {
          effect: 'Allow',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.dataBucketArn}/*`],
        },
        {
          effect: 'Allow',
          actions: ['s3:ListBucket'],
          resources: [props.dataBucketArn],
        },
        {
          effect: 'Allow',
          actions: ['secretsmanager:GetSecretValue'],
          resources: [patSecretArn],
        },
        {
          effect: 'Allow',
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [cursorTable.arn],
        },
      ],
      timeout: 900,
      memorySize: 1024,
    }).lambda;

    const rule = new CloudwatchEventRule(this, 'cuttriss-sync-rule', {
      description: 'Triggers the Cuttriss 12d Synergy sync Lambda',
      scheduleExpression,
    });

    new CloudwatchEventTarget(this, 'cuttriss-sync-target', {
      arn: lambda.arn,
      rule: rule.name,
      input: JSON.stringify({
        mode: 'probe',
        cleanupDeleted: enableDeletion,
      }),
    });

    new LambdaPermission(this, 'cuttriss-sync-rule-permission', {
      action: 'lambda:InvokeFunction',
      functionName: lambda.functionName,
      principal: 'events.amazonaws.com',
      sourceArn: rule.arn,
    });
  }
}
