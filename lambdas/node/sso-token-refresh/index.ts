import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// Cognito binds refresh tokens to the flow that issued them. Refresh tokens
// issued via the Hosted-UI SAML/OAuth2 flow can ONLY be exchanged against the
// OAuth2 /token endpoint with client_secret — InitiateAuth REFRESH_TOKEN_AUTH
// rejects them (which is what was silently kicking SSO users every ~10-20min).
// Native (SRP) users keep using InitiateAuth on the client; federated users
// route through this lambda so the client_secret stays server-side.
const CLIENT_ID = process.env.COGNITO_CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;
const COGNITO_REGION = process.env.COGNITO_REGION as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
} as const;

function getCognitoDomain(): string {
  return `numa-${CLIENT_NAME}`;
}

function getTokenEndpoint(): string {
  return `https://${getCognitoDomain()}.auth.${COGNITO_REGION}.amazoncognito.com/oauth2/token`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }

    const { refreshToken } = body as { refreshToken?: string };

    if (!refreshToken) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'refreshToken is required' }) };
    }

    if (typeof refreshToken !== 'string') {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'refreshToken must be a string' }) };
    }

    // Cognito refresh tokens are JWT-shaped and well over 100 chars; cap at 4KB
    // to reject obviously malformed/oversized input.
    if (refreshToken.length < 20 || refreshToken.length > 4096) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid refresh token' }) };
    }

    console.log(`SSO token refresh: clientName=${CLIENT_NAME}`);

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let tokenRes: Response;
    try {
      tokenRes = await fetch(getTokenEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      const isTimeout = (fetchErr as Error).name === 'AbortError';
      console.error(
        JSON.stringify({
          _name: isTimeout ? 'SSO_REFRESH_TIMEOUT' : 'SSO_REFRESH_FETCH_ERROR',
          error: (fetchErr as Error).message,
          clientName: CLIENT_NAME,
        })
      );
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({
          error: isTimeout ? 'Cognito token endpoint timed out' : 'Failed to reach Cognito token endpoint',
        }),
      };
    } finally {
      clearTimeout(timeout);
    }

    let tokenData: unknown;
    try {
      tokenData = await tokenRes.json();
    } catch {
      console.error(`SSO token refresh: failed to parse Cognito response (status=${tokenRes.status})`);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Invalid response from Cognito' }) };
    }

    if (!tokenRes.ok) {
      console.error(
        JSON.stringify({
          _name: 'SSO_REFRESH_FAILURE',
          status: tokenRes.status,
          clientName: CLIENT_NAME,
          error: tokenData,
        })
      );
      return {
        statusCode: tokenRes.status,
        headers: HEADERS,
        body: JSON.stringify({
          error: 'Token refresh failed',
          detail: (tokenData as Record<string, unknown>)?.error || 'Unknown error',
        }),
      };
    }

    // Refresh flow returns access_token and id_token; refresh_token is NOT
    // re-issued (Cognito keeps the existing one valid), matching the behaviour
    // the frontend already assumes for native InitiateAuth refreshes.
    const data = tokenData as Record<string, unknown>;
    if (!data.access_token || !data.id_token) {
      console.error(
        JSON.stringify({
          _name: 'SSO_REFRESH_FAILURE',
          reason: 'incomplete_tokens',
          has_access: !!data.access_token,
          has_id: !!data.id_token,
          clientName: CLIENT_NAME,
        })
      );
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({ error: 'Incomplete token response from Cognito' }),
      };
    }

    console.log(JSON.stringify({ _name: 'SSO_REFRESH_SUCCESS', clientName: CLIENT_NAME }));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ access_token: data.access_token, id_token: data.id_token }),
    };
  } catch (error) {
    console.error(
      JSON.stringify({ _name: 'SSO_TOKEN_REFRESH_ERROR', error: (error as Error).message, clientName: CLIENT_NAME })
    );
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
