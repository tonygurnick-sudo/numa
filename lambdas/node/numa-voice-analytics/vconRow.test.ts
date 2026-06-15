import { describe, it, expect } from 'vitest';
import { vconToRow } from './vconRow';

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
    { type: 'summary', body: 'Good call.' },
    { type: 'objections', body: ['price'] },
    { type: 'next_steps', body: ['callback'] },
    { type: 'call_quality', body: { rating: 4 } },
  ],
  attachments: [{ type: 'sdr_disposition', body: { outcome: 'interested', qualified: true } }],
};

describe('vconToRow', () => {
  it('maps a vCon to an analytics CallRow', () => {
    const r = vconToRow(vcon, 'Pacific/Auckland');
    expect(r).not.toBeNull();
    expect(r!.contactId).toBe('c1');
    expect(r!.direction).toBe('outbound');
    expect(r!.durationSeconds).toBe(88);
    expect(r!.wasAnswered).toBe(true);
    expect(r!.disposition).toBe('interested');
    expect(r!.rating).toBe(4);
    expect(r!.agentUsername).toBe('tony@x.nz');
    expect(r!.company).toBe('Acme');
    expect(r!.prospectPhone).toBe('+6421999');
    expect(r!.recordingKey).toBe('recordings/c1.wav');
    expect(r!.recordingBucket).toBe('recbucket');
    expect(r!.transcriptKey).toBe('documents/company/voice/transcripts/c1.json');
    expect(r!.summary).toBe('Good call.');
    expect(r!.gsi1pk).toBe('2026-06-12'); // 14:13 NZ
    expect(typeof r!.startMs).toBe('number');
  });

  it('returns null without a contactId', () => {
    expect(vconToRow({ meta: {} }, 'Pacific/Auckland')).toBeNull();
  });
});
