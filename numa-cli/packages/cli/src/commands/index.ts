/**
 * Public API surface for @numa/cli/commands consumers (mainly @numa/cli-dev).
 *
 * Each `createXxxCommand()` factory builds a Commander subtree for that
 * category. @numa/cli's own binary (`cli/numa.ts`) imports them directly via
 * relative paths; @numa/cli-dev imports them through this barrel so it can
 * compose the same trees and bolt on `*Test` subcommands for the dev binary.
 *
 * Factories — call once, register on a Command instance.
 */

// Bootstrap + general
export { createBootstrapCommand, runBootstrap, tryBootstrapAfterLogin } from './bootstrap.js';
// `prompt.ts` is a TTY input helper (used by login flow), not a Commander
// factory — re-export so cli-dev can prompt for things like dev-context overrides.
export { prompt } from './prompt.js';

// Auth
export { createLoginCommand } from './auth/login.js';
export { createLogoutCommand } from './auth/logout.js';
export { createWhoamiCommand } from './auth/whoami.js';
export { createProfileCommand } from './auth/profile.js';

// Action surfaces
export { createFilesCommand } from './actions/files.js';
export { createDocsCommand } from './actions/docs.js';
export { createMemoryCommand } from './actions/memory.js';
export { createAgentsCommand } from './actions/agents.js';
export { createWebCommand } from './actions/web.js';
export { createIntegrationsCommand } from './actions/integrations.js';
export { createOpsCommand, VALID_OPS, type ValidOp } from './actions/ops.js';
export { createRenderCommand } from './actions/render.js';
