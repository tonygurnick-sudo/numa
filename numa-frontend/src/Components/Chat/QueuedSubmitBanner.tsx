import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface QueuedSubmitBannerProps {
  message: string;
  onCancel: () => void;
}

/**
 * Inline banner shown above the chat input when the user submits a message
 * while file uploads are still in flight. The message is held until uploads +
 * staging finish, then auto-fired so the model receives text + attachments together.
 */
export function QueuedSubmitBanner({ message, onCancel }: QueuedSubmitBannerProps) {
  const { t } = useTranslation('chat');
  const preview =
    message.trim().length > 0
      ? message.length > 80
        ? `${message.slice(0, 80).trim()}…`
        : message
      : t('queuedSubmit.attachmentsOnly', { defaultValue: '(attachments only)' });

  return (
    <div className="queued-submit-banner" role="status" aria-live="polite">
      <Spinner as="span" animation="border" size="sm" className="queued-submit-spinner" />
      <span className="queued-submit-text">
        <span className="queued-submit-label">
          {t('queuedSubmit.label', { defaultValue: 'Sending after upload finishes:' })}
        </span>{' '}
        <span className="queued-submit-preview">{preview}</span>
      </span>
      <button
        type="button"
        className="queued-submit-cancel"
        onClick={onCancel}
        aria-label={t('queuedSubmit.cancelAria', { defaultValue: 'Cancel queued message' })}
      >
        {t('queuedSubmit.cancel', { defaultValue: 'Cancel' })}
      </button>
    </div>
  );
}
