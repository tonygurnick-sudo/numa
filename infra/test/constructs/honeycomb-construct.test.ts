import { TerraformStack, Testing } from 'cdktf';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Honeycomb } from '../../constructs/honeycomb-construct';
import { Construct } from 'constructs';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new Honeycomb(this, 'honeycomb', { name: 'bob' });
  }
}

describe('Honeycomb construct', () => {
  it('Adds provider', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(Testing.toHaveProvider(synthesized, 'honeycombio'));
  });

  it('Adds environment', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(
      Testing.toHaveResourceWithProperties(synthesized, 'honeycombio_environment', {
        name: 'bob',
        color: 'purple',
      }),
    );
  });

  it('Adds frontend api key', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(
      Testing.toHaveResourceWithProperties(synthesized, 'honeycombio_api_key', {
        name: 'Frontend Ingest Key',
        type: 'ingest',
        permissions: [
          {
            create_datasets: false,
          },
        ],
      }),
    );
  });

  // TODO: Uncomment this when we need to create the backend key.
  it('Adds backend api key', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(
      Testing.toHaveResourceWithProperties(synthesized, 'honeycombio_api_key', {
        name: 'Backend Ingest Key',
        type: 'ingest',
        permissions: [
          {
            create_datasets: true,
          },
        ],
      }),
    );
  });
});
