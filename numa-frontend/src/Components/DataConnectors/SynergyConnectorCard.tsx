import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link2, RotateCw, Settings, Zap } from 'lucide-react';
import synergyIconUrl from '../../assets/icons/12d_Synergy-cube.svg';

type SynergyConnectorCardProps = {
  status?: {
    status?: string;
  };
  onConnect: () => void;
  onTest: () => void;
  onSettings: () => void;
  isConnecting: boolean;
  adminDisabled?: boolean;
};

export const SynergyIcon = () => {
  const { t } = useTranslation('integrations');
  return (
    <img
      src={synergyIconUrl}
      alt={t('dataConnectors.synergy.iconAlt')}
      width={32}
      height={32}
      style={{ objectFit: 'contain' }}
    />
  );
};

export const SynergyConnectorCard = ({
  status,
  onConnect,
  onTest,
  onSettings,
  isConnecting,
  adminDisabled = false,
}: SynergyConnectorCardProps) => {
  const { t } = useTranslation('integrations');
  const isConnected = status?.status === 'connected';

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
            <SynergyIcon />
          </div>
          <div className="integrations-row-card__text">
            <h6 className="integrations-row-card__name">{t('dataConnectors.synergy.name')}</h6>
            <p className="integrations-row-card__description">{t('dataConnectors.synergy.description')}</p>
          </div>
        </div>

        <div className="integrations-row-card__controls">
          {isConnected && (
            <div className="integrations-row-status">
              <span className="integrations-row-status__dot" aria-hidden="true" />
              <span>{t('status.connected')}</span>
            </div>
          )}

          <div className="integrations-row-actions">
            {isConnected ? (
              <>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onTest}
                  disabled={isConnecting || adminDisabled}
                  className="integrations-row-btn integrations-row-btn--primary"
                >
                  <Zap size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.test')}</span>
                </Button>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onSettings}
                  disabled={isConnecting || adminDisabled}
                  className="integrations-row-btn integrations-row-btn--secondary"
                >
                  <Settings size={14} className="integrations-row-btn__icon" />
                  <span className="integrations-row-btn__label">{t('dataConnectors.actions.settings')}</span>
                </Button>
                <Button
                  variant="light"
                  size="sm"
                  onClick={onConnect}
                  disabled={isConnecting || adminDisabled}
                  className="integrations-row-btn integrations-row-btn--neutral"
                >
                  {isConnecting ? (
                    <>
                      <Spinner size="sm" className="integrations-row-btn__spinner" />
                      <span className="integrations-row-btn__label">{t('dataConnectors.actions.connecting')}</span>
                    </>
                  ) : (
                    <>
                      <RotateCw size={14} className="integrations-row-btn__icon" />
                      <span className="integrations-row-btn__label">{t('dataConnectors.actions.reconnect')}</span>
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                variant="light"
                size="sm"
                onClick={onConnect}
                disabled={isConnecting || adminDisabled}
                className="integrations-row-btn integrations-row-btn--primary"
              >
                {isConnecting ? (
                  <>
                    <Spinner size="sm" className="integrations-row-btn__spinner" />
                    <span className="integrations-row-btn__label">{t('dataConnectors.actions.connecting')}</span>
                  </>
                ) : (
                  <>
                    <Link2 size={14} className="integrations-row-btn__icon" />
                    <span className="integrations-row-btn__label">{t('dataConnectors.actions.connect')}</span>
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
