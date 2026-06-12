/**
 * Init command for Numa CLI.
 * Sets up the .numa directory and initial configuration.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { NumaConfig } from '../types.js';

const NUMA_DIR = join(homedir(), '.numa');
const CONFIG_FILE = join(NUMA_DIR, 'config.json');

/**
 * Create the init command.
 */
export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize Numa CLI configuration')
    .option('-f, --force', 'Overwrite existing configuration')
    .action((options: { force?: boolean }) => {
      init(options.force ?? false);
    });

  return cmd;
}

function init(force: boolean): void {
  // Check if .numa directory already exists
  const dirExists = existsSync(NUMA_DIR);
  const configExists = existsSync(CONFIG_FILE);

  if (dirExists && configExists && !force) {
    console.log(`Numa CLI is already initialized at ${NUMA_DIR}`);
    console.log('');
    console.log('Use --force to reinitialize (this will clear your configuration).');
    console.log('');
    console.log('Available commands:');
    console.log('  numa env list       - List configured environments');
    console.log('  numa env add <name> - Add a new environment');
    console.log('  numa env use <name> - Switch to an environment');
    return;
  }

  // Create directory
  if (!dirExists) {
    mkdirSync(NUMA_DIR, { recursive: true });
    console.log(`Created directory: ${NUMA_DIR}`);
  }

  // Create initial config
  const initialConfig: NumaConfig = {
    environments: {},
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2) + '\n');
  console.log(`Created config file: ${CONFIG_FILE}`);

  console.log('');
  console.log('✅ Numa CLI initialized!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Scan AWS profiles:');
  console.log('     numa roles scan');
  console.log('');
  console.log('  2. Add an environment:');
  console.log('     numa env add demo --client arcanum-demo-tony --account 418274024729 --region us-east-1');
  console.log('     Or quick-add: numa env use arcanum-demo-tony');
  console.log('');
  console.log('  3. Create a shared document:');
  console.log('     numa create shared doc ./document.pdf');
}
