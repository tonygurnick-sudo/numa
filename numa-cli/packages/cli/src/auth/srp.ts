/**
 * Cognito SRP login wrapped around `cognito-srp-helper` (the same JS lib the
 * frontend and `numa-admin-cli` both use).
 *
 * Two-step flow against Cognito's user pool:
 *   1. InitiateAuth(USER_SRP_AUTH) → PASSWORD_VERIFIER challenge.
 *   2. RespondToAuthChallenge(PASSWORD_VERIFIER) → AuthenticationResult.
 *
 * SECRET_HASH is fetched from /api/srp-hasher because the app client has
 * `generateSecret: true` (the secret stays Lambda-side; clients only ever
 * see the hash).
 *
 * MFA challenges (SOFTWARE_TOKEN_MFA, NEW_PASSWORD_REQUIRED, DEVICE_SRP_AUTH)
 * are not handled in v1 — they throw with a clear message. nd-labs has MFA
 * off, prod tenants will need the additional flows wired in later.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import { fetchClientConfig, type ClientConfig } from '../api/client.js';
import { fetchSecretHash } from '../api/srp-hasher.js';

export interface SrpLoginResult {
  authResult: AuthenticationResultType;
  config: ClientConfig;
  username: string;
  secretHash: string;
}

export async function srpLogin(account: string, username: string, password: string): Promise<SrpLoginResult> {
  const lowercaseUsername = username.toLowerCase();

  const config = await fetchClientConfig(account);
  const secretHash = await fetchSecretHash(account, lowercaseUsername, config);

  const cognitoClient = new CognitoIdentityProviderClient({ region: config.REGION });

  const srpSession = createSrpSession(lowercaseUsername, password, config.USER_POOL_ID, false);

  const initiateAuthResponse = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: config.CLIENT_ID,
      AuthParameters: {
        USERNAME: lowercaseUsername,
        SRP_A: srpSession.largeA,
        SECRET_HASH: secretHash,
      },
    })
  );

  if (initiateAuthResponse.ChallengeName !== 'PASSWORD_VERIFIER') {
    throw new Error(
      `srpLogin: unexpected challenge ${JSON.stringify(initiateAuthResponse.ChallengeName)} from InitiateAuth`
    );
  }
  if (!initiateAuthResponse.ChallengeParameters) {
    throw new Error('srpLogin: missing ChallengeParameters in InitiateAuth response');
  }

  const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);

  const challengeResponse = await cognitoClient.send(
    new RespondToAuthChallengeCommand({
      ChallengeName: 'PASSWORD_VERIFIER',
      ClientId: config.CLIENT_ID,
      ChallengeResponses: {
        USERNAME: lowercaseUsername,
        PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
        PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
        SECRET_HASH: secretHash,
        TIMESTAMP: signedSrpSession.timestamp,
      },
    })
  );

  if (challengeResponse.ChallengeName) {
    throw new Error(
      `srpLogin: post-password challenge '${challengeResponse.ChallengeName}' is not supported in v1 (MFA / device trust / new password required not yet wired in)`
    );
  }
  if (!challengeResponse.AuthenticationResult) {
    throw new Error('srpLogin: no AuthenticationResult in PASSWORD_VERIFIER response');
  }

  return {
    authResult: challengeResponse.AuthenticationResult,
    config,
    username: lowercaseUsername,
    secretHash,
  };
}

/**
 * Refresh an expired access/id token using the stored refresh token.
 * Identifies the user via the immutable userSub.
 */
export async function refreshSession(
  account: string,
  userSub: string,
  refreshToken: string
): Promise<{ authResult: AuthenticationResultType; config: ClientConfig }> {
  const config = await fetchClientConfig(account);
  const secretHash = await fetchSecretHash(account, userSub, config);

  const cognitoClient = new CognitoIdentityProviderClient({ region: config.REGION });

  const response = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        SECRET_HASH: secretHash,
      },
    })
  );

  if (!response.AuthenticationResult) {
    throw new Error('refreshSession: no AuthenticationResult — refresh token may be revoked');
  }

  return { authResult: response.AuthenticationResult, config };
}
