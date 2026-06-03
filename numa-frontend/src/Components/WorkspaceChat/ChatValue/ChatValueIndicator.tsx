import React from 'react';
import { OverlayTrigger } from 'react-bootstrap';
import { useChatValue } from './useChatValue';
import { ChatValuePopover } from './ChatValuePopover';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;

interface Props {
  conversationId: string | null | undefined;
  /** True while the assistant is streaming — used to refetch the tier once a turn settles. */
  streaming: boolean;
  numaGet: NumaGet;
}

// Match the chat-health indicator's hover feel.
const HOVER_DELAY = { show: 150, hide: 100 };

/**
 * In-chat credit-tier indicator (coin), shown next to the chat-health donut and gated by
 * SHOW_CREDITS at the call site. On hover it reveals the conversation's current credit tier on a
 * 4-step ladder. Informational only.
 */
export const ChatValueIndicator: React.FC<Props> = ({ conversationId, streaming, numaGet }) => {
  const value = useChatValue(conversationId, numaGet, streaming);

  return (
    <OverlayTrigger
      trigger={['hover', 'focus']}
      placement="top"
      delay={HOVER_DELAY}
      overlay={<ChatValuePopover value={value} />}
    >
      <button type="button" className="chat-health-indicator-btn" aria-label="Chat credit tier">
        <i className="bi bi-coin" style={{ fontSize: '1rem', color: value.classified ? '#b8860b' : '#adb5bd' }} />
      </button>
    </OverlayTrigger>
  );
};
