import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
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
      className="rounded-3 p-3 border"
      style={{
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        opacity: adminDisabled ? 0.55 : 1,
        filter: adminDisabled ? 'grayscale(20%)' : 'none',
      }}
    >
      <div className="row align-items-center h-100">
        <div className="col-md-6">
          <div className="d-flex align-items-center">
            <div
              className="rounded-2 d-flex align-items-center justify-content-center me-3 flex-shrink-0"
              style={{ width: '48px', height: '48px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}
            >
              <SynergyIcon />
            </div>
            <div>
              <h6 className="mb-1 fw-semibold">{t('dataConnectors.synergy.name')}</h6>
              <p className="mb-0 small text-muted" style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                {t('dataConnectors.synergy.description')}
              </p>
            </div>
          </div>
        </div>
        <div className="col-md-2 text-center">
          <div className="d-flex align-items-center justify-content-center">
            {isConnected ? (
              <>
                <div className="rounded-circle bg-success me-2" style={{ width: '12px', height: '12px' }}></div>
                <span className="text-success small fw-semibold">{t('status.connected')}</span>
              </>
            ) : (
              <>
                <div
                  className="rounded-circle border border-secondary me-2"
                  style={{ width: '12px', height: '12px' }}
                ></div>
                <span className="text-muted small">{t('status.notConnected')}</span>
              </>
            )}
          </div>
        </div>
        <div className="col-md-4">
          <div className="d-flex gap-2 justify-content-end">
            {isConnected ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onTest}
                  disabled={isConnecting || adminDisabled}
                  className="d-flex align-items-center"
                >
                  <i className="bi bi-lightning-fill me-2"></i>
                  {t('dataConnectors.actions.test')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onSettings}
                  disabled={isConnecting || adminDisabled}
                  className="d-flex align-items-center"
                >
                  <i className="bi bi-sliders me-2"></i>
                  {t('dataConnectors.actions.settings')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onConnect}
                  disabled={isConnecting || adminDisabled}
                  className="d-flex align-items-center"
                >
                  <i className="bi bi-arrow-repeat me-2"></i>
                  {t('dataConnectors.actions.reconnect')}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={onConnect}
                disabled={isConnecting || adminDisabled}
                className="px-4"
              >
                {isConnecting ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    {t('dataConnectors.actions.connecting')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-plus-circle me-2"></i>
                    {t('dataConnectors.actions.connect')}
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
