/**
 * Public API surface for @numa/cli/output consumers.
 *
 * Output mode resolution, the unified emitter (emitResult / prettyOrSpill),
 * and the human-facing helpers (info / success / warn / fail / printJson /
 * confirm). cli-dev test runners use fail/info/success extensively.
 */

export { emitResult, prettyOrSpill, type EmitOptions, type PrettyOrSpillOptions } from './emit.js';
export { resolveOutputMode, type OutputMode, type OutputModeFlags } from './mode.js';
export {
  buildEnvelope,
  inferSchema,
  buildSample,
  deepArrayCount,
  spillResultToFile,
  formatSize,
  INLINE_THRESHOLD_BYTES,
  SAMPLE_ARRAY_LIMIT,
  SAMPLE_STRING_LIMIT,
  SAMPLE_DEPTH_LIMIT,
  type StandardEnvelope,
} from './standard.js';
export { info, success, warn, fail, isJsonMode } from './pretty.js';
export { printJson } from './json.js';
export { confirm } from './confirm.js';
export {
  splitExtraArgs,
  coerceValue,
  camelize,
  parseJsonBlob,
  addStandardOptions,
  addOutputModeOptions,
  requireUserMessage,
  type SplitExtraArgs,
  type StandardOptions,
  type StandardOptionsConfig,
} from './cli-args.js';
