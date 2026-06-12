/**
 * @numa/cli — root barrel. Re-exports every public subpath so consumers
 * who don't want to think about the boundaries can do:
 *
 *     import { invokeTool, emitResult, createIntegrationsCommand } from '@numa/cli';
 *
 * The narrow subpaths (`@numa/cli/api`, `/auth`, `/context`, `/output`,
 * `/metadata`, `/commands`) are the preferred way to import — they keep
 * the bundle graph clear when someone reads the import statements alone.
 * This barrel exists so people don't have to memorise which subpath holds
 * what; everything is reachable from the top-level too.
 */

export * from './api/index.js';
export * from './auth/index.js';
export * from './context/index.js';
export * from './output/index.js';
export * from './metadata/index.js';
export * from './commands/index.js';
