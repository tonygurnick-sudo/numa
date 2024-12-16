import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
  InitiateAuthCommandOutput,
  RespondToAuthChallengeCommand,
  RespondToAuthChallengeCommandInput,
  RespondToAuthChallengeCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'node:crypto';
import * as process from 'node:process';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
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
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET); // Use 'createHmac' from 'crypto'
  return hmac.update(message).digest('base64'); // Return the hash in base64 format
}

interface Body {
  username: string;
  srpA: string;
  challengeResponses: ChallengeResponses;
  timestamp: string;
  refreshToken: string;
}

interface ChallengeResponses {
  PASSWORD_CLAIM_SECRET_BLOCK: string;
  PASSWORD_CLAIM_SIGNATURE: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body || '{}') as Body;
    let result;

    const path = event.rawPath;

    if (path === '/api/initiate') {
      result = await handleInitiateAuth(body);
    } else if (path === '/api/respond') {
      result = await handleRespondToChallenge(body);
    } else if (path === '/api/refresh') {
      result = await handleRefreshToken(body);
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid path' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};

async function handleInitiateAuth(body: Body): Promise<InitiateAuthCommandOutput> {
  const { username, srpA } = body;

  if (!username || !srpA) {
    throw new Error('Missing required parameters');
  }

  console.log('InitiateAuth request:', { username, srpA });

  const secretHash = calculateSecretHash(username);

  const params: InitiateAuthCommandInput = {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: username,
      SRP_A: srpA,
      SECRET_HASH: secretHash,
    },
  };

  return await cognito.send(new InitiateAuthCommand(params));
}

async function handleRespondToChallenge(body: Body): Promise<RespondToAuthChallengeCommandOutput> {
  const { username, challengeResponses, timestamp } = body;

  console.log('RespondToChallenge request body:', JSON.stringify(body, null, 2));

  if (!username) {
    throw new Error('Missing required parameter: username');
  }

  if (!challengeResponses) {
    throw new Error('Missing required parameter: challengeResponses');
  }

  const { PASSWORD_CLAIM_SECRET_BLOCK, PASSWORD_CLAIM_SIGNATURE } = challengeResponses;

  if (!PASSWORD_CLAIM_SECRET_BLOCK) {
    console.error('Missing PASSWORD_CLAIM_SECRET_BLOCK');
    throw new Error('Missing required parameter: PASSWORD_CLAIM_SECRET_BLOCK');
  }

  if (!PASSWORD_CLAIM_SIGNATURE) {
    console.error('Missing PASSWORD_CLAIM_SIGNATURE');
    throw new Error('Missing required parameter: PASSWORD_CLAIM_SIGNATURE');
  }

  console.log('RespondToChallenge received valid parameters:', {
    username,
    PASSWORD_CLAIM_SECRET_BLOCK,
    PASSWORD_CLAIM_SIGNATURE,
  });

  const secretHash = calculateSecretHash(username);

  const params: RespondToAuthChallengeCommandInput = {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: CLIENT_ID,
    ChallengeResponses: {
      USERNAME: username,
      PASSWORD_CLAIM_SECRET_BLOCK,
      PASSWORD_CLAIM_SIGNATURE,
      SECRET_HASH: secretHash,
      TIMESTAMP: timestamp,
    },
  };

  return await cognito.send(new RespondToAuthChallengeCommand(params));
}

async function handleRefreshToken(body: Body): Promise<InitiateAuthCommandOutput> {
  const { refreshToken, username } = body;

  if (!refreshToken) {
    throw new Error('Missing required parameter: refreshToken');
  }
  if (!username) {
    throw new Error('Missing required parameter: username');
  }

  const params: InitiateAuthCommandInput = {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
      SECRET_HASH: calculateSecretHash(username),
    },
  };

  return await cognito.send(new InitiateAuthCommand(params));
}
