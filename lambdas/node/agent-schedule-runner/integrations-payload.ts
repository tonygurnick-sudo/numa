/**
 * Unified integrations payload builder for the schedule runner.
 *
 * Mirrors the chat-side unification from FEAT-143: every workspace-agent
 * request carries `enabledIntegrations` and `availableIntegrations` rows tagged
 * with `method: 'native' | 'pipedream'`. The agent registers the right MCP
 * family based on the method tag; admin `preferred_method` is honoured.
 *
 * The runner does this server-side because there is no frontend in the loop
 * when EventBridge / event-dispatcher / "Run now" fires a scheduled or
 * triggered agent run. Inputs (slug lists) come from the persisted schedule
 * record or the freshly-refreshed agent snapshot; the method per slug is
 * resolved at run time against:
 *   1. the global integration settings table (admin `preferred_method`),
 *   2. the user's Pipedream connections (via the relay),
 *   3. the user's native connector rows (in DDB).
 *
 * Slugs that resolve to neither method are dropped with a warn log — the
 * workspace agent will surface "integration not connected" if the LLM
 * actually tries that tool. This matches chat behaviour and avoids failing
 * runs over optional integrations the agent could still partially complete.
 */

import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { QueryCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { CONNECTOR_TO_PIPEDREAM, PIPEDREAM_TO_CONNECTOR } from '../../../infra/config/connectors';

// ---------------------------------------------------------------------------
// Types — mirror the lib/scheduling-schemas.ts shapes without a runtime dep
// ---------------------------------------------------------------------------

export type IntegrationMethod = 'native' | 'pipedream';

export interface IntegrationListItem {
  slug: string;
  method: IntegrationMethod;
  name: string;
}

export interface AgentSnapshotLike {
  toolsConfig?: {
    enabledConnections?: string[];
    enabledIntegrations?: IntegrationListItem[];
  };
  requiredIntegrations?: string[];
}

export interface ScheduledRunConfigLike {
  enabledConnections?: string[];
  enabledIntegrations?: IntegrationListItem[];
}

// ---------------------------------------------------------------------------
// Cache for admin preferred-method scan (2-min TTL, dedup in-flight)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 120_000;
let preferredCache: Map<string, IntegrationMethod> | null = null;
let preferredCacheLoadedAt = 0;
let preferredCacheInFlight: Promise<Map<string, IntegrationMethod>> | null = null;

/** For tests — reset module-level cache state between runs. */
export const _resetPreferredMethodCache = (): void => {
  preferredCache = null;
  preferredCacheLoadedAt = 0;
  preferredCacheInFlight = null;
};

/**
 * Scan the global-integration-settings table for `preferred_method` rows.
 *
 * Returns a Pipedream-slug → method map. Empty when the table env var isn't
 * configured (legitimate: dev stacks before FEAT-143 ran). On scan failure we
 * fall back to whatever's cached and DO NOT stamp the load timestamp, so the
 * next call retries instead of locking us into a 120s fail-open window — same
 * posture as the Python equivalent in
 * `services/numa-workspace-agent/.../integration_preferences.py`.
 */
export const loadGlobalPreferredMethods = async ({
  dynamo,
  tableName,
}: {
  dynamo: DynamoDBDocumentClient;
  tableName: string;
}): Promise<Map<string, IntegrationMethod>> => {
  const now = Date.now();
  if (preferredCache && now - preferredCacheLoadedAt < CACHE_TTL_MS) {
    return preferredCache;
  }
  if (preferredCacheInFlight) return preferredCacheInFlight;

  if (!tableName) {
    preferredCache = new Map();
    preferredCacheLoadedAt = now;
    return preferredCache;
  }

  preferredCacheInFlight = (async (): Promise<Map<string, IntegrationMethod>> => {
    const out = new Map<string, IntegrationMethod>();
    try {
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await dynamo.send(
          new ScanCommand({ TableName: tableName, ExclusiveStartKey: exclusiveStartKey })
        );
        for (const item of result.Items ?? []) {
          const slug = item.integration as string | undefined;
          const preferred = item.preferred_method as string | undefined;
          if (slug && (preferred === 'native' || preferred === 'pipedream')) {
            out.set(slug, preferred);
          }
        }
        exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);

      preferredCache = out;
      preferredCacheLoadedAt = Date.now();
      return out;
    } catch (err) {
      console.warn('[SCHEDULE_RUNNER] failed to load preferred-method map', {
        _name: 'INTEGRATION_PREFERENCES_LOAD_FAILED',
        error: (err as Error).message,
      });
      // Do NOT update preferredCacheLoadedAt — let the next call retry.
      return preferredCache ?? new Map();
    } finally {
      preferredCacheInFlight = null;
    }
  })();

  return preferredCacheInFlight;
};

// ---------------------------------------------------------------------------
// Per-user auth state lookups
// ---------------------------------------------------------------------------

/**
 * Live Pipedream-side connection state for the user. Calls the relay's
 * `get_integration_status` op (the same one used at trigger-deploy time —
 * see `lambdas/node/agent-schedules/pipedream-trigger-lifecycle.ts`).
 *
 * Returns the set of Pipedream slugs the user has currently authed AND that
 * Pipedream reports as healthy. Pipedream's `healthy: false` signal means an
 * OAuth grant has been revoked / expired — we don't want to register tools
 * the agent can't actually use.
 */
export const listUserPipedreamConnectedApps = async ({
  lambdaClient,
  relayArn,
  externalUserId,
}: {
  lambdaClient: LambdaClient;
  relayArn: string;
  externalUserId: string;
}): Promise<Set<string>> => {
  if (!relayArn) return new Set();

  type IntegrationStatus = {
    app_name: string;
    status: 'connected' | 'not_connected';
    healthy?: boolean | null;
  };

  try {
    const response = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: relayArn,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(
          JSON.stringify({ operation: 'get_integration_status', external_user_id: externalUserId, parameters: {} })
        ),
      })
    );
    if (response.FunctionError) {
      console.warn('[SCHEDULE_RUNNER] pipedream relay returned function error', {
        functionError: response.FunctionError,
      });
      return new Set();
    }
    const body = response.Payload ? Buffer.from(response.Payload).toString('utf-8') : '';
    if (!body) return new Set();
    const parsed = JSON.parse(body) as { statusCode?: number; body?: unknown };
    const inner =
      typeof parsed.body === 'string'
        ? JSON.parse(parsed.body)
        : (parsed.body as { success?: boolean; data?: unknown });
    if (parsed.statusCode !== 200 || !inner?.success) return new Set();

    const data = inner.data as { connections?: IntegrationStatus[] } | IntegrationStatus[] | undefined;
    const connections: IntegrationStatus[] = Array.isArray(data) ? data : (data?.connections ?? []);
    const out = new Set<string>();
    for (const conn of connections) {
      if (conn.status === 'connected' && conn.healthy !== false) {
        out.add(conn.app_name);
      }
    }
    return out;
  } catch (err) {
    console.warn('[SCHEDULE_RUNNER] failed to list pipedream connections', {
      error: (err as Error).message,
    });
    return new Set();
  }
};

/**
 * Native connector rows the user has currently set up. DDB Query keyed by
 * `user_id` against the data-connectors table; we only count rows whose
 * `status === 'connected'`. The table layout (`{user_id, connector_id}`)
 * mirrors `lambdas/python/data-connectors/storage.py`.
 */
export const listUserConnectedNativeConnectors = async ({
  dynamo,
  tableName,
  userSub,
}: {
  dynamo: DynamoDBDocumentClient;
  tableName: string;
  userSub: string;
}): Promise<Set<string>> => {
  if (!tableName) return new Set();
  try {
    const out = new Set<string>();
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'user_id = :u',
          ExpressionAttributeValues: { ':u': userSub },
          ProjectionExpression: 'connector_id, #s',
          ExpressionAttributeNames: { '#s': 'status' },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      for (const item of result.Items ?? []) {
        const slug = item.connector_id as string | undefined;
        const status = item.status as string | undefined;
        if (slug && status === 'connected') out.add(slug);
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);
    return out;
  } catch (err) {
    console.warn('[SCHEDULE_RUNNER] failed to list native connectors', {
      error: (err as Error).message,
    });
    return new Set();
  }
};

// ---------------------------------------------------------------------------
// Method-resolution core
// ---------------------------------------------------------------------------

export interface DecideMethodInput {
  slug: string;
  explicitMethod?: IntegrationMethod;
  preferred: Map<string, IntegrationMethod>;
  pipedreamConnected: Set<string>;
  nativeConnected: Set<string>;
}

export interface DecideMethodResult {
  canonicalSlug: string;
  method: IntegrationMethod;
}

/**
 * Decide which method to send for a single slug + the user's auth state.
 *
 * Walk:
 *   1. Canonicalise the input slug — figure out which Pipedream slug and
 *      which native connector slug it could map to.
 *   2. Admin `preferred_method` for the Pipedream slug wins if set AND
 *      the user has authed that method (admin can't force tools the user
 *      hasn't connected).
 *   3. If the row carried an explicit `method` (e.g. from a saved unified
 *      record), honour it as long as the user has that method authed.
 *   4. Fall back: prefer Pipedream when both methods are authed (richer
 *      tool surface), else use whichever method the user has.
 *   5. If neither method is authed for this slug — return null. Caller
 *      drops the row with a warn log.
 */
export const decideMethod = ({
  slug,
  explicitMethod,
  preferred,
  pipedreamConnected,
  nativeConnected,
}: DecideMethodInput): DecideMethodResult | null => {
  // Canonicalise — try interpreting the input as either kind of slug.
  const asPipedreamSlug = slug in PIPEDREAM_TO_CONNECTOR || pipedreamConnected.has(slug) || preferred.has(slug);
  const asNativeSlug = slug in CONNECTOR_TO_PIPEDREAM || nativeConnected.has(slug);

  let pdSlug: string | undefined;
  let nativeSlug: string | undefined;
  if (asPipedreamSlug) {
    pdSlug = slug;
    nativeSlug = PIPEDREAM_TO_CONNECTOR[slug];
  } else if (asNativeSlug) {
    nativeSlug = slug;
    pdSlug = CONNECTOR_TO_PIPEDREAM[slug];
  } else {
    // Unknown slug — could still be a Pipedream-only app the user has authed.
    // Try Pipedream first since the legacy shape historically only carried
    // Pipedream slugs.
    if (pipedreamConnected.has(slug)) pdSlug = slug;
    else if (nativeConnected.has(slug)) nativeSlug = slug;
  }

  // 1. Admin pref wins when its preferred method is authed by the user.
  const adminPref = pdSlug ? preferred.get(pdSlug) : undefined;
  if (adminPref === 'native' && nativeSlug && nativeConnected.has(nativeSlug)) {
    return { canonicalSlug: nativeSlug, method: 'native' };
  }
  if (adminPref === 'pipedream' && pdSlug && pipedreamConnected.has(pdSlug)) {
    return { canonicalSlug: pdSlug, method: 'pipedream' };
  }

  // 2. Honour explicit method on the row when user has that method.
  if (explicitMethod === 'pipedream' && pdSlug && pipedreamConnected.has(pdSlug)) {
    return { canonicalSlug: pdSlug, method: 'pipedream' };
  }
  if (explicitMethod === 'native' && nativeSlug && nativeConnected.has(nativeSlug)) {
    return { canonicalSlug: nativeSlug, method: 'native' };
  }

  // 3. Fallback — Pipedream first (richer tool surface), then native.
  if (pdSlug && pipedreamConnected.has(pdSlug)) {
    return { canonicalSlug: pdSlug, method: 'pipedream' };
  }
  if (nativeSlug && nativeConnected.has(nativeSlug)) {
    return { canonicalSlug: nativeSlug, method: 'native' };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface BuildUnifiedIntegrationsPayloadParams {
  dynamo: DynamoDBDocumentClient;
  lambdaClient: LambdaClient;
  globalIntegrationSettingsTableName: string;
  dataConnectorsTableName: string;
  dataConnectorsEnabled: boolean;
  pipedreamRelayLambdaArn: string;
  clientName: string;
  userSub: string;
  agentSnapshot?: AgentSnapshotLike;
  runConfig?: ScheduledRunConfigLike;
}

export interface UnifiedIntegrationsPayload {
  enabledIntegrations: IntegrationListItem[];
  availableIntegrations: IntegrationListItem[];
}

/**
 * Build the workspace-agent wire payload for integrations on this run.
 *
 * Inputs are merged via this priority list (highest first):
 *
 *   1. runConfig.enabledIntegrations  — explicit per-schedule unified shape
 *   2. agentSnapshot.toolsConfig.enabledIntegrations  — future-shape on agent
 *   3. runConfig.enabledConnections  — legacy slug list (per-schedule)
 *   4. agentSnapshot.toolsConfig.enabledConnections  — legacy on agent
 *   5. agentSnapshot.requiredIntegrations  — legacy required list
 *
 * Each unique slug goes through `decideMethod`. Method-less rows in legacy
 * shapes get their method inferred from per-user live auth state.
 * `availableIntegrations` is the union of every method-authed integration the
 * user has — same shape chat emits — so the workspace agent prompt can
 * advertise what's connected even if the agent didn't list it.
 */
export const buildUnifiedIntegrationsPayload = async ({
  dynamo,
  lambdaClient,
  globalIntegrationSettingsTableName,
  dataConnectorsTableName,
  dataConnectorsEnabled,
  pipedreamRelayLambdaArn,
  clientName,
  userSub,
  agentSnapshot,
  runConfig,
}: BuildUnifiedIntegrationsPayloadParams): Promise<UnifiedIntegrationsPayload> => {
  // ── Step 1: assemble the input row list ────────────────────────────────
  type InputRow = { slug: string; method?: IntegrationMethod; name?: string };
  let rows: InputRow[] = [];

  const tc = agentSnapshot?.toolsConfig;
  if (runConfig?.enabledIntegrations?.length) {
    rows = runConfig.enabledIntegrations.map((r) => ({ ...r }));
  } else if (tc?.enabledIntegrations?.length) {
    rows = tc.enabledIntegrations.map((r) => ({ ...r }));
  } else {
    const legacySlugs: string[] = [];
    if (runConfig?.enabledConnections?.length) legacySlugs.push(...runConfig.enabledConnections);
    if (tc?.enabledConnections?.length) legacySlugs.push(...tc.enabledConnections);
    if (agentSnapshot?.requiredIntegrations?.length) legacySlugs.push(...agentSnapshot.requiredIntegrations);
    rows = uniqStrings(legacySlugs).map((slug) => ({ slug }));
  }

  // ── Step 2: load admin pref + per-user auth state in parallel ──────────
  const externalUserId = `${clientName}_${userSub}`;
  const [preferred, pipedreamConnected, nativeConnected] = await Promise.all([
    loadGlobalPreferredMethods({ dynamo, tableName: globalIntegrationSettingsTableName }),
    listUserPipedreamConnectedApps({ lambdaClient, relayArn: pipedreamRelayLambdaArn, externalUserId }),
    dataConnectorsEnabled
      ? listUserConnectedNativeConnectors({ dynamo, tableName: dataConnectorsTableName, userSub })
      : Promise.resolve(new Set<string>()),
  ]);

  // ── Step 3: resolve each row's method ──────────────────────────────────
  const resolved: IntegrationListItem[] = [];
  const droppedRows: string[] = [];
  for (const row of rows) {
    const decision = decideMethod({
      slug: row.slug,
      explicitMethod: row.method,
      preferred,
      pipedreamConnected,
      nativeConnected,
    });
    if (!decision) {
      droppedRows.push(row.slug);
      continue;
    }
    resolved.push({
      slug: decision.canonicalSlug,
      method: decision.method,
      name: row.name ?? decision.canonicalSlug,
    });
  }

  if (droppedRows.length > 0) {
    console.warn('[SCHEDULE_RUNNER] dropping integrations with no resolvable method', {
      _name: 'INTEGRATION_DROPPED_NO_AUTH',
      slugs: droppedRows,
      userSub: `${userSub.slice(0, 8)}...`,
    });
  }

  // ── Step 4: build the "available" union ────────────────────────────────
  const available: IntegrationListItem[] = [];
  for (const slug of pipedreamConnected) {
    available.push({ slug, method: 'pipedream', name: slug });
  }
  for (const slug of nativeConnected) {
    available.push({ slug, method: 'native', name: slug });
  }

  return {
    enabledIntegrations: dedupeIntegrationRows(resolved),
    availableIntegrations: available,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uniqStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim?.();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const dedupeIntegrationRows = (rows: IntegrationListItem[]): IntegrationListItem[] => {
  const seen = new Set<string>();
  const out: IntegrationListItem[] = [];
  for (const row of rows) {
    const key = `${row.method}:${row.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};
