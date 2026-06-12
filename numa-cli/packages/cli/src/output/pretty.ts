/**
 * Pretty (TTY) output helpers. Bypass when stdout is not a TTY.
 */

export function info(msg: string): void {
  process.stderr.write(`numa: ${msg}\n`);
}

export function success(msg: string): void {
  process.stderr.write(`numa: ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`numa: warning — ${msg}\n`);
}

export function fail(msg: string, code = 1): never {
  process.stderr.write(`numa: error — ${msg}\n`);
  process.exit(code);
}

export function isJsonMode(opts: { json?: boolean } | undefined): boolean {
  if (opts?.json) return true;
  // When stdout is being piped, default to JSON for pipe-friendliness.
  return !process.stdout.isTTY;
}
