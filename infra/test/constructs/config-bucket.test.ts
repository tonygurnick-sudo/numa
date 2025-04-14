import { TerraformStack, Testing } from 'cdktf';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ConfigBucket } from '../../constructs/config-bucket-construct';
import { Construct } from 'constructs';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new ConfigBucket(this, 'test', { clientName: 'bob', clientAccountId: '12345' });
  }
}

describe('Config Bucket construct', () => {
  it('Adds bucket', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(
      Testing.toHaveResourceWithProperties(synthesized, 'aws_s3_bucket', {
        bucket: 'numa-bob-config',
      }),
    );
  });
});
