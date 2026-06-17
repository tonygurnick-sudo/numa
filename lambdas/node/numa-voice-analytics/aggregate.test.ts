import { describe, it, expect } from 'vitest';
import { aggregateSummary, aggregateTimeseries, dateRange, type CallRow } from './aggregate';

const rows: CallRow[] = [
  {
    contactId: 'a',
    direction: 'outbound',
    durationSeconds: 60,
    disposition: 'interested',
    wasAnswered: true,
    agentUsername: 'tony@x.nz',
    gsi1pk: '2026-06-11',
    rating: 4,
  },
  {
    contactId: 'b',
    direction: 'outbound',
    durationSeconds: 0,
    disposition: 'no_answer',
    wasAnswered: false,
    agentUsername: 'tony@x.nz',
    gsi1pk: '2026-06-11',
  },
  {
    contactId: 'c',
    direction: 'outbound',
    durationSeconds: 120,
    disposition: 'callback',
    wasAnswered: true,
    agentUsername: 'lily@x.nz',
    gsi1pk: '2026-06-12',
  },
  { contactId: 'd', direction: 'inbound', durationSeconds: 0, missed: true, gsi1pk: '2026-06-12' },
];

describe('aggregateSummary', () => {
  it('computes outbound/inbound/dispositions/agents', () => {
    const s = aggregateSummary(rows);
    expect(s.totalCalls).toBe(4);
    expect(s.outbound.count).toBe(3);
    // 2 of 3 outbound connected (a + c have answered/duration)
    expect(s.outbound.connectRate).toBe(67);
    expect(s.outbound.avgDurationSec).toBe(90); // mean of 60 + 120
    expect(s.inbound.count).toBe(1);
    expect(s.inbound.missed).toBe(1);
    expect(s.missedDistribution.abandoned).toBe(1);
    // dispositions sorted by count
    expect(s.dispositions.map((d) => d.disposition).sort()).toEqual(['callback', 'interested', 'no_answer']);
    // per-agent
    const tony = s.agents.find((a) => a.agent === 'tony@x.nz');
    expect(tony?.contacts).toBe(2);
    expect(tony?.answered).toBe(1);
    expect(s.timing.avgTalkSec).toBe(90); // mean of nonzero durations
  });
});

describe('aggregateTimeseries', () => {
  it('buckets inbound/outbound per day', () => {
    const pts = aggregateTimeseries(rows, ['2026-06-11', '2026-06-12', '2026-06-13']);
    expect(pts).toEqual([
      { date: '2026-06-11', inbound: 0, outbound: 2 },
      { date: '2026-06-12', inbound: 1, outbound: 1 },
      { date: '2026-06-13', inbound: 0, outbound: 0 },
    ]);
  });
});

describe('dateRange', () => {
  it('spans inclusive tenant-local days', () => {
    const from = Date.parse('2026-06-11T00:00:00+12:00');
    const to = Date.parse('2026-06-12T00:00:00+12:00');
    const days = dateRange(from, to, 'Pacific/Auckland');
    expect(days).toContain('2026-06-11');
    expect(days).toContain('2026-06-12');
  });
});
