/**
 * Public API surface for @numa/cli/metadata consumers.
 *
 * Tool type definitions (params + results + the discriminated ToolCall
 * union) plus the TOOL_DISPLAY registry used by the frontend renderers.
 * The frontend consumes this via the `./metadata` subpath alone; cli-dev
 * gets the same plus the type exports.
 */

export type { ToolCall, ToolName, ToolResult, ParamsForTool } from './tool-types.js';
// Frontend-facing display metadata (TOOL_DISPLAY registry + helpers).
export * from './tool-display.js';
// Re-export common per-tool result types that cli-dev test runners assert on.
export type {
  WebSearchResult,
  PipedreamActionIndexEntry,
  OpsOperationParams,
  OpsOperationResult,
} from './tool-types.js';
export { SAFE_OPS_OPERATIONS } from './tool-types.js';
// EnabledIntegration lives in @numa/cli/context/resolve, not here — context
// is the canonical home since it shapes scope resolution. Don't re-export
// it from metadata to avoid the ambiguity from the root barrel.
