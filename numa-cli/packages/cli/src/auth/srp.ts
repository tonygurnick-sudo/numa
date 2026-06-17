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
 * TOTP MFA (SOFTWARE_TOKEN_MFA / SMS_MFA) is supported: srpLogin returns an
 * `mfa_required` result carrying the Cognito Session, and the caller answers it
 * with `respondToMfaChallenge` after prompting for the code. The flows that can
 * only be completed in the browser (NEW_PASSWORD_REQUIRED, MFA_SETUP) throw with
 * an actionable message pointing the user at the web interface.
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

/** SRP succeeded outright — no further challenge. */
export interface SrpAuthSuccess {
  status: 'authenticated';
  authResult: AuthenticationResultType;
  config: ClientConfig;
  username: string;
  secretHash: string;
}

/** Password verified, but Cognito wants a one-time MFA code next. */
export interface SrpMfaRequired {
  status: 'mfa_required';
  challengeName: 'SOFTWARE_TOKEN_MFA' | 'SMS_MFA';
  session: string;
  config: ClientConfig;
  username: string;
  secretHash: string;
}

export type SrpLoginResult = SrpAuthSuccess | SrpMfaRequired;

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

  // Password verified but Cognito wants a second factor. Hand the session back
  // to the caller (the command layer prompts for the code, then calls
  // respondToMfaChallenge) so this module stays free of terminal I/O.
  if (challengeResponse.ChallengeName === 'SOFTWARE_TOKEN_MFA' || challengeResponse.ChallengeName === 'SMS_MFA') {
    if (!challengeResponse.Session) {
      throw new Error(`srpLogin: ${challengeResponse.ChallengeName} challenge returned without a Session`);
    }
    return {
      status: 'mfa_required',
      challengeName: challengeResponse.ChallengeName,
      session: challengeResponse.Session,
      config,
      username: lowercaseUsername,
      secretHash,
    };
  }

  // Browser-only flows — can't be completed from the CLI.
  if (challengeResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    throw new Error(
      'srpLogin: a password change is required — please log in via the web interface first, then retry `numa login`'
    );
  }
  if (challengeResponse.ChallengeName === 'MFA_SETUP') {
    throw new Error(
      'srpLogin: MFA setup is required — please complete MFA setup via the web interface first, then retry `numa login`'
    );
  }
  if (challengeResponse.ChallengeName) {
    throw new Error(`srpLogin: post-password challenge '${challengeResponse.ChallengeName}' is not supported`);
  }
  if (!challengeResponse.AuthenticationResult) {
    throw new Error('srpLogin: no AuthenticationResult in PASSWORD_VERIFIER response');
  }

  return {
    status: 'authenticated',
    authResult: challengeResponse.AuthenticationResult,
    config,
    username: lowercaseUsername,
    secretHash,
  };
}

/**
 * Answer a SOFTWARE_TOKEN_MFA / SMS_MFA challenge raised by srpLogin with the
 * one-time code the user just entered. A wrong code surfaces as Cognito's
 * CodeMismatchException; the session is single-use, so re-run `numa login` to
 * get a fresh challenge.
 */
export async function respondToMfaChallenge(
  challenge: SrpMfaRequired,
  code: string
): Promise<AuthenticationResultType> {
  const cognitoClient = new CognitoIdentityProviderClient({ region: challenge.config.REGION });

  const codeKey = challenge.challengeName === 'SMS_MFA' ? 'SMS_MFA_CODE' : 'SOFTWARE_TOKEN_MFA_CODE';

  const response = await cognitoClient.send(
    new RespondToAuthChallengeCommand({
      ChallengeName: challenge.challengeName,
      ClientId: challenge.config.CLIENT_ID,
      Session: challenge.session,
      ChallengeResponses: {
        USERNAME: challenge.username,
        [codeKey]: code,
        SECRET_HASH: challenge.secretHash,
      },
    })
  );

  if (response.ChallengeName) {
    throw new Error(`respondToMfaChallenge: unexpected follow-up challenge '${response.ChallengeName}'`);
  }
  if (!response.AuthenticationResult) {
    throw new Error('respondToMfaChallenge: no AuthenticationResult after MFA code');
  }

  return response.AuthenticationResult;
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
