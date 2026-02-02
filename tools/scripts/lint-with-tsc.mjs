import { spawnSync } from 'node:child_process';

const eslintArgs = process.argv.slice(2);

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  return result.status ?? 1;
};

const eslintStatus = run('eslint', ['.', ...eslintArgs]);
if (eslintStatus !== 0) {
  process.exit(eslintStatus);
}

const tscStatus = run('tsc', ['--noEmit']);
process.exit(tscStatus);
