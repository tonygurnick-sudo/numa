/**
 * Public API surface for @numa/cli/context consumers.
 *
 * Scoping resolution (workspace-env / dev-context / bootstrap-default),
 * profile + token store, dev-context manipulation, and per-category
 * approval policy.
 */

export {
  activeProfile,
  setActiveProfile,
  loadContext,
  saveContext,
  loadTokens,
  saveTokens,
  clearTokens,
  contextPath,
  tokensPath,
  ensureStateDir,
  type StoredTokens,
} from './store.js';
export { resolveScopingContext, type ScopingContext, type EnabledIntegration } from './resolve.js';
export { loadDevContext, saveDevContext, clearDevContext, type DevContext } from './dev-context.js';
export {
  requiresLocalApproval,
  requiresLocalApprovalForIntegration,
  type IntegrationApprovalInput,
} from './approval.js';
export { tryWorkspaceDocs, writeCachedDocs, type ResolvedDocs } from './integrations-cache.js';
