import React from 'react';
import { Popover } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatMessage } from '../../../types/workspaceChatTypes';
import type { ChatHealthState } from './useChatHealth';

interface Props {
  state: ChatHealthState;
  /** Which indicator the popover is anchored to - affects copy emphasis */
  anchor: 'context' | 'alarm';
  /** When true, render the raw token breakdown for debugging. */
  debugMode?: boolean;
  /** Latest assistant message - only used to render the debug breakdown. */
  latestUsageMessage?: WorkspaceChatMessage;
}

/**
 * Shared popover for both chat-health indicators. Informational only - no
 * action buttons. Uses a plain-English "chat length" framing instead of jargon
 * (tokens / context window / compaction). The raw token breakdown is rendered
 * only in debugMode (DEVELOPER_MODE + cost toggle), never for end users.
 */
export const ChatHealthPopover = React.forwardRef<HTMLDivElement, Props & React.HTMLAttributes<HTMLDivElement>>(
  ({ state, anchor, debugMode, latestUsageMessage, ...overlayProps }, ref) => {
    const { t } = useTranslation('chat');
    const { contextPct, alarmBand, prePulse, compactions } = state;

    let title: string;
    let body: string;

    if (anchor === 'context') {
      const pct = Math.round(contextPct * 100);
      if (prePulse) {
        title = t('chatHealth.context.preCompactTitle');
        body = t('chatHealth.context.preCompactBody', { pct });
      } else {
        title = t('chatHealth.context.title');
        body = t('chatHealth.context.body', { pct });
      }
    } else {
      if (alarmBand === 'red') {
        title = t('chatHealth.alarm.redTitle');
        body = t('chatHealth.alarm.redBody');
      } else {
        title = t('chatHealth.alarm.amberTitle');
        body = t('chatHealth.alarm.amberBody');
      }
    }

    return (
      <Popover
        ref={ref}
        id="chat-health-popover"
        {...overlayProps}
        className={`chat-health-popover ${overlayProps.className ?? ''}`}
      >
        <Popover.Body>
          <div className="chat-health-popover-title">{title}</div>
          <div className="chat-health-popover-body">{body}</div>
          {compactions > 0 && anchor === 'alarm' && (
            <div className="chat-health-popover-note">
              {t('chatHealth.alarm.compactionsNote', { count: compactions })}
            </div>
          )}
          {debugMode && (
            <div className="chat-health-debug">
              <div>
                <strong>tokensUsed:</strong> {state.tokensUsed.toLocaleString()} /{' '}
                {state.effectiveContextLimit.toLocaleString()} ({Math.round(state.contextPct * 100)}%)
              </div>
              {latestUsageMessage && (
                <>
                  <div>
                    <strong>snapshot</strong>: in {(latestUsageMessage.snapshotInputTokens ?? 0).toLocaleString()}
                    {' + cache_read '}
                    {(latestUsageMessage.snapshotCacheReadTokens ?? 0).toLocaleString()}
                    {' + cache_create '}
                    {(latestUsageMessage.snapshotCacheCreationTokens ?? 0).toLocaleString()}
                    {' + out '}
                    {(latestUsageMessage.snapshotOutputTokens ?? 0).toLocaleString()}
                  </div>
                  <div>
                    <strong>cumulative</strong>: in {(latestUsageMessage.inputTokens ?? 0).toLocaleString()}
                    {' + cache_read '}
                    {(latestUsageMessage.cacheReadTokens ?? 0).toLocaleString()}
                    {' + cache_create '}
                    {(latestUsageMessage.cacheCreationTokens ?? 0).toLocaleString()}
                    {' + out '}
                    {(latestUsageMessage.outputTokens ?? 0).toLocaleString()}
                  </div>
                </>
              )}
              <div>
                userMsgs: {state.userMessages} · compactions: {state.compactions} · toolTurns: {state.toolTurns}
              </div>
            </div>
          )}
        </Popover.Body>
      </Popover>
    );
  }
);

ChatHealthPopover.displayName = 'ChatHealthPopover';
