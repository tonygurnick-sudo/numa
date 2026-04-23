import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Mail } from 'lucide-react';
import type { ConnectorTemplate } from './connectorRegistry';
import { AuthTypeBadge } from './AuthTypeBadge';

interface ContactRequiredCardProps {
  connector: ConnectorTemplate;
}

export const ContactRequiredCard = ({ connector }: ContactRequiredCardProps) => {
  const { t } = useTranslation('integrations');

  return (
    <div className="integrations-row-card" style={{ opacity: 0.75 }}>
      <div className="integrations-row-card__inner">
        <div className="integrations-row-card__identity">
          <div className="integrations-row-card__app-icon d-flex align-items-center justify-content-center">
            <i className={connector.icon} style={{ fontSize: '1.5rem' }} />
          </div>
          <div className="integrations-row-card__text">
            <h6 className="integrations-row-card__name d-flex align-items-center gap-2">
              <span>{connector.displayName}</span>
              <AuthTypeBadge authType={connector.authType} />
            </h6>
            <p className="integrations-row-card__description">{connector.description}</p>
            {connector.contactInfo?.notes && (
              <p className="text-muted small mb-0" style={{ fontSize: '0.8rem' }}>
                {connector.contactInfo.notes}
              </p>
            )}
          </div>
        </div>

        <div className="integrations-row-card__controls">
          <div className="integrations-row-actions">
            {connector.contactInfo?.email && (
              <a
                href={`mailto:${connector.contactInfo.email}`}
                className="btn btn-light btn-sm integrations-row-btn integrations-row-btn--secondary d-inline-flex align-items-center gap-1"
              >
                <Mail size={14} />
                <span className="integrations-row-btn__label">{t('dataConnectors.contact.email')}</span>
              </a>
            )}
            {connector.contactInfo?.website && (
              <Button
                variant="light"
                size="sm"
                className="integrations-row-btn integrations-row-btn--primary"
                onClick={() => window.open(connector.contactInfo!.website!, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={14} className="integrations-row-btn__icon" />
                <span className="integrations-row-btn__label">{t('dataConnectors.contact.visitWebsite')}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
