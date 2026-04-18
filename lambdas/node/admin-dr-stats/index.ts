import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeContinuousBackupsCommand,
  ListExportsCommand,
  RestoreTableToPointInTimeCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  CreateGroupCommand,
  ListGroupsCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import { withPRM } from '../../../lib/prm-node/prm';

const RECOVERY_BUCKET = process.env.RECOVERY_BUCKET as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;
const REGION = process.env.REGION as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string;

const s3 = withPRM(S3Client, { region: REGION });
const dynamodb = withPRM(DynamoDBClient, { region: REGION });

let cognitoClient: CognitoIdentityProviderClient | null = null;
const getCognito = (): CognitoIdentityProviderClient => {
  if (!cognitoClient) cognitoClient = withPRM(CognitoIdentityProviderClient, { region: REGION });
  return cognitoClient;
};

let secretsClient: SecretsManagerClient | null = null;
const getSecrets = (): SecretsManagerClient => {
  if (!secretsClient) secretsClient = withPRM(SecretsManagerClient, { region: REGION });
  return secretsClient;
};

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// --- Auth ---

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

function getAdminInfo(event: Pick<APIGatewayProxyEventV2, 'headers'>): { sub: string; email: string } {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return { sub: '', email: '' };
  const token = String(auth).replace(/^Bearer\s+/i, '');
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return { sub: claims.sub || '', email: claims.email || '' };
  } catch {
    return { sub: '', email: '' };
  }
}

function generateCodeWord(date: string): string {
  const d = new Date(date);
  const month = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `RESTORE-${month}${day}`;
}

// --- S3 helpers ---

async function readJsonFromS3(key: string): Promise<unknown> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: RECOVERY_BUCKET, Key: key }));
  const body = await resp.Body?.transformToString('utf-8');
  if (!body) throw new Error(`File ${key} is empty or not readable`);
  return JSON.parse(body);
}

// --- Backups listing ---

interface BackupDay {
  date: string;
  timestamps: string[];
  itemCount: number;
  totalSizeBytes: number;
  codeWord: string;
  types: { cognito: boolean; secrets: boolean; dynamodb: boolean };
}

async function handleListBackups(): Promise<{ statusCode: number; body: string }> {
  // Discover backup timestamps from cognito/ prefix
  const cognitoResp = await s3.send(
    new ListObjectsV2Command({ Bucket: RECOVERY_BUCKET, Prefix: 'cognito/', Delimiter: '/' })
  );

  const timestamps = (cognitoResp.CommonPrefixes || [])
    .map((p) => {
      const prefix = p.Prefix || '';
      // Extract timestamp from "cognito/2026-04-17T12-30-45Z/"
      const match = prefix.match(/cognito\/([^/]+)\//);
      return match ? match[1] : '';
    })
    .filter(Boolean)
    .sort()
    .reverse();

  // Group by date
  const byDate = new Map<string, string[]>();
  for (const ts of timestamps) {
    const date = ts.substring(0, 10); // "2026-04-17"
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(ts);
  }

  // Build backup day entries (parallel HeadObject calls across all days)
  const backups: BackupDay[] = await Promise.all(
    [...byDate.entries()].map(async ([date, dayTimestamps]) => {
      const latestTs = dayTimestamps[0]; // Already sorted descending
      let totalSize = 0;
      let itemCount = 0;
      let hasCognito = false;
      let hasSecrets = false;

      // Fire both HeadObject calls in parallel per day
      const [usersResult, secretsResult] = await Promise.allSettled([
        s3.send(new HeadObjectCommand({ Bucket: RECOVERY_BUCKET, Key: `cognito/${latestTs}/users.json` })),
        s3.send(new HeadObjectCommand({ Bucket: RECOVERY_BUCKET, Key: `secrets/${latestTs}/secrets.json` })),
      ]);

      if (usersResult.status === 'fulfilled') {
        totalSize += usersResult.value.ContentLength || 0;
        hasCognito = true;
        itemCount += Math.max(1, Math.round((usersResult.value.ContentLength || 0) / 200));
      }

      if (secretsResult.status === 'fulfilled') {
        totalSize += secretsResult.value.ContentLength || 0;
        hasSecrets = true;
        itemCount += Math.max(1, Math.round((secretsResult.value.ContentLength || 0) / 300));
      }

      return {
        date,
        timestamps: dayTimestamps,
        itemCount,
        totalSizeBytes: totalSize,
        codeWord: generateCodeWord(date),
        types: { cognito: hasCognito, secrets: hasSecrets, dynamodb: true },
      };
    })
  );

  return { statusCode: 200, body: JSON.stringify({ backups }) };
}

// --- Restore ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRestore(event: APIGatewayProxyEventV2): Promise<{ statusCode: number; body: string }> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { date, timestamp, codeWord } = body as { date?: string; timestamp?: string; codeWord?: string };
  const admin = getAdminInfo(event);

  if (!USER_POOL_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'USER_POOL_ID not configured for this environment' }) };
  }

  if (!date || !codeWord) {
    return { statusCode: 400, body: JSON.stringify({ error: 'date and codeWord are required' }) };
  }

  // Validate code word
  const expectedCodeWord = generateCodeWord(date);
  if (codeWord !== expectedCodeWord) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid code word' }) };
  }

  // Find the latest timestamp for this date if not specified
  let restoreTs = timestamp as string;
  if (!restoreTs) {
    const cognitoResp = await s3.send(
      new ListObjectsV2Command({ Bucket: RECOVERY_BUCKET, Prefix: `cognito/`, Delimiter: '/' })
    );
    const dayTimestamps = (cognitoResp.CommonPrefixes || [])
      .map((p) => (p.Prefix || '').match(/cognito\/([^/]+)\//)?.[1] || '')
      .filter((ts) => ts.startsWith(date))
      .sort()
      .reverse();

    if (dayTimestamps.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: `No backup found for ${date}` }) };
    }
    restoreTs = dayTimestamps[0];
  }

  console.log(
    JSON.stringify({
      _name: 'DR_RESTORE_START',
      date,
      timestamp: restoreTs,
      adminSub: admin.sub,
      adminEmail: admin.email,
    })
  );

  const results = {
    groupsRestored: 0,
    usersRestored: 0,
    secretsRestored: 0,
    tablesRestoring: 0,
    errors: [] as string[],
  };

  // 1. Restore Cognito groups
  try {
    const groupsData = (await readJsonFromS3(`cognito/${restoreTs}/groups.json`)) as Array<{
      GroupName: string;
      Description?: string;
      Precedence?: number;
      RoleArn?: string;
    }>;

    // Get existing groups (paginated)
    const existingGroups = new Set<string>();
    try {
      let nextToken: string | undefined;
      do {
        const listRes = await getCognito().send(
          new ListGroupsCommand({ UserPoolId: USER_POOL_ID, NextToken: nextToken })
        );
        for (const g of listRes.Groups || []) {
          if (g.GroupName) existingGroups.add(g.GroupName);
        }
        nextToken = listRes.NextToken;
      } while (nextToken);
    } catch {
      // Continue — will try to create all
    }

    for (const group of groupsData) {
      if (existingGroups.has(group.GroupName)) continue;
      try {
        await getCognito().send(
          new CreateGroupCommand({
            UserPoolId: USER_POOL_ID,
            GroupName: group.GroupName,
            Description: group.Description,
            Precedence: group.Precedence,
            RoleArn: group.RoleArn,
          })
        );
        results.groupsRestored++;
        console.log(JSON.stringify({ _name: 'DR_RESTORE_GROUP', group: group.GroupName }));
      } catch (err) {
        results.errors.push(`Group ${group.GroupName}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Cognito groups: ${(err as Error).message}`);
  }

  // 2. Restore Cognito users (sequential, ~5 RPS with exponential backoff)
  try {
    const usersData = (await readJsonFromS3(`cognito/${restoreTs}/users.json`)) as Array<{
      Username: string;
      Attributes: Record<string, string>;
      Enabled: boolean;
      Groups: string[];
    }>;

    // Process users sequentially to respect Cognito's ~5 RPS rate limit.
    // Retry with exponential backoff on throttling.
    for (const user of usersData) {
      const email = user.Attributes?.email;
      if (!email) continue;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Check if user exists
          let exists = false;
          try {
            await getCognito().send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
            exists = true;
          } catch (lookupErr) {
            const lookupName = (lookupErr as { name?: string })?.name;
            if (lookupName === 'UserNotFoundException' || lookupName === 'ResourceNotFoundException') {
              exists = false;
            } else {
              throw lookupErr; // Re-throw auth/throttle errors
            }
          }

          if (exists) {
            const attrs = Object.entries(user.Attributes || {})
              .filter(([k]) => !['sub', 'email_verified', 'identities'].includes(k))
              .map(([Name, Value]) => ({ Name, Value }));

            if (attrs.length > 0) {
              await getCognito().send(
                new AdminUpdateUserAttributesCommand({
                  UserPoolId: USER_POOL_ID,
                  Username: email,
                  UserAttributes: attrs,
                })
              );
            }
          } else {
            const attrs = Object.entries(user.Attributes || {})
              .filter(([k]) => !['sub', 'identities'].includes(k))
              .map(([Name, Value]) => ({ Name, Value }));

            await getCognito().send(
              new AdminCreateUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: email,
                UserAttributes: attrs,
                MessageAction: 'SUPPRESS',
              })
            );
          }

          // Restore group memberships
          for (const groupName of user.Groups || []) {
            try {
              await getCognito().send(
                new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: groupName })
              );
            } catch (groupErr) {
              const groupMsg = (groupErr as Error).message || '';
              // Ignore "user already in group" — that's fine
              if (!groupMsg.includes('already a member')) {
                results.errors.push(`User ${email} → group ${groupName}: ${groupMsg}`);
              }
            }
          }

          results.usersRestored++;
          break; // Success — exit retry loop
        } catch (err) {
          const msg = (err as Error).message || '';
          const errName = (err as { name?: string })?.name || '';
          if ((errName === 'ThrottlingException' || msg.includes('ThrottlingException')) && attempt < 2) {
            await sleep(Math.pow(2, attempt) * 500); // 500ms, 1s, 2s backoff
            continue;
          }
          results.errors.push(`User ${email}: ${msg}`);
          break;
        }
      }

      // 200ms pause between users (~5 RPS)
      await sleep(200);
    }
  } catch (err) {
    results.errors.push(`Cognito users: ${(err as Error).message}`);
  }

  // 3. Restore secrets (sequential)
  try {
    const secretsData = (await readJsonFromS3(`secrets/${restoreTs}/secrets.json`)) as Array<{
      Name: string;
      ARN: string;
      Description?: string;
      SecretString: string;
      Tags?: Array<{ Key: string; Value: string }>;
    }>;

    // Get existing secrets (paginated)
    const existingSecrets = new Set<string>();
    try {
      let nextToken: string | undefined;
      do {
        const listRes = await getSecrets().send(new ListSecretsCommand({ NextToken: nextToken }));
        for (const s of listRes.SecretList || []) {
          if (s.Name) existingSecrets.add(s.Name);
        }
        nextToken = listRes.NextToken;
      } while (nextToken);
    } catch {
      // Continue
    }

    for (const secret of secretsData) {
      try {
        if (existingSecrets.has(secret.Name)) {
          await getSecrets().send(
            new UpdateSecretCommand({ SecretId: secret.Name, SecretString: secret.SecretString })
          );
        } else {
          await getSecrets().send(
            new CreateSecretCommand({
              Name: secret.Name,
              Description: secret.Description,
              SecretString: secret.SecretString,
              Tags: secret.Tags,
            })
          );
        }
        results.secretsRestored++;
        console.log(JSON.stringify({ _name: 'DR_RESTORE_SECRET', secret: secret.Name }));
      } catch (err) {
        results.errors.push(`Secret ${secret.Name}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    results.errors.push(`Secrets: ${(err as Error).message}`);
  }

  // 4. DynamoDB — initiate PITR restores (async, don't wait)
  try {
    const tables: string[] = [];
    let exclusiveStartTableName: string | undefined;
    do {
      const resp = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: exclusiveStartTableName }));
      for (const name of resp.TableNames || []) {
        if ((name.startsWith(`numa-${CLIENT_NAME}`) || name.startsWith(CLIENT_NAME)) && !name.includes('-restored-')) {
          tables.push(name);
        }
      }
      exclusiveStartTableName = resp.LastEvaluatedTableName;
    } while (exclusiveStartTableName);

    // Parse the restore timestamp (format: 2026-04-17T12-30-45Z → 2026-04-17T12:30:45Z)
    const restoreDate = new Date(restoreTs.replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/, '$1T$2:$3:$4Z'));
    if (isNaN(restoreDate.getTime())) {
      results.errors.push(`DynamoDB: invalid restore timestamp '${restoreTs}'`);
    }

    for (const tableName of tables) {
      if (isNaN(restoreDate.getTime())) break;
      try {
        const pitrResp = await dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
        const pitr = pitrResp.ContinuousBackupsDescription?.PointInTimeRecoveryDescription;
        if (pitr?.PointInTimeRecoveryStatus !== 'ENABLED') continue;

        await dynamodb.send(
          new RestoreTableToPointInTimeCommand({
            SourceTableName: tableName,
            TargetTableName: `${tableName}-restored-${date}`,
            RestoreDateTime: restoreDate,
          })
        );
        results.tablesRestoring++;
        console.log(
          JSON.stringify({ _name: 'DR_RESTORE_TABLE', table: tableName, targetTable: `${tableName}-restored-${date}` })
        );
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('already exists')) {
          // Table already restored for this date
          results.errors.push(`Table ${tableName}: restore table already exists`);
        } else {
          results.errors.push(`Table ${tableName}: ${msg}`);
        }
      }
    }
  } catch (err) {
    results.errors.push(`DynamoDB: ${(err as Error).message}`);
  }

  const status = results.errors.length > 0 ? 'partial_failure' : 'completed';

  console.log(
    JSON.stringify({
      _name: 'DR_RESTORE_COMPLETE',
      date,
      timestamp: restoreTs,
      status,
      ...results,
      adminSub: admin.sub,
      adminEmail: admin.email,
    })
  );

  // Persist last-restore record. Displayed at the top of the DR tab so admins
  // can see who triggered the most recent restore. Best-effort — failure here
  // does not fail the restore itself.
  try {
    const lastRestore = {
      email: admin.email,
      sub: admin.sub,
      date,
      codeWord,
      timestamp: new Date().toISOString(),
      status,
    };
    await s3.send(
      new PutObjectCommand({
        Bucket: RECOVERY_BUCKET,
        Key: 'metadata/last-restore.json',
        Body: JSON.stringify(lastRestore),
        ContentType: 'application/json',
      })
    );
  } catch (err) {
    console.warn(`DR_LAST_RESTORE_WRITE_FAILED: ${(err as Error).message}`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ status, ...results }),
  };
}

// --- Access log (POST) + last-restore (GET) ---

async function handleAccessLog(event: APIGatewayProxyEventV2): Promise<{ statusCode: number; body: string }> {
  if (!isAdmin(event)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  const admin = getAdminInfo(event);
  const sourceIp = event.requestContext?.http?.sourceIp || '';
  const userAgent = event.requestContext?.http?.userAgent || '';
  console.log(
    JSON.stringify({
      _name: 'DR_ACCESS_UNLOCKED',
      adminSub: admin.sub,
      adminEmail: admin.email,
      sourceIp,
      userAgent,
      timestamp: new Date().toISOString(),
    })
  );
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

async function handleGetLastRestore(event: APIGatewayProxyEventV2): Promise<{ statusCode: number; body: string }> {
  if (!isAdmin(event)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: RECOVERY_BUCKET, Key: 'metadata/last-restore.json' }));
    const body = await resp.Body?.transformToString();
    if (!body) {
      return { statusCode: 200, body: JSON.stringify({ lastRestore: null }) };
    }
    return { statusCode: 200, body: JSON.stringify({ lastRestore: JSON.parse(body) }) };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') {
      return { statusCode: 200, body: JSON.stringify({ lastRestore: null }) };
    }
    return { statusCode: 500, body: JSON.stringify({ error: (err as Error).message }) };
  }
}

// --- Legacy stats (kept for backward compatibility) ---

async function handleGetStats(): Promise<{ statusCode: number; body: string }> {
  const emptyBucket = {
    name: RECOVERY_BUCKET,
    totalSizeBytes: 0,
    totalObjects: 0,
    prefixes: [] as Array<{ prefix: string; objectCount: number; totalSizeBytes: number; lastModified: string | null }>,
  };

  const topLevelResp = await s3
    .send(new ListObjectsV2Command({ Bucket: RECOVERY_BUCKET, Delimiter: '/' }))
    .catch(() => null);
  if (!topLevelResp) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        recoveryBucket: emptyBucket,
        dynamodb: { totalTables: 0, pitrEnabledCount: 0, tables: [], recentExports: [] },
        schedule: { frequencyHours: 6, retentionDays: 14 },
      }),
    };
  }

  const prefixes = (topLevelResp.CommonPrefixes || []).map((p) => p.Prefix!).filter(Boolean);
  let totalSize = 0;
  let totalObjects = 0;
  const prefixStats = await Promise.all(
    prefixes.map(async (prefix) => {
      let count = 0;
      let size = 0;
      let lastMod: Date | null = null;
      let ct: string | undefined;
      do {
        const resp = await s3.send(
          new ListObjectsV2Command({ Bucket: RECOVERY_BUCKET, Prefix: prefix, ContinuationToken: ct, MaxKeys: 1000 })
        );
        count += resp.KeyCount || 0;
        for (const obj of resp.Contents || []) {
          size += obj.Size || 0;
          if (obj.LastModified && (!lastMod || obj.LastModified > lastMod)) lastMod = obj.LastModified;
        }
        ct = resp.NextContinuationToken;
      } while (ct);
      return { prefix, objectCount: count, totalSizeBytes: size, lastModified: lastMod?.toISOString() ?? null };
    })
  );
  for (const ps of prefixStats) {
    totalSize += ps.totalSizeBytes;
    totalObjects += ps.objectCount;
  }

  // DynamoDB stats
  const tables: string[] = [];
  let est: string | undefined;
  do {
    const resp = await dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: est }));
    for (const n of resp.TableNames || []) {
      if ((n.startsWith(`numa-${CLIENT_NAME}`) || n.startsWith(CLIENT_NAME)) && !n.includes('-restored-'))
        tables.push(n);
    }
    est = resp.LastEvaluatedTableName;
  } while (est);

  const tableStatuses = await Promise.all(
    tables.map(async (tableName) => {
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

  const recentExports: Array<{ tableName: string; exportArn: string; exportStatus: string; exportTime: string }> = [];
  try {
    const resp = await dynamodb.send(new ListExportsCommand({ MaxResults: 25 }));
    for (const exp of resp.ExportSummaries || []) {
      const arn = exp.ExportArn || '';
      if (exp.ExportStatus) {
        const arnParts = arn.split('/');
        recentExports.push({
          tableName: arnParts.length >= 2 ? arnParts[1] : 'unknown',
          exportArn: arn,
          exportStatus: exp.ExportStatus,
          exportTime: ((): string => {
            const et = (exp as Record<string, unknown>).ExportTime;
            if (!et) return '';
            if (et instanceof Date) return et.toISOString();
            return new Date(String(et)).toISOString();
          })(),
        });
      }
    }
  } catch (err) {
    console.error('Failed to list exports', err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      recoveryBucket: { name: RECOVERY_BUCKET, totalSizeBytes: totalSize, totalObjects, prefixes: prefixStats },
      dynamodb: {
        totalTables: tables.length,
        pitrEnabledCount: tableStatuses.filter((t) => t.pitrEnabled).length,
        tables: tableStatuses,
        recentExports,
      },
      schedule: { frequencyHours: 6, retentionDays: 14 },
    }),
  };
}

// --- Main handler ---

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';

  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  if (!isAdmin(event)) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    // GET /settings/disaster-recovery/backups — daily backup listing
    if (method === 'GET' && /\/disaster-recovery\/backups\/?$/.test(path)) {
      const result = await handleListBackups();
      return { ...result, headers: HEADERS };
    }

    // POST /settings/disaster-recovery/restore — restore from backup
    if (method === 'POST' && /\/disaster-recovery\/restore\/?$/.test(path)) {
      const result = await handleRestore(event);
      return { ...result, headers: HEADERS };
    }

    // GET /settings/disaster-recovery/stats — legacy stats endpoint
    if (method === 'GET' && /\/disaster-recovery\/stats\/?$/.test(path)) {
      const result = await handleGetStats();
      return { ...result, headers: HEADERS };
    }

    // POST /settings/disaster-recovery/access-log — record admin unlock event
    if (method === 'POST' && /\/disaster-recovery\/access-log\/?$/.test(path)) {
      const result = await handleAccessLog(event);
      return { ...result, headers: HEADERS };
    }

    // GET /settings/disaster-recovery/last-restore — who restored last + when
    if (method === 'GET' && /\/disaster-recovery\/last-restore\/?$/.test(path)) {
      const result = await handleGetLastRestore(event);
      return { ...result, headers: HEADERS };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error(JSON.stringify({ _name: 'DR_ERROR', method, path, error: (err as Error).message }));
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
