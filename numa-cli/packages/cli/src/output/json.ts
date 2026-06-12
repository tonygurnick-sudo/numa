/**
 * JSON output helpers. Pipe-friendly — write to stdout, errors to stderr,
 * exit code reflects success.
 */

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function printJsonCompact(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}
