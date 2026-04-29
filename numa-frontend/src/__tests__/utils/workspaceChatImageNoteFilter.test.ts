/**
 * @vitest-environment jsdom
 *
 * Verifies that the synthetic "[Image: original WxH, displayed at WxH. Multiply
 * coordinates by N to map to original image.]" message that the bundled
 * Claude Code CLI injects when it auto-downsamples an image is filtered out
 * of the rendered transcript by parseRawTraceToMessages.
 */

import { describe, it, expect } from 'vitest';
import { parseRawTraceToMessages } from '../../utils/workspaceChatEventHandlers';

function makeTrace(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

function userTextEvent(text: string) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  };
}

describe('workspaceChatEventHandlers — synthetic image-note filter', () => {
  it('drops the synthetic image-resize note from the rendered transcript', () => {
    const trace = makeTrace([
      userTextEvent('please measure the cladding from the elevation drawings'),
      userTextEvent(
        '[Image: original 5788x942, displayed at 2000x326. Multiply coordinates by 2.89 to map to original image.]'
      ),
      userTextEvent(
        '[Image: original 1041x3070, displayed at 678x2000. Multiply coordinates by 1.54 to map to original image.]'
      ),
    ]);

    const messages = parseRawTraceToMessages(trace);
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('please measure the cladding from the elevation drawings');
  });

  it('filters synthetic notes with surrounding whitespace', () => {
    const trace = makeTrace([
      userTextEvent(
        '   [Image: original 3000x2000, displayed at 2000x1333. Multiply coordinates by 1.50 to map to original image.]   \n'
      ),
    ]);

    const messages = parseRawTraceToMessages(trace);
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(0);
  });

  it('keeps user messages where the bracket text appears mid-sentence', () => {
    const userText =
      'I sent a screenshot earlier — the model said "[Image: original 100x100, displayed at 50x50. Multiply coordinates by 2.00 to map to original image.]" and I want to talk about it.';
    const trace = makeTrace([userTextEvent(userText)]);

    const messages = parseRawTraceToMessages(trace);
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe(userText);
  });

  it('keeps ordinary user messages untouched', () => {
    const trace = makeTrace([userTextEvent('hello world')]);

    const messages = parseRawTraceToMessages(trace);
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('hello world');
  });
});
