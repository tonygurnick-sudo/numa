import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  parseQuotasFromEnv,
  parseQuotasFromSettingsItem,
  resolveEffectiveQuotas,
  type PartialScheduleQuotas,
  type ScheduleQuotas,
} from '../../../lib/schedule-load';

const TABLE_NAME = process.env.SCHEDULING_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

/**
 * Read level-2 (per-client) overrides from env vars. The legacy
 * SCHEDULING_MIN_INTERVAL_MINUTES wiring still works — see parseQuotasFromEnv.
 */
const LEVEL_2_QUOTAS = parseQuotasFromEnv(process.env);

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isAdmin(event: unknown): boolean {
  const headers = (event as { headers?: Record<string, string> })?.headers || {};
  const auth = headers.authorization || headers.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || {};
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  return groups.includes('admin');
}

/**
 * Read the level-3 admin override record. Returns the raw partial
 * (admin-supplied values; may be missing some keys).
 */
async function readLevel3(): Promise<PartialScheduleQuotas> {
  if (!TABLE_NAME) return {};
  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { setting: 'scheduling' } }));
    return parseQuotasFromSettingsItem(res.Item);
  } catch {
    return {};
  }
}

/**
 * Resolve the level-1+2 ceiling — what the level-3 admin can never exceed.
 * Used both when responding to GET (so the UI can show the effective ceiling)
 * and when validating PUT input.
 */
function getCeilings(): ScheduleQuotas {
  return resolveEffectiveQuotas(LEVEL_2_QUOTAS, undefined);
}

/**
 * Sanitise + validate a PUT body. Admins may tighten **user-level** quotas
 * within their tenant — never raise them above the platform ceiling. They
 * may also raise the min-interval floor. Company-level quotas are
 * platform-controlled and any attempt to set them is silently dropped (with
 * a warn log) so stale clients don't 400.
 *
 * Allow-listed fields:
 *   - `minIntervalMinutes` — admin may RAISE (more restrictive). Cannot
 *     set below the resolved Level 1+2 floor.
 *   - `maxRunsPerUserPerMonth` — admin may LOWER. Cannot exceed ceiling.
 *   - `maxTriggerRunsPerUserPerMonth` — admin may LOWER. Cannot exceed ceiling.
 *   - `maxConcurrentActiveSchedulesPerUser` — admin may LOWER. Cannot exceed ceiling.
 *
 * Silently dropped (company-level — platform only):
 *   - maxRunsPerCompanyPerMonth
 *   - maxTriggerRunsPerCompanyPerMonth
 *   - maxConcurrentActiveSchedulesPerCompany
 *   - requireApprovalAboveUserCap — platform/per-client (Level 2) is a hard
 *     floor in BOTH directions; admin cannot toggle. Adjust at the
 *     platform-settings record level instead.
 */
function sanitiseAdminInput(input: Record<string, unknown>): PartialScheduleQuotas {
  const out: PartialScheduleQuotas = {};
  const ceilings = getCeilings();

  type Direction = 'lower' | 'upper'; // lower = admin RAISES (floor), upper = admin LOWERS (cap)
  // Floors must be >0 (a minimum of 0 means "no floor", which makes no
  // sense). Caps allow 0 — meaning "0 allowed", a valid way to disable a
  // quota target entirely.
  const writableNumeric: Array<{ key: keyof ScheduleQuotas; direction: Direction; allowZero: boolean }> = [
    { key: 'minIntervalMinutes', direction: 'lower', allowZero: false },
    { key: 'maxRunsPerUserPerMonth', direction: 'upper', allowZero: true },
    { key: 'maxTriggerRunsPerUserPerMonth', direction: 'upper', allowZero: true },
    { key: 'maxConcurrentActiveSchedulesPerUser', direction: 'upper', allowZero: true },
  ];

  for (const { key, direction, allowZero } of writableNumeric) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || (allowZero ? v < 0 : v <= 0)) {
      throw new Error(`${key} must be a ${allowZero ? 'non-negative' : 'positive'} integer`);
    }
    const ceiling = ceilings[key] as number;
    if (direction === 'upper' && v > ceiling) {
      throw new Error(`${key} cannot exceed the platform ceiling of ${ceiling}`);
    }
    if (direction === 'lower' && v < ceiling) {
      throw new Error(`${key} cannot be lower than the platform minimum of ${ceiling}`);
    }
    (out as Record<string, unknown>)[key] = v;
  }

  // requireApprovalAboveUserCap is a hard floor at Level 2 in both directions
  // — admin cannot toggle. Silently drop any attempt rather than 400, so
  // stale clients (or admin-form bugs) don't surface as errors.
  if (input.requireApprovalAboveUserCap !== undefined) {
    console.warn(
      'Dropping admin attempt to set requireApprovalAboveUserCap — Level 2 is a hard floor, change platform-settings instead'
    );
  }

  return out;
}

/** Company-level quotas are platform-controlled — never written from in-app admin. */
const COMPANY_LEVEL_KEYS = new Set([
  'maxRunsPerCompanyPerMonth',
  'maxTriggerRunsPerCompanyPerMonth',
  'maxConcurrentActiveSchedulesPerCompany',
  'requireApprovalAboveUserCap',
]);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    if (method === 'GET' && /\/settings\/scheduling\/?$/.test(path)) {
      const level3 = await readLevel3();
      const effective = resolveEffectiveQuotas(LEVEL_2_QUOTAS, level3);
      const ceilings = getCeilings();

      // Backwards-compatible response: the existing `minIntervalMinutes` and
      // `arcanumFloor` fields are preserved; the new `quotas` block is the
      // authoritative source for the new admin UI.
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          minIntervalMinutes: level3.minIntervalMinutes ?? null,
          arcanumFloor: ceilings.minIntervalMinutes,
          adminOverrides: level3,
          effective,
          ceilings,
        }),
      };
    }

    if (method === 'PUT' && /\/settings\/scheduling\/?$/.test(path)) {
      if (!isAdmin(event)) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
      // New callers send `quotas: {...}`; legacy callers may send fields at
      // the top level. Either way we only accept the approval-policy toggle.
      const raw = (body.quotas && typeof body.quotas === 'object' ? body.quotas : body) as Record<string, unknown>;

      let incoming: PartialScheduleQuotas;
      try {
        incoming = sanitiseAdminInput(raw);
      } catch (err) {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: (err as Error).message }),
        };
      }

      // Company-level quotas are platform-controlled and silently dropped.
      // Log if a stale client tries to send them so we have visibility.
      const ignoredCompanyKeys = Object.keys(raw).filter((k) => COMPANY_LEVEL_KEYS.has(k) && raw[k] !== undefined);
      if (ignoredCompanyKeys.length > 0) {
        console.warn(
          '[admin-scheduling-settings] Ignored company-level quota fields from PUT (platform-controlled only)',
          ignoredCompanyKeys
        );
      }

      // Merge with any existing record so we don't clobber other persisted fields.
      const existing = await readLevel3();
      const merged: PartialScheduleQuotas = { ...existing, ...incoming };

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            setting: 'scheduling',
            ...merged,
            updatedAt: new Date().toISOString(),
          },
        })
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('admin-scheduling-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
