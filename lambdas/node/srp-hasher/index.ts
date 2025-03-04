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

function calculateSecretHash(email: string): string {
  const message = email + CLIENT_ID;
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET);
  return hmac.update(message).digest('base64');
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const { email } = body;

    if (!email || !isValidEmail(email)) {
      console.warn('Invalid or missing email:', email);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid or missing email' }),
      };
    }

    const hash = calculateSecretHash(email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ hash }),
    };
  } catch (error) {
    console.error('Error:', error);
    console.error('Error stack:', (error as Error).stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
