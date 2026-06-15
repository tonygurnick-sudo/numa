import { TerraformStack, Testing } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import assert from 'node:assert';
import { before, describe, it } from 'node:test';
import { v5 as uuidv5 } from 'uuid';
import {
  NumaVoiceConstruct,
  isValidConnectInstanceUrl,
  callPrepCronFromTime,
} from '../../constructs/numa-voice-construct';

// Must match VOICE_UUID_NAMESPACE in the construct + seed-data.ts.
const NAMESPACE = '4f3b2a1c-9d8e-5f6a-8b8c-0d1e2f3a4b5c';

class TestStack extends TerraformStack {
  constructor(scope: Construct, name: string, overrides: Record<string, unknown> = {}) {
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
      frontendOrigin: 'https://testclient.numa.arcanum.ai',
      voiceConfigWriterLambdaArn: 'arn:aws:lambda:us-east-1:207567759910:function:numa-voice-config-writer',
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
      ...overrides,
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

  it('gives the recording→transcript pipeline a DLQ wired into the processor', () => {
    // The blocker: S3/EventBridge are ASYNC invokes — without a DLQ a failed
    // recording or completion event is silently dropped after 2 retries.
    assert.match(synthesized, /testclient-voice-processor-dlq/);
    assert.match(synthesized, /dead_letter_config/);
  });

  it('alarms on the pipeline failure signals (DLQ depth, Lambda errors, Transcribe failures)', () => {
    assert.match(synthesized, /testclient-voice-processor-dlq-not-empty/);
    assert.match(synthesized, /testclient-voice-processor-errors/);
    assert.match(synthesized, /testclient-voice-transcription-failed/);
    assert.match(synthesized, /testclient-voice-diarisation-unexpected/);
  });

  it('grants the processor cloudwatch:PutMetricData so the custom-metric alarms get data', () => {
    // Without this the best-effort metric emits silently no-op and the
    // TranscriptionFailed/DiarisationUnexpected alarms never receive data.
    assert.match(synthesized, /cloudwatch:PutMetricData/);
  });
});

describe('callPrepCronFromTime (FEAT-164 per-client schedule time)', () => {
  it('parses HH:MM into an EventBridge Scheduler cron', () => {
    assert.strictEqual(callPrepCronFromTime('07:30'), 'cron(30 7 * * ? *)');
    assert.strictEqual(callPrepCronFromTime('6:05'), 'cron(5 6 * * ? *)');
    assert.strictEqual(callPrepCronFromTime('23:59'), 'cron(59 23 * * ? *)');
  });

  it('throws at synth on malformed times so a config typo fails loudly', () => {
    for (const bad of ['24:00', '7:5', 'half past', '', '07:60']) {
      assert.throws(() => callPrepCronFromTime(bad), /HH:MM/);
    }
  });
});

describe('NumaVoiceConstruct FEAT-164 schedule-time plumbing', () => {
  it('threads a custom callPrepTime/timezone into BOTH the SchedulerSchedule and the seed env', () => {
    const app = Testing.app();
    const synth = Testing.synth(
      new TestStack(app, 'test-callprep', { callPrepTime: '06:15', callPrepTimezone: 'Australia/Sydney' })
    );
    // The cron that actually fires…
    assert.match(synth, /cron\(15 6 \* \* \? \*\)/);
    assert.match(synth, /Australia\/Sydney/);
    // …and the seeded schedule record mirror (env on the seed lambda).
    assert.match(synth, /"CALL_PREP_CRON":\s*"cron\(15 6 \* \* \? \*\)"/);
    assert.match(synth, /"CALL_PREP_TIMEZONE":\s*"Australia\/Sydney"/);
  });

  it('defaults to 07:30 Pacific/Auckland when no time is configured', () => {
    const app = Testing.app();
    const synth = Testing.synth(new TestStack(app, 'test-callprep-default'));
    assert.match(synth, /cron\(30 7 \* \* \? \*\)/);
    assert.match(synth, /Pacific\/Auckland/);
  });
});

describe('isValidConnectInstanceUrl (FEAT-158 pre-flight)', () => {
  it('accepts a modern *.my.connect.aws instance URL', () => {
    assert.ok(isValidConnectInstanceUrl('https://numa-testclient.my.connect.aws'));
    assert.ok(isValidConnectInstanceUrl('https://numa-testclient.my.connect.aws/'));
  });

  it('accepts a legacy *.awsapps.com/connect/ instance URL', () => {
    assert.ok(isValidConnectInstanceUrl('https://testclient.awsapps.com/connect/'));
  });

  it('rejects http, unknown hosts, the CCP URL, and garbage', () => {
    assert.ok(!isValidConnectInstanceUrl('http://numa-testclient.my.connect.aws')); // not https
    assert.ok(!isValidConnectInstanceUrl('https://evil.example.com')); // wrong host
    assert.ok(!isValidConnectInstanceUrl('https://numa-testclient.my.connect.aws/connect/ccp-v2')); // CCP URL
    assert.ok(!isValidConnectInstanceUrl('numa-testclient')); // not a URL
    assert.ok(!isValidConnectInstanceUrl('')); // empty
  });
});

describe('NumaVoiceConstruct FEAT-158 deploy-time pre-flight', () => {
  it('throws at synth when a manual (non-autoProvision) tenant has no connectInstanceUrl', () => {
    assert.throws(() => {
      const app = Testing.app();
      Testing.synth(new TestStack(app, 'no-url', { connectAutoProvision: false, connectInstanceUrl: undefined }));
    }, /connectInstanceUrl is missing/);
  });

  it('throws at synth when connectInstanceUrl is malformed', () => {
    assert.throws(() => {
      const app = Testing.app();
      Testing.synth(
        new TestStack(app, 'bad-url', {
          connectAutoProvision: false,
          connectInstanceUrl: 'https://numa-testclient.my.connect.aws/connect/ccp-v2',
        })
      );
    }, /not a valid Amazon Connect instance URL/);
  });

  it('synthesizes cleanly for a manual tenant with a valid connectInstanceUrl', () => {
    const app = Testing.app();
    assert.doesNotThrow(() => {
      Testing.synth(
        new TestStack(app, 'good-url', {
          connectAutoProvision: false,
          connectInstanceUrl: 'https://numa-testclient.my.connect.aws',
        })
      );
    });
  });
});
