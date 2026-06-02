import React from 'react';
import { OverlayTrigger } from 'react-bootstrap';
import type { WorkspaceChatMessage, WorkspaceChatModelId } from '../../../types/workspaceChatTypes';
import { ChatHealthAlarm } from './ChatHealthAlarm';
import { ChatHealthPopover } from './ChatHealthPopover';
import { ContextDonut } from './ContextDonut';
import { useChatHealth } from './useChatHealth';

interface Props {
  messages: WorkspaceChatMessage[] | undefined;
  modelId: WorkspaceChatModelId | undefined;
  /** Show raw token breakdown in popover - gated by DEVELOPER_MODE + cost toggle. */
  debugMode?: boolean;
}

// Tooltip-style hover delay - quick to appear, quick to dismiss.
const HOVER_DELAY = { show: 150, hide: 100 };

/**
 * Two side-by-side chat health indicators:
 *  1. Context donut - neutral fill, pulses near auto-compaction.
 *  2. Chat-health alarm - hidden until amber, then the only coloured warning.
 *
 * Each shows a popover with plain-English copy on hover/focus. Informational
 * only - no action buttons.
 */
export const ChatHealthIndicators: React.FC<Props> = ({ messages, modelId, debugMode }) => {
  const state = useChatHealth(messages, modelId);

  const latestUsageMessage = debugMode
    ? [...(messages ?? [])]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' && (typeof m.snapshotInputTokens === 'number' || typeof m.inputTokens === 'number')
        )
    : undefined;

  return (
    <div className="chat-health-indicators" role="group" aria-label="Chat health">
      <OverlayTrigger
        trigger={['hover', 'focus']}
        placement="top"
        delay={HOVER_DELAY}
        overlay={
          <ChatHealthPopover
            state={state}
            anchor="context"
            debugMode={debugMode}
            latestUsageMessage={latestUsageMessage}
          />
        }
      >
        <button type="button" className="chat-health-indicator-btn" aria-label="Chat memory usage">
          <ContextDonut pct={state.contextPct} pulse={state.prePulse} />
        </button>
      </OverlayTrigger>

      {state.alarmBand !== 'hidden' && (
        <OverlayTrigger
          trigger={['hover', 'focus']}
          placement="top"
          delay={HOVER_DELAY}
          overlay={
            <ChatHealthPopover
              state={state}
              anchor="alarm"
              debugMode={debugMode}
              latestUsageMessage={latestUsageMessage}
            />
          }
        >
          <button type="button" className="chat-health-indicator-btn" aria-label="Chat health warning">
            <ChatHealthAlarm band={state.alarmBand} />
          </button>
        </OverlayTrigger>
      )}
    </div>
  );
};
