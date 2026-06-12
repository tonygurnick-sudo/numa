/**
 * stderr noise suppression (cli/suppress-noise.ts) — the AWS SDK's
 * Node-version / maintenance-mode notices must be swallowed (they fire on
 * every CLI invocation in the image and waste tokens in every tool result),
 * while genuine warnings still flow.
 *
 * Importing the module installs the filter into THIS process — fine, the
 * node test runner isolates each test file in its own child process.
 */
import { test } from 'node:test';
import assert from 'node:assert';

const { isAwsSdkSupportNoise } = await import('../dist/cli/suppress-noise.js');

test('classifier matches the SDK support-policy shapes', () => {
  assert.ok(
    isAwsSdkSupportNoise(
      'NodeDeprecationWarning: The AWS SDK for JavaScript (v3) will\nno longer support Node.js 16.x on January 6, 2025.'
    )
  );
  assert.ok(isAwsSdkSupportNoise('The AWS SDK for JavaScript (v3) will no longer support Node.js 20.x.'));
  assert.ok(isAwsSdkSupportNoise('support ends soon', 'NodeVersionSupportWarning'));
  assert.ok(isAwsSdkSupportNoise(new Error('AWS SDK for JavaScript maintenance mode notice')));
});

test('classifier leaves genuine warnings alone', () => {
  assert.equal(isAwsSdkSupportNoise('ExperimentalWarning: VM Modules'), false);
  assert.equal(isAwsSdkSupportNoise('MaxListenersExceededWarning: 11 listeners added', 'MaxListenersExceededWarning'), false);
  assert.equal(isAwsSdkSupportNoise(new Error('something broke')), false);
});

test('installed filter swallows SDK noise but passes genuine warnings through', async () => {
  const received = [];
  process.on('warning', (w) => received.push(w.message));

  process.emitWarning(
    'NodeVersionSupportWarning: The AWS SDK for JavaScript (v3) will no longer support Node.js 20.x.',
    'NodeVersionSupportWarning'
  );
  process.emitWarning('a genuine warning the agent should see', 'GenuineWarning');

  // 'warning' events are emitted on the next tick.
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(received, ['a genuine warning the agent should see']);
});

test('module sets the SDK suppress env + noDeprecation', () => {
  assert.equal(process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE, '1');
  assert.equal(process.noDeprecation, true);
});
