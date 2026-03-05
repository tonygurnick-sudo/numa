import { useTranslation } from 'react-i18next';
import { ExpiryCountdown } from './ExpiryCountdown';
import { usePublicBranding } from '../../hooks/usePublicBranding';
import './SharedNavPanel.scss';

interface SharedNavPanelProps {
  clientName?: string;
  expiresAt?: string | null; // null/undefined = permanent
  description?: string;
  maxCalls?: number | null; // null/undefined = unlimited
  callCount?: number;
  allowDownload?: boolean;
  documentUrl?: string;
  documentName?: string;
  onCollapse: () => void;
}

/**
 * Collapsible navigation panel for shared document pages.
 * Shows client branding (if configured), expiry countdown, description, and powered-by link.
 */
export const SharedNavPanel = ({
  clientName,
  expiresAt,
  description,
  maxCalls,
  callCount = 0,
  allowDownload,
  documentUrl,
  documentName,
  onCollapse,
}: SharedNavPanelProps) => {
  const { t } = useTranslation('shared');
  const { logoUrl, brandName } = usePublicBranding(clientName);

  return (
    <div className="shared-nav-panel">
      {/* Collapse button */}
      <button className="collapse-button" onClick={onCollapse} aria-label="Collapse navigation">
        <i className="bi bi-chevron-left" />
      </button>

      <div className="logo-section">
        <img src={logoUrl} alt={brandName} className="logo" />
      </div>

      <div className="info-section">
        <ExpiryCountdown expiresAt={expiresAt} />
        {maxCalls != null && (
          <div className={`message-limit ${callCount >= maxCalls ? 'message-limit--exhausted' : ''}`}>
            <i className={`bi ${callCount >= maxCalls ? 'bi-x-circle' : 'bi-chat-square-dots'}`} />
            <span>
              {callCount >= maxCalls
                ? t('nav.questionsLimitReached')
                : t('nav.questionsUsed', { used: callCount, total: maxCalls })}
            </span>
          </div>
        )}
        {description && <p className="description">{description}</p>}
        {allowDownload && documentUrl && (
          <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="download-link">
            <i className="bi bi-download" />
            <span>{documentName || t('nav.downloadDocument')}</span>
          </a>
        )}
      </div>

      <div className="footer-section">
        <span className="powered-by-label">{t('nav.poweredByLabel')}</span>
        <a href="https://arcanum.ai" target="_blank" rel="noopener noreferrer" className="powered-by-link">
          {t('nav.poweredByBrandName')}
        </a>
      </div>
    </div>
  );
};
