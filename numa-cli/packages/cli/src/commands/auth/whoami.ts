/**
 * `numa whoami`
 *
 * Prints the active profile's identity claims. Pretty by default, JSON if
 * piped or --json is passed. Refreshes the access token if expired so the
 * output reflects current state.
 */

import { Command } from 'commander';
import { getValidTokens } from '../../auth/tokens.js';
import { decodeJwtClaims } from '../../auth/jwt.js';
import { activeProfile } from '../../context/store.js';
import { fail } from '../../output/pretty.js';
import { emitResult } from '../../output/emit.js';
import { type OutputModeFlags } from '../../output/mode.js';

export function createWhoamiCommand(): Command {
  return new Command('whoami')
    .description("Print the active profile's identity claims")
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action(async (options: OutputModeFlags) => {
      const account = activeProfile();
      if (!account) fail('no active profile — run `numa login` first');

      const tokens = await getValidTokens(account);
      const claims = decodeJwtClaims(tokens.idToken);

      const output = {
        account,
        sub: claims.sub,
        email: claims.email ?? tokens.email,
        name: claims['name'] as string | undefined,
        groups: (claims['cognito:groups'] as string[] | undefined) ?? [],
        cognito_username: claims['cognito:username'] as string | undefined,
        issued_at: new Date(claims.iat * 1000).toISOString(),
        expires_at: new Date(claims.exp * 1000).toISOString(),
        issuer: claims.iss,
      };

      emitResult({
        tool: 'whoami',
        result: output,
        options,
        pretty: (r) => {
          const rows: Array<[string, string]> = [
            ['account', String(r.account)],
            ['email', String(r.email)],
            ['sub', r.sub],
            ['groups', r.groups.length > 0 ? r.groups.join(', ') : '(none)'],
            ['name', r.name ? String(r.name) : '(unset)'],
            ['expires', r.expires_at],
          ];
          const width = Math.max(...rows.map(([k]) => k.length));
          for (const [k, v] of rows) {
            process.stdout.write(`${k.padEnd(width)}  ${v}\n`);
          }
        },
      });
    });
}
