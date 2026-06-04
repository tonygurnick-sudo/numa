import React from 'react';
import { Hourglass } from 'lucide-react';
import type { AlarmBand } from './useChatHealth';

interface Props {
  band: AlarmBand;
  size?: number;
}

/**
 * Long-running-chat alarm. Hidden unless the chat has accrued real wear
 * (compactions, message count, or tool-turn count). Carries the only colour
 * semantics in the chat-health UI - donut stays neutral.
 */
export const ChatHealthAlarm: React.FC<Props> = ({ band, size = 16 }) => {
  if (band === 'hidden') return null;

  return (
    <span className={`chat-health-alarm chat-health-alarm-${band}`} aria-hidden="true">
      <Hourglass size={size} strokeWidth={2} />
    </span>
  );
};
