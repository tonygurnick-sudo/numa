import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { SFNClient, StartExecutionCommand, StopExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  DeleteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { authService } from './authService';
import { getConfigValue } from './configService';
import type { PortalConfig } from './configService';
import type { DeploymentGroup } from '@/types';
import { clientService } from './clientService';

const AUTO_GROUP_NAME = 'All Production Clients';
const AUTO_GROUP_DESCRIPTION = 'Automatically includes all non-dev client stacks plus key trial environments.';
const AUTO_GROUP_EXTRA_CLIENTS = new Set(['arcanum-prod-trial', 'arcanum-prod-numa-demo', 'arcanum-council-trial']);

function getRegion(): string {
  return getConfigValue('AWS_REGION') || 'us-east-1';
}

function getAwsCredentialsProvider() {
  const region = getRegion();
  const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!;
  const userPoolId = getConfigValue('USER_POOL_ID')!;
  return async () => {
    const ensured = await authService.ensureValidSession(60 * 1000);
    const session = ensured || authService.getCurrentSession();
    if (!session) throw new Error('Not authenticated');
    const idToken = session.idToken;
    const base = fromCognitoIdentityPool({
      identityPoolId,
      logins: { [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken },
      clientConfig: { region },
    });
    return base();
  };
}

export interface StartDeploymentInput {
  clientName: string;
  imageTag: string;
  initiatedBy: string;
  deploymentId?: string; // optional client-generated id to correlate
  deploymentLabel?: string; // optional custom label for deployment
  mode?: 'deploy' | 'plan';
  groupRunId?: string;
  groupName?: string;
}

export async function startDeployment(
  input: StartDeploymentInput
): Promise<{ executionArn: string; deploymentId: string }> {
  const sfnArn = getConfigValue('DEPLOYMENT_SFN_ARN');
  if (!sfnArn) throw new Error('Deployment state machine not configured');

  const credentials = getAwsCredentialsProvider();
  const region = getRegion();
  const sfn = new SFNClient({ region, credentials });

  const nowIso = new Date().toISOString();
  const deploymentId = input.deploymentId || `deploy-${Date.now()}`;
  const payload = {
    clientName: input.clientName,
    imageTag: input.imageTag,
    initiatedBy: input.initiatedBy,
    startedAt: nowIso,
    deploymentId,
    ...(input.deploymentLabel && { deploymentLabel: input.deploymentLabel }),
    mode: input.mode || 'deploy',
    ...(input.groupRunId ? { groupRunId: input.groupRunId } : {}),
    ...(input.groupName ? { groupName: input.groupName } : {}),
  };
  const cmd = new StartExecutionCommand({ stateMachineArn: sfnArn, input: JSON.stringify(payload) });
  const res = await sfn.send(cmd);
  if (!res.executionArn) throw new Error('Failed to start deployment');
  return { executionArn: res.executionArn, deploymentId };
}

export async function startGroupDeployment(input: StartGroupDeploymentInput): Promise<StartGroupDeploymentResult> {
  const sfnArn = getGroupStateMachineArn();
  if (!input.clients || input.clients.length === 0)
    throw new Error('At least one client is required to start a group deployment');

  const credentials = getAwsCredentialsProvider();
  const region = getRegion();
  const sfn = new SFNClient({ region, credentials });

  const groupRunId =
    input.groupRunId ||
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `group-${crypto.randomUUID()}` : `group-${Date.now()}`);
  const startedAt = input.startedAt || new Date().toISOString();

  const payload = {
    groupRunId,
    groupName: input.groupName,
    clients: input.clients,
    imageTag: input.imageTag,
    initiatedBy: input.initiatedBy,
    startedAt,
    mode: input.mode || 'deploy',
    deploymentLabel: input.deploymentLabel ?? input.groupName,
    ...(input.maxConcurrency ? { maxConcurrency: input.maxConcurrency } : {}),
  };

  const cmd = new StartExecutionCommand({ stateMachineArn: sfnArn, input: JSON.stringify(payload) });
  const res = await sfn.send(cmd);
  if (!res.executionArn) throw new Error('Failed to start group deployment');
  return { executionArn: res.executionArn, groupRunId };
}

export interface DeploymentRecord {
  deploymentId: string;
  clientName: string;
  imageTag?: string;
  initiatedBy?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  logsGroup?: string;
  logsStream?: string;
  ecsTaskArn?: string;
  sfnExecutionArn?: string;
  attemptNumber?: number;
  attemptLabel?: string;
  message?: string;
  deploymentLabel?: string;
  mode?: 'deploy' | 'plan';
  entityType?: 'deployment' | 'group';
  groupRunId?: string;
  groupName?: string;
  clientsJson?: string;
  clientsTotal?: number;
  clientsCompleted?: number;
  clientsSucceeded?: number;
  clientsFailed?: number;
  maxConcurrency?: number;
  lastFailedClient?: string;
  lastError?: string;
  lastActivityAt?: string;
  clients?: string[];
}

export interface DeploymentLockRecord {
  deploymentId: string;
  clientName: string;
  startedAt?: string;
}

export interface StartGroupDeploymentInput {
  groupName: string;
  clients: string[];
  imageTag: string;
  initiatedBy: string;
  mode?: 'deploy' | 'plan';
  maxConcurrency?: number;
  groupRunId?: string;
  startedAt?: string;
  deploymentLabel?: string;
}

export interface StartGroupDeploymentResult {
  executionArn: string;
  groupRunId: string;
}

function getDdbDoc(): DynamoDBDocumentClient {
  const region = getRegion();
  const client = new DynamoDBClient({ region, credentials: getAwsCredentialsProvider() });
  return DynamoDBDocumentClient.from(client);
}

function getSfn(): SFNClient {
  const region = getRegion();
  return new SFNClient({ region, credentials: getAwsCredentialsProvider() });
}

function getEcs(): ECSClient {
  const region = getRegion();
  return new ECSClient({ region, credentials: getAwsCredentialsProvider() });
}

function getGroupStateMachineArn(): string {
  const arn = getConfigValue('DEPLOYMENT_GROUP_SFN_ARN');
  if (!arn) throw new Error('Group deployment state machine not configured');
  return arn;
}

function getGroupsTableName(): string {
  const table = getConfigValue('DEPLOYMENT_GROUPS_TABLE');
  if (!table) throw new Error('Deployment groups table not configured');
  return table;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function getGroupDefaultConcurrencyConfig(): number | undefined {
  return parseOptionalNumber(getConfigValue('DEPLOYMENT_GROUP_DEFAULT_CONCURRENCY' as keyof PortalConfig));
}

function getGroupMaxConcurrencyConfig(): number | undefined {
  return parseOptionalNumber(getConfigValue('DEPLOYMENT_GROUP_MAX_CONCURRENCY' as keyof PortalConfig));
}

export function getGroupConcurrencyBounds(): { default?: number; max?: number } {
  return {
    default: getGroupDefaultConcurrencyConfig(),
    max: getGroupMaxConcurrencyConfig(),
  };
}

function enrichDeploymentRecord(raw: DeploymentRecord | undefined | null): DeploymentRecord | null {
  if (!raw) return null;
  const record: DeploymentRecord = { ...raw };
  if (!record.clients && typeof record.clientsJson === 'string') {
    try {
      const parsed = JSON.parse(record.clientsJson);
      if (Array.isArray(parsed)) record.clients = parsed.filter((c): c is string => typeof c === 'string');
    } catch (error) {
      console.warn('Failed to parse clientsJson for deployment record', error);
    }
  }
  return record;
}

export async function getDeploymentById(deploymentId: string, consistent = true): Promise<DeploymentRecord | null> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { deploymentId }, ConsistentRead: consistent }));
  return enrichDeploymentRecord(res.Item as DeploymentRecord | undefined);
}

export async function listRecentDeploymentsForClient(clientName: string, limit = 20): Promise<DeploymentRecord[]> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'clientName-index',
      KeyConditionExpression: 'clientName = :c',
      ExpressionAttributeValues: { ':c': clientName },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  const items = (res.Items as DeploymentRecord[]) || [];
  return items
    .map((item) => enrichDeploymentRecord(item))
    .filter((record): record is DeploymentRecord => Boolean(record));
}

export async function listAllRecentDeployments(limit = 100): Promise<DeploymentRecord[]> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();

  // Paginated scan to reduce missed-late-page issues.
  // Note: Scan has no sort order; we fetch multiple pages and then sort by startedAt desc.
  const collected: DeploymentRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;
  const maxPages = 5; // reasonable client-side bound; consider server/API or GSI for scale
  const pageSize = Math.max(100, Math.min(1000, limit * 2));

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        Limit: pageSize,
        ExclusiveStartKey: exclusiveStartKey as any,
        FilterExpression: 'NOT begins_with(deploymentId, :lockPrefix)',
        ExpressionAttributeValues: { ':lockPrefix': 'lock#' },
      })
    );
    const items = (res.Items as DeploymentRecord[]) || [];
    collected.push(...items);
    exclusiveStartKey = res.LastEvaluatedKey as any;
    pages += 1;
    // Stop early if we have significantly more than requested; we'll trim after sorting
  } while (exclusiveStartKey && pages < maxPages && collected.length < limit * 4);

  const normalized = collected
    .map((item) => enrichDeploymentRecord(item))
    .filter((record): record is DeploymentRecord => Boolean(record));

  normalized.sort((a, b) => {
    const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return timeB - timeA;
  });

  return normalized.slice(0, limit);
}

export interface ListByTimeRangeParams {
  fromIso: string;
  toIso?: string;
  pageSize?: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface ListByTimeRangeResult {
  items: DeploymentRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export async function listDeploymentsByTimeRange(params: ListByTimeRangeParams): Promise<ListByTimeRangeResult> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const toIso = params.toIso ?? new Date().toISOString();
  const pageSize = params.pageSize ?? 100;

  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'history-index',
      KeyConditionExpression: 'historyPk = :h AND startedAt BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':h': 'all',
        ':from': params.fromIso,
        ':to': toIso,
      },
      ScanIndexForward: false, // newest first
      Limit: pageSize,
      ExclusiveStartKey: params.exclusiveStartKey as any,
    })
  );

  let items = ((res.Items as DeploymentRecord[]) || [])
    .map((item) => enrichDeploymentRecord(item))
    .filter((record): record is DeploymentRecord => Boolean(record));

  // Temporary fallback for legacy items missing historyPk: scan a page from base table
  if (items.length === 0 && !res.LastEvaluatedKey) {
    const scan = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression:
          'attribute_not_exists(historyPk) AND NOT begins_with(deploymentId, :lockPrefix) AND #s BETWEEN :from AND :to',
        ExpressionAttributeNames: { '#s': 'startedAt' },
        ExpressionAttributeValues: {
          ':lockPrefix': 'lock#',
          ':from': params.fromIso,
          ':to': toIso,
        },
        Limit: pageSize * 2,
      })
    );
    const legacy = ((scan.Items as DeploymentRecord[]) || [])
      .map((item) => enrichDeploymentRecord(item))
      .filter((record): record is DeploymentRecord => Boolean(record))
      .sort((a, b) => {
        const timeA = a.startedAt ? Date.parse(a.startedAt) : 0;
        const timeB = b.startedAt ? Date.parse(b.startedAt) : 0;
        return timeB - timeA;
      })
      .slice(0, pageSize);
    items = legacy;
  }

  return { items, lastEvaluatedKey: res.LastEvaluatedKey as any };
}

export async function listDeploymentLocks(): Promise<DeploymentLockRecord[]> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const res = await ddb.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: 'begins_with(deploymentId, :lockPrefix)',
      ExpressionAttributeValues: { ':lockPrefix': 'lock#' },
    })
  );
  const items = (res.Items as DeploymentLockRecord[]) || [];
  return items;
}

export async function listDeploymentsForGroup(groupRunId: string): Promise<DeploymentRecord[]> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'groupRunId-index',
      KeyConditionExpression: 'groupRunId = :g',
      ExpressionAttributeValues: { ':g': groupRunId },
      ScanIndexForward: true,
    })
  );

  const items = (res.Items as DeploymentRecord[]) || [];
  return items
    .map((item) => enrichDeploymentRecord(item))
    .filter((record): record is DeploymentRecord => Boolean(record))
    .filter((record) => record.entityType !== 'group' || record.deploymentId !== groupRunId)
    .sort((a, b) => {
      const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return timeA - timeB;
    });
}

export async function releaseDeploymentLock(clientName: string): Promise<void> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  await ddb.send(
    new DeleteCommand({
      TableName: table,
      Key: { deploymentId: `lock#${clientName}` },
    })
  );
}

export async function listDeploymentGroups(): Promise<DeploymentGroup[]> {
  const table = getGroupsTableName();
  const ddb = getDdbDoc();
  const res = await ddb.send(new ScanCommand({ TableName: table }));
  const items = (res.Items as DeploymentGroup[]) || [];

  const normalized = items.map((group) => ({
    ...group,
    clients: (group.clients || []).filter((client): client is string => typeof client === 'string'),
  }));

  let autoGroup: DeploymentGroup | null = null;
  try {
    const clients = await clientService.getAllClients();
    const eligibleClients = clients
      .filter((client) => !client.config.devInstance || AUTO_GROUP_EXTRA_CLIENTS.has(client.name))
      .map((client) => client.name)
      .sort((a, b) => a.localeCompare(b));

    if (eligibleClients.length > 0) {
      autoGroup = {
        groupName: AUTO_GROUP_NAME,
        clients: eligibleClients,
        description: AUTO_GROUP_DESCRIPTION,
        managed: true,
      };
    }
  } catch (error) {
    console.warn('Failed to build automatic production deployment group:', error);
  }

  const merged = normalized.filter((group) => !autoGroup || group.groupName !== autoGroup.groupName);
  if (autoGroup) {
    merged.push(autoGroup);
  }

  return merged.sort((a, b) => {
    if (a.managed && !b.managed) return -1;
    if (!a.managed && b.managed) return 1;
    return a.groupName.localeCompare(b.groupName);
  });
}

export async function getDeploymentGroup(groupName: string): Promise<DeploymentGroup | null> {
  const table = getGroupsTableName();
  const ddb = getDdbDoc();
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { groupName } }));
  if (!res.Item) return null;
  const group = res.Item as DeploymentGroup;
  return {
    ...group,
    clients: (group.clients || []).filter((client): client is string => typeof client === 'string'),
  };
}

export async function saveDeploymentGroup(group: DeploymentGroup): Promise<void> {
  if (!group.groupName.trim()) throw new Error('Group name is required');
  if (!group.clients || group.clients.length === 0) throw new Error('At least one client is required for a group');

  const table = getGroupsTableName();
  const ddb = getDdbDoc();
  const now = new Date().toISOString();
  const existing = await getDeploymentGroup(group.groupName);

  const item: DeploymentGroup = {
    groupName: group.groupName.trim(),
    clients: Array.from(new Set(group.clients.map((c) => c.trim()).filter(Boolean))).sort(),
    description: group.description?.trim() || undefined,
    maxConcurrency: group.maxConcurrency,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

export async function deleteDeploymentGroup(groupName: string): Promise<void> {
  const table = getGroupsTableName();
  const ddb = getDdbDoc();
  await ddb.send(new DeleteCommand({ TableName: table, Key: { groupName } }));
}

export function buildCloudwatchLogsUrl(region: string, group?: string, stream?: string): string | null {
  if (!group || !stream) return null;
  const enc = (s: string) => encodeURIComponent(s);
  return `https://console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${enc(group)}/log-events/${enc(stream)}`;
}

export function buildStepFunctionsUrl(region: string, executionArn?: string): string | null {
  if (!executionArn) return null;
  const enc = encodeURIComponent(executionArn);
  return `https://console.aws.amazon.com/states/home?region=${region}#/executions/details/${enc}`;
}

export function buildEcsTaskUrl(region: string, taskArn?: string): string | null {
  if (!taskArn) return null;
  const taskId = taskArn.split('/').pop() || taskArn;
  return `https://console.aws.amazon.com/ecs/home?region=${region}#/clusters/numa-portal-deployments/tasks/${encodeURIComponent(taskId)}/details`;
}

export async function getGroupDeploymentSummary(
  groupRunId: string,
  consistent = true
): Promise<DeploymentRecord | null> {
  return getDeploymentById(groupRunId, consistent);
}

export async function overrideDeploymentStatus(deploymentId: string, status: string, message?: string): Promise<void> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');
  const ddb = getDdbDoc();
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { deploymentId },
      UpdateExpression: 'SET #s = :s, endedAt = :e, message = :m',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': status,
        ':e': now,
        ':m': message || 'manually marked by user',
      },
      ConditionExpression: 'attribute_exists(deploymentId)',
    })
  );
}

export async function stopSfnExecution(executionArn: string, reason = 'Stopped by user from portal'): Promise<void> {
  const sfn = getSfn();
  await sfn.send(new StopExecutionCommand({ executionArn, cause: reason }));
}

export async function stopEcsTask(taskArn: string): Promise<void> {
  const ecs = getEcs();
  const cluster = (getConfigValue('ECS_CLUSTER_ARN') || 'numa-portal-deployments') as string;
  await ecs.send(new StopTaskCommand({ cluster, task: taskArn, reason: 'Stopped by user from portal' }));
}

export async function stopDeployment(deployment: DeploymentRecord, stoppedBy: string): Promise<void> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');

  // 1) Best-effort stop Step Functions
  if (deployment.sfnExecutionArn) {
    try {
      await stopSfnExecution(deployment.sfnExecutionArn, `Stopped by ${stoppedBy}`);
    } catch (e) {
      console.warn('StopExecution failed (best-effort):', e);
    }
  }

  // 2) Best-effort stop ECS Task (if known)
  if (deployment.ecsTaskArn) {
    try {
      await stopEcsTask(deployment.ecsTaskArn);
    } catch (e) {
      console.warn('ECS StopTask failed (best-effort):', e);
    }
  }

  // 3) Release lock for the client
  if (deployment.clientName && !deployment.clientName.startsWith('group#')) {
    try {
      await releaseDeploymentLock(deployment.clientName);
    } catch (e) {
      console.warn('Release lock failed (best-effort):', e);
    }
  }

  // 4) Mark record as stopped
  const ddb = getDdbDoc();
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { deploymentId: deployment.deploymentId },
      UpdateExpression: 'SET #s = :s, endedAt = :e, message = :m',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'stopped',
        ':e': now,
        ':m': `stopped by ${stoppedBy}`,
      },
      ConditionExpression: 'attribute_exists(deploymentId)',
    })
  );
}

export async function stopGroupDeployment(summary: DeploymentRecord, stoppedBy: string): Promise<void> {
  const table = getConfigValue('DEPLOYMENTS_TABLE');
  if (!table) throw new Error('Deployments table not configured');

  // Best-effort stop the group Step Functions execution
  if (summary.sfnExecutionArn) {
    try {
      await stopSfnExecution(summary.sfnExecutionArn, `Stopped group by ${stoppedBy}`);
    } catch (e) {
      console.warn('StopExecution (group) failed (best-effort):', e);
    }
  }

  // Mark group summary record as stopped
  const ddb = getDdbDoc();
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { deploymentId: summary.deploymentId },
      UpdateExpression: 'SET #s = :s, endedAt = :e, message = :m',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'stopped',
        ':e': now,
        ':m': `stopped by ${stoppedBy}`,
      },
      ConditionExpression: 'attribute_exists(deploymentId)',
    })
  );
}
