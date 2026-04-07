import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeContinuousBackupsCommand,
  ListExportsCommand,
} from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';

const RECOVERY_BUCKET = process.env.RECOVERY_BUCKET as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
const REGION = process.env.REGION as string;

const s3 = withPRM(S3Client, { region: REGION });
const dynamodb = withPRM(DynamoDBClient, { region: REGION });

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

interface PrefixStats {
  prefix: string;
  objectCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

interface TablePitrStatus {
  tableName: string;
  pitrEnabled: boolean;
  earliestRestoreDate: string | null;
  latestRestoreDate: string | null;
}

interface ExportInfo {
  tableName: string;
  exportArn: string;
  exportStatus: string;
  exportTime: string;
}

interface DrStats {
  recoveryBucket: {
    name: string;
    totalSizeBytes: number;
    totalObjects: number;
    prefixes: PrefixStats[];
  };
  dynamodb: {
    totalTables: number;
    pitrEnabledCount: number;
    tables: TablePitrStatus[];
    recentExports: ExportInfo[];
  };
  schedule: {
    frequencyHours: number;
    retentionDays: number;
  };
}

function isAdmin(event: Pick<APIGatewayProxyEventV2, 'headers'>): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return (claims['cognito:groups'] || []).includes('admin');
  } catch {
    return false;
  }
}

async function getBucketStats(): Promise<DrStats['recoveryBucket']> {
  const prefixes = ['dynamodb/', 'cognito/', 'secrets/'];
  const prefixStats: PrefixStats[] = [];
  let totalSize = 0;
  let totalObjects = 0;

  // Get stats for known export prefixes (parallel)
  const prefixResults = await Promise.all(
    prefixes.map(async (prefix) => {
      let count = 0;
      let size = 0;
      let lastMod: Date | null = null;
      let continuationToken: string | undefined;

      do {
        const resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: RECOVERY_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );
        for (const obj of resp.Contents || []) {
          count++;
          size += obj.Size || 0;
          if (obj.LastModified && (!lastMod || obj.LastModified > lastMod)) {
            lastMod = obj.LastModified;
          }
        }
        continuationToken = resp.NextContinuationToken;
      } while (continuationToken);

      return { prefix, objectCount: count, totalSizeBytes: size, lastModified: lastMod?.toISOString() ?? null };
    })
  );

  for (const ps of prefixResults) {
    prefixStats.push(ps);
    totalSize += ps.totalSizeBytes;
    totalObjects += ps.objectCount;
  }

  // Get stats for replicated S3 objects (everything NOT in the export prefixes)
  let replicatedCount = 0;
  let replicatedSize = 0;
  let replicatedLastMod: Date | null = null;
  let continuationToken: string | undefined;

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: RECOVERY_BUCKET,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents || []) {
      const key = obj.Key || '';
      if (prefixes.some((p) => key.startsWith(p))) continue;
      replicatedCount++;
      replicatedSize += obj.Size || 0;
      if (obj.LastModified && (!replicatedLastMod || obj.LastModified > replicatedLastMod)) {
        replicatedLastMod = obj.LastModified;
      }
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  if (replicatedCount > 0) {
    prefixStats.unshift({
      prefix: 's3-replicated/',
      objectCount: replicatedCount,
      totalSizeBytes: replicatedSize,
      lastModified: replicatedLastMod?.toISOString() ?? null,
    });
    totalSize += replicatedSize;
    totalObjects += replicatedCount;
  }

  return {
    name: RECOVERY_BUCKET,
    totalSizeBytes: totalSize,
    totalObjects,
    prefixes: prefixStats,
  };
}

async function getDynamoDbStats(): Promise<DrStats['dynamodb']> {
  // List all client tables
  const tables: string[] = [];
  let exclusiveStartTableName: string | undefined;

  do {
    const resp = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: exclusiveStartTableName }));
    for (const name of resp.TableNames || []) {
      if (name.startsWith(`numa-${CLIENT_NAME}`) || name.startsWith(CLIENT_NAME)) {
        tables.push(name);
      }
    }
    exclusiveStartTableName = resp.LastEvaluatedTableName;
  } while (exclusiveStartTableName);

  // Check PITR status for each table (parallel)
  const tableStatuses = await Promise.all(
    tables.map(async (tableName): Promise<TablePitrStatus> => {
      try {
        const resp = await dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
        const pitr = resp.ContinuousBackupsDescription?.PointInTimeRecoveryDescription;
        return {
          tableName,
          pitrEnabled: pitr?.PointInTimeRecoveryStatus === 'ENABLED',
          earliestRestoreDate: pitr?.EarliestRestorableDateTime?.toISOString() ?? null,
          latestRestoreDate: pitr?.LatestRestorableDateTime?.toISOString() ?? null,
        };
      } catch {
        return { tableName, pitrEnabled: false, earliestRestoreDate: null, latestRestoreDate: null };
      }
    })
  );
  const pitrEnabled = tableStatuses.filter((t) => t.pitrEnabled).length;

  // Get recent exports
  const recentExports: ExportInfo[] = [];
  try {
    const resp = await dynamodb.send(new ListExportsCommand({ MaxResults: 25 }));
    for (const exp of resp.ExportSummaries || []) {
      const arn = exp.ExportArn || '';
      // Only include exports targeting our recovery bucket
      if (exp.ExportStatus) {
        // ExportArn format: arn:aws:dynamodb:region:account:table/tableName/export/exportId
        const arnParts = arn.split('/');
        const tableName = arnParts.length >= 2 ? arnParts[1] : 'unknown';
        recentExports.push({
          tableName,
          exportArn: arn,
          exportStatus: exp.ExportStatus,
          exportTime: arn, // ARN contains the export ID which encodes the time
        });
      }
    }
  } catch (err) {
    console.error('Failed to list exports', err);
  }

  return {
    totalTables: tables.length,
    pitrEnabledCount: pitrEnabled,
    tables: tableStatuses,
    recentExports,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

  if (!isAdmin(event)) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const emptyBucket: DrStats['recoveryBucket'] = {
      name: RECOVERY_BUCKET,
      totalSizeBytes: 0,
      totalObjects: 0,
      prefixes: [],
    };

    const [bucketStats, dynamoStats] = await Promise.all([
      getBucketStats().catch((err: unknown) => {
        const code = (err as { name?: string })?.name;
        if (code === 'NoSuchBucket' || code === 'AccessDenied') return emptyBucket;
        throw err;
      }),
      getDynamoDbStats(),
    ]);

    const stats: DrStats = {
      recoveryBucket: bucketStats,
      dynamodb: dynamoStats,
      schedule: {
        frequencyHours: 6,
        retentionDays: 14,
      },
    };

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(stats) };
  } catch (err) {
    console.error('admin-dr-stats error', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
