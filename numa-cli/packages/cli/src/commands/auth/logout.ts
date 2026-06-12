/**
 * `numa logout [account]`
 *
 * Deletes the stored tokens file for the active (or named) profile. Does not
 * touch the active-profile pointer — `numa profile <name>` does that. Matches
 * `git credential reject` semantics: invalidate creds, leave config.
 */

import { Command } from 'commander';
import { activeProfile, clearTokens } from '../../context/store.js';
import { fail, info, success } from '../../output/pretty.js';

export function createLogoutCommand(): Command {
  return new Command('logout')
    .description('Delete stored tokens for the active (or named) profile')
    .argument('[account]', 'Account name. Defaults to the active profile.')
    .action((accountArg: string | undefined) => {
      const account = accountArg ?? activeProfile();
      if (!account) {
        fail('no active profile to log out');
      }
      const removed = clearTokens(account);
      if (removed) {
        success(`cleared tokens for '${account}'`);
      } else {
        info(`no stored tokens for '${account}'`);
      }
    });
}
