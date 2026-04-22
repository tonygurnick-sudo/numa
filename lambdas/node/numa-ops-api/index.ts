import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';
import { withPRM } from '../../../lib/prm-node/prm';
import {
  ZONE_STATUS_TYPES,
  STATUS_TYPE_TO_ZONES,
  getPreset,
  isStatusTypeAllowedInZone,
} from '../../../lib/ops-constants';
import type { PresetZone } from '../../../lib/ops-constants';
import type { ZoneType, StatusType } from '../../../lib/ops-schemas';

const client = withPRM(DynamoDBClient, {});

const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

const OPS_TABLE = process.env.OPS_TABLE!;
const OPS_CONFIG_TABLE = process.env.OPS_CONFIG_TABLE!;
const OUTPUTS_BUCKET_NAME = process.env.OUTPUTS_BUCKET_NAME!;
const REGION = process.env.REGION || 'ap-southeast-2';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLIENT_NAME = process.env.CLIENT_NAME!;

/**
 * Generate an STS presigned GetCallerIdentity URL for cross-account identity proof.
 */
async function generateStsProofUrl(expiresIn = 60): Promise<string> {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const { HttpRequest } = await import('@smithy/protocol-http');

  const signer = new SignatureV4({
    service: 'sts',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname: 'sts.us-east-1.amazonaws.com',
    path: '/',
    query: {
      Action: 'GetCallerIdentity',
      Version: '2011-06-15',
    },
    headers: {
      host: 'sts.us-east-1.amazonaws.com',
    },
  });

  const signed = await signer.presign(request, { expiresIn });
  const queryString = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  return `https://${signed.hostname}${signed.path}?${queryString}`;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const ORDER_GAP = 1000;
const ORDER_PAD = 10;

const LINK_INVERSE: Record<string, string> = {
  blocks: 'depends_on',
  depends_on: 'blocks',
  related_to: 'related_to',
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

type AuthContext = { sub: string; email?: string; name?: string; groups: string[] };

const jsonResponse = (
  statusCode: number,
  payload: unknown
): { statusCode: number; headers: typeof HEADERS; body: string } => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode: number, message: string): ReturnType<typeof jsonResponse> =>
  jsonResponse(statusCode, { error: message });

/**
 * Resolve user display name from staff records in OPS_CONFIG_TABLE.
 * Falls back to JWT name claim, then email prefix, then 'Unknown'.
 */
const resolveAuthorName = async (auth: AuthContext): Promise<string> => {
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: OPS_CONFIG_TABLE,
        Key: { PK: 'CONFIG', SK: `STAFF#${auth.sub}` },
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#n': 'name' },
      })
    );
    if (result.Item?.name) return String(result.Item.name);
  } catch {
    // Fall through to JWT-based fallback
  }
  return auth.name || (auth.email ? auth.email.split('@')[0] : 'Unknown');
};

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const resolveAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  // Path 1: Direct Lambda invocation with pre-authenticated context
  // (e.g. workspace-chat-tools calling us — IAM controls who can invoke)
  const uc = (event as unknown as Record<string, unknown>).userContext as Record<string, unknown> | undefined;
  if (uc && typeof uc.sub === 'string') {
    return {
      sub: uc.sub,
      email: typeof uc.email === 'string' ? uc.email : undefined,
      name: typeof uc.name === 'string' ? uc.name : undefined,
      groups: Array.isArray(uc.groups)
        ? (uc.groups as unknown[]).filter((g): g is string => typeof g === 'string')
        : [],
    };
  }

  // Path 2: API Gateway with JWT (already verified by Cognito authorizer)
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!sub) return null;
  const groups = Array.isArray(payload['cognito:groups'])
    ? (payload['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : [];
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    groups,
  };
};

const isAdmin = (auth: AuthContext): boolean => auth.groups.includes('admin');

/** Check if user is a team owner (creator or listed in accessControl.owners). */
const isTeamOwner = (teamMeta: Record<string, unknown>, auth: AuthContext): boolean => {
  if (teamMeta.createdBy === auth.sub) return true;
  const ac = teamMeta.accessControl as { owners?: string[] } | undefined;
  return Array.isArray(ac?.owners) && ac.owners.includes(auth.sub);
};

/** Check if user has access to a team (owner or listed member). Admins do NOT bypass this. */
const hasTeamAccess = (teamMeta: Record<string, unknown>, auth: AuthContext): boolean => {
  const ac = teamMeta.accessControl as { mode?: string; users?: string[] } | undefined;
  if (!ac || ac.mode === 'all') return true;
  if (isTeamOwner(teamMeta, auth)) return true;
  return Array.isArray(ac.users) && ac.users.includes(auth.sub);
};

const buildPathSegments = (event: APIGatewayProxyEventV2): string[] => {
  const rawPath = event.requestContext.http?.path ?? event.rawPath ?? '';
  const trimmed = rawPath.replace(/^\/+/, '');
  const withoutApi = trimmed.startsWith('api/') ? trimmed.slice(4) : trimmed;
  return withoutApi.split('/').filter(Boolean);
};

const parseBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  try {
    return JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
};

const now = (): string => new Date().toISOString();

const padOrder = (order: number): string => String(order).padStart(ORDER_PAD, '0');

// ─── DynamoDB Query Helpers ─────────────────────────────────────────────────────

const queryGSI1 = async (
  gsi1pk: string,
  skPrefix?: string,
  limit?: number,
  startKey?: Record<string, unknown>
): Promise<{ items: Record<string, unknown>[]; lastKey?: Record<string, unknown> }> => {
  // When a limit is specified, use single-page cursor-based pagination for the frontend.
  // When no limit, auto-paginate to return all results (avoids 1MB truncation).
  if (limit) {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: skPrefix ? 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)' : 'GSI1PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': gsi1pk, ':sk': skPrefix } : { ':pk': gsi1pk },
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      })
    );
    return {
      items: (result.Items ?? []) as Record<string, unknown>[],
      lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  }
  const allItems: Record<string, unknown>[] = [];
  let exclusiveStartKey = startKey;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: skPrefix ? 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)' : 'GSI1PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': gsi1pk, ':sk': skPrefix } : { ':pk': gsi1pk },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    );
    allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return { items: allItems };
};

const queryGSI2 = async (
  gsi2pk: string,
  skPrefix?: string,
  limit?: number,
  startKey?: Record<string, unknown>
): Promise<{ items: Record<string, unknown>[]; lastKey?: Record<string, unknown> }> => {
  if (limit) {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: skPrefix ? 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)' : 'GSI2PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': gsi2pk, ':sk': skPrefix } : { ':pk': gsi2pk },
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      })
    );
    return {
      items: (result.Items ?? []) as Record<string, unknown>[],
      lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  }
  const allItems: Record<string, unknown>[] = [];
  let exclusiveStartKey = startKey;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: skPrefix ? 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)' : 'GSI2PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': gsi2pk, ':sk': skPrefix } : { ':pk': gsi2pk },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    );
    allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return { items: allItems };
};

const queryGSI3 = async (gsi3pk: string, gsi3sk?: string): Promise<Record<string, unknown> | undefined> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_TABLE,
      IndexName: 'GSI3',
      KeyConditionExpression: gsi3sk ? 'GSI3PK = :pk AND GSI3SK = :sk' : 'GSI3PK = :pk',
      ExpressionAttributeValues: gsi3sk ? { ':pk': gsi3pk, ':sk': gsi3sk } : { ':pk': gsi3pk },
      Limit: 1,
    })
  );
  return (result.Items ?? [])[0] as Record<string, unknown> | undefined;
};

const queryByPK = async (pk: string, skPrefix?: string): Promise<Record<string, unknown>[]> => {
  const allItems: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: OPS_TABLE,
        KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    );
    allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return allItems;
};

const getItem = async (pk: string, sk: string): Promise<Record<string, unknown> | undefined> => {
  const result = await dynamo.send(new GetCommand({ TableName: OPS_TABLE, Key: { PK: pk, SK: sk } }));
  return result.Item as Record<string, unknown> | undefined;
};

const putItem = async (item: Record<string, unknown>): Promise<void> => {
  await dynamo.send(new PutCommand({ TableName: OPS_TABLE, Item: item }));
};

const deleteItem = async (pk: string, sk: string): Promise<void> => {
  await dynamo.send(new DeleteCommand({ TableName: OPS_TABLE, Key: { PK: pk, SK: sk } }));
};

// ─── Audit Helper ───────────────────────────────────────────────────────────────

const buildAuditItem = (
  ticketId: string,
  auth: AuthContext,
  action: string,
  changes?: Record<string, unknown>
): Record<string, unknown> => {
  const ts = now();
  const auditId = randomUUID();
  return {
    PK: `TICKET#${ticketId}`,
    SK: `AUDIT#${ts}#${auditId}`,
    entityType: 'AUDIT',
    auditId,
    ticketId,
    action,
    changes: changes ?? {},
    performedBy: auth.sub,
    performedByEmail: auth.email,
    performedByName: auth.name,
    createdAt: ts,
  };
};

// ─── Teams ───────────────────────────────────────────────────────────────────────

const handleTeams = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  // GET /ops/teams — list teams (filtered by access)
  if (method === 'GET' && segments.length === 0) {
    const { items } = await queryGSI1('TENANT', 'TEAM#');

    // Private boards are private for everyone — admins do NOT bypass access control
    const visibleTeams = items.filter((team) => hasTeamAccess(team, auth));

    return jsonResponse(200, { teams: visibleTeams });
  }

  // GET /ops/teams/{teamId} — with access control
  if (method === 'GET' && segments.length === 1) {
    const teamId = segments[0];
    const items = await queryByPK(`TEAM#${teamId}`);
    if (items.length === 0) return errorResponse(404, 'Team not found');
    const meta = items.find((i) => String(i.SK) === 'META');

    // Verify user has access to this team
    if (meta && !hasTeamAccess(meta, auth)) {
      return errorResponse(403, 'You do not have access to this team');
    }

    const zones = items
      .filter((i) => String(i.SK ?? '').startsWith('ZONE#'))
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    const stages = items
      .filter((i) => String(i.SK ?? '').startsWith('STAGE#'))
      .sort((a, b) => {
        const zoneCompare = String(a.zoneId ?? '').localeCompare(String(b.zoneId ?? ''));
        if (zoneCompare !== 0) return zoneCompare;
        return Number(a.order ?? 0) - Number(b.order ?? 0);
      });
    return jsonResponse(200, { team: meta, zones, stages });
  }

  // POST /ops/teams — create team (any authenticated user can create)
  if (method === 'POST' && segments.length === 0) {
    const {
      name,
      ticketTypeId,
      description,
      color,
      allowedTicketTypes,
      fieldOverrides,
      addedFields,
      accessControl,
      workUnitSeries,
      preset: rawPreset,
      announcement,
      order: rawOrder,
      customStages,
      zones: rawZones,
    } = body;
    if (!name) return errorResponse(400, 'Missing required field: name');

    const teamId = randomUUID();
    const ts = now();
    const hasWorkUnits = !!(workUnitSeries as Record<string, unknown> | null)?.enabled;
    const preset = getPreset(rawPreset as string | undefined);

    // Resolve zone definitions: use explicit zones array, or fall back to preset zones
    // customStages overlay: either zone-centric array or legacy Record<ZoneType, stages[]>
    let zoneDefinitions: PresetZone[];
    if (Array.isArray(rawZones) && rawZones.length > 0) {
      // Explicit zones array from the request body
      zoneDefinitions = rawZones as PresetZone[];
    } else if (Array.isArray(customStages) && customStages.length > 0) {
      // Zone-centric custom stages (new format)
      zoneDefinitions = customStages as PresetZone[];
    } else if (customStages && typeof customStages === 'object' && !Array.isArray(customStages)) {
      // Legacy format: Record<ZoneType, stages[]> — overlay onto preset zones
      const customMap = customStages as Record<string, { name: string; statusType: StatusType }[]>;
      zoneDefinitions = preset.zones.map((pz) => ({
        ...pz,
        stages: customMap[pz.zoneType] ?? pz.stages,
      }));
    } else {
      zoneDefinitions = preset.zones;
    }

    // Validate: at least 1 zone, at least 1 stage per zone
    if (zoneDefinitions.length === 0) return errorResponse(400, 'At least one zone is required');
    for (const zd of zoneDefinitions) {
      if (!zd.stages || zd.stages.length === 0)
        return errorResponse(400, `Zone "${zd.name}" must have at least one stage`);
    }

    // Build zone entries with generated IDs
    let zoneOrder = ORDER_GAP;
    const zoneEntries = zoneDefinitions.map((zd) => {
      const entry = { id: randomUUID(), name: zd.name, zoneType: zd.zoneType, order: zoneOrder, stages: zd.stages };
      zoneOrder += ORDER_GAP;
      return entry;
    });

    // Default zone is the first backlog zone, or the first zone if no backlog zones
    const defaultZoneEntry = zoneEntries.find((z) => z.zoneType === 'backlog') ?? zoneEntries[0];
    const defaultZoneId = defaultZoneEntry.id;

    const transactItems: Record<string, unknown>[] = [];

    // Track first stage ID in default zone for defaultStageId
    let defaultStageId: string | undefined;

    // Team meta
    const teamMetaItem: Record<string, unknown> = {
      PK: `TEAM#${teamId}`,
      SK: 'META',
      GSI1PK: 'TENANT',
      GSI1SK: `TEAM#${teamId}`,
      entityType: 'TEAM',
      id: teamId,
      name: String(name),
      description: description ? String(description) : undefined,
      color: color ? String(color) : undefined,
      ticketTypeId: ticketTypeId ? String(ticketTypeId) : undefined,
      allowedTicketTypes: Array.isArray(allowedTicketTypes) ? allowedTicketTypes : undefined,
      fieldOverrides: fieldOverrides && typeof fieldOverrides === 'object' ? fieldOverrides : undefined,
      addedFields: addedFields && typeof addedFields === 'object' ? addedFields : undefined,
      accessControl: accessControl ?? { mode: 'all' },
      workUnitSeries: hasWorkUnits ? workUnitSeries : undefined,
      defaultZoneId,
      announcement: announcement ? String(announcement) : undefined,
      preset: rawPreset ? String(rawPreset) : undefined,
      order: typeof rawOrder === 'number' ? rawOrder : undefined,
      createdBy: auth.sub,
      createdAt: ts,
      updatedAt: ts,
    };

    // Create zones and their stages
    for (const zoneEntry of zoneEntries) {
      const zoneId = zoneEntry.id;

      transactItems.push({
        Put: {
          TableName: OPS_TABLE,
          Item: {
            PK: `TEAM#${teamId}`,
            SK: `ZONE#${zoneId}`,
            GSI1PK: `TEAM#${teamId}`,
            GSI1SK: `ZONE#${padOrder(zoneEntry.order)}#${zoneId}`,
            entityType: 'ZONE',
            id: zoneId,
            teamId,
            name: zoneEntry.name,
            zoneType: zoneEntry.zoneType,
            order: zoneEntry.order,
            createdAt: ts,
            updatedAt: ts,
          },
        },
      });

      let stageOrder = ORDER_GAP;
      for (const stage of zoneEntry.stages) {
        const stageId = randomUUID();

        // First stage in the default zone becomes the defaultStageId
        if (zoneId === defaultZoneId && !defaultStageId) {
          defaultStageId = stageId;
        }

        transactItems.push({
          Put: {
            TableName: OPS_TABLE,
            Item: {
              PK: `TEAM#${teamId}`,
              SK: `STAGE#${stageId}`,
              GSI1PK: `TEAM#${teamId}`,
              GSI1SK: `ZONE#${zoneId}#STAGE#${padOrder(stageOrder)}#${stageId}`,
              entityType: 'STAGE',
              id: stageId,
              teamId,
              zoneId,
              name: stage.name,
              order: stageOrder,
              statusType: stage.statusType,
              createdAt: ts,
              updatedAt: ts,
            },
          },
        });
        stageOrder += ORDER_GAP;
      }
    }

    teamMetaItem.defaultStageId = defaultStageId;
    transactItems.unshift({ Put: { TableName: OPS_TABLE, Item: teamMetaItem } });

    await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems as never }));

    return jsonResponse(201, { team: teamMetaItem });
  }

  // PUT /ops/teams/{teamId} — update team settings (admin or team owner)
  if (method === 'PUT' && segments.length === 1) {
    const teamId = segments[0];

    const metaResults = await queryByPK(`TEAM#${teamId}`, 'META');
    const meta = metaResults[0];
    if (!meta) return errorResponse(404, 'Team not found');

    if (!isAdmin(auth) && !isTeamOwner(meta, auth)) return errorResponse(403, 'Admin or team owner access required');

    const updated: Record<string, unknown> = {
      ...meta,
      ...body,
      PK: meta.PK,
      SK: meta.SK,
      GSI1PK: meta.GSI1PK,
      GSI1SK: meta.GSI1SK,
      id: teamId,
      updatedAt: now(),
    };
    await putItem(updated);
    return jsonResponse(200, { team: updated });
  }

  // DELETE /ops/teams/{teamId} — (admin or team owner)
  if (method === 'DELETE' && segments.length === 1) {
    const teamId = segments[0];

    // Find team meta first for ownership check
    const metaResults = await queryByPK(`TEAM#${teamId}`, 'META');
    const meta = metaResults[0];
    if (!meta) return errorResponse(404, 'Team not found');

    if (!isAdmin(auth) && !isTeamOwner(meta, auth)) return errorResponse(403, 'Admin or team owner access required');

    const tickets = await queryByPK(`TEAM#${teamId}`, 'TICKET#');
    const activeTickets = tickets.filter((t) => t.statusType !== 'deleted');
    if (activeTickets.length > 0) {
      return errorResponse(409, 'Cannot delete team with active tickets');
    }

    // Delete all team items (zones, stages, tickets, etc.)
    const teamItems = await queryByPK(`TEAM#${teamId}`);
    const deleteOps = teamItems.map((item) => deleteItem(String(item.PK), String(item.SK)));
    await Promise.all(deleteOps);

    return jsonResponse(200, { deleted: true });
  }

  // PUT /ops/teams/{teamId}/zones — batch update zones (admin or team owner)
  if (method === 'PUT' && segments.length === 2 && segments[1] === 'zones') {
    const teamId = segments[0];
    const teamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (!teamMeta) return errorResponse(404, 'Team not found');
    if (!isAdmin(auth) && !isTeamOwner(teamMeta, auth))
      return errorResponse(403, 'Admin or team owner access required');
    const zones = body.zones;
    if (!Array.isArray(zones)) return errorResponse(400, 'Missing required field: zones (array)');

    const ts = now();
    const ops = zones.map((zone: Record<string, unknown>) => {
      const zoneId = zone.id ? String(zone.id) : randomUUID();
      const order = typeof zone.order === 'number' ? zone.order : ORDER_GAP;
      return putItem({
        PK: `TEAM#${teamId}`,
        SK: `ZONE#${zoneId}`,
        GSI1PK: `TEAM#${teamId}`,
        GSI1SK: `ZONE#${padOrder(order as number)}#${zoneId}`,
        entityType: 'ZONE',
        id: zoneId,
        teamId,
        name: zone.name ? String(zone.name) : 'Unnamed Zone',
        zoneType: zone.zoneType ? String(zone.zoneType) : 'board',
        order,
        color: zone.color ? String(zone.color) : '#6B7280',
        createdAt: zone.createdAt ? String(zone.createdAt) : ts,
        updatedAt: ts,
      });
    });
    await Promise.all(ops);
    return jsonResponse(200, { updated: true });
  }

  // DELETE /ops/teams/{teamId}/zones/{zoneId} — delete a zone (admin or team owner)
  if (method === 'DELETE' && segments.length === 3 && segments[1] === 'zones') {
    const teamId = segments[0];
    const teamMetaForZoneDel = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (!teamMetaForZoneDel) return errorResponse(404, 'Team not found');
    if (!isAdmin(auth) && !isTeamOwner(teamMetaForZoneDel, auth))
      return errorResponse(403, 'Admin or team owner access required');
    const zoneId = segments[2];

    // Load team items to validate
    const teamItems = await queryGSI1(`TEAM#${teamId}`);
    const allZones = teamItems.items.filter((i) => String(i.SK ?? '').startsWith('ZONE#'));
    if (allZones.length <= 1) return errorResponse(400, 'Cannot delete the last zone');

    const zoneToDelete = allZones.find((z) => String(z.id) === zoneId);
    if (!zoneToDelete) return errorResponse(404, 'Zone not found');

    // Check for active tickets in this zone
    const ticketItems = await queryByPK(`TEAM#${teamId}`, 'TICKET#');
    const activeTicketsInZone = ticketItems.filter(
      (t) => String(t.zoneId) === zoneId && String(t.statusType) !== 'deleted'
    );
    if (activeTicketsInZone.length > 0) {
      return errorResponse(409, 'Cannot delete zone with active tickets. Move or delete them first.');
    }

    // Delete the zone and all its stages
    const stagesToDelete = teamItems.items.filter(
      (i) => String(i.SK ?? '').startsWith('STAGE#') && String(i.zoneId) === zoneId
    );
    const deleteOps = [
      deleteItem(`TEAM#${teamId}`, `ZONE#${zoneId}`),
      ...stagesToDelete.map((s) => deleteItem(`TEAM#${teamId}`, String(s.SK))),
    ];
    await Promise.all(deleteOps);
    return jsonResponse(200, { deleted: true });
  }

  // PUT /ops/teams/{teamId}/stages — batch update stages (admin or team owner)
  if (method === 'PUT' && segments.length === 2 && segments[1] === 'stages') {
    const teamId = segments[0];
    const teamMetaForStages = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (!teamMetaForStages) return errorResponse(404, 'Team not found');
    if (!isAdmin(auth) && !isTeamOwner(teamMetaForStages, auth))
      return errorResponse(403, 'Admin or team owner access required');
    const stages = body.stages;
    if (!Array.isArray(stages)) return errorResponse(400, 'Missing required field: stages (array)');

    // Load zones to validate status types
    const teamItems = await queryGSI1(`TEAM#${teamId}`);
    const zoneMap = new Map<string, string>();
    for (const item of teamItems.items) {
      if (String(item.SK ?? '').startsWith('ZONE#') && item.id && item.zoneType) {
        zoneMap.set(String(item.id), String(item.zoneType));
      }
    }

    // Validate each stage's statusType against its zone
    for (const stage of stages as Record<string, unknown>[]) {
      const zoneId = stage.zoneId ? String(stage.zoneId) : '';
      const statusType = stage.statusType ? String(stage.statusType) : 'backlog';
      const zoneType = zoneMap.get(zoneId) as ZoneType | undefined;
      if (zoneType && !isStatusTypeAllowedInZone(statusType as StatusType, zoneType)) {
        return errorResponse(
          400,
          `Status type '${statusType}' is not allowed in '${zoneType}' zone. Allowed: ${ZONE_STATUS_TYPES[zoneType].join(', ')}`
        );
      }
    }

    const ts = now();
    const ops = stages.map((stage: Record<string, unknown>) => {
      const stageId = stage.id ? String(stage.id) : randomUUID();
      const zoneId = stage.zoneId ? String(stage.zoneId) : '';
      const order = typeof stage.order === 'number' ? stage.order : ORDER_GAP;
      return putItem({
        PK: `TEAM#${teamId}`,
        SK: `STAGE#${stageId}`,
        GSI1PK: `TEAM#${teamId}`,
        GSI1SK: `ZONE#${zoneId}#STAGE#${padOrder(order as number)}#${stageId}`,
        entityType: 'STAGE',
        id: stageId,
        teamId,
        zoneId,
        name: stage.name ? String(stage.name) : 'Unnamed Stage',
        order,
        statusType: stage.statusType ? String(stage.statusType) : 'backlog',
        createdAt: stage.createdAt ? String(stage.createdAt) : ts,
        updatedAt: ts,
      });
    });
    await Promise.all(ops);
    return jsonResponse(200, { updated: true });
  }

  // GET /ops/teams/{teamId}/work-units — list work units for a team
  if (method === 'GET' && segments.length === 2 && segments[1] === 'work-units') {
    const teamId = segments[0];
    const { items } = await queryGSI1(`TEAM#${teamId}`, 'WORKUNIT#');
    return jsonResponse(200, { workUnits: items });
  }

  // POST /ops/teams/{teamId}/work-units — create work unit
  if (method === 'POST' && segments.length === 2 && segments[1] === 'work-units') {
    const teamId = segments[0];
    const wuTeamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (!wuTeamMeta) return errorResponse(404, 'Team not found');
    if (!isAdmin(auth) && !isTeamOwner(wuTeamMeta, auth))
      return errorResponse(403, 'Admin or team owner access required');
    const { name, goal, startDate, endDate, status, capacity } = body;
    if (!name) return errorResponse(400, 'Missing required field: name');

    const id = randomUUID();
    const ts = now();
    const unitStatus = status ? String(status) : 'planning';
    const existingUnits = await queryGSI1(`TEAM#${teamId}`, 'WORKUNIT#');
    const order = (existingUnits.items.length + 1) * ORDER_GAP;

    const item: Record<string, unknown> = {
      PK: `TEAM#${teamId}`,
      SK: `WORKUNIT#${id}`,
      GSI1PK: `TEAM#${teamId}`,
      GSI1SK: `WORKUNIT#STATUS#${unitStatus}#${padOrder(order)}`,
      entityType: 'WORK_UNIT',
      id,
      teamId,
      name: String(name),
      goal: goal ? String(goal) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      status: unitStatus,
      capacity: typeof capacity === 'number' ? capacity : undefined,
      order,
      createdBy: auth.sub,
      createdAt: ts,
      updatedAt: ts,
    };
    await putItem(item);
    return jsonResponse(201, { workUnit: item });
  }

  // PUT /ops/teams/{teamId}/work-units/{id} — update work unit
  if (method === 'PUT' && segments.length === 3 && segments[1] === 'work-units') {
    const teamId = segments[0];
    const id = segments[2];
    const existing = await getItem(`TEAM#${teamId}`, `WORKUNIT#${id}`);
    if (!existing) return errorResponse(404, 'Work unit not found');

    const prevStatus = String(existing.status ?? 'planning');
    const unitStatus = body.status ? String(body.status) : prevStatus;
    const order = typeof body.order === 'number' ? body.order : ((existing.order as number) ?? ORDER_GAP);

    // ── Sprint Activation: planning → active ──────────────────────────────
    let movedCount = 0;
    let ticketCountAtStart = 0;
    if (prevStatus === 'planning' && unitStatus === 'active') {
      // Enforce single active sprint
      const allUnits = await queryGSI1(`TEAM#${teamId}`, 'WORKUNIT#STATUS#active#');
      if (allUnits.items.length > 0) {
        return errorResponse(409, 'Another sprint is already active. Complete it first.');
      }

      // Load team zones and stages to find the target (first board zone, first stage)
      const teamItems = await queryGSI1(`TEAM#${teamId}`);
      const zones = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('ZONE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
      const stages = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('STAGE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

      const backlogZoneIds = new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => String(z.id)));
      const boardZone = zones.find((z) => z.zoneType === 'board');

      // Count total tickets assigned to this sprint at activation
      const activationIndexItems = await queryGSI2(`WORKUNIT#${id}`, 'TICKET#');
      ticketCountAtStart = activationIndexItems.items.filter(
        (idx) => String(idx.entityType ?? '') === 'TICKET_INDEX'
      ).length;

      if (boardZone) {
        const boardZoneId = String(boardZone.id);
        const firstKanbanStage = stages.find((s) => String(s.zoneId) === boardZoneId);

        if (firstKanbanStage) {
          const targetStageId = String(firstKanbanStage.id);
          const targetStatusType = String(firstKanbanStage.statusType ?? 'queued');

          // Find all tickets assigned to this sprint that are in backlog zones
          // GSI2 returns TICKET_INDEX items — resolve to actual ticket entities
          const sprintTicketEntities = (
            await Promise.all(
              activationIndexItems.items
                .filter((idx) => String(idx.entityType ?? '') === 'TICKET_INDEX')
                .map((idx) => getItem(`TEAM#${String(idx.teamId)}`, `TICKET#${String(idx.ticketId)}`))
            )
          ).filter(Boolean) as Record<string, unknown>[];
          const ticketsToMove = sprintTicketEntities.filter((t) => backlogZoneIds.has(String(t.zoneId)));

          // Batch-update tickets to move to the board zone
          const ts = now();
          for (const ticket of ticketsToMove) {
            const ticketId = String(ticket.id);
            const ticketOrder = (ticket.order as number) ?? ORDER_GAP;
            const updatedTicket: Record<string, unknown> = {
              ...ticket,
              zoneId: boardZoneId,
              stageId: targetStageId,
              statusType: targetStatusType,
              startedAt: ticket.startedAt ?? ts,
              GSI1SK: `STAGE#${targetStageId}#ORDER#${padOrder(ticketOrder)}#${ticketId}`,
              updatedAt: ts,
            };
            await putItem(updatedTicket);
          }
          movedCount = ticketsToMove.length;
        }
      }
    }

    // ── Sprint Completion: active → completed ─────────────────────────────
    let rolloverCount = 0;
    let completedCount = 0;
    let incompleteCount = 0;
    let addedDuringSprint = 0;
    if (prevStatus === 'active' && unitStatus === 'completed') {
      // Load team zones to find the backlog zone
      const teamItems = await queryGSI1(`TEAM#${teamId}`);
      const zones = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('ZONE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
      const stages = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('STAGE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

      const backlogZone = zones.find((z) => z.zoneType === 'backlog') ?? zones[0];
      const backlogZoneId = backlogZone ? String(backlogZone.id) : undefined;
      const firstBacklogStage = backlogZoneId ? stages.find((s) => String(s.zoneId) === backlogZoneId) : undefined;

      // Find all tickets for this sprint via GSI2 index items, then resolve to entities
      const sprintIndexItems = await queryGSI2(`WORKUNIT#${id}`, 'TICKET#');
      const allSprintTickets = (
        await Promise.all(
          sprintIndexItems.items
            .filter((idx) => String(idx.entityType ?? '') === 'TICKET_INDEX')
            .map((idx) => getItem(`TEAM#${String(idx.teamId)}`, `TICKET#${String(idx.ticketId)}`))
        )
      ).filter(Boolean) as Record<string, unknown>[];

      const incompleteTickets = allSprintTickets.filter(
        (t) => t.statusType !== 'completed' && t.statusType !== 'ended'
      );
      const doneTickets = allSprintTickets.filter((t) => t.statusType === 'completed' || t.statusType === 'ended');

      // Sprint metadata
      completedCount = doneTickets.length;
      incompleteCount = incompleteTickets.length;
      const startCount = (existing.ticketCountAtStart as number) ?? 0;
      addedDuringSprint = startCount > 0 ? Math.max(0, allSprintTickets.length - startCount) : 0;

      // Archive completed/ended tickets
      if (doneTickets.length > 0) {
        const ts = now();
        for (const ticket of doneTickets) {
          await putItem({
            ...ticket,
            archived: true,
            updatedAt: ts,
          });
        }
      }

      if (incompleteTickets.length > 0 && backlogZoneId && firstBacklogStage) {
        const targetStageId = String(firstBacklogStage.id);
        const targetStatusType = String(firstBacklogStage.statusType ?? 'backlog');
        const rolloverToWorkUnitId = body.rolloverToWorkUnitId ? String(body.rolloverToWorkUnitId) : undefined;

        // Resolve 'next' sentinel to the next planning sprint
        let resolvedRolloverWuId: string | undefined;
        if (rolloverToWorkUnitId === 'next') {
          const allUnits = await queryGSI1(`TEAM#${teamId}`, 'WORKUNIT#STATUS#planning#');
          const nextPlanning = allUnits.items.sort(
            (a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0)
          )[0];
          resolvedRolloverWuId = nextPlanning ? String(nextPlanning.id) : undefined;
        } else if (rolloverToWorkUnitId) {
          resolvedRolloverWuId = rolloverToWorkUnitId;
        }

        const ts = now();
        for (const ticket of incompleteTickets) {
          const ticketId = String(ticket.id);
          const ticketOrder = (ticket.order as number) ?? ORDER_GAP;
          const updatedTicket: Record<string, unknown> = {
            ...ticket,
            zoneId: backlogZoneId,
            stageId: targetStageId,
            statusType: targetStatusType,
            workUnitId: resolvedRolloverWuId ?? null,
            GSI1SK: `STAGE#${targetStageId}#ORDER#${padOrder(ticketOrder)}#${ticketId}`,
            updatedAt: ts,
          };
          await putItem(updatedTicket);

          // Update the work unit index item
          if (resolvedRolloverWuId) {
            // Delete old index, create new one
            try {
              await deleteItem(`TEAM#${teamId}`, `TICKET#${ticketId}#IDX_WORKUNIT`);
            } catch {
              /* may not exist */
            }
            await putItem({
              PK: `TEAM#${teamId}`,
              SK: `TICKET#${ticketId}#IDX_WORKUNIT`,
              GSI2PK: `WORKUNIT#${resolvedRolloverWuId}`,
              GSI2SK: `TICKET#${ts}#${ticketId}`,
              entityType: 'TICKET_INDEX',
              indexType: 'IDX_WORKUNIT',
              ticketId,
              teamId,
              workUnitId: resolvedRolloverWuId,
            });
          } else {
            // Clear work unit - delete the index
            try {
              await deleteItem(`TEAM#${teamId}`, `TICKET#${ticketId}#IDX_WORKUNIT`);
            } catch {
              /* may not exist */
            }
          }
        }
        rolloverCount = incompleteTickets.length;
      }
    }

    // Update the work unit itself
    const updated: Record<string, unknown> = {
      ...existing,
      ...body,
      PK: `TEAM#${teamId}`,
      SK: `WORKUNIT#${id}`,
      GSI1PK: `TEAM#${teamId}`,
      GSI1SK: `WORKUNIT#STATUS#${unitStatus}#${padOrder(order)}`,
      id,
      teamId,
      status: unitStatus,
      order,
      updatedAt: now(),
    };

    // Sprint metadata: snapshot counts at activation and completion
    if (prevStatus === 'planning' && unitStatus === 'active') {
      updated.startedAt = now();
      updated.ticketCountAtStart = ticketCountAtStart;
    }
    if (prevStatus === 'active' && unitStatus === 'completed') {
      updated.completedAt = now();
      updated.ticketCountAtEnd = completedCount + incompleteCount;
      updated.completedCount = completedCount;
      updated.incompleteCount = incompleteCount;
      updated.addedDuringSprint = addedDuringSprint;
    }

    await putItem(updated);

    return jsonResponse(200, { workUnit: updated, movedCount, rolloverCount });
  }

  // DELETE /ops/teams/{teamId}/work-units/{id} — delete a planning work unit
  if (method === 'DELETE' && segments.length === 3 && segments[1] === 'work-units') {
    const teamId = segments[0];
    const wuDelTeamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (!wuDelTeamMeta) return errorResponse(404, 'Team not found');
    if (!isAdmin(auth) && !isTeamOwner(wuDelTeamMeta, auth))
      return errorResponse(403, 'Admin or team owner access required');
    const id = segments[2];
    const existing = await getItem(`TEAM#${teamId}`, `WORKUNIT#${id}`);
    if (!existing) return errorResponse(404, 'Work unit not found');
    if (String(existing.status) !== 'planning') {
      return errorResponse(409, 'Only planning sprints can be deleted');
    }

    // Un-assign any tickets linked to this work unit
    const sprintTickets = await queryGSI2(`WORKUNIT#${id}`, 'TICKET#');
    const ts = now();
    for (const item of sprintTickets.items) {
      if (String(item.entityType ?? '') === 'TICKET') {
        const ticket = item;
        await putItem({
          ...ticket,
          workUnitId: null,
          updatedAt: ts,
        });
        // Remove the work unit index entry
        try {
          await deleteItem(`TEAM#${teamId}`, `TICKET#${String(ticket.id)}#IDX_WORKUNIT`);
        } catch {
          /* index may not exist */
        }
      }
    }

    await deleteItem(`TEAM#${teamId}`, `WORKUNIT#${id}`);
    return jsonResponse(200, { deleted: true });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Tickets ────────────────────────────────────────────────────────────────────

const getNextDisplayId = async (prefix: string): Promise<{ displayId: string; sequence: number }> => {
  const result = await dynamo.send(
    new UpdateCommand({
      TableName: OPS_TABLE,
      Key: { PK: 'PREFIX', SK: prefix },
      UpdateExpression: 'ADD nextSequence :inc',
      ExpressionAttributeValues: { ':inc': 1 },
      ReturnValues: 'ALL_NEW',
    })
  );
  const seq = (result.Attributes?.nextSequence as number) ?? 1;
  const displayId = `${prefix}-${String(seq).padStart(3, '0')}`;
  return { displayId, sequence: seq };
};

const getLastTicketOrder = async (teamId: string, stageId: string): Promise<number> => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: OPS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':sk': `STAGE#${stageId}#ORDER#`,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  const last = (result.Items ?? [])[0];
  if (!last) return 0;
  return (last.order as number) ?? 0;
};

const resolveTicketTypePrefix = async (ticketTypeId: string): Promise<string> => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: OPS_CONFIG_TABLE,
      Key: { PK: 'CONFIG', SK: `TICKET_TYPE#${ticketTypeId}` },
    })
  );
  const item = result.Item;
  if (!item || !item.prefix) return 'TKT';
  return String(item.prefix);
};

const buildTicketIndexItems = (
  teamId: string,
  ticketId: string,
  assigneeId: string | undefined,
  customerId: string | undefined,
  workUnitId: string | undefined,
  projectId: string | undefined,
  updatedAt: string
): Record<string, unknown>[] => {
  const items: Record<string, unknown>[] = [];

  if (assigneeId) {
    items.push({
      PK: `TEAM#${teamId}`,
      SK: `TICKET#${ticketId}#IDX_ASSIGNEE`,
      GSI2PK: `ASSIGNEE#${assigneeId}`,
      GSI2SK: `TICKET#${updatedAt}#${ticketId}`,
      entityType: 'TICKET_INDEX',
      indexType: 'IDX_ASSIGNEE',
      ticketId,
      teamId,
      assigneeId,
    });
  }

  if (customerId) {
    items.push({
      PK: `TEAM#${teamId}`,
      SK: `TICKET#${ticketId}#IDX_CUSTOMER`,
      GSI2PK: `CUSTOMER#${customerId}`,
      GSI2SK: `TICKET#${updatedAt}#${ticketId}`,
      entityType: 'TICKET_INDEX',
      indexType: 'IDX_CUSTOMER',
      ticketId,
      teamId,
      customerId,
    });
  }

  if (workUnitId) {
    items.push({
      PK: `TEAM#${teamId}`,
      SK: `TICKET#${ticketId}#IDX_WORKUNIT`,
      GSI2PK: `WORKUNIT#${workUnitId}`,
      GSI2SK: `TICKET#${updatedAt}#${ticketId}`,
      entityType: 'TICKET_INDEX',
      indexType: 'IDX_WORKUNIT',
      ticketId,
      teamId,
      workUnitId,
    });
  }

  if (projectId) {
    items.push({
      PK: `TEAM#${teamId}`,
      SK: `TICKET#${ticketId}#IDX_PROJECT`,
      GSI2PK: `PROJECT#${projectId}`,
      GSI2SK: `TICKET#${updatedAt}#${ticketId}`,
      entityType: 'TICKET_INDEX',
      indexType: 'IDX_PROJECT',
      ticketId,
      teamId,
      projectId,
    });
  }

  return items;
};

const handleTickets = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext,
  event: APIGatewayProxyEventV2
): Promise<ReturnType<typeof jsonResponse>> => {
  const qp = event.queryStringParameters ?? {};

  // ── Audit sub-routes ─────────────────────────────────────────────────────────
  // GET /ops/tickets/{ticketId}/audit
  if (method === 'GET' && segments.length === 2 && segments[1] === 'audit') {
    const ticketId = segments[0];
    const items = await queryByPK(`TICKET#${ticketId}`, 'AUDIT#');
    // Sort reverse chronological (newest first) — SK is AUDIT#{timestamp}#{id}
    items.sort((a, b) => String(b.SK).localeCompare(String(a.SK)));
    const entries = items.map((item) => ({
      id: item.auditId,
      ticketId: item.ticketId,
      teamId: item.teamId ?? '',
      userId: item.performedBy,
      userName: item.performedByName ?? item.performedByEmail ?? '',
      action: item.action,
      changes: item.changes ?? {},
      timestamp: item.createdAt,
    }));
    return jsonResponse(200, { entries });
  }

  // ── Comments sub-routes ─────────────────────────────────────────────────────
  // GET /ops/tickets/{ticketId}/comments
  if (method === 'GET' && segments.length === 2 && segments[1] === 'comments') {
    const ticketId = segments[0];
    const items = await queryByPK(`TICKET#${ticketId}`, 'COMMENT#');
    return jsonResponse(200, { comments: items });
  }

  // POST /ops/tickets/{ticketId}/comments
  if (method === 'POST' && segments.length === 2 && segments[1] === 'comments') {
    const ticketId = segments[0];
    const { content, attachments } = body;
    if (!content) return errorResponse(400, 'Missing required field: content');

    const commentId = randomUUID();
    const ts = now();
    const commentItem: Record<string, unknown> = {
      PK: `TICKET#${ticketId}`,
      SK: `COMMENT#${ts}#${commentId}`,
      entityType: 'COMMENT',
      commentId,
      ticketId,
      content: String(content),
      attachments: Array.isArray(attachments) ? attachments : undefined,
      authorId: auth.sub,
      authorEmail: auth.email,
      authorName: auth.name || (auth.email ? auth.email.split('@')[0] : 'Unknown'),
      createdAt: ts,
      updatedAt: ts,
    };
    await putItem(commentItem);

    // Parse mentions and send emails
    const mentions = new Set<string>();
    const contentStr = String(content);
    const mentionRegex = /<span[^>]*data-sub="([^"]+)"[^>]*>/g;
    let match;
    while ((match = mentionRegex.exec(contentStr)) !== null) {
      if (match[1] !== auth.sub) {
        mentions.add(match[1]);
      }
    }

    if (mentions.size > 0 && process.env.EMAIL_SENDER_LAMBDA_ARN) {
      try {
        const staffResp = await dynamo.send(
          new QueryCommand({
            TableName: process.env.OPS_CONFIG_TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': 'CONFIG', ':sk': 'STAFF#' },
          })
        );
        const staffList = staffResp.Items ?? [];

        const origin =
          event.headers.origin ??
          (event.headers.referer ? event.headers.referer.replace(/\/$/, '') : `https://${event.headers.host}`);
        const ticketUrl = `${origin}/ops?ticketId=${ticketId}`;

        const authorStaff = staffList.find((s) => s.id === auth.sub || s.SK === `STAFF#${auth.sub}`);
        const authorName = authorStaff?.name;
        const authorEmail = authorStaff?.email;
        const displayAuthor = authorName
          ? String(authorName)
          : authorEmail
            ? String(authorEmail).split('@')[0]
            : 'Someone';

        for (const sub of mentions) {
          const mentionedStaff = staffList.find((s) => s.id === sub || s.SK === `STAFF#${sub}`);
          if (mentionedStaff && mentionedStaff.email) {
            const emailPayload = {
              sts_proof_url: await generateStsProofUrl(),
              client_name: process.env.CLIENT_NAME || 'unknown',
              to: [mentionedStaff.email],
              template: 'generic',
              template_data: {
                subject: `${displayAuthor} mentioned you in Ops Ticket #${ticketId.split('-')[0] || ticketId.slice(0, 8)}`,
                title: 'You Were Mentioned',
                body_html: `<p>You were mentioned in a comment by <strong>${displayAuthor}</strong>:</p>
                            <blockquote style="border-left: 4px solid #ccc; padding-left: 1rem; color: #555; margin-left: 0; word-break: break-word;">
                              ${contentStr}
                            </blockquote>
                            <p><a href="${ticketUrl}" style="display: inline-block; padding: 10px 20px; background-color: #0d6efd; color: white; text-decoration: none; border-radius: 5px;">View Ticket</a></p>`,
                body_text: `You were mentioned in a comment by ${displayAuthor}: ${contentStr}\nView Ticket: ${ticketUrl}`,
                primary_color: '#0d6efd',
              },
            };

            const emailLambdaClient = withPRM(LambdaClient, { region: 'us-east-1' });
            await emailLambdaClient.send(
              new InvokeCommand({
                FunctionName: process.env.EMAIL_SENDER_LAMBDA_ARN,
                InvocationType: 'Event',
                Payload: Buffer.from(JSON.stringify(emailPayload)),
              })
            );
          }
        }
      } catch (err) {
        console.error('Failed to process mentions', err);
      }
    }

    // Increment commentCount on the ticket — need to find the ticket first
    const ticketItems = await queryByPK(`TEAM#${String(body.teamId ?? '')}`, `TICKET#${ticketId}`);
    // Fallback: scan for ticket by looking at GSI3
    let ticket = ticketItems.find((t) => String(t.SK) === `TICKET#${ticketId}`);
    if (!ticket) {
      const found = await queryGSI3(`TID#${String(body.displayId ?? '')}`, 'TICKET');
      ticket = found;
    }
    if (ticket) {
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: OPS_TABLE,
            Key: { PK: String(ticket.PK), SK: String(ticket.SK) },
            UpdateExpression: 'ADD commentCount :inc',
            ExpressionAttributeValues: { ':inc': 1 },
          })
        );
      } catch (e) {
        console.warn('Failed to increment commentCount', (e as Error).message);
      }
    }

    return jsonResponse(201, { comment: commentItem });
  }

  // PUT /ops/tickets/{ticketId}/comments/{commentId}
  if (method === 'PUT' && segments.length === 3 && segments[1] === 'comments') {
    const ticketId = segments[0];
    const commentId = segments[2];
    // Find the comment
    const comments = await queryByPK(`TICKET#${ticketId}`, 'COMMENT#');
    const existing = comments.find((c) => c.commentId === commentId);
    if (!existing) return errorResponse(404, 'Comment not found');

    const updated: Record<string, unknown> = {
      ...existing,
      content: body.content ? String(body.content) : existing.content,
      attachments: Array.isArray(body.attachments) ? body.attachments : existing.attachments,
      updatedAt: now(),
      edited: true,
    };
    await putItem(updated);
    return jsonResponse(200, { comment: updated });
  }

  // DELETE /ops/tickets/{ticketId}/comments/{commentId}
  if (method === 'DELETE' && segments.length === 3 && segments[1] === 'comments') {
    const ticketId = segments[0];
    const commentId = segments[2];
    const comments = await queryByPK(`TICKET#${ticketId}`, 'COMMENT#');
    const existing = comments.find((c) => c.commentId === commentId);
    if (!existing) return errorResponse(404, 'Comment not found');

    await deleteItem(String(existing.PK), String(existing.SK));

    // Decrement commentCount — find ticket via body.teamId or best-effort
    if (body.teamId) {
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: OPS_TABLE,
            Key: { PK: `TEAM#${String(body.teamId)}`, SK: `TICKET#${ticketId}` },
            UpdateExpression: 'ADD commentCount :dec',
            ExpressionAttributeValues: { ':dec': -1 },
          })
        );
      } catch (e) {
        console.warn('Failed to decrement commentCount', (e as Error).message);
      }
    }

    return jsonResponse(200, { deleted: true });
  }

  // ── Links sub-routes ────────────────────────────────────────────────────────
  // POST /ops/tickets/{ticketId}/links
  if (method === 'POST' && segments.length === 2 && segments[1] === 'links') {
    const ticketId = segments[0];
    const { linkedTicketId, linkedTicketDisplayId, linkedTicketTitle, linkType } = body;
    if (!linkedTicketId || !linkedTicketDisplayId || !linkType)
      return errorResponse(400, 'Missing required fields: linkedTicketId, linkedTicketDisplayId, linkType');

    const lt = String(linkType);
    const inverse = LINK_INVERSE[lt];
    if (!inverse) return errorResponse(400, `Invalid linkType: ${lt}`);

    const linkedId = String(linkedTicketId);
    const linkedDisplayId = String(linkedTicketDisplayId);
    const linkedTitle = linkedTicketTitle ? String(linkedTicketTitle) : undefined;
    const ts = now();

    // Look up source ticket's displayId for the inverse link record
    const srcTeamId = body.teamId ? String(body.teamId) : undefined;
    const linkedTeamId = body.linkedTeamId ? String(body.linkedTeamId) : srcTeamId;

    let srcDisplayId: string | undefined;
    let srcTitle: string | undefined;
    if (srcTeamId) {
      const srcTicket = await getItem(`TEAM#${srcTeamId}`, `TICKET#${ticketId}`);
      if (srcTicket) {
        srcDisplayId = srcTicket.displayId ? String(srcTicket.displayId) : undefined;
        srcTitle = srcTicket.title ? String(srcTicket.title) : undefined;
      }
    }

    const transactItems: Record<string, unknown>[] = [
      {
        Put: {
          TableName: OPS_TABLE,
          Item: {
            PK: `TICKET#${ticketId}`,
            SK: `LINK#${lt}#${linkedId}`,
            entityType: 'LINK',
            ticketId,
            linkedTicketId: linkedId,
            linkedTicketDisplayId: linkedDisplayId,
            linkedTicketTitle: linkedTitle,
            linkType: lt,
            createdBy: auth.sub,
            createdAt: ts,
          },
        },
      },
      {
        Put: {
          TableName: OPS_TABLE,
          Item: {
            PK: `TICKET#${linkedId}`,
            SK: `LINK#${inverse}#${ticketId}`,
            entityType: 'LINK',
            ticketId: linkedId,
            linkedTicketId: ticketId,
            linkedTicketDisplayId: srcDisplayId,
            linkedTicketTitle: srcTitle,
            linkType: inverse,
            createdBy: auth.sub,
            createdAt: ts,
          },
        },
      },
    ];

    // Atomically increment linkCount on both tickets within the same transaction
    if (srcTeamId) {
      transactItems.push({
        Update: {
          TableName: OPS_TABLE,
          Key: { PK: `TEAM#${srcTeamId}`, SK: `TICKET#${ticketId}` },
          UpdateExpression: 'ADD linkCount :inc',
          ExpressionAttributeValues: { ':inc': 1 },
        },
      });
    }
    if (linkedTeamId) {
      transactItems.push({
        Update: {
          TableName: OPS_TABLE,
          Key: { PK: `TEAM#${linkedTeamId}`, SK: `TICKET#${linkedId}` },
          UpdateExpression: 'ADD linkCount :inc',
          ExpressionAttributeValues: { ':inc': 1 },
        },
      });
    }

    await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems as never }));

    return jsonResponse(201, { created: true });
  }

  // DELETE /ops/tickets/{ticketId}/links/{linkType}/{linkedTicketId}
  if (method === 'DELETE' && segments.length === 4 && segments[1] === 'links') {
    const ticketId = segments[0];
    const lt = segments[2];
    const linkedId = segments[3];
    const inverse = LINK_INVERSE[lt];
    if (!inverse) return errorResponse(400, `Invalid linkType: ${lt}`);

    const transactItems = [
      {
        Delete: {
          TableName: OPS_TABLE,
          Key: { PK: `TICKET#${ticketId}`, SK: `LINK#${lt}#${linkedId}` },
        },
      },
      {
        Delete: {
          TableName: OPS_TABLE,
          Key: { PK: `TICKET#${linkedId}`, SK: `LINK#${inverse}#${ticketId}` },
        },
      },
    ];

    await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems as never }));

    // Decrement linkCount (best-effort)
    if (body.teamId) {
      const teamId = String(body.teamId);
      const linkedTeamId = body.linkedTeamId ? String(body.linkedTeamId) : teamId;
      try {
        await Promise.all([
          dynamo.send(
            new UpdateCommand({
              TableName: OPS_TABLE,
              Key: { PK: `TEAM#${teamId}`, SK: `TICKET#${ticketId}` },
              UpdateExpression: 'ADD linkCount :dec',
              ExpressionAttributeValues: { ':dec': -1 },
            })
          ),
          dynamo.send(
            new UpdateCommand({
              TableName: OPS_TABLE,
              Key: { PK: `TEAM#${linkedTeamId}`, SK: `TICKET#${linkedId}` },
              UpdateExpression: 'ADD linkCount :dec',
              ExpressionAttributeValues: { ':dec': -1 },
            })
          ),
        ]);
      } catch (e) {
        console.warn('Failed to decrement linkCount', (e as Error).message);
      }
    }

    return jsonResponse(200, { deleted: true });
  }

  // ── Ticket by display ID ───────────────────────────────────────────────────
  // GET /ops/tickets/by-display-id/{displayId}
  if (method === 'GET' && segments.length === 2 && segments[0] === 'by-display-id') {
    const displayId = decodeURIComponent(segments[1]);
    const ticket = await queryGSI3(`TID#${displayId}`, 'TICKET');
    if (!ticket) return errorResponse(404, 'Ticket not found');
    // Fetch links and recent comments
    const ticketId = String(ticket.id);
    const [links, comments] = await Promise.all([
      queryByPK(`TICKET#${ticketId}`, 'LINK#'),
      queryByPK(`TICKET#${ticketId}`, 'COMMENT#'),
    ]);
    return jsonResponse(200, {
      ticket,
      links,
      comments: comments.slice(-20),
    });
  }

  // ── Bulk update ────────────────────────────────────────────────────────────
  // POST /ops/tickets/bulk
  if (method === 'POST' && segments.length === 1 && segments[0] === 'bulk') {
    const { ticketIds, changes } = body;
    if (!Array.isArray(ticketIds) || !changes) return errorResponse(400, 'Missing required fields: ticketIds, changes');

    const ts = now();
    const results: Record<string, unknown>[] = [];

    for (const tid of ticketIds as string[]) {
      const teamId = String((changes as Record<string, unknown>).teamId ?? '');
      const existing = await getItem(`TEAM#${teamId}`, `TICKET#${tid}`);
      if (!existing) {
        results.push({ ticketId: tid, error: 'not found' });
        continue;
      }

      const changesObj = changes as Record<string, unknown>;

      // Derive statusType from stage when stageId changes
      let derivedStatusType: string | undefined;
      if (changesObj.stageId && String(changesObj.stageId) !== String(existing.stageId)) {
        const targetStage = await getItem(`TEAM#${teamId}`, `STAGE#${String(changesObj.stageId)}`);
        if (targetStage?.statusType) derivedStatusType = String(targetStage.statusType);
      }

      const updated: Record<string, unknown> = {
        ...existing,
        ...changesObj,
        PK: existing.PK,
        SK: existing.SK,
        id: tid,
        ...(derivedStatusType ? { statusType: derivedStatusType } : {}),
        version: ((existing.version as number) ?? 0) + 1,
        updatedAt: ts,
        updatedBy: auth.sub,
      };

      // Recompute GSI1SK if stageId or order changed
      const stageId = String(updated.stageId ?? existing.stageId ?? '');
      const order = typeof updated.order === 'number' ? updated.order : ((existing.order as number) ?? 0);
      updated.GSI1SK = `STAGE#${stageId}#ORDER#${padOrder(order)}#${tid}`;

      await putItem(updated);
      results.push({ ticketId: tid, success: true });
    }

    return jsonResponse(200, { results });
  }

  // ── GET /ops/tickets — list tickets (with access check) ─────────────────────
  if (method === 'GET' && segments.length === 0) {
    const teamId = qp.teamId;
    if (!teamId) return errorResponse(400, 'Missing required query parameter: teamId');

    // Verify user has access to the team
    const teamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (teamMeta && !hasTeamAccess(teamMeta, auth)) {
      return errorResponse(403, 'You do not have access to this team');
    }

    const limit = qp.limit ? parseInt(qp.limit, 10) : undefined;
    const cursor = qp.cursor ? JSON.parse(decodeURIComponent(qp.cursor)) : undefined;

    // Cross-team lookups via GSI2
    // Helper to exclude soft-deleted tickets from GSI2 cross-team queries
    const excludeDeleted = (tickets: Record<string, unknown>[]): Record<string, unknown>[] =>
      tickets.filter((t) => t.statusType !== 'deleted');

    if (qp.assigneeId) {
      const { items, lastKey } = await queryGSI2(`ASSIGNEE#${qp.assigneeId}`, 'TICKET#', limit, cursor);
      return jsonResponse(200, {
        tickets: excludeDeleted(items),
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }
    if (qp.customerId) {
      const { items, lastKey } = await queryGSI2(`CUSTOMER#${qp.customerId}`, 'TICKET#', limit, cursor);
      return jsonResponse(200, {
        tickets: excludeDeleted(items),
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }
    if (qp.workUnitId) {
      const { items, lastKey } = await queryGSI2(`WORKUNIT#${qp.workUnitId}`, 'TICKET#', limit, cursor);
      return jsonResponse(200, {
        tickets: excludeDeleted(items),
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }
    if (qp.projectId) {
      const { items, lastKey } = await queryGSI2(`PROJECT#${qp.projectId}`, 'TICKET#', limit, cursor);
      return jsonResponse(200, {
        tickets: excludeDeleted(items),
        cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
      });
    }

    // Stage-specific view via GSI1
    const skPrefix = qp.stageId ? `STAGE#${qp.stageId}#ORDER#` : 'STAGE#';

    const { items, lastKey } = await queryGSI1(`TEAM#${teamId}`, skPrefix, limit, cursor);

    // Client-side filter for additional params
    let filtered = items.filter((i) => String(i.entityType ?? '') === 'TICKET');
    // Exclude soft-deleted tickets
    filtered = filtered.filter((t) => t.statusType !== 'deleted');
    // Exclude archived tickets by default
    if (qp.includeArchived !== 'true') {
      filtered = filtered.filter((t) => !t.archived);
    }
    if (qp.statusType) {
      filtered = filtered.filter((t) => t.statusType === qp.statusType);
    }
    if (qp.priority) {
      filtered = filtered.filter((t) => t.priority === qp.priority);
    }

    return jsonResponse(200, {
      tickets: filtered,
      cursor: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : undefined,
    });
  }

  // ── GET /ops/tickets/{ticketId} — get single ticket ─────────────────────────
  if (method === 'GET' && segments.length === 1) {
    const ticketId = segments[0];
    // We need to find the ticket; use GSI3 lookup with a scan over known boards
    // or the caller can provide teamId as query param
    const teamId = qp.teamId;
    let ticket: Record<string, unknown> | undefined;

    if (teamId) {
      ticket = await getItem(`TEAM#${teamId}`, `TICKET#${ticketId}`);
    }

    if (!ticket) {
      // Fallback: try to find via all boards (expensive, but works)
      // For efficiency, caller should provide teamId
      return errorResponse(400, 'Please provide teamId as query parameter for single ticket lookup');
    }

    // Fetch links and recent comments
    const [links, comments] = await Promise.all([
      queryByPK(`TICKET#${ticketId}`, 'LINK#'),
      queryByPK(`TICKET#${ticketId}`, 'COMMENT#'),
    ]);

    return jsonResponse(200, {
      ticket,
      links,
      comments: comments.slice(-20),
    });
  }

  // ── POST /ops/tickets — create ticket ───────────────────────────────────────
  if (method === 'POST' && segments.length === 0) {
    const {
      teamId: rawTeamId,
      stageId: rawStageId,
      zoneId: rawZoneId,
      ticketTypeId,
      title,
      description,
      priority,
      assigneeId,
      assigneeName,
      reporterId,
      reporterName,
      customerId,
      customerName,
      supplierId,
      supplierName,
      workUnitId,
      projectId,
      tags,
      fields,
      dueDate,
      effortPoints,
      sourceType,
      sourceId,
      sourceAppType,
    } = body;

    // Detect unknown parameters
    const knownCreateFields = new Set([
      'teamId',
      'stageId',
      'zoneId',
      'ticketTypeId',
      'title',
      'description',
      'priority',
      'assigneeId',
      'assigneeName',
      'reporterId',
      'reporterName',
      'customerId',
      'customerName',
      'supplierId',
      'supplierName',
      'workUnitId',
      'projectId',
      'tags',
      'fields',
      'dueDate',
      'effortPoints',
      'sourceType',
      'sourceId',
      'sourceAppType',
    ]);
    const unknownKeys = Object.keys(body).filter((k) => !knownCreateFields.has(k));

    if (!rawTeamId || !rawStageId || !title)
      return errorResponse(400, 'Missing required fields: teamId, stageId, title');

    const teamId = String(rawTeamId);

    // Verify user has access to create tickets in this team
    const createTeamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    if (createTeamMeta && !hasTeamAccess(createTeamMeta, auth)) {
      return errorResponse(403, 'You do not have access to this team');
    }

    const stageId = String(rawStageId);
    const ticketId = randomUUID();
    const ts = now();

    // Look up the stage to resolve zoneId and statusType
    const stageRecord = await getItem(`TEAM#${teamId}`, `STAGE#${stageId}`);
    if (!stageRecord) {
      return errorResponse(
        400,
        `Invalid stageId: '${stageId}' is not a valid stage for team '${teamId}'. Call get_team to retrieve valid stage IDs.`
      );
    }
    const zoneId = rawZoneId ? String(rawZoneId) : stageRecord?.zoneId ? String(stageRecord.zoneId) : undefined;
    const statusType = stageRecord?.statusType ? String(stageRecord.statusType) : 'backlog';

    // Resolve prefix from ticket type
    const prefix = ticketTypeId ? await resolveTicketTypePrefix(String(ticketTypeId)) : 'TKT';

    // Atomic display ID generation
    const { displayId } = await getNextDisplayId(prefix);

    // Gap-based ordering
    const lastOrder = await getLastTicketOrder(teamId, stageId);
    const order = lastOrder + ORDER_GAP;

    const ticketItem: Record<string, unknown> = {
      PK: `TEAM#${teamId}`,
      SK: `TICKET#${ticketId}`,
      GSI1PK: `TEAM#${teamId}`,
      GSI1SK: `STAGE#${stageId}#ORDER#${padOrder(order)}#${ticketId}`,
      GSI3PK: `TID#${displayId}`,
      GSI3SK: 'TICKET',
      entityType: 'TICKET',
      id: ticketId,
      displayId,
      teamId,
      zoneId,
      stageId,
      ticketTypeId: ticketTypeId ? String(ticketTypeId) : undefined,
      title: String(title),
      description: description ? String(description) : undefined,
      priority: priority ? String(priority) : 'medium',
      statusType,
      assigneeId: assigneeId ? String(assigneeId) : undefined,
      assigneeName: assigneeName ? String(assigneeName) : undefined,
      reporterId: reporterId ? String(reporterId) : auth.sub,
      reporterName: reporterName ? String(reporterName) : !reporterId ? auth.name : undefined,
      customerId: customerId ? String(customerId) : undefined,
      customerName: customerName ? String(customerName) : undefined,
      supplierId: supplierId ? String(supplierId) : undefined,
      supplierName: supplierName ? String(supplierName) : undefined,
      workUnitId: workUnitId ? String(workUnitId) : undefined,
      projectId: projectId ? String(projectId) : undefined,
      tags: Array.isArray(tags) ? tags : [],
      fields: fields ?? {},
      order,
      archived: false,
      version: 1,
      commentCount: 0,
      linkCount: 0,
      dueDate: dueDate ? String(dueDate) : undefined,
      effortPoints: typeof effortPoints === 'number' ? effortPoints : undefined,
      sourceType: sourceType ? String(sourceType) : undefined,
      sourceId: sourceId ? String(sourceId) : undefined,
      sourceAppType: sourceAppType ? String(sourceAppType) : undefined,
      createdBy: auth.sub,
      createdByName: auth.name ?? undefined,
      createdAt: ts,
      updatedAt: ts,
    };

    // Build index items
    const indexItems = buildTicketIndexItems(
      teamId,
      ticketId,
      assigneeId ? String(assigneeId) : undefined,
      customerId ? String(customerId) : undefined,
      workUnitId ? String(workUnitId) : undefined,
      projectId ? String(projectId) : undefined,
      ts
    );

    // Build audit entry
    const auditItem = buildAuditItem(ticketId, auth, 'created', { title, displayId });

    // TransactWriteItems
    const transactItems: Record<string, unknown>[] = [
      { Put: { TableName: OPS_TABLE, Item: ticketItem } },
      { Put: { TableName: OPS_TABLE, Item: auditItem } },
      ...indexItems.map((item) => ({ Put: { TableName: OPS_TABLE, Item: item } })),
    ];

    await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems as never }));

    return jsonResponse(201, {
      ticket: ticketItem,
      ...(unknownKeys.length > 0 && {
        warnings: [
          `Unrecognized parameters were ignored: ${unknownKeys.join(', ')}. Valid fields: ${[...knownCreateFields].join(', ')}`,
        ],
      }),
    });
  }

  // ── PUT /ops/tickets/{ticketId} — update ticket ─────────────────────────────
  if (method === 'PUT' && segments.length === 1) {
    const ticketId = segments[0];
    const teamId = body.teamId ? String(body.teamId) : undefined;
    const currentTeamId = body.currentTeamId ? String(body.currentTeamId) : teamId;

    if (!currentTeamId) return errorResponse(400, 'Missing required field: teamId or currentTeamId');

    const existing = await getItem(`TEAM#${currentTeamId}`, `TICKET#${ticketId}`);
    if (!existing) return errorResponse(404, 'Ticket not found');

    // Optimistic locking
    const expectedVersion = body.version;
    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      return errorResponse(409, 'Conflict: ticket has been modified by another user');
    }

    const ts = now();
    const newVersion = ((existing.version as number) ?? 0) + 1;
    const isCrossTeamMove = teamId && teamId !== currentTeamId;

    const targetTeamId = isCrossTeamMove ? teamId! : currentTeamId;

    // Verify user has access to the target team for cross-team moves
    if (isCrossTeamMove) {
      const targetMeta = (await queryByPK(`TEAM#${targetTeamId}`, 'META'))[0];
      if (targetMeta && !hasTeamAccess(targetMeta, auth)) {
        return errorResponse(403, 'You do not have access to the target team');
      }
    }

    let stageId = body.stageId ? String(body.stageId) : (existing.stageId as string);

    // ── Derive statusType from stage when stageId changes ─────────────────
    // Stage IS the status — whenever a ticket moves to a new stage (drag-and-drop,
    // context menu, detail modal), we derive statusType from the destination stage.
    let statusType: string;
    if (body.stageId && String(body.stageId) !== String(existing.stageId)) {
      const targetStage = await getItem(`TEAM#${targetTeamId}`, `STAGE#${stageId}`);
      statusType = targetStage?.statusType ? String(targetStage.statusType) : (existing.statusType as string);
    } else if (body.statusType) {
      statusType = String(body.statusType);
    } else {
      statusType = existing.statusType as string;
    }

    // Compute lifecycle timestamps — matches Ian's POC getLifecycleDateUpdates() logic
    const lifecycleUpdates: Record<string, unknown> = {};
    if (statusType !== existing.statusType) {
      const prevStatus = existing.statusType as string;

      // scopedAt: permanent, set on first entry to scoped, queued, or active
      if (['scoped', 'queued', 'active'].includes(statusType) && !existing.scopedAt) {
        lifecycleUpdates.scopedAt = ts;
      }

      // startedAt: permanent, set on first entry to queued or active
      if (['queued', 'active'].includes(statusType) && !existing.startedAt) {
        lifecycleUpdates.startedAt = ts;
      }

      // completedAt: set on entry to completed; cleared on exit; mutually exclusive with endedAt
      if (statusType === 'completed') {
        if (!existing.completedAt) lifecycleUpdates.completedAt = ts;
        if (existing.endedAt) lifecycleUpdates.endedAt = null;
      } else if (prevStatus === 'completed') {
        lifecycleUpdates.completedAt = null;
      }

      // endedAt: set on entry to ended; cleared on exit; mutually exclusive with completedAt
      if (statusType === 'ended') {
        if (!existing.endedAt) lifecycleUpdates.endedAt = ts;
        if (existing.completedAt) lifecycleUpdates.completedAt = null;
      } else if (prevStatus === 'ended') {
        lifecycleUpdates.endedAt = null;
      }
    }

    // scopedAt: also triggered by workUnitId being assigned for the first time
    const workUnitBeingAssigned = !existing.workUnitId && body.workUnitId && body.workUnitId !== null;
    if (workUnitBeingAssigned && !existing.scopedAt && !lifecycleUpdates.scopedAt) {
      lifecycleUpdates.scopedAt = ts;
    }
    let zoneIdOverride: string | undefined;
    const order = typeof body.order === 'number' ? body.order : ((existing.order as number) ?? ORDER_GAP);

    // ── Auto-move logic: if statusType changed, check zone compatibility ───
    if (statusType !== existing.statusType && !isCrossTeamMove) {
      const teamItems = await queryGSI1(`TEAM#${targetTeamId}`);
      const allZones = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('ZONE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
      const allStages = teamItems.items
        .filter((i) => String(i.SK ?? '').startsWith('STAGE#'))
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

      // Find the current zone
      const currentZoneId = body.zoneId ? String(body.zoneId) : (existing.zoneId as string);
      const currentZone = allZones.find((z) => String(z.id) === currentZoneId);
      const currentZoneType = currentZone ? (String(currentZone.zoneType) as ZoneType) : undefined;

      if (currentZoneType && !isStatusTypeAllowedInZone(statusType as StatusType, currentZoneType)) {
        // Status type is NOT allowed in current zone — auto-move to the correct zone
        const targetZoneType = STATUS_TYPE_TO_ZONES[statusType as StatusType]?.[0];
        if (targetZoneType) {
          const targetZone = allZones.find((z) => String(z.zoneType) === targetZoneType);
          if (targetZone) {
            zoneIdOverride = String(targetZone.id);
            // Find the first stage in the target zone that matches the statusType
            const matchingStage = allStages.find(
              (s) => String(s.zoneId) === zoneIdOverride && String(s.statusType) === statusType
            );
            // Fallback: first stage in the target zone
            const fallbackStage = allStages.find((s) => String(s.zoneId) === zoneIdOverride);
            const autoStage = matchingStage ?? fallbackStage;
            if (autoStage) {
              stageId = String(autoStage.id);
            }
          }
        }
      }
    }

    const finalZoneId = zoneIdOverride ?? (body.zoneId ? String(body.zoneId) : (existing.zoneId as string));
    const updated: Record<string, unknown> = {
      ...existing,
      ...body,
      ...lifecycleUpdates,
      PK: `TEAM#${targetTeamId}`,
      SK: `TICKET#${ticketId}`,
      GSI1PK: `TEAM#${targetTeamId}`,
      GSI1SK: `STAGE#${stageId}#ORDER#${padOrder(order as number)}#${ticketId}`,
      GSI3PK: `TID#${String(existing.displayId)}`,
      GSI3SK: 'TICKET',
      id: ticketId,
      teamId: targetTeamId,
      zoneId: finalZoneId,
      stageId,
      order,
      statusType,
      version: newVersion,
      updatedAt: ts,
      updatedBy: auth.sub,
    };

    // Track field changes for audit
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (body[key] !== existing[key]) {
        changes[key] = { from: existing[key], to: body[key] };
      }
    }

    const auditItem = buildAuditItem(ticketId, auth, 'updated', changes);

    if (isCrossTeamMove) {
      // Cross-team move: delete old items, create new items atomically
      const oldIndexSKs = [
        `TICKET#${ticketId}#IDX_ASSIGNEE`,
        `TICKET#${ticketId}#IDX_CUSTOMER`,
        `TICKET#${ticketId}#IDX_WORKUNIT`,
        `TICKET#${ticketId}#IDX_PROJECT`,
      ];

      const newIndexItems = buildTicketIndexItems(
        targetTeamId,
        ticketId,
        updated.assigneeId ? String(updated.assigneeId) : undefined,
        updated.customerId ? String(updated.customerId) : undefined,
        updated.workUnitId ? String(updated.workUnitId) : undefined,
        updated.projectId ? String(updated.projectId) : undefined,
        ts
      );

      const transactItems: Record<string, unknown>[] = [
        // Delete old ticket
        { Delete: { TableName: OPS_TABLE, Key: { PK: `TEAM#${currentTeamId}`, SK: `TICKET#${ticketId}` } } },
        // Delete old index items
        ...oldIndexSKs.map((sk) => ({
          Delete: { TableName: OPS_TABLE, Key: { PK: `TEAM#${currentTeamId}`, SK: sk } },
        })),
        // Create new ticket
        { Put: { TableName: OPS_TABLE, Item: updated } },
        // Create new index items
        ...newIndexItems.map((item) => ({ Put: { TableName: OPS_TABLE, Item: item } })),
        // Audit entry
        { Put: { TableName: OPS_TABLE, Item: auditItem } },
      ];

      try {
        await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems as never }));
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') {
          return errorResponse(409, 'Conflict: ticket has been modified by another user');
        }
        throw err;
      }

      return jsonResponse(200, { ticket: updated });
    }

    // Same-team update
    try {
      // Write the updated ticket with optimistic locking
      await dynamo.send(
        new PutCommand({
          TableName: OPS_TABLE,
          Item: updated,
          ConditionExpression: 'version = :expectedVersion',
          ExpressionAttributeValues: { ':expectedVersion': existing.version },
        })
      );
    } catch (err) {
      if ((err as Error).name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'Conflict: ticket has been modified by another user');
      }
      throw err;
    }

    // Update index items if assignee/customer/workUnit changed
    const assigneeChanged =
      body.assigneeId !== undefined && String(body.assigneeId ?? '') !== String(existing.assigneeId ?? '');
    const customerChanged =
      body.customerId !== undefined && String(body.customerId ?? '') !== String(existing.customerId ?? '');
    const workUnitChanged =
      body.workUnitId !== undefined && String(body.workUnitId ?? '') !== String(existing.workUnitId ?? '');

    const indexOps: Promise<void>[] = [];

    if (assigneeChanged) {
      // Delete old, create new
      indexOps.push(deleteItem(`TEAM#${targetTeamId}`, `TICKET#${ticketId}#IDX_ASSIGNEE`));
      if (body.assigneeId) {
        indexOps.push(
          putItem({
            PK: `TEAM#${targetTeamId}`,
            SK: `TICKET#${ticketId}#IDX_ASSIGNEE`,
            GSI2PK: `ASSIGNEE#${String(body.assigneeId)}`,
            GSI2SK: `TICKET#${ts}#${ticketId}`,
            entityType: 'TICKET_INDEX',
            indexType: 'IDX_ASSIGNEE',
            ticketId,
            teamId: targetTeamId,
            assigneeId: String(body.assigneeId),
          })
        );
      }
    }

    if (customerChanged) {
      indexOps.push(deleteItem(`TEAM#${targetTeamId}`, `TICKET#${ticketId}#IDX_CUSTOMER`));
      if (body.customerId) {
        indexOps.push(
          putItem({
            PK: `TEAM#${targetTeamId}`,
            SK: `TICKET#${ticketId}#IDX_CUSTOMER`,
            GSI2PK: `CUSTOMER#${String(body.customerId)}`,
            GSI2SK: `TICKET#${ts}#${ticketId}`,
            entityType: 'TICKET_INDEX',
            indexType: 'IDX_CUSTOMER',
            ticketId,
            teamId: targetTeamId,
            customerId: String(body.customerId),
          })
        );
      }
    }

    if (workUnitChanged) {
      indexOps.push(deleteItem(`TEAM#${targetTeamId}`, `TICKET#${ticketId}#IDX_WORKUNIT`));
      if (body.workUnitId) {
        indexOps.push(
          putItem({
            PK: `TEAM#${targetTeamId}`,
            SK: `TICKET#${ticketId}#IDX_WORKUNIT`,
            GSI2PK: `WORKUNIT#${String(body.workUnitId)}`,
            GSI2SK: `TICKET#${ts}#${ticketId}`,
            entityType: 'TICKET_INDEX',
            indexType: 'IDX_WORKUNIT',
            ticketId,
            teamId: targetTeamId,
            workUnitId: String(body.workUnitId),
          })
        );
      }
    }

    const projectChanged =
      body.projectId !== undefined && String(body.projectId ?? '') !== String(existing.projectId ?? '');
    if (projectChanged) {
      indexOps.push(deleteItem(`TEAM#${targetTeamId}`, `TICKET#${ticketId}#IDX_PROJECT`));
      if (body.projectId) {
        indexOps.push(
          putItem({
            PK: `TEAM#${targetTeamId}`,
            SK: `TICKET#${ticketId}#IDX_PROJECT`,
            GSI2PK: `PROJECT#${String(body.projectId)}`,
            GSI2SK: `TICKET#${ts}#${ticketId}`,
            entityType: 'TICKET_INDEX',
            indexType: 'IDX_PROJECT',
            ticketId,
            teamId: targetTeamId,
            projectId: String(body.projectId),
          })
        );
      }
    }

    indexOps.push(putItem(auditItem));
    if (indexOps.length > 0) await Promise.all(indexOps);

    return jsonResponse(200, { ticket: updated });
  }

  // ── DELETE /ops/tickets/{ticketId} — soft delete ────────────────────────────
  if (method === 'DELETE' && segments.length === 1) {
    const ticketId = segments[0];
    const teamId = qp.teamId;
    if (!teamId) return errorResponse(400, 'Missing required query parameter: teamId');

    const existing = await getItem(`TEAM#${teamId}`, `TICKET#${ticketId}`);
    if (!existing) return errorResponse(404, 'Ticket not found');

    const ts = now();
    const updated: Record<string, unknown> = {
      ...existing,
      statusType: 'deleted',
      deletedAt: ts,
      deletedBy: auth.sub,
      updatedAt: ts,
      version: ((existing.version as number) ?? 0) + 1,
    };
    await putItem(updated);
    await putItem(buildAuditItem(ticketId, auth, 'deleted'));

    return jsonResponse(200, { deleted: true });
  }

  // ── POST /ops/tickets/{ticketId}/restore — restore soft-deleted ticket ──────
  if (method === 'POST' && segments.length === 2 && segments[1] === 'restore') {
    const ticketId = segments[0];
    const teamId = body.teamId ? String(body.teamId) : qp.teamId;
    if (!teamId) return errorResponse(400, 'Missing required field: teamId');

    const existing = await getItem(`TEAM#${teamId}`, `TICKET#${ticketId}`);
    if (!existing) return errorResponse(404, 'Ticket not found');

    const ts = now();

    // Restore ticket to team's default stage (derive statusType from it)
    const teamMeta = (await queryByPK(`TEAM#${teamId}`, 'META'))[0];
    const defaultStageId = teamMeta?.defaultStageId ? String(teamMeta.defaultStageId) : undefined;
    let restoreStageId = existing.stageId as string;
    let restoreZoneId = existing.zoneId as string;
    let restoreStatusType = 'backlog';

    if (defaultStageId) {
      const defaultStage = await getItem(`TEAM#${teamId}`, `STAGE#${defaultStageId}`);
      if (defaultStage) {
        restoreStageId = defaultStageId;
        restoreZoneId = String(defaultStage.zoneId ?? restoreZoneId);
        restoreStatusType = String(defaultStage.statusType ?? 'backlog');
      }
    }

    const updated: Record<string, unknown> = {
      ...existing,
      stageId: restoreStageId,
      zoneId: restoreZoneId,
      statusType: restoreStatusType,
      GSI1SK: `STAGE#${restoreStageId}#ORDER#${padOrder((existing.order as number) ?? ORDER_GAP)}#${ticketId}`,
      deletedAt: undefined,
      deletedBy: undefined,
      updatedAt: ts,
      version: ((existing.version as number) ?? 0) + 1,
    };
    await putItem(updated);
    await putItem(buildAuditItem(ticketId, auth, 'restored'));

    return jsonResponse(200, { ticket: updated });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Metrics ────────────────────────────────────────────────────────────────────

const handleMetrics = async (
  _auth: AuthContext,
  event: APIGatewayProxyEventV2
): Promise<ReturnType<typeof jsonResponse>> => {
  const qp = event.queryStringParameters ?? {};
  const teamIds = qp.teamIds ? qp.teamIds.split(',') : [];

  if (teamIds.length === 0) {
    return errorResponse(400, 'Missing required query parameter: teamIds');
  }

  const metrics: Record<string, Record<string, number>> = {};

  for (const teamId of teamIds) {
    const tickets = await queryByPK(`TEAM#${teamId}`, 'TICKET#');
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      const st = String(t.statusType ?? 'unknown');
      counts[st] = (counts[st] ?? 0) + 1;
    }
    metrics[teamId] = counts;
  }

  return jsonResponse(200, { metrics });
};

// ─── Uploads ────────────────────────────────────────────────────────────────────

const handleUploads = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  queryParams: Record<string, string> = {}
): Promise<ReturnType<typeof jsonResponse>> => {
  // GET /ops/uploads/presigned-url?s3Key=... — generate a presigned download URL
  if (method === 'GET' && segments.length === 1 && segments[0] === 'presigned-url') {
    const s3Key = queryParams.s3Key ? String(queryParams.s3Key) : undefined;
    if (!s3Key) return errorResponse(400, 'Missing required query param: s3Key');

    // Validate the key belongs to the ops/tickets namespace to prevent arbitrary access
    if (!s3Key.startsWith('ops/tickets/') && !s3Key.startsWith('ops/')) {
      return errorResponse(403, 'Access denied: key outside allowed namespace');
    }

    const s3 = withPRM(S3Client, { region: REGION });
    const command = new GetObjectCommand({ Bucket: OUTPUTS_BUCKET_NAME, Key: s3Key });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const downloadUrl = await getSignedUrl(s3 as any, command, { expiresIn: 900 });

    return jsonResponse(200, { downloadUrl, s3Key });
  }

  // POST /ops/uploads/presigned-url — generate a presigned upload URL
  if (method === 'POST' && segments.length === 1 && segments[0] === 'presigned-url') {
    const { fileName, contentType, contextId } = body;
    if (!fileName || !contextId) return errorResponse(400, 'Missing required fields: fileName, contextId');

    const fileId = randomUUID();
    const s3Key = `ops/tickets/${String(contextId)}/attachments/${fileId}/${String(fileName)}`;

    const s3 = withPRM(S3Client, { region: REGION });
    const command = new PutObjectCommand({
      Bucket: OUTPUTS_BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType ? String(contentType) : 'application/octet-stream',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadUrl = await getSignedUrl(s3 as any, command, { expiresIn: 900 });

    return jsonResponse(200, { uploadUrl, s3Key, fileId });
  }

  return errorResponse(404, 'Route not found');
};

// ─── User Preferences ───────────────────────────────────────────────────────────

const handleUserPreferences = async (
  method: string,
  segments: string[],
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<ReturnType<typeof jsonResponse>> => {
  if (segments.length !== 1) return errorResponse(404, 'Route not found');

  const teamId = segments[0];
  const pk = `USER#${auth.sub}`;
  const sk = `PREF#TEAM#${teamId}`;

  // GET /ops/user-preferences/{teamId}
  if (method === 'GET') {
    const item = await getItem(pk, sk);
    return jsonResponse(200, item ?? {});
  }

  // PUT /ops/user-preferences/{teamId}
  if (method === 'PUT') {
    const existing = await getItem(pk, sk);
    const updated: Record<string, unknown> = {
      ...(existing ?? {}),
      ...body,
      PK: pk,
      SK: sk,
      entityType: 'USER_PREFERENCE',
      userId: auth.sub,
      teamId,
      updatedAt: now(),
    };
    await putItem(updated);
    return jsonResponse(200, { preferences: updated });
  }

  return errorResponse(404, 'Route not found');
};

// ─── Main Handler ───────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!OPS_TABLE) throw new Error('Missing OPS_TABLE environment variable');
    if (!OPS_CONFIG_TABLE) throw new Error('Missing OPS_CONFIG_TABLE environment variable');
    if (!OUTPUTS_BUCKET_NAME) throw new Error('Missing OUTPUTS_BUCKET_NAME environment variable');

    if (event.requestContext.http?.method === 'OPTIONS') {
      return { statusCode: 200, headers: HEADERS, body: '' };
    }

    const auth = resolveAuthContext(event);
    if (!auth) return errorResponse(401, 'Unauthorized');

    // Enrich auth.name from staff records (JWT access tokens lack the name claim)
    auth.name = await resolveAuthorName(auth);

    const segments = buildPathSegments(event);
    if (segments[0] !== 'ops') {
      return errorResponse(404, 'Not Found');
    }

    const method = event.requestContext.http?.method ?? 'GET';
    const body = parseBody(event);
    const resource = segments[1];
    const rest = segments.slice(2);

    switch (resource) {
      case 'teams':
        return handleTeams(method, rest, body, auth);

      case 'tickets': {
        // Handle the by-display-id sub-path specially
        if (rest[0] === 'by-display-id') {
          return handleTickets(method, rest, body, auth, event);
        }
        return handleTickets(method, rest, body, auth, event);
      }

      case 'metrics':
        return handleMetrics(auth, event);

      case 'uploads':
        return handleUploads(method, rest, body, event.queryStringParameters ?? {});

      case 'user-preferences':
        return handleUserPreferences(method, rest, body, auth);

      default:
        return errorResponse(404, 'Route not found');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const method = event.requestContext?.http?.method ?? 'UNKNOWN';
    const path = event.requestContext?.http?.path ?? event.rawPath ?? 'UNKNOWN';
    console.error(
      '[OPS-API] Unhandled error',
      JSON.stringify({
        method,
        path,
        error: err.message,
        name: err.name,
        stack: err.stack,
      })
    );
    return errorResponse(500, `Internal Server Error: ${err.message}`);
  }
};
