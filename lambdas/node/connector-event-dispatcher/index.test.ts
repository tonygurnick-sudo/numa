import { describe, it, expect } from 'vitest';
import { isKnownConnectEventType, matchesConnectSchedule, CONNECT_EVENT_TYPES } from './index';

describe('isKnownConnectEventType', () => {
  it('accepts the known voice sub-events', () => {
    expect(isKnownConnectEventType('call.completed')).toBe(true);
    expect(isKnownConnectEventType('prospects.uploaded')).toBe(true);
  });

  it('rejects unknown / empty event types (so we never dispatch them)', () => {
    expect(isKnownConnectEventType('something.else')).toBe(false);
    expect(isKnownConnectEventType('')).toBe(false);
    expect(isKnownConnectEventType(undefined)).toBe(false);
  });

  it('matches the declared set exactly', () => {
    expect([...CONNECT_EVENT_TYPES].sort()).toEqual(['call.completed', 'prospects.uploaded']);
  });
});

describe('matchesConnectSchedule', () => {
  const active = { status: 'active', trigger: { source: 'connect', event: 'call.completed' } };

  it('matches active connect schedules on the same sub-event', () => {
    expect(matchesConnectSchedule(active, 'call.completed')).toBe(true);
  });

  it('does not cross-fire across sub-events (post-call vs ingest)', () => {
    expect(matchesConnectSchedule(active, 'prospects.uploaded')).toBe(false);
  });

  it('defaults a missing trigger.event to call.completed (legacy schedules)', () => {
    const legacy = { status: 'active', trigger: { source: 'connect' } };
    expect(matchesConnectSchedule(legacy, 'call.completed')).toBe(true);
    expect(matchesConnectSchedule(legacy, 'prospects.uploaded')).toBe(false);
  });

  it('ignores paused, non-connect, and trigger-less schedules', () => {
    expect(
      matchesConnectSchedule(
        { status: 'paused', trigger: { source: 'connect', event: 'call.completed' } },
        'call.completed'
      )
    ).toBe(false);
    expect(
      matchesConnectSchedule(
        { status: 'active', trigger: { source: 'gmail', event: 'call.completed' } },
        'call.completed'
      )
    ).toBe(false);
    expect(matchesConnectSchedule({ status: 'active' }, 'call.completed')).toBe(false);
  });
});
