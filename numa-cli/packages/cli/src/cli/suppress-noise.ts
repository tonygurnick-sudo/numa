/**
 * stderr noise suppression for the PROD binary. Imported first by cli/numa.ts
 * (side-effect module); numa-dev deliberately skips it so local debugging
 * keeps full warnings.
 *
 * Every byte the binary writes to stderr lands in a tool result the model
 * reads — recurring, non-actionable runtime notices waste tokens on every
 * single `numa` call. Two suppressions:
 *
 * 1. Node deprecation warnings (e.g. DEP0040 punycode via a transitive dep) —
 *    `process.noDeprecation`.
 * 2. The AWS SDK's Node-version / maintenance-mode notices — these bypass
 *    noDeprecation (plain `process.emitWarning` with their own names, fired
 *    by whatever SDK version the image build installed, e.g. the Node 20
 *    support notice). The env var covers SDK paths that honour it; the
 *    emitWarning filter catches the rest. Scoped narrowly: only AWS SDK
 *    support-policy warnings are dropped, everything else still surfaces.
 */

process.noDeprecation = true;

process.env['AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE'] = '1';

const _emitWarning = process.emitWarning.bind(process);

/** Exported for tests — true when a warning should be swallowed. */
export const isAwsSdkSupportNoise = (warning: string | Error, name?: unknown): boolean => {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '');
  const nameStr = typeof name === 'string' ? name : '';
  return (
    /AWS SDK for JavaScript/i.test(text) ||
    /NodeVersionSupportWarning|NodeDeprecationWarning/.test(`${nameStr} ${text}`)
  );
};

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (isAwsSdkSupportNoise(warning, args[0])) return;
  (_emitWarning as (w: string | Error, ...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
