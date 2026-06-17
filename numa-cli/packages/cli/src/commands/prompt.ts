/**
 * Terminal prompt helper. Hides input for password-style prompts.
 * Mirrors numa-admin-cli/src/commands/auth.ts.
 */

import { createInterface } from 'node:readline';

const CTRL_C = String.fromCharCode(0x03);
const EOT = String.fromCharCode(0x04);
const BACKSPACE = String.fromCharCode(0x7f);
const BS = String.fromCharCode(0x08);

export function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      let password = '';

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === EOT) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(password);
        } else if (char === CTRL_C) {
          process.exit(130);
        } else if (char === BACKSPACE || char === BS) {
          if (password.length > 0) password = password.slice(0, -1);
        } else {
          password += char;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
