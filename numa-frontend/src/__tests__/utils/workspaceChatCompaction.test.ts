/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import {
  createSDKEventContext,
  createWorkspaceChatMessageHelpers,
  handleSDKStreamComplete,
  parseRawTraceToMessages,
  processSDKEvent,
} from '../../utils/workspaceChatEventHandlers';
import type { SDKEvent, WorkspaceChatCompactionSegment, WorkspaceChatMessage } from '../../types/workspaceChatTypes';

function makeTrace(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

function compactBoundaryEvent(): SDKEvent {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    data: {
      compact_metadata: {
        pre_tokens: 124977,
        trigger: 'auto',
      },
    },
  } as SDKEvent;
}

function compactionSummaryEvent(summary: string): SDKEvent {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: summary }],
    },
  } as SDKEvent;
}

function resultEvent(): SDKEvent {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 13500,
    duration_api_ms: 12000,
    is_error: false,
    num_turns: 31,
    total_cost_usd: 0.0336,
    usage: {
      input_tokens: 9,
      output_tokens: 919,
    },
  } as SDKEvent;
}

function errorResultEvent(message = 'Prompt too long'): SDKEvent {
  return {
    ...resultEvent(),
    is_error: true,
    result: message,
  } as SDKEvent;
}

function compactionSegment(messages: WorkspaceChatMessage[]): WorkspaceChatCompactionSegment {
  const assistant = messages.find((m) => m.role === 'assistant');
  const segment = assistant?.segments?.find((s) => s.kind === 'compaction');
  expect(segment).toBeDefined();
  return segment as WorkspaceChatCompactionSegment;
}

describe('workspaceChatEventHandlers — compaction UI', () => {
  it('renders compaction from trace replay when compact_boundary has no prior status event', () => {
    const trace = makeTrace([compactBoundaryEvent(), compactionSummaryEvent('Previous turns summarized.')]);

    const messages = parseRawTraceToMessages(trace);
    const segment = compactionSegment(messages);

    expect(segment.status).toBe('complete');
    expect(segment.summary).toBe('Previous turns summarized.');
    expect(segment.preTokens).toBe(124977);
    expect(segment.trigger).toBe('auto');
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(0);
  });

  it('shows live compaction instead of leaving the generic processing spinner visible', () => {
    let messages: WorkspaceChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        status: 'processing',
        segments: [{ kind: 'inline_thinking', isStreaming: true }],
      },
    ];
    const helpers = createWorkspaceChatMessageHelpers(
      (updater) => {
        messages = updater(messages);
      },
      () => undefined
    );
    const context = createSDKEventContext();

    processSDKEvent(compactBoundaryEvent(), context, helpers);

    expect(messages[0].status).toBe('streaming');
    expect(messages[0].segments?.some((s) => s.kind === 'inline_thinking')).toBe(false);
    const segment = compactionSegment(messages);
    expect(segment.status).toBe('summarizing');
    expect(segment.preTokens).toBe(124977);
  });

  it('marks live compaction complete when the turn result arrives without a streamed summary', () => {
    let messages: WorkspaceChatMessage[] = [];
    const helpers = createWorkspaceChatMessageHelpers(
      (updater) => {
        messages = updater(messages);
      },
      () => undefined
    );
    const context = createSDKEventContext();

    processSDKEvent(compactBoundaryEvent(), context, helpers);
    processSDKEvent(resultEvent(), context, helpers);

    const segment = compactionSegment(messages);
    expect(segment.status).toBe('complete');
    expect(segment.summary).toBeUndefined();
    expect(messages[0].costUsd).toBe(0.0336);
  });

  it('marks live compaction failed when the turn result is an error', () => {
    let messages: WorkspaceChatMessage[] = [];
    const helpers = createWorkspaceChatMessageHelpers(
      (updater) => {
        messages = updater(messages);
      },
      () => undefined
    );
    const context = createSDKEventContext();

    processSDKEvent(compactBoundaryEvent(), context, helpers);
    processSDKEvent(errorResultEvent(), context, helpers);

    expect(compactionSegment(messages).status).toBe('failed');
  });

  it('marks replayed compaction failed when the trace result is an error before a summary arrives', () => {
    const trace = makeTrace([
      {
        type: 'assistant',
        message: {
          id: 'msg-1',
          role: 'assistant',
          model: 'claude',
          content: [{ type: 'text', text: 'Starting with activating the full suite:' }],
        },
      },
      compactBoundaryEvent(),
      errorResultEvent(),
    ]);

    const messages = parseRawTraceToMessages(trace);

    expect(compactionSegment(messages).status).toBe('failed');
  });

  it('marks live compaction complete when the stream closes without a result or streamed summary', () => {
    let messages: WorkspaceChatMessage[] = [];
    const helpers = createWorkspaceChatMessageHelpers(
      (updater) => {
        messages = updater(messages);
      },
      () => undefined
    );
    const context = createSDKEventContext();

    processSDKEvent(compactBoundaryEvent(), context, helpers);
    handleSDKStreamComplete(context, helpers);

    expect(compactionSegment(messages).status).toBe('complete');
  });
});
