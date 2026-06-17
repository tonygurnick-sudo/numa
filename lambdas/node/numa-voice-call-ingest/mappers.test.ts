import { describe, it, expect } from 'vitest';
import { dateBucket, epochMs, mapContactEvent, mapVconRecord } from './mappers';

describe('dateBucket (tenant timezone)', () => {
  it('rolls a late-UTC time into the next NZ day', () => {
    // 13:00 UTC on Jun 11 is 01:00 NZ (UTC+12) on Jun 12.
    expect(dateBucket('2026-06-11T13:00:00Z', 'Pacific/Auckland')).toBe('2026-06-12');
  });
  it('returns undefined for a non-date', () => {
    expect(dateBucket('nope', 'Pacific/Auckland')).toBeUndefined();
    expect(epochMs(undefined)).toBeUndefined();
  });
});

describe('mapContactEvent', () => {
  it('maps an OUTBOUND initiated event', () => {
    const m = mapContactEvent(
      {
        eventType: 'INITIATED',
        contactId: 'c1',
        channel: 'VOICE',
        initiationMethod: 'OUTBOUND',
        initiationTimestamp: '2026-06-12T02:13:40.000Z',
      },
      'Pacific/Auckland'
    );
    expect(m).not.toBeNull();
    expect(m!.contactId).toBe('c1');
    expect(m!.attrs.direction).toBe('outbound');
    expect(m!.attrs.gsi1pk).toBe('2026-06-12'); // 14:13 NZ
    expect(m!.attrs.sk).toBe('CALL');
    expect(typeof m!.attrs.gsi1sk).toBe('string');
  });

  it('flags a disconnected-without-agent as missed', () => {
    const m = mapContactEvent(
      {
        eventType: 'DISCONNECTED',
        contactId: 'c2',
        initiationMethod: 'INBOUND',
        disconnectReason: 'CUSTOMER_DISCONNECT',
      },
      'Pacific/Auckland'
    );
    expect(m!.attrs.missed).toBe(true);
    expect(m!.attrs.direction).toBe('inbound');
    expect(m!.attrs.disconnectReason).toBe('CUSTOMER_DISCONNECT');
  });

  it('marks answered when an agent connected', () => {
    const m = mapContactEvent(
      {
        eventType: 'CONNECTED_TO_AGENT',
        contactId: 'c3',
        agentInfo: {
          agentArn: 'arn:aws:connect:x:1:instance/i/agent/AID',
          connectedToAgentTimestamp: '2026-06-12T02:14:00Z',
        },
      },
      'Pacific/Auckland'
    );
    expect(m!.attrs.wasAnswered).toBe(true);
    expect(m!.attrs.agentId).toBe('AID');
    expect(m!.attrs.missed).toBeUndefined();
  });

  it('returns null without a contactId', () => {
    expect(mapContactEvent({ eventType: 'INITIATED' }, 'Pacific/Auckland')).toBeNull();
  });
});

describe('mapVconRecord', () => {
  const vcon = {
    uuid: 'u1',
    meta: { numa_contact_id: 'c1' },
    parties: [
      { role: 'agent', name: 'Tony', mailto: 'tony@x.nz', meta: { connect_agent_id: 'tony@x.nz' } },
      { role: 'customer', tel: '+6421999', meta: { company_name: 'Acme' } },
    ],
    dialog: [
      { type: 'recording', start: '2026-06-12T02:13:40Z', duration: 88, url: 's3://recbucket/recordings/c1.wav' },
      { type: 'transcript', url: 's3://databucket/documents/company/voice/transcripts/c1.json' },
    ],
    analysis: [
      { type: 'transcript', body: {} },
      { type: 'summary', body: 'Good call.' },
      { type: 'call_quality', body: { rating: 4 } },
    ],
    attachments: [{ type: 'sdr_disposition', body: { outcome: 'interested', qualified: true } }],
  };

  it('enriches from the vCon', () => {
    const m = mapVconRecord(vcon, 'Pacific/Auckland');
    expect(m!.contactId).toBe('c1');
    expect(m!.attrs.durationSeconds).toBe(88);
    expect(m!.attrs.recordingKey).toBe('recordings/c1.wav');
    expect(m!.attrs.recordingBucket).toBe('recbucket');
    expect(m!.attrs.transcriptKey).toBe('documents/company/voice/transcripts/c1.json');
    expect(m!.attrs.disposition).toBe('interested');
    expect(m!.attrs.qualified).toBe(true);
    expect(m!.attrs.rating).toBe(4);
    expect(m!.attrs.summary).toBe('Good call.');
    expect(m!.attrs.agentUsername).toBe('tony@x.nz');
    expect(m!.attrs.prospectPhone).toBe('+6421999');
    expect(m!.attrs.company).toBe('Acme');
    expect(m!.attrs.gsi2pk).toBe('tony@x.nz'); // byAgent
    expect(m!.attrs.gsi3pk).toBe('interested'); // byDisposition
    expect(m!.attrs.vconUuid).toBe('u1');
  });

  it('returns null without a contactId', () => {
    expect(mapVconRecord({ meta: {} }, 'Pacific/Auckland')).toBeNull();
  });
});
