/**
 * Configuration management for Numa CLI.
 * Stores state in ~/.numa/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NumaConfig, EnvironmentConfig, RolesConfig } from './types.js';
import { DEFAULT_AWS_PROFILE } from './types.js';

const NUMA_DIR = join(homedir(), '.numa');
const CONFIG_FILE = join(NUMA_DIR, 'config.json');

/**
 * Ensure the .numa directory exists.
 */
function ensureNumaDir(): void {
  if (!existsSync(NUMA_DIR)) {
    mkdirSync(NUMA_DIR, { recursive: true });
  }
}

/**
 * Load the Numa configuration from disk.
 */
export function loadConfig(): NumaConfig {
  ensureNumaDir();

  if (!existsSync(CONFIG_FILE)) {
    return { environments: {} };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    // Type guard
    if (typeof parsed === 'object' && parsed !== null) {
      const config = parsed as Record<string, unknown>;
      return {
        currentEnv: typeof config['currentEnv'] === 'string' ? config['currentEnv'] : undefined,
        environments:
          typeof config['environments'] === 'object' && config['environments'] !== null
            ? (config['environments'] as Record<string, EnvironmentConfig>)
            : {},
        roles:
          typeof config['roles'] === 'object' && config['roles'] !== null
            ? (config['roles'] as RolesConfig)
            : undefined,
      };
    }

    return { environments: {} };
  } catch {
    return { environments: {} };
  }
}

/**
 * Save the Numa configuration to disk.
 */
export function saveConfig(config: NumaConfig): void {
  ensureNumaDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get the current environment configuration.
 */
export function getCurrentEnv(): EnvironmentConfig | undefined {
  const config = loadConfig();

  if (!config.currentEnv) {
    return undefined;
  }

  return config.environments[config.currentEnv];
}

/**
 * Get the current environment name.
 */
export function getCurrentEnvName(): string | undefined {
  const config = loadConfig();
  return config.currentEnv;
}

/**
 * Set the current environment.
 */
export function setCurrentEnv(name: string): void {
  const config = loadConfig();

  if (!config.environments[name]) {
    throw new Error(`Environment '${name}' not found. Run 'numa env list' to see available environments.`);
  }

  config.currentEnv = name;
  saveConfig(config);
}

/**
 * Add or update an environment.
 */
export function addEnvironment(name: string, env: EnvironmentConfig): void {
  const config = loadConfig();
  config.environments[name] = env;
  saveConfig(config);
}

/**
 * Remove an environment.
 */
export function removeEnvironment(name: string): void {
  const config = loadConfig();

  if (!config.environments[name]) {
    throw new Error(`Environment '${name}' not found.`);
  }

  delete config.environments[name];

  // Clear current if it was the removed env
  if (config.currentEnv === name) {
    config.currentEnv = undefined;
  }

  saveConfig(config);
}

/**
 * List all environments.
 */
export function listEnvironments(): Array<{ name: string; config: EnvironmentConfig; isCurrent: boolean }> {
  const config = loadConfig();

  return Object.entries(config.environments).map(([name, envConfig]) => ({
    name,
    config: envConfig,
    isCurrent: name === config.currentEnv,
  }));
}

/**
 * Get environment by name.
 */
export function getEnvironment(name: string): EnvironmentConfig | undefined {
  const config = loadConfig();
  return config.environments[name];
}

/**
 * Get the configured deployer profile name, falling back to DEFAULT_AWS_PROFILE.
 */
export function getDeployerProfile(): string {
  const config = loadConfig();
  return config.roles?.deployer ?? DEFAULT_AWS_PROFILE;
}

/**
 * Get the roles configuration.
 */
export function getRolesConfig(): RolesConfig | undefined {
  const config = loadConfig();
  return config.roles;
}

/**
 * Save roles configuration (merges with existing config).
 */
export function saveRolesConfig(roles: RolesConfig): void {
  const config = loadConfig();
  config.roles = roles;
  saveConfig(config);
}

/**
 * Resolve the environment config from an optional name or the current env.
 * Exits the process with an error if neither is available.
 */
export function resolveEnvConfig(envName?: string): EnvironmentConfig {
  const config = loadConfig();

  if (envName) {
    const env = config.environments[envName];
    if (!env) {
      console.error(`❌ Environment '${envName}' not found.`);
      console.log('Available environments:', Object.keys(config.environments).join(', '));
      process.exit(1);
    }
    return env;
  }

  const currentEnvResult = getCurrentEnv();
  if (!currentEnvResult) {
    console.error('❌ No current environment set.');
    console.log('Use "numa env use <name>" to set an environment or --env <name> to specify one.');
    process.exit(1);
  }
  return currentEnvResult;
}
