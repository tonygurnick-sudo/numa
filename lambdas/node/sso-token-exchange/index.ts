import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const CLIENT_ID = process.env.COGNITO_CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;
const COGNITO_REGION = process.env.COGNITO_REGION as string;
const CLIENT_NAME = process.env.CLIENT_NAME as string;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type',
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

    const { code, redirectUri } = body as { code?: string; redirectUri?: string };

    if (!code || !redirectUri) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: 'code and redirectUri are required' }),
      };
    }

    // Fix #9: basic input validation to prevent abuse
    if (typeof code !== 'string' || typeof redirectUri !== 'string') {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: 'code and redirectUri must be strings' }),
      };
    }

    // Fix #9: validate code length (Cognito codes are ~64 chars, reject obviously invalid)
    if (code.length > 2048 || code.length < 10) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid authorization code' }) };
    }

    // Validate redirectUri is a valid URL using https (HTTPS-only — reject http and all other schemes)
    try {
      const parsed = new URL(redirectUri);
      if (parsed.protocol !== 'https:') {
        return {
          statusCode: 400,
          headers: HEADERS,
          body: JSON.stringify({ error: 'redirectUri must use https' }),
        };
      }
    } catch {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'redirectUri must be a valid URL' }) };
    }

    console.log(`SSO token exchange: clientName=${CLIENT_NAME}, redirectUri=${redirectUri}`);

    // Exchange authorization code for tokens via Cognito's /oauth2/token endpoint.
    // The client_secret is added server-side — never sent from the browser.
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

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
          _name: isTimeout ? 'SSO_TOKEN_EXCHANGE_TIMEOUT' : 'SSO_TOKEN_EXCHANGE_FETCH_ERROR',
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
      console.error(`SSO token exchange: failed to parse Cognito response (status=${tokenRes.status})`);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Invalid response from Cognito' }) };
    }

    if (!tokenRes.ok) {
      console.error(
        JSON.stringify({
          _name: 'SSO_LOGIN_FAILURE',
          status: tokenRes.status,
          clientName: CLIENT_NAME,
          error: tokenData,
        })
      );
      return {
        statusCode: tokenRes.status,
        headers: HEADERS,
        body: JSON.stringify({
          error: 'Token exchange failed',
          detail: (tokenData as Record<string, unknown>)?.error || 'Unknown error',
        }),
      };
    }

    // Fix #6: validate Cognito returned all required tokens
    const data = tokenData as Record<string, unknown>;
    if (!data.access_token || !data.id_token || !data.refresh_token) {
      console.error(
        JSON.stringify({
          _name: 'SSO_LOGIN_FAILURE',
          reason: 'incomplete_tokens',
          has_access: !!data.access_token,
          has_id: !!data.id_token,
          has_refresh: !!data.refresh_token,
          clientName: CLIENT_NAME,
        })
      );
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({ error: 'Incomplete token response from Cognito' }),
      };
    }

    console.log(JSON.stringify({ _name: 'SSO_LOGIN_SUCCESS', clientName: CLIENT_NAME }));

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(tokenData) };
  } catch (error) {
    console.error(
      JSON.stringify({ _name: 'SSO_TOKEN_EXCHANGE_ERROR', error: (error as Error).message, clientName: CLIENT_NAME })
    );
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
