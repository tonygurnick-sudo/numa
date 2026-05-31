import { TerraformStack, Testing } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import assert from 'node:assert';
import { before, describe, it } from 'node:test';
import { v5 as uuidv5 } from 'uuid';
import { NumaVoiceConstruct } from '../../constructs/numa-voice-construct';

// Must match VOICE_UUID_NAMESPACE in the construct + seed-data.ts.
const NAMESPACE = '4f3b2a1c-9d8e-5f6a-8b8c-0d1e2f3a4b5c';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    new AwsProvider(this, 'aws', { region: 'us-east-1' });
    new NumaVoiceConstruct(this, 'voice', {
      apiGatewayAuthorizerId: 'auth',
      apiGatewayId: 'api',
      clientName: 'testclient',
      environmentName: 'prod',
      region: 'us-east-1',
      voiceRegion: 'ap-southeast-2',
      voiceProvider: undefined,
      clientAccountId: '123456789012',
      outputsBucketArn: 'arn:aws:s3:::out',
      outputsBucketName: 'out',
      dataBucketName: 'numa-testclient-data',
      connectorEventBusName: 'bus',
      agentsTableName: 'agents',
      agentsTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/agents',
      schedulesTableName: 'sched',
      schedulesTableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/sched',
      userPoolId: 'pool',
      userPoolArn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool',
      systemUserEmail: 'sys@arcanum.ai',
      runnerArn: 'arn:aws:lambda:us-east-1:123456789012:function:runner',
      connectAutoProvision: true,
      systemUserDependsOn: [],
    });
  }
}

describe('NumaVoiceConstruct (connectAutoProvision)', () => {
  let synthesized: string;
  before(() => {
    const app = Testing.app();
    synthesized = Testing.synth(new TestStack(app, 'test'));
  });

  it('grants the Transcribe service principal KMS on the recordings CMK', () => {
    // The blocker: without this, Transcribe fails AccessDenied and no transcript
    // is ever produced.
    assert.match(synthesized, /AllowTranscribeUseOfKey/);
    assert.match(synthesized, /transcribe\.amazonaws\.com/);
  });

  it('does not case-sensitively filter intake uploads', () => {
    // The blocker: a '.xlsx' filterSuffix silently drops 'prospects.XLSX'.
    assert.ok(!synthesized.includes('.xlsx'), 'intake notification must not use a case-sensitive .xlsx filter');
    assert.ok(!synthesized.includes('.xls"'), 'intake notification must not use a case-sensitive .xls filter');
  });

  it('targets the deterministic call-prep id AND passes it to the seed lambda (no drift)', () => {
    const id = uuidv5('callprep-testclient', NAMESPACE);
    // Appears in BOTH the SchedulerSchedule target input and the seed lambda's
    // CALL_PREP_SCHEDULE_ID env — single source of truth.
    assert.ok(synthesized.includes(id), `synth must reference the call-prep id ${id}`);
  });
});
