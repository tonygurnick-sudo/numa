import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock the Cognito verifier so module init never touches the JWKS network and
// each test controls whether verification succeeds or fails.
const verifyMock = vi.fn();
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: (): { verify: typeof verifyMock } => ({ verify: verifyMock }),
  },
}));

const SECRET = 'cf-shared-secret';

// Module-level constants read process.env at import time — set before importing.
process.env.CLOUDFRONT_SHARED_SECRET = SECRET;
process.env.NOTIFICATIONS_TABLE_NAME = 'notifications-table';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_pool';
process.env.COGNITO_USER_POOL_CLIENT_ID = 'client-id';

let handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

beforeAll(async () => {
  ({ handler } = (await import('./index')) as {
    handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
  });
});

const streamEvent = (headers: Record<string, string>): APIGatewayProxyEventV2 =>
  ({
    rawPath: '/notifications/stream',
    requestContext: { http: { path: '/notifications/stream' } },
    headers,
  }) as unknown as APIGatewayProxyEventV2;

describe('notifications-stream auth', () => {
  it('returns 401 when the CloudFront secret does not match', async () => {
    verifyMock.mockResolvedValue({ sub: 'user-1' });
    const res = await handler(
      streamEvent({ 'x-arcanum-cloudfront-secret': 'wrong', authorization: 'Bearer good.jwt.token' })
    );
    expect(res.statusCode).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('fails closed (401) when JWT verification throws', async () => {
    verifyMock.mockRejectedValueOnce(new Error('invalid signature'));
    const res = await handler(
      streamEvent({ 'x-arcanum-cloudfront-secret': SECRET, authorization: 'Bearer tampered.jwt.token' })
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the verified sub when secret and JWT are valid', async () => {
    verifyMock.mockResolvedValueOnce({ sub: 'user-1' });
    const res = await handler(
      streamEvent({ 'x-arcanum-cloudfront-secret': SECRET, authorization: 'Bearer good.jwt.token' })
    );
    expect(res.statusCode).toBe(200);
  });
});
