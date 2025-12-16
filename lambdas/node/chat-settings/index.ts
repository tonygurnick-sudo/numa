import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withPRM } from '../../../lib/prm-node/prm';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.CHAT_SETTINGS_TABLE_NAME as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

// Type definitions for chat settings
export type ChatSettings = {
  defaultKBIds: string[];
  autoToolsEnabled: boolean;
  webSearchEnabled: boolean;
  createAgentEnabled: boolean;
  defaultConnectionIds: string[];
};

export type UserChatSettings = ChatSettings & {
  userDefaultsEnabled: boolean;
};

export type GlobalChatSettings = ChatSettings & {
  allowUserDefaults: boolean;
};

type ChatSettingsUpdate = {
  [K in keyof ChatSettings]?: ChatSettings[K] | null;
};

type UserChatSettingsUpdate = ChatSettingsUpdate & {
  userDefaultsEnabled?: boolean | null;
};

// Default settings for new users
const DEFAULT_SETTINGS: ChatSettings = {
  defaultKBIds: ['company'],
  autoToolsEnabled: true,
  webSearchEnabled: true,
  createAgentEnabled: false,
  defaultConnectionIds: [],
};

const GLOBAL_SETTINGS_KEY = '__global__';
const COMPANY_KB_ID = 'company';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
} as const;

type JwtClaims = { sub?: string; email?: string; [key: string]: unknown };

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {};
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function getClaims(event: { headers?: Record<string, string | undefined> }): JwtClaims | null {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return null;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  return parseJwt(token);
}

function isAdmin(claims: JwtClaims | null): boolean {
  if (!claims) return false;
  const groups = claims['cognito:groups'];
  if (Array.isArray(groups)) {
    return groups.includes('admin');
  }
  if (typeof groups === 'string') {
    return groups
      .split(',')
      .map((g) => g.trim())
      .includes('admin');
  }
  return false;
}

async function loadGlobalSettings(): Promise<GlobalChatSettings> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { user_id: GLOBAL_SETTINGS_KEY },
      ConsistentRead: true,
    }),
  );

  const item = res.Item as Partial<GlobalChatSettings> | undefined;
  if (!item) {
    // If company defaults haven't been configured yet, default to disallowing user overrides
    return {
      defaultKBIds: DEFAULT_SETTINGS.defaultKBIds,
      autoToolsEnabled: DEFAULT_SETTINGS.autoToolsEnabled,
      webSearchEnabled: DEFAULT_SETTINGS.webSearchEnabled,
      createAgentEnabled: DEFAULT_SETTINGS.createAgentEnabled,
      defaultConnectionIds: DEFAULT_SETTINGS.defaultConnectionIds,
      allowUserDefaults: false,
    };
  }

  const defaultKBIds = Array.isArray(item?.defaultKBIds)
    ? item!.defaultKBIds.filter((id) => id === COMPANY_KB_ID)
    : DEFAULT_SETTINGS.defaultKBIds;
  const itemRecord = item as Record<string, unknown>;
  const allowUserDefaults =
    parseBoolean(itemRecord.allowUserDefaults) ?? parseBoolean(itemRecord.allow_user_defaults) ?? false;
  return {
    defaultKBIds,
    autoToolsEnabled:
      typeof item?.autoToolsEnabled === 'boolean' ? item!.autoToolsEnabled : DEFAULT_SETTINGS.autoToolsEnabled,
    webSearchEnabled:
      typeof item?.webSearchEnabled === 'boolean' ? item!.webSearchEnabled : DEFAULT_SETTINGS.webSearchEnabled,
    createAgentEnabled:
      typeof item?.createAgentEnabled === 'boolean' ? item!.createAgentEnabled : DEFAULT_SETTINGS.createAgentEnabled,
    defaultConnectionIds: Array.isArray(item?.defaultConnectionIds)
      ? item!.defaultConnectionIds
      : DEFAULT_SETTINGS.defaultConnectionIds,
    allowUserDefaults,
  };
}

async function loadUserItem(userId: string): Promise<Record<string, unknown> | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { user_id: userId },
      ConsistentRead: true,
    }),
  );
  const item = res.Item as Record<string, unknown> | undefined;
  return item ?? null;
}

function mergeUserSettings(globalSettings: ChatSettings, userItem: Record<string, unknown> | null): UserChatSettings {
  const defaultKBIds = Array.isArray(userItem?.defaultKBIds)
    ? (userItem!.defaultKBIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : globalSettings.defaultKBIds;
  const autoToolsEnabled =
    typeof userItem?.autoToolsEnabled === 'boolean'
      ? (userItem!.autoToolsEnabled as boolean)
      : globalSettings.autoToolsEnabled;
  const webSearchEnabled =
    typeof userItem?.webSearchEnabled === 'boolean'
      ? (userItem!.webSearchEnabled as boolean)
      : globalSettings.webSearchEnabled;
  const createAgentEnabled =
    typeof userItem?.createAgentEnabled === 'boolean'
      ? (userItem!.createAgentEnabled as boolean)
      : globalSettings.createAgentEnabled;
  const defaultConnectionIds = Array.isArray(userItem?.defaultConnectionIds)
    ? (userItem!.defaultConnectionIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : globalSettings.defaultConnectionIds;
  const userDefaultsEnabled =
    parseBoolean(userItem?.userDefaultsEnabled) ?? parseBoolean(userItem?.user_defaults_enabled) ?? true;

  return {
    defaultKBIds,
    autoToolsEnabled,
    webSearchEnabled,
    createAgentEnabled,
    defaultConnectionIds,
    userDefaultsEnabled,
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path || '';
  const scope = event.queryStringParameters?.scope;
  const profileView = event.queryStringParameters?.profile === 'true';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      console.error('Missing required environment variables', { TABLE_NAME, CLIENT_NAME });
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const claims = getClaims(event);
    const userId = claims && typeof claims.sub === 'string' ? claims.sub : null;
    if (!userId) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // GET/PUT /chat/settings?scope=global - company-wide defaults and policy
    console.log('chat-settings handler', { method, path, scope, pathMatch: /\/chat\/settings\/?$/.test(path) });
    if ((method === 'GET' || method === 'PUT') && /\/chat\/settings\/?$/.test(path) && scope === 'global') {
      if (method === 'GET') {
        const globalSettings = await loadGlobalSettings();
        console.log('GET scope=global returning', globalSettings);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify(globalSettings) };
      }

      const adminCheck = isAdmin(claims);
      console.log('PUT scope=global adminCheck', { adminCheck, groups: claims?.['cognito:groups'] });
      if (!adminCheck) {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const body = JSON.parse(event.body || '{}') as Partial<GlobalChatSettings>;
      console.log('PUT scope=global body', body);
      const currentGlobal = await loadGlobalSettings();
      const bodyRecord = body as Record<string, unknown>;
      const allowUserDefaults =
        parseBoolean(bodyRecord.allowUserDefaults) ??
        parseBoolean(bodyRecord.allow_user_defaults) ??
        currentGlobal.allowUserDefaults;

      const updatedSettings: GlobalChatSettings & { user_id: string; updatedAt: string } = {
        user_id: GLOBAL_SETTINGS_KEY,
        defaultKBIds:
          'defaultKBIds' in body
            ? Array.isArray(body.defaultKBIds)
              ? body.defaultKBIds.filter((id): id is string => typeof id === 'string' && id === COMPANY_KB_ID)
              : currentGlobal.defaultKBIds
            : currentGlobal.defaultKBIds,
        autoToolsEnabled:
          'autoToolsEnabled' in body && typeof body.autoToolsEnabled === 'boolean'
            ? body.autoToolsEnabled
            : currentGlobal.autoToolsEnabled,
        webSearchEnabled:
          'webSearchEnabled' in body && typeof body.webSearchEnabled === 'boolean'
            ? body.webSearchEnabled
            : currentGlobal.webSearchEnabled,
        createAgentEnabled:
          'createAgentEnabled' in body && typeof body.createAgentEnabled === 'boolean'
            ? body.createAgentEnabled
            : currentGlobal.createAgentEnabled,
        defaultConnectionIds:
          'defaultConnectionIds' in body
            ? Array.isArray(body.defaultConnectionIds)
              ? body.defaultConnectionIds.filter((id): id is string => typeof id === 'string')
              : currentGlobal.defaultConnectionIds
            : currentGlobal.defaultConnectionIds,
        allowUserDefaults,
        updatedAt: new Date().toISOString(),
      };

      console.log('PUT scope=global saving to DynamoDB', { tableName: TABLE_NAME, item: updatedSettings });
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: updatedSettings,
        }),
      );
      console.log('PUT scope=global saved successfully');

      const responseSettings: GlobalChatSettings = {
        defaultKBIds: updatedSettings.defaultKBIds,
        autoToolsEnabled: updatedSettings.autoToolsEnabled,
        webSearchEnabled: updatedSettings.webSearchEnabled,
        createAgentEnabled: updatedSettings.createAgentEnabled,
        defaultConnectionIds: updatedSettings.defaultConnectionIds,
        allowUserDefaults: updatedSettings.allowUserDefaults,
      };

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(responseSettings) };
    }

    // GET /chat/settings - Get user's chat settings
    if (method === 'GET' && /\/chat\/settings\/?$/.test(path)) {
      const globalSettings = await loadGlobalSettings();
      if (!globalSettings.allowUserDefaults) {
        // Company policy disables per-user defaults; always return company defaults
        const settings: ChatSettings = {
          defaultKBIds: globalSettings.defaultKBIds,
          autoToolsEnabled: globalSettings.autoToolsEnabled,
          webSearchEnabled: globalSettings.webSearchEnabled,
          createAgentEnabled: globalSettings.createAgentEnabled,
          defaultConnectionIds: globalSettings.defaultConnectionIds,
        };
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify(settings) };
      }

      const userItem = await loadUserItem(userId);
      const merged = mergeUserSettings(globalSettings, userItem);

      const mergedSettings: ChatSettings = {
        defaultKBIds: merged.defaultKBIds,
        autoToolsEnabled: merged.autoToolsEnabled,
        webSearchEnabled: merged.webSearchEnabled,
        createAgentEnabled: merged.createAgentEnabled,
        defaultConnectionIds: merged.defaultConnectionIds,
      };

      if (profileView) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ userDefaultsEnabled: merged.userDefaultsEnabled, settings: mergedSettings }),
        };
      }

      // Only apply user defaults in chat when the user has explicitly enabled them.
      const effective: ChatSettings = merged.userDefaultsEnabled
        ? mergedSettings
        : {
            defaultKBIds: globalSettings.defaultKBIds,
            autoToolsEnabled: globalSettings.autoToolsEnabled,
            webSearchEnabled: globalSettings.webSearchEnabled,
            createAgentEnabled: globalSettings.createAgentEnabled,
            defaultConnectionIds: globalSettings.defaultConnectionIds,
          };

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ ...effective, userDefaultsEnabled: merged.userDefaultsEnabled }),
      };
    }

    // PUT /chat/settings - Update user's chat settings
    if (method === 'PUT' && /\/chat\/settings\/?$/.test(path)) {
      const globalSettings = await loadGlobalSettings();
      if (!globalSettings.allowUserDefaults) {
        return {
          statusCode: 403,
          headers: HEADERS,
          body: JSON.stringify({ error: 'User defaults are disabled by admin policy' }),
        };
      }

      const body = JSON.parse(event.body || '{}') as UserChatSettingsUpdate;

      const existing = await loadUserItem(userId);
      const current = (existing as (Partial<UserChatSettings> & { user_id: string }) | null) ?? { user_id: userId };

      const next: Partial<UserChatSettings> & { user_id: string; updatedAt: string } = {
        user_id: userId,
        updatedAt: new Date().toISOString(),
      };

      const mergeArray = (value: unknown): string[] | undefined =>
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : undefined;

      // defaultKBIds
      if ('defaultKBIds' in body) {
        if (body.defaultKBIds === null) {
          // clear override
        } else {
          next.defaultKBIds = mergeArray(body.defaultKBIds) ?? [];
        }
      } else if (Array.isArray(current.defaultKBIds)) {
        next.defaultKBIds = current.defaultKBIds;
      }

      // autoToolsEnabled
      if ('autoToolsEnabled' in body) {
        if (body.autoToolsEnabled === null) {
          // clear override
        } else if (typeof body.autoToolsEnabled === 'boolean') {
          next.autoToolsEnabled = body.autoToolsEnabled;
        }
      } else if (typeof current.autoToolsEnabled === 'boolean') {
        next.autoToolsEnabled = current.autoToolsEnabled;
      }

      // webSearchEnabled
      if ('webSearchEnabled' in body) {
        if (body.webSearchEnabled === null) {
          // clear override
        } else if (typeof body.webSearchEnabled === 'boolean') {
          next.webSearchEnabled = body.webSearchEnabled;
        }
      } else if (typeof current.webSearchEnabled === 'boolean') {
        next.webSearchEnabled = current.webSearchEnabled;
      }

      // createAgentEnabled
      if ('createAgentEnabled' in body) {
        if (body.createAgentEnabled === null) {
          // clear override
        } else if (typeof body.createAgentEnabled === 'boolean') {
          next.createAgentEnabled = body.createAgentEnabled;
        }
      } else if (typeof current.createAgentEnabled === 'boolean') {
        next.createAgentEnabled = current.createAgentEnabled;
      }

      // defaultConnectionIds
      if ('defaultConnectionIds' in body) {
        if (body.defaultConnectionIds === null) {
          // clear override
        } else {
          next.defaultConnectionIds = mergeArray(body.defaultConnectionIds) ?? [];
        }
      } else if (Array.isArray(current.defaultConnectionIds)) {
        next.defaultConnectionIds = current.defaultConnectionIds;
      }

      // userDefaultsEnabled
      if ('userDefaultsEnabled' in body) {
        if (body.userDefaultsEnabled === null) {
          // clear explicit flag (default true)
        } else if (typeof body.userDefaultsEnabled === 'boolean') {
          next.userDefaultsEnabled = body.userDefaultsEnabled;
        }
      } else if ('user_defaults_enabled' in body) {
        const val = (body as Record<string, unknown>).user_defaults_enabled;
        if (val === null) {
          // clear explicit flag (default true)
        } else if (typeof val === 'boolean') {
          next.userDefaultsEnabled = val;
        }
      } else if (typeof current.userDefaultsEnabled === 'boolean') {
        next.userDefaultsEnabled = current.userDefaultsEnabled;
      }

      // Remove empty overrides item (keep minimal keys) - store only if at least one override is set
      const hasOverrides =
        'defaultKBIds' in next ||
        'autoToolsEnabled' in next ||
        'webSearchEnabled' in next ||
        'createAgentEnabled' in next ||
        'defaultConnectionIds' in next ||
        'userDefaultsEnabled' in next;

      const itemToStore = hasOverrides ? next : { user_id: userId, updatedAt: next.updatedAt };

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: itemToStore,
        }),
      );

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('chat-settings error', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
