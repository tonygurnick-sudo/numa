/**
 * `numa login [account]`
 *
 * No silent default — account must come from an explicit source so tokens
 * never land in the wrong file. Resolution order:
 *
 *   1. positional `account` arg          (e.g. `numa login nd-labs`)
 *   2. NUMA_ACCOUNT env var              (scripting / CI)
 *   3. interactive prompt                (matches the email/password flow)
 *
 * If none of those produce a value, login errors. Username and password
 * follow the same pattern (NUMA_USERNAME / NUMA_PASSWORD → prompt).
 *
 * After SRP succeeds, persists tokens at ~/.config/numa/tokens-<account>.json
 * and sets the active profile.
 */

import { Command } from 'commander';
import type { AuthenticationResultType } from '@aws-sdk/client-cognito-identity-provider';
import { srpLogin, respondToMfaChallenge } from '../../auth/srp.js';
import { decodeJwtClaims } from '../../auth/jwt.js';
import { saveTokens, setActiveProfile, type StoredTokens } from '../../context/store.js';
import { fail, info, success } from '../../output/pretty.js';
import { prompt } from '../prompt.js';
import { tryBootstrapAfterLogin } from '../bootstrap.js';

export function createLoginCommand(): Command {
  return new Command('login')
    .description('Authenticate against a Numa instance with email + password (Cognito SRP)')
    .argument('[account]', 'Account name (e.g. nd-labs). NUMA_ACCOUNT env var or interactive prompt fallback.')
    .option('-u, --username <email>', 'Email (defaults to NUMA_USERNAME or interactive prompt)')
    .option('-p, --password <password>', 'Password (defaults to NUMA_PASSWORD or hidden prompt)')
    .option('-v, --verbose', 'Print full error details on failure (stack + AWS error metadata)')
    .action(
      async (accountArg: string | undefined, options: { username?: string; password?: string; verbose?: boolean }) => {
        // Resolve account from arg → NUMA_ACCOUNT env → interactive prompt.
        // No silent fallback to the active profile — explicit choice each
        // time so re-login can't quietly target the wrong instance.
        const account = (accountArg ?? process.env['NUMA_ACCOUNT'] ?? (await prompt('Account: '))).trim();
        if (!account) {
          fail('login: account is required (e.g. `numa login nd-labs`).');
        }

        info(`logging into '${account}'...`);

        const username = options.username ?? process.env['NUMA_USERNAME'] ?? (await prompt('Email: '));
        const password = options.password ?? process.env['NUMA_PASSWORD'] ?? (await prompt('Password: ', true));

        try {
          const loginResult = await srpLogin(account, username, password);

          // Resolve to a final AuthenticationResult, answering an MFA challenge
          // in between if Cognito raised one.
          let authResult: AuthenticationResultType;
          const lowercaseUsername = loginResult.username;
          if (loginResult.status === 'mfa_required') {
            const label = loginResult.challengeName === 'SMS_MFA' ? 'SMS code' : 'authenticator code';
            info(`multi-factor authentication required — enter your ${label}.`);
            const code = (await prompt(`MFA code: `)).trim();
            if (!code) {
              fail('login: MFA code is required.');
            }
            authResult = await respondToMfaChallenge(loginResult, code);
          } else {
            authResult = loginResult.authResult;
          }

          if (!authResult.AccessToken || !authResult.IdToken) {
            fail('login: response missing AccessToken or IdToken');
          }

          const claims = decodeJwtClaims(authResult.IdToken);
          const issuedAt = Math.floor(Date.now() / 1000);
          const tokens: StoredTokens = {
            account,
            username: lowercaseUsername,
            sub: claims.sub,
            email: claims.email ?? lowercaseUsername,
            groups: claims['cognito:groups'] ?? [],
            accessToken: authResult.AccessToken,
            idToken: authResult.IdToken,
            refreshToken: authResult.RefreshToken,
            expiresAt: issuedAt + (authResult.ExpiresIn ?? 3600),
            issuedAt,
          };
          saveTokens(account, tokens);
          setActiveProfile(account);

          const groupLabel = tokens.groups.length > 0 ? tokens.groups.join(', ') : 'no groups';
          success(`logged in as ${tokens.email} (${groupLabel}) on '${account}'`);

          // Best-effort context refresh — non-fatal if numa-cli-api isn't deployed
          // yet on this client.
          await tryBootstrapAfterLogin(account);
        } catch (error) {
          // AWS SDK exceptions can have empty `.message` but a useful `.name`
          // (e.g. NotAuthorizedException) and metadata on `$metadata` /
          // `$response`. cognito-srp-helper sometimes throws bare Errors. Surface
          // everything we reasonably can so empty-message cases aren't silent.
          const parts: string[] = [];
          if (error instanceof Error) {
            if (error.message) parts.push(error.message);
            if (!error.message && error.name && error.name !== 'Error') parts.push(`(${error.name})`);
            const meta = (error as { $metadata?: { httpStatusCode?: number; requestId?: string } }).$metadata;
            if (meta?.httpStatusCode)
              parts.push(`[HTTP ${meta.httpStatusCode}${meta.requestId ? ` req=${meta.requestId}` : ''}]`);
          } else {
            parts.push(String(error));
          }
          if (parts.length === 0) {
            parts.push(
              `unknown error (${Object.prototype.toString.call(error)}) — rerun with --verbose for full details`
            );
          }
          if (options.verbose && error instanceof Error) {
            process.stderr.write(
              `\n--- error details ---\nname:    ${error.name}\nmessage: ${JSON.stringify(error.message)}\nstack:\n${error.stack}\n`
            );
            const errObj = error as unknown as Record<string, unknown>;
            for (const k of Object.keys(errObj)) {
              if (k === 'message' || k === 'stack' || k === 'name') continue;
              process.stderr.write(`${k}: ${JSON.stringify(errObj[k], null, 2)}\n`);
            }
            process.stderr.write(`---------------------\n\n`);
          }
          fail(`login failed: ${parts.join(' ')}`);
        }
      }
    );
}
