import { Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import { getConnectionExampleQuery } from '../config/integrationsConfig';

export const GenericTestConnection = ({
  appName,
  integrationName,
  onClose,
}: {
  appName: string;
  integrationName: string;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const exampleQuery = getConnectionExampleQuery(appName);

  const handleTestConnection = () => {
    const chatUrl = `/chat?query=${encodeURIComponent(exampleQuery)}&enableTool=${appName}`;
    navigate(chatUrl);
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div className="d-flex align-items-center">
          <div
            className="rounded-2 d-flex align-items-center justify-content-center me-3"
            style={{ width: '40px', height: '40px', backgroundColor: '#6f42c1' }}
          >
            <i className="bi bi-lightning-fill text-white fs-5"></i>
          </div>
          <div>
            <h5 className="mb-1 fw-semibold">{t('genericTestConnection.title', { integrationName })}</h5>
            <p className="mb-0 small text-muted">{t('genericTestConnection.subtitle')}</p>
          </div>
        </div>
        <Button variant="link" size="sm" className="p-0 text-muted" onClick={onClose}>
          <i className="bi bi-x-lg"></i>
        </Button>
      </div>

      <div className="bg-white rounded-3 p-4 border">
        <div className="mb-4">
          <h6 className="fw-semibold mb-3 d-flex align-items-center">
            <i className="bi bi-chat-dots text-primary me-2"></i>
            {t('genericTestConnection.howToTitle')}
          </h6>

          <div className="d-flex align-items-start mb-3">
            <div
              className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3"
              style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
            >
              1
            </div>
            <div>
              <div className="fw-semibold mb-1">{t('genericTestConnection.steps.goTitle')}</div>
              <div className="small text-muted">{t('genericTestConnection.steps.goDescription')}</div>
            </div>
          </div>

          <div className="d-flex align-items-start mb-3">
            <div
              className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3"
              style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
            >
              2
            </div>
            <div>
              <div className="fw-semibold mb-1">{t('genericTestConnection.steps.enableTitle')}</div>
              <div className="small text-muted">
                {t('genericTestConnection.steps.enableDescriptionPrefix')}
                <Link size={14} className="mx-1" />
                {t('genericTestConnection.steps.enableDescriptionSuffix', { integrationName })}
              </div>
            </div>
          </div>

          <div className="d-flex align-items-start mb-4">
            <div
              className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3"
              style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
            >
              3
            </div>
            <div>
              <div className="fw-semibold mb-1">{t('genericTestConnection.steps.sendTitle')}</div>
              <div className="small text-muted">{t('genericTestConnection.steps.sendDescription')}</div>
            </div>
          </div>
        </div>

        <div className="bg-light rounded-3 p-3 mb-4">
          <div className="small fw-semibold text-muted mb-2">{t('genericTestConnection.exampleQueryLabel')}</div>
          <div className="bg-white rounded-2 p-3 border">
            <code className="text-primary">{exampleQuery}</code>
          </div>
          <div className="small text-muted mt-2">
            <i className="bi bi-info-circle me-1"></i>
            {t('genericTestConnection.exampleQueryNote')}
          </div>
        </div>

        <div className="d-grid">
          <Button
            variant="primary"
            size="lg"
            onClick={handleTestConnection}
            className="d-flex align-items-center justify-content-center py-3"
          >
            <i className="bi bi-arrow-right-circle me-2"></i>
            {t('genericTestConnection.goButton')}
          </Button>
        </div>

        <div className="text-center mt-3">
          <div className="small text-muted">
            {t('genericTestConnection.reminderPrefix')}
            <Link size={12} className="mx-1" />
            {t('genericTestConnection.reminderSuffix')}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenericTestConnection;
