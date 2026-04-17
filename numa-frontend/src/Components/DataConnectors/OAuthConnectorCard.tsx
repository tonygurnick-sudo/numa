import type { ReactNode } from 'react';
import { Button, Dropdown, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link2, MoreVertical, Settings, Trash2, Zap } from 'lucide-react';

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
  onDisconnect?: () => void;
  isDisconnecting?: boolean;
  extraStatus?: ReactNode;
  hasError?: boolean;
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
  onDisconnect,
  isDisconnecting = false,
  extraStatus,
  hasError = false,
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
            <div className="d-flex align-items-center gap-3">
              <div className={`integrations-row-status${hasError ? ' integrations-row-status--error' : ''}`}>
                <span
                  className={`integrations-row-status__dot${hasError ? ' integrations-row-status__dot--error' : ''}`}
                  aria-hidden="true"
                />
                <span>{hasError ? t('dataConnectors.oauth.authError') : t('dataConnectors.oauth.configured')}</span>
              </div>
              {extraStatus}
            </div>
          )}

          <div className="integrations-row-actions">
            {credentialConfigured ? (
              <>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onTest}
                  disabled={isLoading || adminDisabled || isDisconnecting}
                  className="integrations-row-btn integrations-row-btn--primary"
                >
                  <Zap size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.test')}</span>
                </Button>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onConfigure}
                  disabled={isLoading || adminDisabled || isDisconnecting}
                  className="integrations-row-btn integrations-row-btn--secondary"
                >
                  <Settings size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.settings')}</span>
                </Button>
                {onDisconnect && (
                  <Dropdown align="end">
                    <Dropdown.Toggle
                      variant="light"
                      size="sm"
                      className="integrations-row-btn integrations-row-btn--secondary"
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? <Spinner size="sm" /> : <MoreVertical size={14} />}
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item className="text-danger d-flex align-items-center gap-2" onClick={onDisconnect}>
                        <Trash2 size={14} />
                        {t('dataConnectors.actions.disconnect')}
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                )}
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
