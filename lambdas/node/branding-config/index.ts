import { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withPRM } from '../../../lib/prm-node/prm';

const TABLE_NAME = process.env.BRANDING_TABLE_NAME as string | undefined;
const ddbDoc = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, {}));

const CLIENT_NAME = process.env.CLIENT_NAME as string | undefined;
const BRANDING_PROVIDER_ENABLED = (process.env.BRANDING_PROVIDER_ENABLED ?? 'false') === 'true';
const BRANDING_PUBLIC_MODE = (process.env.BRANDING_PUBLIC_MODE ?? 'false') === 'true';
const BRANDING_ASSETS_BUCKET = process.env.BRANDING_ASSETS_BUCKET as string | undefined;
const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';

const CURRENT_CONFIG_ID = 'branding#current';
const VERSION_PREFIX = 'branding#version#';
const HISTORY_LIMIT = 50;

type JwtClaims = { [key: string]: unknown; 'cognito:groups'?: string[]; username?: string };

type BrandingPayload = Record<string, unknown>; // Pass-through document
type BrandingVersionSummary = {
  versionId: string;
  label?: string;
  updatedAt?: string;
  updatedBy?: string;
};

function parseJwt(token: string): JwtClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
  } catch {
    return {} as JwtClaims;
  }
}

function isAdminFromAuth(event: Pick<APIGatewayProxyEventV2, 'headers'>): { admin: boolean; username?: string } {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return { admin: false };
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || ({} as JwtClaims);
  const groups: string[] = (claims['cognito:groups'] as string[]) || [];
  const username = (claims.username as string) || undefined;
  return { admin: groups.includes('admin'), username };
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };
}

async function fetchHistory(clientId: string): Promise<BrandingVersionSummary[]> {
  const queryRes = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'client_id = :client AND begins_with(config_id, :prefix)',
      ExpressionAttributeValues: {
        ':client': clientId,
        ':prefix': VERSION_PREFIX,
      },
      ScanIndexForward: false,
      Limit: HISTORY_LIMIT,
    }),
  );

  const items = (queryRes.Items as Record<string, unknown>[] | undefined) ?? [];
  return items.map((item): BrandingVersionSummary => {
    const configId = String(item.config_id ?? '');
    const versionIdField = typeof item.versionId === 'string' ? item.versionId : undefined;
    const versionId = versionIdField || configId.replace(VERSION_PREFIX, '');
    return {
      versionId,
      label: typeof item.label === 'string' ? item.label : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
      updatedBy: typeof item.updatedBy === 'string' ? item.updatedBy : undefined,
    };
  });
}

/**
 * Pre-sign an S3 URI (s3://bucket/key) to a signed HTTPS URL.
 * Returns the original value if it's not an S3 URI or if signing fails.
 */
async function presignS3Uri(s3Uri: string | null | undefined, expiresIn = 14400): Promise<string | null> {
  if (!s3Uri || !s3Uri.startsWith('s3://') || !BRANDING_ASSETS_BUCKET) {
    return s3Uri ?? null;
  }

  const withoutScheme = s3Uri.slice(5); // Remove 's3://'
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) return s3Uri;

  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);

  // Only sign if it's from our branding bucket
  if (bucket !== BRANDING_ASSETS_BUCKET) {
    return s3Uri;
  }

  try {
    const s3Client = withPRM(S3Client, { region: AWS_REGION });
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type compatibility workaround
    return await getSignedUrl(s3Client as any, command, { expiresIn });
  } catch (error) {
    console.error('Failed to pre-sign S3 URL:', error);
    return s3Uri; // Return original URI on failure
  }
}

/**
 * Process a branding config and pre-sign all S3 asset URLs.
 */
async function presignBrandingAssets(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const branding = config.branding as Record<string, unknown> | undefined;
  if (!branding) return config;

  const assets = branding.assets as Record<string, string | null | undefined> | undefined;
  if (!assets) return config;

  const presignedAssets: Record<string, string | null> = {};

  // Pre-sign each asset URL in parallel
  const assetKeys = ['logoNav', 'logoLoginRight', 'favicon'] as const;
  await Promise.all(
    assetKeys.map(async (key) => {
      presignedAssets[key] = await presignS3Uri(assets[key]);
    }),
  );

  return {
    ...config,
    branding: {
      ...branding,
      assets: presignedAssets,
    },
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const rawPath = event.requestContext.http.path || '';
  const headers = corsHeaders();

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    if (!TABLE_NAME || !CLIENT_NAME) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error (table missing)' }),
      };
    }

    const pathParts = rawPath.split('/').filter(Boolean);
    const brandingIndex = pathParts.findIndex((p) => p === 'branding');
    const clientId = decodeURIComponent(pathParts[brandingIndex + 1] || '');
    const remainder = pathParts.slice(brandingIndex + 2);
    const hasVersions = remainder[0] === 'versions';
    const versionId = hasVersions && remainder[1] ? decodeURIComponent(remainder[1]) : undefined;
    if (!clientId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'clientId required' }) };

    if (BRANDING_PUBLIC_MODE && clientId !== CLIENT_NAME) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
    }

    if (BRANDING_PUBLIC_MODE) {
      if (method !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
      }
      if (hasVersions) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'forbidden' }) };
      }
    }

    if (method === 'GET' && hasVersions) {
      const { admin } = isAdminFromAuth(event);
      if (!admin) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const history = await fetchHistory(clientId);
      return { statusCode: 200, headers, body: JSON.stringify({ history }) };
    }

    if (method === 'GET') {
      // Global owner switch must allow branding for this client
      if (!BRANDING_PROVIDER_ENABLED) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
      }
      const getRes = await ddbDoc.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { client_id: clientId, config_id: CURRENT_CONFIG_ID },
        }),
      );
      if (!getRes.Item) {
        // No record → return 404 with minimal default indicator
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
      }
      const itemRecord = getRes.Item as Record<string, unknown>;
      // Return the stored blob with pre-signed asset URLs
      const blob = (itemRecord.config as Record<string, unknown> | undefined) ?? itemRecord;
      const presignedBlob = await presignBrandingAssets(blob);
      return { statusCode: 200, headers, body: JSON.stringify(presignedBlob) };
    }

    if (method === 'PUT') {
      const { admin, username } = isAdminFromAuth(event);
      if (!admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };

      // Owner switch must allow writes too; otherwise block
      if (!BRANDING_PROVIDER_ENABLED) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const payload = (event.body ? JSON.parse(event.body) : {}) as BrandingPayload;
      // Minimal validation
      if (payload && typeof payload !== 'object') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_payload' }) };
      }

      const { createVersion, ...configWithoutFlag } = (payload || {}) as BrandingPayload & { createVersion?: boolean };

      const enabledEntry =
        typeof configWithoutFlag === 'object' &&
        configWithoutFlag !== null &&
        'enabled' in configWithoutFlag &&
        typeof (configWithoutFlag as { enabled: unknown }).enabled === 'boolean'
          ? { enabled: (configWithoutFlag as { enabled: boolean }).enabled }
          : {};

      // Persist minimal metadata + full document under `config`
      const nowIso = new Date().toISOString();
      const item: Record<string, unknown> = {
        client_id: clientId,
        config_id: CURRENT_CONFIG_ID,
        clientId,
        provider: 'branding',
        updatedAt: nowIso,
        updatedBy: username || 'admin',
        // Optional runtime flag: if callers include `enabled`, store it alongside
        ...enabledEntry,
        config: configWithoutFlag,
      };

      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

      if (createVersion) {
        const versionIdValue = nowIso;
        const versionItem: Record<string, unknown> = {
          ...item,
          config_id: `${VERSION_PREFIX}${versionIdValue}`,
          versionId: versionIdValue,
        };
        await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: versionItem }));
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (method === 'POST' && hasVersions && versionId) {
      const { admin, username } = isAdminFromAuth(event);
      if (!admin) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const versionKey = `${VERSION_PREFIX}${versionId}`;
      const versionRes = await ddbDoc.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { client_id: clientId, config_id: versionKey },
        }),
      );

      if (!versionRes.Item) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'version_not_found' }) };
      }

      const versionItem = versionRes.Item as Record<string, unknown>;
      const versionConfigRaw = (versionItem.config as BrandingPayload | undefined) ?? versionItem;
      const configWithoutFlag: BrandingPayload =
        versionConfigRaw && typeof versionConfigRaw === 'object'
          ? Object.fromEntries(
              Object.entries(versionConfigRaw as Record<string, unknown>).filter(([key]) => key !== 'createVersion'),
            )
          : {};

      const enabledEntry =
        typeof configWithoutFlag === 'object' &&
        configWithoutFlag !== null &&
        'enabled' in configWithoutFlag &&
        typeof (configWithoutFlag as { enabled: unknown }).enabled === 'boolean'
          ? { enabled: (configWithoutFlag as { enabled: boolean }).enabled }
          : {};

      const nowIso = new Date().toISOString();
      const currentItem: Record<string, unknown> = {
        client_id: clientId,
        config_id: CURRENT_CONFIG_ID,
        clientId,
        provider: 'branding',
        updatedAt: nowIso,
        updatedBy: username || String(versionItem.updatedBy || 'admin'),
        ...enabledEntry,
        config: configWithoutFlag,
      };

      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: currentItem }));

      const history = await fetchHistory(clientId);

      const responseBody = {
        ...(typeof configWithoutFlag === 'object' && configWithoutFlag !== null ? configWithoutFlag : {}),
        history,
      };

      return { statusCode: 200, headers, body: JSON.stringify(responseBody) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('branding-config error', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};
