import { TerraformStack, Testing } from 'cdktf';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ConfigBucket } from '../../constructs/config-bucket-construct';
import { Construct } from 'constructs';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new ConfigBucket(this, 'test', { client: 'bob', clientAccountId: '12345' });
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

  it('Adds bucket object', (): void => {
    const app = Testing.app();
    const stack = new TestStack(app, 'test');
    const synthesized = Testing.synth(stack);

    assert(Testing.toHaveResource(synthesized, 'aws_s3_object'));

    const s3Objects = JSON.parse(synthesized)['resource']['aws_s3_object'];
    const s3ObjectList = Object.entries(s3Objects);
    type Expected = {
      key: string;
      source: string;
      bucket: string;
    };
    assert.equal(s3ObjectList.length, 1);
    const [key, value] = s3ObjectList[0] as [string, Expected];
    assert.match(key, /test_honeycomb-config-file_[A-F0-9]+/);
    assert.equal(value['key'], 'config.yaml');
    assert.match(value['source'], /.*\/infra\/assets\/otel-config\.yaml$/);
  });
});
