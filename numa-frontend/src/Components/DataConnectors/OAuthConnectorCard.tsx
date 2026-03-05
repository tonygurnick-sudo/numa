import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link2, Settings, Zap } from 'lucide-react';

type OAuthConnectorCardProps = {
  providerId: string;
  displayName: string;
  icon: string;
  description: string;
  credentialConfigured: boolean;
  onConfigure: () => void;
  onTest: () => void;
  isLoading: boolean;
  adminDisabled?: boolean;
};

export const OAuthConnectorCard = ({
  providerId: _providerId,
  displayName,
  icon,
  description,
  credentialConfigured,
  onConfigure,
  onTest,
  isLoading,
  adminDisabled = false,
}: OAuthConnectorCardProps) => {
  const { t } = useTranslation('integrations');

  return (
    <div
      className="integrations-row-card"
      style={{
        opacity: adminDisabled ? 0.55 : 1,
        filter: adminDisabled ? 'grayscale(20%)' : 'none',
      }}
    >
      <div className="integrations-row-card__inner">
        <div className="integrations-row-card__identity">
          <div className="integrations-row-card__app-icon d-flex align-items-center justify-content-center">
            <i className={icon} style={{ fontSize: '1.5rem' }} />
          </div>
          <div className="integrations-row-card__text">
            <h6 className="integrations-row-card__name">{displayName}</h6>
            <p className="integrations-row-card__description">{description}</p>
          </div>
        </div>

        <div className="integrations-row-card__controls">
          {credentialConfigured && (
            <div className="integrations-row-status">
              <span className="integrations-row-status__dot" aria-hidden="true" />
              <span>{t('dataConnectors.oauth.configured')}</span>
            </div>
          )}

          <div className="integrations-row-actions">
            {credentialConfigured ? (
              <>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onTest}
                  disabled={isLoading || adminDisabled}
                  className="integrations-row-btn integrations-row-btn--primary"
                >
                  <Zap size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.test')}</span>
                </Button>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onConfigure}
                  disabled={isLoading || adminDisabled}
                  className="integrations-row-btn integrations-row-btn--secondary"
                >
                  <Settings size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.settings')}</span>
                </Button>
              </>
            ) : (
              <Button
                variant="light"
                size="sm"
                onClick={onConfigure}
                disabled={isLoading || adminDisabled}
                className="integrations-row-btn integrations-row-btn--primary"
              >
                {isLoading ? (
                  <>
                    <Spinner size="sm" className="integrations-row-btn__spinner" />
                    <span className="integrations-row-btn__label">{t('dataConnectors.oauth.configuring')}</span>
                  </>
                ) : (
                  <>
                    <Link2 size={14} className="integrations-row-btn__icon" />
                    <span className="integrations-row-btn__label">{t('dataConnectors.oauth.configure')}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
