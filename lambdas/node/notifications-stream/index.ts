import { timingSafeEqual } from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME ?? '';
const CLOUDFRONT_SHARED_SECRET = process.env.CLOUDFRONT_SHARED_SECRET ?? '';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const USER_POOL_CLIENT_ID = process.env.COGNITO_USER_POOL_CLIENT_ID ?? '';
const ADDITIONAL_IDS = (process.env.ADDITIONAL_COGNITO_CLIENT_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALL_CLIENT_IDS = ADDITIONAL_IDS.length > 0 ? [USER_POOL_CLIENT_ID, ...ADDITIONAL_IDS] : USER_POOL_CLIENT_ID;

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: ALL_CLIENT_IDS,
  includeRawJwtInErrors: true,
});

// Constant-time string comparison. timingSafeEqual throws on length mismatch,
// so guard the length first and treat a mismatch as not-equal without leaking
// timing via an early return on the buffers themselves.
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};

// Verify the bearer token's signature against the Cognito JWKS and return the
// verified subject. Fails closed: any verification error (bad signature,
// expiry, wrong audience, missing header) returns null → 401.
const validateAuth = async (headers: Record<string, string | undefined>): Promise<string | null> => {
  // Validate CloudFront secret with a constant-time comparison
  const cfSecret = headers['x-arcanum-cloudfront-secret'];
  if (!cfSecret || !constantTimeEquals(cfSecret, CLOUDFRONT_SHARED_SECRET)) {
    return null;
  }

  // Verify JWT signature with Cognito (never trust an unverified decode)
  const authHeader = headers.authorization;
  if (!authHeader) return null;

  const token = String(authHeader).replace(/^Bearer\s+/i, '');

  try {
    const payload = await verifier.verify(token);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (err) {
    console.error('JWT verification failed:', err);
    return null;
  }
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

  const userId = await validateAuth(event.headers || {});
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
