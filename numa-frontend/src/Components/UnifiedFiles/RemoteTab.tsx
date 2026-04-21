import React from 'react';
import { Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export function RemoteTab(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');

  return (
    <div className="py-4">
      <Alert variant="info" className="d-flex align-items-start">
        <i className="bi bi-cloud me-3" style={{ fontSize: '1.5rem' }} />
        <div>
          <h6 className="mb-1">{t('remote.title')}</h6>
          <p className="mb-1 text-muted">{t('remote.subtitle')}</p>
          <p className="mb-0 small text-muted">{t('remote.connectProvider')}</p>
        </div>
      </Alert>
    </div>
  );
}
