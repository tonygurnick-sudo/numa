#!/usr/bin/env node
/**
 * Numa CLI - Command line tools for the Numa platform.
 *
 * Usage:
 *   numa init                     - Initialize Numa CLI
 *   numa env list                 - List configured environments
 *   numa env use <name>           - Switch to an environment
 *   numa login                    - Log in to Numa
 *   numa whoami                   - Show current user
 *   numa users ls                 - List all users with roles
 *   numa users promote <email>    - Promote user to admin
 *   numa users demote <email>     - Remove admin from user
 *   numa users delete <email>     - Delete a user
 *   numa create shared doc <file> - Create a shareable document Q&A link
 */

import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createEnvCommand } from './commands/env.js';
import {
  createLoginCommand,
  createLogoutCommand,
  createWhoamiCommand,
  createSetPasswordCommand,
  createUsersListCommand,
  createUserDeleteCommand,
  createUserAdminCommand,
  createUserPromoteCommand,
  createUserDemoteCommand,
} from './commands/auth.js';
import { createSharedDocumentCommand } from './commands/create-shared-document.js';
import { createRolesCommand } from './commands/roles.js';
import { getCurrentEnvName } from './config.js';

const program = new Command();

program
  .name('numa')
  .description('Numa CLI - Command line tools for the Numa platform')
  .version('0.1.0')
  .option('--debug', 'Enable verbose debug output')
  .hook('preAction', (thisCommand) => {
    // Walk up to root to find the --debug flag
    let cmd = thisCommand;
    while (cmd.parent) cmd = cmd.parent;
    if (cmd.opts().debug) {
      process.env['NUMA_DEBUG'] = '1';
    }
  });

// Show current environment in help if set
const currentEnv = getCurrentEnvName();
if (currentEnv) {
  program.addHelpText('after', `\nCurrent environment: ${currentEnv}`);
}

// Add init command
program.addCommand(createInitCommand());

// Add environment management commands
program.addCommand(createEnvCommand());

// Add roles management commands
program.addCommand(createRolesCommand());

// Auth commands
const authCmd = new Command('auth').description('Authentication and user management');
authCmd.addCommand(createLoginCommand());
authCmd.addCommand(createLogoutCommand());
authCmd.addCommand(createWhoamiCommand());
authCmd.addCommand(createSetPasswordCommand());

// Add 'users' subcommand group to auth
const authUsersCmd = new Command('users').description('User management');
authUsersCmd.addCommand(createUsersListCommand());
authUsersCmd.addCommand(createUserPromoteCommand());
authUsersCmd.addCommand(createUserDemoteCommand());
authUsersCmd.addCommand(createUserDeleteCommand());
authUsersCmd.addCommand(createUserAdminCommand());
authCmd.addCommand(authUsersCmd);

program.addCommand(authCmd);

// Create command group
const createCmd = new Command('create').description('Create resources');

// Add 'shared' subcommand group
const sharedCmd = new Command('shared').description('Create shared resources');

sharedCmd.addCommand(createSharedDocumentCommand());
createCmd.addCommand(sharedCmd);
program.addCommand(createCmd);

// Top-level users command
const usersCmd = new Command('users').description('User management');
usersCmd.addCommand(createUsersListCommand());
usersCmd.addCommand(createUserPromoteCommand());
usersCmd.addCommand(createUserDemoteCommand());
usersCmd.addCommand(createUserDeleteCommand());
usersCmd.addCommand(createUserAdminCommand());
program.addCommand(usersCmd);

// Parse and execute
program.parse();
