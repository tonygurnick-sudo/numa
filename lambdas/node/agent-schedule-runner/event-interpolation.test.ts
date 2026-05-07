/**
 * Unit tests for the {{ event.* }} interpolation helpers used by the
 * Pipedream-trigger branch of the runner.
 */

import { describe, it, expect } from 'vitest';
import { interpolateEventVars, resolveDottedPath } from './index';

describe('resolveDottedPath', () => {
  it('returns the value at a single-segment path', () => {
    expect(resolveDottedPath({ text: 'hello' }, 'text')).toBe('hello');
  });

  it('returns the value at a nested dotted path', () => {
    expect(resolveDottedPath({ raw: { user_profile: { real_name: 'Nathan' } } }, 'raw.user_profile.real_name')).toBe(
      'Nathan'
    );
  });

  it('returns undefined for missing intermediates', () => {
    expect(resolveDottedPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(resolveDottedPath({}, 'foo')).toBeUndefined();
  });

  it('handles non-object roots safely', () => {
    expect(resolveDottedPath(null, 'a')).toBeUndefined();
    expect(resolveDottedPath('hello', 'a')).toBeUndefined();
    expect(resolveDottedPath(42, 'a')).toBeUndefined();
  });
});

describe('interpolateEventVars', () => {
  const slackEvent = {
    source: 'pipedream' as const,
    app_slug: 'slack',
    component_id: 'slack-new-keyword-mention',
    dedup_key: '8cb3a6fe',
    text: 'Hey @numa, summarise this thread',
    channel: 'CD65MARED',
    channel_name: 'fun',
    user: 'U036X8Z6728',
    user_name: 'Nathan',
    raw: {
      type: 'message',
      user_profile: { real_name: 'Nathan Douglas', display_name: 'nathan' },
      blocks: [{ type: 'rich_text' }],
    },
  };

  it('substitutes a top-level field', () => {
    const out = interpolateEventVars('Got: {{ event.text }}', slackEvent);
    expect(out).toBe('Got: Hey @numa, summarise this thread');
  });

  it('substitutes a dotted path into the raw payload', () => {
    const out = interpolateEventVars('From {{ event.raw.user_profile.real_name }}', slackEvent);
    expect(out).toBe('From Nathan Douglas');
  });

  it('handles whitespace inside the braces', () => {
    expect(interpolateEventVars('{{event.text}}', slackEvent)).toBe('Hey @numa, summarise this thread');
    expect(interpolateEventVars('{{  event.text  }}', slackEvent)).toBe('Hey @numa, summarise this thread');
  });

  it('replaces missing fields with empty string (not "undefined")', () => {
    const out = interpolateEventVars('Maybe: {{ event.does_not_exist }}!', slackEvent);
    expect(out).toBe('Maybe: !');
  });

  it('JSON-encodes object/array values', () => {
    const out = interpolateEventVars('{{ event.raw.blocks }}', slackEvent);
    expect(out).toBe('[{"type":"rich_text"}]');
  });

  it('does not collapse multiple substitutions', () => {
    const out = interpolateEventVars('user={{ event.user }} channel={{ event.channel_name }}', slackEvent);
    expect(out).toBe('user=U036X8Z6728 channel=fun');
  });

  it('leaves the template untouched when there are no placeholders', () => {
    expect(interpolateEventVars('Just a static prompt.', slackEvent)).toBe('Just a static prompt.');
  });

  it('coerces numbers and booleans', () => {
    const evt = { source: 'pipedream' as const, count: 3, ok: true };
    expect(interpolateEventVars('{{ event.count }} / {{ event.ok }}', evt)).toBe('3 / true');
  });
});
