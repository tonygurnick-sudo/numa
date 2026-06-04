import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  show: boolean;
  onDismiss: () => void;
}

/**
 * Inline banner shown at the top of the chat area when chat health hits red.
 * Dismissable; the dismissal lives in component state in the parent, which
 * resets whenever the conversationId changes — so re-opening the conversation
 * later surfaces the banner again.
 */
export const ChatHealthBanner: React.FC<Props> = ({ show, onDismiss }) => {
  const { t } = useTranslation('chat');
  if (!show) return null;
  return (
    <div className="chat-health-banner" role="alert">
      <span className="chat-health-banner-icon" aria-hidden="true">
        <AlertCircle size={16} strokeWidth={2.2} />
      </span>
      <div className="chat-health-banner-text">
        <div className="chat-health-banner-title">{t('chatHealth.banner.title')}</div>
        <div className="chat-health-banner-body">{t('chatHealth.banner.body')}</div>
      </div>
      <button
        type="button"
        className="chat-health-banner-dismiss"
        onClick={onDismiss}
        aria-label={t('chatHealth.banner.dismissAria')}
      >
        <X size={14} strokeWidth={2.4} />
      </button>
    </div>
  );
};
