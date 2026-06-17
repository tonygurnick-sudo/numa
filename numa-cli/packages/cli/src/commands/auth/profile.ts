/**
 * `numa profile [name]`
 *
 * Show or set the active profile. No SRP, no token mutation — just the
 * pointer at ~/.config/numa/profile.
 */

import { Command } from 'commander';
import { activeProfile, setActiveProfile } from '../../context/store.js';
import { fail, info } from '../../output/pretty.js';
import { emitResult } from '../../output/emit.js';
import { type OutputModeFlags } from '../../output/mode.js';

export function createProfileCommand(): Command {
  return new Command('profile')
    .description('Show or set the active profile (no auth side effects)')
    .argument('[name]', 'Account name to set as active. Omit to print the current.')
    .option('--pretty', 'Force human-readable output')
    .option('--standard', 'Force standard envelope output (LLM-friendly)')
    .option('--json', 'Force raw JSON output')
    .action((nameArg: string | undefined, options: OutputModeFlags) => {
      if (!nameArg) {
        const current = activeProfile();
        if (!current) fail('no active profile');
        emitResult({
          tool: 'active_profile',
          result: {
            profile: current,
            source: process.env['NUMA_PROFILE'] ? 'env (NUMA_PROFILE)' : 'config',
          },
          options,
          pretty: ({ profile, source }) => {
            process.stdout.write(`${profile}\n`);
            if (source.startsWith('env')) info(`(value comes from NUMA_PROFILE env var)`);
          },
        });
        return;
      }
      setActiveProfile(nameArg);
      emitResult({
        tool: 'set_active_profile',
        result: { profile: nameArg, action: 'set' },
        options,
        pretty: () => info(`active profile set to '${nameArg}'`),
      });
    });
}
