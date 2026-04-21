import React from 'react';
import { Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export function SharedFoldersTab(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');

  return (
    <div className="py-4">
      <Alert variant="info" className="d-flex align-items-start">
        <i className="bi bi-share me-3" style={{ fontSize: '1.5rem' }} />
        <div>
          <h6 className="mb-1">{t('shared.title')}</h6>
          <p className="mb-1 text-muted">{t('shared.subtitle')}</p>
          <p className="mb-0 small text-muted">{t('shared.hint')}</p>
        </div>
      </Alert>
    </div>
  );
}
