/**
 * Authentication commands for Numa CLI.
 * Handles login/logout with Cognito.
 * Credentials are stored per-environment in ~/.numa/credentials/<env-name>.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminInitiateAuthCommand,
  RespondToAuthChallengeCommand,
  AdminRespondToAuthChallengeCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  ListGroupsCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromTemporaryCredentials, fromIni } from '@aws-sdk/credential-providers';
import { createSrpSession, signSrpSession } from 'cognito-srp-helper';
import { getCurrentEnv, getCurrentEnvName, getDeployerProfile } from '../config.js';
import { DOMAIN_SUFFIX } from '../types.js';

const NUMA_DIR = join(homedir(), '.numa');
const CREDENTIALS_DIR = join(NUMA_DIR, 'credentials');

interface StoredCredentials {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  environment: string;
}

interface ResolvedCognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
  apiEndpoint: string;
}

/**
 * Prompt for input (with optional hidden input for passwords).
 */
function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdin.isTTY) {
      // For password input, we need to handle it specially
      process.stdout.write(question);
      let password = '';

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Get the credentials file path for an environment.
 */
function getCredentialsPath(envName: string): string {
  return join(CREDENTIALS_DIR, `${envName}.json`);
}

/**
 * Ensure the credentials directory exists.
 */
function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get Cognito configuration for the current environment.
 * Uses the stored config from `numa env use` (fetched from AWS).
 */
function getCognitoConfig(clientName: string, region: string): ResolvedCognitoConfig {
  const env = getCurrentEnv();

  if (!env?.cognito) {
    throw new Error(
      `Cognito configuration not found for ${clientName}.\n` +
      `Run "numa env use ${clientName}" to fetch Cognito details from AWS.\n` +
      `Or manually add Cognito config with "numa env refresh".`
    );
  }

  // Build API endpoint from domain pattern
  const apiEndpoint = `https://${clientName}.${DOMAIN_SUFFIX}/api`;

  return {
    userPoolId: env.cognito.userPoolId,
    clientId: env.cognito.clientId,
    region: env.cognito.region || region,
    apiEndpoint,
  };
}

/**
 * Fetch the secret hash from the srp-hasher endpoint.
 */
async function fetchSecretHash(apiEndpoint: string, identifier: string): Promise<string> {
  const isEmail = identifier.includes('@');
  const payload = isEmail ? { email: identifier } : { userSub: identifier };

  const response = await fetch(`${apiEndpoint}/srp-hasher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch secret hash: ${response.status}`);
  }

  const data = await response.json() as { hash: string };
  if (!data.hash) {
    throw new Error('Secret hash not received from server');
  }

  return data.hash;
}

/**
 * Save credentials to disk (per-environment).
 */
function saveCredentials(creds: StoredCredentials, envName: string): void {
  ensureCredentialsDir();
  const credPath = getCredentialsPath(envName);
  writeFileSync(credPath, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Load credentials from disk for the current environment.
 */
export function loadCredentials(): StoredCredentials | undefined {
  const envName = getCurrentEnvName();
  if (!envName) {
    return undefined;
  }

  const credPath = getCredentialsPath(envName);
  if (!existsSync(credPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(credPath, 'utf-8');
    return JSON.parse(content) as StoredCredentials;
  } catch {
    return undefined;
  }
}

/**
 * Clear stored credentials for the current environment.
 */
function clearCredentials(): void {
  const envName = getCurrentEnvName();
  if (!envName) {
    return;
  }

  const credPath = getCredentialsPath(envName);
  if (existsSync(credPath)) {
    unlinkSync(credPath);
  }
}

/**
 * Check if the current token is still valid.
 */
export async function isTokenValid(): Promise<boolean> {
  const creds = loadCredentials();
  if (!creds) {
    return false;
  }

  // Check expiry (with 5 minute buffer)
  const now = Math.floor(Date.now() / 1000);
  if (creds.expiresAt <= now + 300) {
    return false;
  }

  return true;
}

/**
 * Get the current access token, refreshing if needed.
 */
export async function getAccessToken(): Promise<string | undefined> {
  const creds = loadCredentials();
  if (!creds) {
    return undefined;
  }

  // Check if token needs refresh
  const now = Math.floor(Date.now() / 1000);
  if (creds.expiresAt <= now + 300) {
    // Token expired or expiring soon - would need to refresh
    // For now, return undefined and require re-login
    console.error('Token expired. Please run "numa login" again.');
    return undefined;
  }

  return creds.accessToken;
}

/**
 * Get the current ID token.
 */
export function getIdToken(): string | undefined {
  const creds = loadCredentials();
  return creds?.idToken;
}

/**
 * Create the login command.
 */
export function createLoginCommand(): Command {
  const cmd = new Command('login')
    .description('Log in to Numa')
    .option('-u, --username <email>', 'Email address')
    .option('-p, --password <password>', 'Password (will prompt if not provided)')
    .option('--admin', 'Use admin auth (bypasses Cognito risk checks, requires AWS credentials)')
    .action(async (options: { username?: string; password?: string; admin?: boolean }) => {
      try {
        if (options.admin) {
          await adminLogin(options.username, options.password);
        } else {
          await login(options.username, options.password);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Login failed: ${error.message}`);
          if (error.message.includes('Incorrect username or password')) {
            console.error('');
            console.error('This can also happen if the account is temporarily locked');
            console.error('due to too many failed attempts (Cognito advanced security).');
            console.error('Try "numa login --admin" to bypass risk checks.');
          }
          if (process.env['NUMA_DEBUG'] !== '1') {
            console.error('');
            console.error('Run with NUMA_DEBUG=1 for verbose output.');
          }
        }
        process.exit(1);
      }
    });

  return cmd;
}

async function login(usernameArg?: string, passwordArg?: string): Promise<void> {
  // Get current environment
  const env = getCurrentEnv();
  const envName = getCurrentEnvName();
  if (!env || !envName) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  console.log(`Logging in to: ${env.clientName}`);

  // Get Cognito configuration (stored during env setup)
  const cognitoConfig = getCognitoConfig(env.clientName, env.region);

  // Prompt for credentials if not provided
  const username = usernameArg ?? await prompt('Email: ');
  const password = passwordArg ?? await prompt('Password: ', true);

  const lowercaseUsername = username.toLowerCase();

  const verbose = process.env['NUMA_DEBUG'] === '1';
  const log = (msg: string) => { if (verbose) console.log(`  [debug] ${msg}`); };

  console.log('Authenticating...');

  // Get secret hash
  log(`Fetching secret hash from ${cognitoConfig.apiEndpoint}/srp-hasher`);
  const secretHash = await fetchSecretHash(cognitoConfig.apiEndpoint, lowercaseUsername);
  log(`Secret hash received (${secretHash.length} chars)`);

  // Create Cognito client
  const cognitoClient = new CognitoIdentityProviderClient({
    region: cognitoConfig.region,
  });

  // Create SRP session
  log(`Creating SRP session for pool ${cognitoConfig.userPoolId}`);
  const srpSession = createSrpSession(
    lowercaseUsername,
    password,
    cognitoConfig.userPoolId,
    false
  );
  log(`SRP_A generated (${srpSession.largeA.length} chars)`);

  // Initiate authentication
  log(`Sending InitiateAuth (USER_SRP_AUTH) to Cognito`);
  log(`  ClientId: ${cognitoConfig.clientId}`);
  log(`  Region: ${cognitoConfig.region}`);
  const initiateAuthResponse = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: cognitoConfig.clientId,
      AuthParameters: {
        USERNAME: lowercaseUsername,
        SRP_A: srpSession.largeA,
        SECRET_HASH: secretHash,
      },
    })
  );

  if (!initiateAuthResponse.ChallengeParameters) {
    throw new Error('Missing ChallengeParameters in response');
  }

  log(`InitiateAuth response: ${initiateAuthResponse.ChallengeName}`);
  log(`  USER_ID_FOR_SRP: ${initiateAuthResponse.ChallengeParameters.USER_ID_FOR_SRP}`);
  log(`  SALT length: ${initiateAuthResponse.ChallengeParameters.SALT?.length}`);
  log(`  SRP_B length: ${initiateAuthResponse.ChallengeParameters.SRP_B?.length}`);

  // Sign SRP session (library uses USER_ID_FOR_SRP from response for password hash)
  log(`Signing SRP session`);
  const signedSrpSession = signSrpSession(srpSession, initiateAuthResponse);
  log(`  Signature: ${signedSrpSession.passwordSignature.substring(0, 20)}...`);
  log(`  Timestamp: ${signedSrpSession.timestamp}`);

  // Respond to password verifier challenge
  // Use the email (same as frontend AuthProvider does)
  log(`Sending RespondToAuthChallenge (PASSWORD_VERIFIER)`);
  log(`  USERNAME: ${lowercaseUsername}`);
  const authResponse = await cognitoClient.send(
    new RespondToAuthChallengeCommand({
      ChallengeName: 'PASSWORD_VERIFIER',
      ClientId: cognitoConfig.clientId,
      ChallengeResponses: {
        USERNAME: lowercaseUsername,
        PASSWORD_CLAIM_SECRET_BLOCK: signedSrpSession.secret,
        PASSWORD_CLAIM_SIGNATURE: signedSrpSession.passwordSignature,
        SECRET_HASH: secretHash,
        TIMESTAMP: signedSrpSession.timestamp,
      },
    })
  );
  log(`Auth response: ${authResponse.ChallengeName ?? 'SUCCESS (tokens received)'}`);

  // Handle additional challenges
  if (authResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    console.error('Your password must be changed. Please log in via the web interface first.');
    process.exit(1);
  }

  if (authResponse.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
    // Prompt for MFA code
    const mfaCode = await prompt('MFA Code: ');

    const mfaResponse = await cognitoClient.send(
      new RespondToAuthChallengeCommand({
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        ClientId: cognitoConfig.clientId,
        Session: authResponse.Session,
        ChallengeResponses: {
          USERNAME: lowercaseUsername,
          SOFTWARE_TOKEN_MFA_CODE: mfaCode,
          SECRET_HASH: secretHash,
        },
      })
    );

    if (!mfaResponse.AuthenticationResult) {
      throw new Error('MFA verification failed');
    }

    saveTokens(mfaResponse.AuthenticationResult, envName);
    console.log('');
    console.log('✅ Login successful!');
    return;
  }

  if (authResponse.ChallengeName === 'MFA_SETUP') {
    console.error('MFA setup required. Please complete MFA setup via the web interface first.');
    process.exit(1);
  }

  if (!authResponse.AuthenticationResult) {
    throw new Error('Authentication failed - no tokens received');
  }

  saveTokens(authResponse.AuthenticationResult, envName);
  console.log('');
  console.log('✅ Login successful!');
}

/**
 * Admin login - uses AdminInitiateAuth with ADMIN_USER_PASSWORD_AUTH.
 * Bypasses Cognito advanced security risk checks.
 * Requires AWS credentials with cognito-idp:AdminInitiateAuth permission.
 */
async function adminLogin(usernameArg?: string, passwordArg?: string): Promise<void> {
  const env = getCurrentEnv();
  const envName = getCurrentEnvName();
  if (!env || !envName) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  console.log(`Logging in to: ${env.clientName} (admin mode)`);

  const cognitoConfig = getCognitoConfig(env.clientName, env.region);
  const username = usernameArg ?? await prompt('Email: ');
  const password = passwordArg ?? await prompt('Password: ', true);
  const lowercaseUsername = username.toLowerCase();

  console.log('Authenticating via admin auth...');

  // Get secret hash
  const secretHash = await fetchSecretHash(cognitoConfig.apiEndpoint, lowercaseUsername);

  // Use deployer → ArcanumAIAccess credentials to call AdminInitiateAuth
  const deployerCredentials = fromIni({ profile: getDeployerProfile() });
  const credentials = fromTemporaryCredentials({
    masterCredentials: deployerCredentials,
    params: {
      RoleArn: `arn:aws:iam::${env.clientAccountId}:role/ArcanumAIAccess`,
      RoleSessionName: 'numa-cli-admin-auth',
    },
  });

  const cognitoClient = new CognitoIdentityProviderClient({
    region: cognitoConfig.region,
    credentials,
  });

  const authResponse = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      UserPoolId: cognitoConfig.userPoolId,
      ClientId: cognitoConfig.clientId,
      AuthParameters: {
        USERNAME: lowercaseUsername,
        PASSWORD: password,
        SECRET_HASH: secretHash,
      },
    })
  );

  // Handle MFA challenge
  if (authResponse.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
    const mfaCode = await prompt('MFA Code: ');

    const mfaResponse = await cognitoClient.send(
      new AdminRespondToAuthChallengeCommand({
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        UserPoolId: cognitoConfig.userPoolId,
        ClientId: cognitoConfig.clientId,
        Session: authResponse.Session,
        ChallengeResponses: {
          USERNAME: lowercaseUsername,
          SOFTWARE_TOKEN_MFA_CODE: mfaCode,
          SECRET_HASH: secretHash,
        },
      })
    );

    if (!mfaResponse.AuthenticationResult) {
      throw new Error('MFA verification failed');
    }

    saveTokens(mfaResponse.AuthenticationResult, envName);
    console.log('');
    console.log('✅ Login successful!');
    return;
  }

  if (authResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    console.error('Your password must be changed. Please log in via the web interface first.');
    process.exit(1);
  }

  if (!authResponse.AuthenticationResult) {
    throw new Error('Authentication failed - no tokens received');
  }

  saveTokens(authResponse.AuthenticationResult, envName);
  console.log('');
  console.log('✅ Login successful!');
}

interface AuthResult {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

function saveTokens(result: AuthResult, envName: string): void {
  if (!result.AccessToken || !result.IdToken || !result.RefreshToken) {
    throw new Error('Missing tokens in authentication result');
  }

  const expiresIn = result.ExpiresIn ?? 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  saveCredentials({
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresAt,
    environment: envName,
  }, envName);
}

/**
 * Get a Cognito client with admin credentials (deployer → ArcanumAIAccess).
 */
function getAdminCognitoClient(accountId: string, region: string): CognitoIdentityProviderClient {
  const deployerCredentials = fromIni({ profile: getDeployerProfile() });
  const credentials = fromTemporaryCredentials({
    masterCredentials: deployerCredentials,
    params: {
      RoleArn: `arn:aws:iam::${accountId}:role/ArcanumAIAccess`,
      RoleSessionName: 'numa-cli-admin',
    },
  });

  return new CognitoIdentityProviderClient({ region, credentials });
}

/**
 * Create the set-password command.
 * Sets a user's password using admin credentials (not a self-service change).
 */
export function createSetPasswordCommand(): Command {
  const cmd = new Command('set-password')
    .description('Set a user\'s password (admin operation)')
    .option('-u, --username <email>', 'User email address')
    .option('-p, --password <password>', 'New password (will prompt if not provided)')
    .option('--temporary', 'Set as temporary (user must change on next login)')
    .action(async (options: { username?: string; password?: string; temporary?: boolean }) => {
      try {
        await setPassword(options.username, options.password, options.temporary ?? false);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

async function setPassword(usernameArg?: string, passwordArg?: string, temporary = false): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  if (!env.cognito) {
    console.error('Cognito not configured for this environment.');
    console.error('Run "numa env refresh" to fetch Cognito config.');
    process.exit(1);
  }

  const username = usernameArg ?? await prompt('Email: ');
  const lowercaseUsername = username.toLowerCase();

  // Verify user exists
  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  try {
    const user = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: env.cognito.userPoolId,
        Username: lowercaseUsername,
      })
    );
    const email = user.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
    console.log(`User: ${email ?? lowercaseUsername}`);
    console.log(`Status: ${user.UserStatus}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      console.error(`User '${lowercaseUsername}' not found.`);
      process.exit(1);
    }
    throw error;
  }

  const password = passwordArg ?? await prompt('New password: ', true);

  if (!password) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.cognito.userPoolId,
      Username: lowercaseUsername,
      Password: password,
      Permanent: !temporary,
    })
  );

  console.log(`Password set${temporary ? ' (temporary - user must change on next login)' : ''}.`);
}

/**
 * Create the logout command.
 */
export function createLogoutCommand(): Command {
  const cmd = new Command('logout')
    .description('Log out of Numa')
    .action(() => {
      clearCredentials();
      console.log('Logged out successfully.');
    });

  return cmd;
}

/**
 * Create the whoami command.
 */
export function createWhoamiCommand(): Command {
  const cmd = new Command('whoami')
    .description('Show current logged-in user')
    .action(async () => {
      const creds = loadCredentials();
      if (!creds) {
        console.log('Not logged in.');
        console.log('Run "numa login" to authenticate.');
        process.exit(1);
      }

      // Check if token is still valid
      const now = Math.floor(Date.now() / 1000);
      if (creds.expiresAt <= now) {
        console.log('Session expired.');
        console.log('Run "numa login" to authenticate again.');
        process.exit(1);
      }

      // Decode the ID token to get user info
      try {
        const payload = JSON.parse(
          Buffer.from(creds.idToken.split('.')[1] ?? '', 'base64').toString()
        ) as { email?: string; sub?: string; 'cognito:username'?: string };

        console.log(`Logged in as: ${payload.email ?? payload['cognito:username'] ?? payload.sub ?? 'unknown'}`);
        console.log(`Environment: ${creds.environment}`);

        const expiresIn = creds.expiresAt - now;
        const minutes = Math.floor(expiresIn / 60);
        console.log(`Token expires in: ${minutes} minutes`);
      } catch {
        console.log(`Environment: ${creds.environment}`);
        console.log('Unable to decode token details.');
      }
    });

  return cmd;
}

/**
 * List all users in the current environment's Cognito User Pool
 */
async function listUsers(): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  if (!env.cognito) {
    console.error('Cognito not configured for this environment.');
    console.error('Run "numa env refresh" to fetch Cognito config.');
    process.exit(1);
  }

  console.log(`Listing users for: ${env.clientName}`);
  console.log('');

  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  try {
    let paginationToken: string | undefined;
    let userCount = 0;

    console.log('EMAIL                              STATUS       CREATED     ROLE');
    console.log('─'.repeat(80));

    do {
      const response = await cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: env.cognito.userPoolId,
          PaginationToken: paginationToken,
          Limit: 60,
        })
      );

      if (response.Users) {
        for (const user of response.Users) {
          userCount++;

          const email = user.Attributes?.find((a: any) => a.Name === 'email')?.Value || 'N/A';
          const status = user.UserStatus || 'UNKNOWN';
          const createdStr: string = user.UserCreateDate ? user.UserCreateDate.toISOString().split('T')[0] ?? 'N/A' : 'N/A';
          const displayEmail = email.length > 30 ? email.substring(0, 27) + '...' : email;

          // Fetch groups for this user
          let role = 'standard';
          if (user.Username) {
            try {
              const userGroupsResponse = await cognitoClient.send(
                new AdminListGroupsForUserCommand({
                  UserPoolId: env.cognito.userPoolId,
                  Username: user.Username,
                })
              );
              const groups = (userGroupsResponse.Groups ?? []).map(g => g.GroupName).filter(Boolean) as string[];
              role = groups.length > 0 ? groups.join(', ') : 'standard';
            } catch {
              role = '?';
            }
          }

          console.log(
            `${displayEmail.padEnd(34)} ${status.padEnd(11)} ${createdStr.padEnd(11)} ${role}`
          );
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    console.log('─'.repeat(80));
    console.log(`Total users: ${userCount}`);

  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error listing users: ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * Promote a user to admin
 */
async function promoteUser(emailArg?: string): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected. Run "numa env use <name>" first.');
    process.exit(1);
  }
  if (!env.cognito) {
    console.error('Cognito not configured. Run "numa env refresh".');
    process.exit(1);
  }

  const email = (emailArg ?? await prompt('Email: ')).toLowerCase();
  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  // Verify user exists
  try {
    await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: env.cognito.userPoolId, Username: email }));
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      console.error(`User '${email}' not found.`);
      process.exit(1);
    }
    throw error;
  }

  // Check current groups
  const groupsResponse = await cognitoClient.send(
    new AdminListGroupsForUserCommand({ UserPoolId: env.cognito.userPoolId, Username: email })
  );
  const currentGroups = (groupsResponse.Groups ?? []).map(g => g.GroupName ?? '').filter(Boolean);

  if (currentGroups.includes('admin')) {
    console.log(`${email} is already admin.`);
    return;
  }

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({ UserPoolId: env.cognito.userPoolId, Username: email, GroupName: 'admin' })
  );
  console.log(`${email} promoted to admin.`);
}

/**
 * Demote a user from admin
 */
async function demoteUser(emailArg?: string): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected. Run "numa env use <name>" first.');
    process.exit(1);
  }
  if (!env.cognito) {
    console.error('Cognito not configured. Run "numa env refresh".');
    process.exit(1);
  }

  const email = (emailArg ?? await prompt('Email: ')).toLowerCase();
  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  // Verify user exists
  try {
    await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: env.cognito.userPoolId, Username: email }));
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      console.error(`User '${email}' not found.`);
      process.exit(1);
    }
    throw error;
  }

  // Check current groups
  const groupsResponse = await cognitoClient.send(
    new AdminListGroupsForUserCommand({ UserPoolId: env.cognito.userPoolId, Username: email })
  );
  const currentGroups = (groupsResponse.Groups ?? []).map(g => g.GroupName ?? '').filter(Boolean);

  if (!currentGroups.includes('admin')) {
    console.log(`${email} is not admin.`);
    return;
  }

  await cognitoClient.send(
    new AdminRemoveUserFromGroupCommand({ UserPoolId: env.cognito.userPoolId, Username: email, GroupName: 'admin' })
  );
  console.log(`${email} demoted from admin.`);
}

/**
 * Delete a user from the current environment's Cognito User Pool
 */
async function deleteUser(usernameArg?: string, force = false): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  if (!env.cognito) {
    console.error('Cognito not configured for this environment.');
    console.error('Run "numa env refresh" to fetch Cognito config.');
    process.exit(1);
  }

  const username = usernameArg ?? await prompt('Email address of user to delete: ');
  const lowercaseUsername = username.toLowerCase();

  console.log(`Environment: ${env.clientName}`);
  console.log(`User: ${lowercaseUsername}`);
  console.log('');

  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  // First verify user exists and show details
  try {
    const user = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: env.cognito.userPoolId,
        Username: lowercaseUsername,
      })
    );

    const email = user.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
    console.log(`Found user: ${email ?? lowercaseUsername}`);
    console.log(`Status: ${user.UserStatus}`);
    console.log(`Enabled: ${user.Enabled ? 'Yes' : 'No'}`);
    console.log(`Created: ${user.UserCreateDate?.toISOString().split('T')[0] ?? 'N/A'}`);
    console.log('');

  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      console.error(`User '${lowercaseUsername}' not found.`);
      process.exit(1);
    }
    throw error;
  }

  // Confirmation prompt (skip if --force)
  if (!force) {
    const confirmation = await prompt(`Are you sure you want to delete user '${lowercaseUsername}'? Type 'DELETE' to confirm: `);

    if (confirmation !== 'DELETE') {
      console.log('User deletion cancelled.');
      process.exit(0);
    }
  }

  // Delete the user
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: env.cognito.userPoolId,
        Username: lowercaseUsername,
      })
    );

    console.log(`✅ User '${lowercaseUsername}' has been deleted successfully.`);

  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error deleting user: ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * Manage user admin privileges
 */
async function manageUserAdmin(usernameArg?: string, makeAdmin?: boolean, removeAdmin?: boolean): Promise<void> {
  const env = getCurrentEnv();
  if (!env) {
    console.error('No environment selected.');
    console.error('Run "numa env use <name>" to select an environment first.');
    process.exit(1);
  }

  if (!env.cognito) {
    console.error('Cognito not configured for this environment.');
    console.error('Run "numa env refresh" to fetch Cognito config.');
    process.exit(1);
  }

  if (!makeAdmin && !removeAdmin) {
    console.error('Must specify either --admin or --user flag.');
    process.exit(1);
  }

  if (makeAdmin && removeAdmin) {
    console.error('Cannot specify both --admin and --user flags.');
    process.exit(1);
  }

  const username = usernameArg ?? await prompt('Email address of user: ');
  const lowercaseUsername = username.toLowerCase();

  console.log(`Environment: ${env.clientName}`);
  console.log(`User: ${lowercaseUsername}`);
  console.log(`Action: ${makeAdmin ? 'Add admin privileges' : 'Remove admin privileges'}`);
  console.log('');

  const cognitoClient = getAdminCognitoClient(env.clientAccountId, env.cognito.region);

  // First verify user exists
  try {
    const user = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: env.cognito.userPoolId,
        Username: lowercaseUsername,
      })
    );

    const email = user.UserAttributes?.find((a: any) => a.Name === 'email')?.Value;
    console.log(`Found user: ${email ?? lowercaseUsername}`);
    console.log(`Status: ${user.UserStatus}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      console.error(`User '${lowercaseUsername}' not found.`);
      process.exit(1);
    }
    throw error;
  }

  // List available groups to find admin group
  try {
    const groupsResponse = await cognitoClient.send(
      new ListGroupsCommand({
        UserPoolId: env.cognito.userPoolId,
      })
    );

    const adminGroup = groupsResponse.Groups?.find(g =>
      g.GroupName?.toLowerCase().includes('admin') ||
      g.GroupName?.toLowerCase().includes('administrator')
    );

    if (!adminGroup || !adminGroup.GroupName) {
      console.error('No admin group found in User Pool.');
      console.error('Available groups:');
      groupsResponse.Groups?.forEach(g => {
        console.error(`  - ${g.GroupName}: ${g.Description || 'No description'}`);
      });
      process.exit(1);
    }

    console.log(`Admin group: ${adminGroup.GroupName}`);

    // Get current user groups
    const userGroupsResponse = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: env.cognito.userPoolId,
        Username: lowercaseUsername,
      })
    );

    const currentGroups = userGroupsResponse.Groups?.map(g => g.GroupName) || [];
    const isCurrentlyAdmin = currentGroups.includes(adminGroup.GroupName);

    console.log(`Current groups: ${currentGroups.join(', ') || 'None'}`);
    console.log(`Currently admin: ${isCurrentlyAdmin ? 'Yes' : 'No'}`);
    console.log('');

    if (makeAdmin) {
      if (isCurrentlyAdmin) {
        console.log(`User '${lowercaseUsername}' is already an admin.`);
        return;
      }

      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: env.cognito.userPoolId,
          Username: lowercaseUsername,
          GroupName: adminGroup.GroupName,
        })
      );

      console.log(`✅ User '${lowercaseUsername}' has been added to admin group '${adminGroup.GroupName}'.`);
    } else {
      if (!isCurrentlyAdmin) {
        console.log(`User '${lowercaseUsername}' is not currently an admin.`);
        return;
      }

      await cognitoClient.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: env.cognito.userPoolId,
          Username: lowercaseUsername,
          GroupName: adminGroup.GroupName,
        })
      );

      console.log(`✅ User '${lowercaseUsername}' has been removed from admin group '${adminGroup.GroupName}'.`);
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error managing admin privileges: ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * Create the users list command
 */
export function createUsersListCommand(): Command {
  const cmd = new Command('ls')
    .alias('list')
    .description('List all users with roles')
    .action(async () => {
      try {
        await listUsers();
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Create the user delete command
 */
export function createUserDeleteCommand(): Command {
  const cmd = new Command('delete')
    .alias('rm')
    .description('Delete a user')
    .argument('[email]', 'User email address')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (email: string | undefined, options: { force?: boolean }) => {
      try {
        await deleteUser(email, options.force ?? false);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Create the promote command
 */
export function createUserPromoteCommand(): Command {
  const cmd = new Command('promote')
    .description('Promote a user to admin')
    .argument('[email]', 'User email address')
    .action(async (email?: string) => {
      try {
        await promoteUser(email);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Create the demote command
 */
export function createUserDemoteCommand(): Command {
  const cmd = new Command('demote')
    .description('Remove admin from a user')
    .argument('[email]', 'User email address')
    .action(async (email?: string) => {
      try {
        await demoteUser(email);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Create the user admin management command
 */
export function createUserAdminCommand(): Command {
  const cmd = new Command('admin')
    .description('Manage user admin privileges')
    .option('-u, --username <email>', 'Email address of user')
    .option('--admin', 'Grant admin privileges to the user')
    .option('--user', 'Remove admin privileges from the user')
    .action(async (options: { username?: string; admin?: boolean; user?: boolean }) => {
      try {
        await manageUserAdmin(options.username, options.admin, options.user);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}
