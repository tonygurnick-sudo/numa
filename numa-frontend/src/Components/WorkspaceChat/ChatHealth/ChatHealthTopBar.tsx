import React from 'react';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CHAT_HEALTH_ORANGE_RATIO } from './constants';
import type { ChatHealthState } from './useChatHealth';

const HOVER_DELAY = { show: 150, hide: 100 };

interface Props {
  state: ChatHealthState;
}

type TrafficBand = 'green' | 'orange' | 'red';

/**
 * Ian's design: a slim, always-visible progress bar at the top of the chat
 * area showing chat health.
 *
 * Bar fills as the chat degrades, showing the wear ratio computed in
 * useChatHealth — worst of: context fill, user-message count, tool-turn
 * count, compaction wear. So:
 *   - 0%   = pristine chat
 *   - 75%  = orange ("chat getting long")
 *   - 100% = red
 * Colour band follows the same scale, traffic-light green/orange/red,
 * brand-independent, and agrees with the hourglass alarm by construction
 * (both derive from the same wearRatio).
 */
export const ChatHealthTopBar: React.FC<Props> = ({ state }) => {
  const { t } = useTranslation('chat');
  const { wearRatio } = state;

  const pct = Math.round(wearRatio * 100);

  const band: TrafficBand = wearRatio >= 1 ? 'red' : wearRatio >= CHAT_HEALTH_ORANGE_RATIO ? 'orange' : 'green';

  const labelKey =
    band === 'red'
      ? 'chatHealth.topBar.labelRed'
      : band === 'orange'
        ? 'chatHealth.topBar.labelOrange'
        : 'chatHealth.topBar.labelGreen';

  const helpPopover = (
    <Popover id="chat-health-topbar-help" className="chat-health-popover">
      <Popover.Body>
        <div className="chat-health-popover-title">{t('chatHealth.topBar.helpTitle')}</div>
        <div className="chat-health-popover-body">{t('chatHealth.topBar.helpBody')}</div>
      </Popover.Body>
    </Popover>
  );

  return (
    <div className={`chat-health-topbar chat-health-topbar-${band}`} role="img" aria-label={t(labelKey)}>
      <div className="chat-health-topbar-label">
        <span className="chat-health-topbar-dot" aria-hidden="true" />
        <span className="chat-health-topbar-label-text">{t(labelKey)}</span>
      </div>
      <div className="chat-health-topbar-track">
        <div className="chat-health-topbar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="chat-health-topbar-value">{pct}%</div>
      <OverlayTrigger trigger={['hover', 'focus']} placement="bottom" delay={HOVER_DELAY} overlay={helpPopover}>
        <button type="button" className="chat-health-topbar-help" aria-label={t('chatHealth.topBar.helpAria')}>
          <HelpCircle size={13} strokeWidth={2.2} />
        </button>
      </OverlayTrigger>
    </div>
  );
};
