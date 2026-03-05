import { useTranslation } from 'react-i18next';
import { ExpiryCountdown } from '../Shared/ExpiryCountdown';
import { usePublicBranding } from '../../hooks/usePublicBranding';
import ReactMarkdown from 'react-markdown';
import '../Shared/SharedNavPanel.scss';

interface DropZoneNavPanelProps {
  clientName?: string;
  expiresAt?: string | null;
  description?: string;
  instructions?: string;
  maxCalls?: number | null;
  callCount?: number;
  enableChat?: boolean;
  onCollapse: () => void;
}

export const DropZoneNavPanel = ({
  clientName,
  expiresAt,
  description,
  instructions,
  maxCalls,
  callCount = 0,
  enableChat,
  onCollapse,
}: DropZoneNavPanelProps) => {
  const { t } = useTranslation('files');
  const { logoUrl, brandName } = usePublicBranding(clientName);

  return (
    <div className="shared-nav-panel">
      <button className="collapse-button" onClick={onCollapse} aria-label="Collapse navigation">
        <i className="bi bi-chevron-left" />
      </button>

      <div className="logo-section">
        <img src={logoUrl} alt={brandName} className="logo" />
      </div>

      <div className="info-section">
        <ExpiryCountdown expiresAt={expiresAt} />

        {enableChat && maxCalls != null && (
          <div className={`message-limit ${callCount >= maxCalls ? 'message-limit--exhausted' : ''}`}>
            <i className={`bi ${callCount >= maxCalls ? 'bi-x-circle' : 'bi-chat-square-dots'}`} />
            <span>
              {callCount >= maxCalls
                ? t('dropzones.questionsLimitReached')
                : t('dropzones.questionsUsed', { used: callCount, total: maxCalls })}
            </span>
          </div>
        )}

        {description && (
          <>
            <h6 className="mt-3 mb-1" style={{ fontSize: '0.8125rem' }}>
              {t('dropzones.navDescription')}
            </h6>
            <p className="description">{description}</p>
          </>
        )}

        {instructions && (
          <>
            <h6 className="mt-3 mb-1" style={{ fontSize: '0.8125rem' }}>
              {t('dropzones.navInstructions')}
            </h6>
            <div className="description" style={{ fontSize: '0.8125rem' }}>
              <ReactMarkdown>{instructions}</ReactMarkdown>
            </div>
          </>
        )}
      </div>

      <div className="footer-section">
        <span className="powered-by-label">{t('dropzones.poweredBy')}</span>
      </div>
    </div>
  );
};
