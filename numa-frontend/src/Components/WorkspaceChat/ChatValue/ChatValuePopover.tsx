import React from 'react';
import { Popover } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { ConversationValue } from '../../../Services/AdminCreditsService';

// The 4-step credit ladder, low -> high. Framed as a CREDIT-COST tier (never "value"): a Low chat
// uses the fewest credits, not "low-value work". Mirrors the lib's VALID_TIERS ordering.
const LADDER = ['low', 'medium', 'high', 'very_high'] as const;

interface Props {
  value: ConversationValue;
}

/**
 * Hover popover for the in-chat credit indicator. Shows where this chat sits on the credit-cost
 * ladder, with the current tier highlighted. Cost-framed copy only — no exact credit amounts, and
 * never a judgement on the user's work.
 */
export const ChatValuePopover = React.forwardRef<HTMLDivElement, Props & React.HTMLAttributes<HTMLDivElement>>(
  ({ value, ...overlayProps }, ref) => {
    const { t } = useTranslation('chat');
    const current = value.classified ? value.tier : null;

    return (
      <Popover
        ref={ref}
        id="chat-value-popover"
        {...overlayProps}
        className={`chat-health-popover ${overlayProps.className ?? ''}`}
      >
        <Popover.Body>
          <div className="chat-health-popover-title">{t('creditTier.title')}</div>
          {current ? (
            <>
              <div style={{ display: 'flex', gap: 4, margin: '0.5rem 0', flexWrap: 'wrap' }}>
                {LADDER.map((tier) => {
                  const active = tier === current;
                  return (
                    <span
                      key={tier}
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: active ? 600 : 500,
                        padding: '0.15rem 0.45rem',
                        borderRadius: 999,
                        lineHeight: 1.3,
                        color: active ? '#fff' : '#6c757d',
                        background: active ? '#b8860b' : '#f1f3f5',
                        border: `1px solid ${active ? '#b8860b' : '#e9ecef'}`,
                      }}
                    >
                      {t(`creditTier.tiers.${tier}`)}
                    </span>
                  );
                })}
              </div>
              <div className="chat-health-popover-body">{t('creditTier.body')}</div>
            </>
          ) : (
            <div className="chat-health-popover-body">{t('creditTier.rating')}</div>
          )}
        </Popover.Body>
      </Popover>
    );
  }
);

ChatValuePopover.displayName = 'ChatValuePopover';
