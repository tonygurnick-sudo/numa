import * as crypto from 'node:crypto';
import * as process from 'node:process';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function calculateSecretHash(username: string): string {
  const message = username + CLIENT_ID;
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET);
  return hmac.update(message).digest('base64');
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Request received:', {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    requestId: event.requestContext.requestId,
  });

  if (event.requestContext.http.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, userSub } = body;

    console.log('Request body:', {
      email: email ? '***@' + email.split('@')[1] : undefined, // Mask email for privacy
      hasUserSub: !!userSub,
    });

    if (!email && !userSub) {
      console.warn('Validation failed: Missing required fields', {
        hasEmail: !!email,
        hasUserSub: !!userSub,
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Either email or userSub must be provided' }),
      };
    }

    if (email && !isValidEmail(email)) {
      console.warn('Validation failed: Invalid email format', {
        emailLength: email.length,
        emailDomain: email.split('@')[1],
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' }),
      };
    }

    const username = email || userSub;
    console.log('Generating hash for username');
    const hash = calculateSecretHash(username);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ hash }),
    };
  } catch (error) {
    console.error('Error processing request:', {
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
      stackTrace: (error as Error).stack,
      eventBody: event.body,
    });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
