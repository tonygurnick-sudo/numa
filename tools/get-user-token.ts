/**
 * Mint Cognito JWTs for a Numa user via SRP login (USER_SRP_AUTH).
 *
 * Numa app clients only allow SRP + custom auth — no USER_PASSWORD_AUTH — and
 * are configured with a client secret, so plain `aws cognito-idp
 * initiate-auth` can't produce tokens. This tool performs the same handshake
 * the frontend does (`AuthProvider.handleSrpLogin`): fetch the SECRET_HASH
 * from the instance's public /api/srp-hasher endpoint, then run the SRP
 * exchange with `cognito-srp-helper`.
 *
 * Pool/client ids are read from the deployed instance's public config.json.
 * Users with MFA configured are rejected — use a user without MFA (e.g. the
 * system user).
 *
 * Usage:
 *   cd tools/
 *   yarn tsx get-user-token.ts <client-name> <email> <password>
 *
 * For the system user, fetch the password first:
 *   yarn tsx get-user-token.ts arcanum-demo-tom numa-system-user@arcanum.ai \
 *     "$(AWS_PROFILE=q-demo aws secretsmanager get-secret-value \
 *        --secret-id arcanum-demo-tom-system-user-password --region us-east-1 \
 *        --query SecretString --output text | jq -r .password)"
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';

const [clientName, usernameArg, password] = process.argv.slice(2);
if (!clientName || !usernameArg || !password) {
  console.error('Usage: yarn tsx get-user-token.ts <client-name> <email> <password>');
  process.exit(1);
}
const username = usernameArg.toLowerCase();
const baseUrl = `https://${clientName}.numa.arcanum.ai`;

const configResponse = await fetch(`${baseUrl}/config.json`);
if (!configResponse.ok) {
  console.error(`Failed to fetch config.json for ${clientName}: ${configResponse.status}`);
  process.exit(1);
}
const config = (await configResponse.json()) as { USER_POOL_ID: string; CLIENT_ID: string; REGION: string };

const hashResponse = await fetch(`${baseUrl}/api/srp-hasher`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: username }),
});
if (!hashResponse.ok) {
  console.error(`srp-hasher returned ${hashResponse.status}`);
  process.exit(1);
}
const { hash: SECRET_HASH } = (await hashResponse.json()) as { hash: string };

const cognito = new CognitoIdentityProviderClient({ region: config.REGION });

const srpSession = createSrpSession(username, password, config.USER_POOL_ID, false);

const initiateResponse = await cognito.send(
  new InitiateAuthCommand({
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: config.CLIENT_ID,
    AuthParameters: { USERNAME: username, SRP_A: srpSession.largeA, SECRET_HASH },
  })
);
if (!initiateResponse.ChallengeParameters) {
  console.error('Missing ChallengeParameters in InitiateAuth response');
  process.exit(1);
}

const signedSession = signSrpSession(srpSession, initiateResponse);

const challengeResponse = await cognito.send(
  new RespondToAuthChallengeCommand({
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: config.CLIENT_ID,
    ChallengeResponses: {
      USERNAME: username,
      PASSWORD_CLAIM_SECRET_BLOCK: signedSession.secret,
      PASSWORD_CLAIM_SIGNATURE: signedSession.passwordSignature,
      TIMESTAMP: signedSession.timestamp,
      SECRET_HASH,
    },
  })
);

if (challengeResponse.ChallengeName) {
  console.error(`Unhandled follow-up challenge: ${challengeResponse.ChallengeName} — use a user without MFA`);
  process.exit(1);
}
const tokens = challengeResponse.AuthenticationResult;
if (!tokens?.IdToken || !tokens.AccessToken) {
  console.error('No tokens in RespondToAuthChallenge response');
  process.exit(1);
}

const idPayload = JSON.parse(Buffer.from(tokens.IdToken.split('.')[1], 'base64').toString('utf8'));
console.log(
  JSON.stringify(
    { sub: idPayload.sub, email: idPayload.email, idToken: tokens.IdToken, accessToken: tokens.AccessToken },
    null,
    2
  )
);
