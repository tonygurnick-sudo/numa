import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME ?? '';
const CLOUDFRONT_SHARED_SECRET = process.env.CLOUDFRONT_SHARED_SECRET ?? '';

const parseJwt = (token: string): Record<string, unknown> => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const validateAuth = (headers: Record<string, string | undefined>): string | null => {
  // Validate CloudFront secret
  const cfSecret = headers['x-arcanum-cloudfront-secret'];
  if (cfSecret !== CLOUDFRONT_SHARED_SECRET) {
    return null;
  }

  // Parse JWT token
  const authHeader = headers.authorization;
  if (!authHeader) return null;

  const token = String(authHeader).replace(/^Bearer\s+/i, '');
  const payload = parseJwt(token);
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;

  return sub || null;
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';

  if (path.includes('/health')) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ status: 'healthy', timestamp: Date.now() }),
    };
  }

  if (!path.includes('/stream')) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  const userId = validateAuth(event.headers || {});
  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  if (!NOTIFICATIONS_TABLE) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Notifications not configured' }),
    };
  }

  // For now, return a simple response since Lambda doesn't support true streaming
  // In production, this would need API Gateway WebSocket or a different approach
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-arcanum-cloudfront-secret',
    },
    body: `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`,
  };
};
