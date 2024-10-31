import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function calculateSecretHash(username) {
  const message = username + CLIENT_ID;
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET); // Use 'createHmac' from 'crypto'
  return hmac.update(message).digest('base64'); // Return the hash in base64 format
}

export const handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let result;

    const path = event.rawPath;

    if (path === '/initiate') {
      result = await handleInitiateAuth(body);
    } else if (path === '/respond') {
      result = await handleRespondToChallenge(body);
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
      body: JSON.stringify(result), // Send the full result back to the frontend
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function handleInitiateAuth(body) {
  const { username, srpA } = body;

  if (!username || !srpA) {
    throw new Error('Missing required parameters');
  }

  console.log('InitiateAuth request:', { username, srpA });

  const secretHash = calculateSecretHash(username);

  const params = {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: username,
      SRP_A: srpA,
      SECRET_HASH: secretHash,
    },
  };

  try {
    // Send the full response back to the frontend without stripping any challenge parameters
    const response = await cognito.send(new InitiateAuthCommand(params));
    return response; // Return the entire response
  } catch (error) {
    console.error('InitiateAuth Error:', error);
    throw error;
  }
}

async function handleRespondToChallenge(body) {
  const { username, challengeResponses, timestamp } = body;

  // Log the incoming body for debugging
  console.log(
    'RespondToChallenge request body:',
    JSON.stringify(body, null, 2),
  );

  // Check for missing parameters and log specific errors
  if (!username) {
    throw new Error('Missing required parameter: username');
  }

  if (!challengeResponses) {
    throw new Error('Missing required parameter: challengeResponses');
  }

  const { PASSWORD_CLAIM_SECRET_BLOCK, PASSWORD_CLAIM_SIGNATURE } =
    challengeResponses;

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

  const params = {
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

  try {
    const response = await cognito.send(
      new RespondToAuthChallengeCommand(params),
    );
    console.log('RespondToAuthChallenge successful:', response);
    return response;
  } catch (error) {
    console.error('RespondToAuthChallenge Error:', error);
    throw error;
  }
}
