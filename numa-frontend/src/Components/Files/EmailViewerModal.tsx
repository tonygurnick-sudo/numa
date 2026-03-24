import { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { OAuthProvidersService } from '../../Services/OAuthProvidersService';
import type { OAuthProviderType } from '../../types/oauthProviders';

interface EmailViewerModalProps {
  show: boolean;
  onHide: () => void;
  provider: OAuthProviderType;
  fileId: string;
  fileName: string;
}

interface EmailContent {
  subject: string;
  from: string;
  date: string;
  body_text: string;
  size: number;
}

export const EmailViewerModal = ({ show, onHide, provider, fileId, fileName }: EmailViewerModalProps) => {
  const { t } = useTranslation('files');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<EmailContent | null>(null);

  useEffect(() => {
    if (!show || !fileId) return;

    setLoading(true);
    setError(null);
    setContent(null);

    OAuthProvidersService.getEmailContent(provider, fileId)
      .then((data) => setContent(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load email'))
      .finally(() => setLoading(false));
  }, [show, provider, fileId]);

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="text-truncate" style={{ maxWidth: '90%' }}>
          {content?.subject || fileName || t('emailViewer.title', { defaultValue: 'Email' })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && (
          <div className="text-center py-5">
            <Spinner animation="border" />
            <p className="text-muted mt-2">{t('emailViewer.loading', { defaultValue: 'Loading email...' })}</p>
          </div>
        )}

        {error && (
          <div className="text-center py-4 text-danger">
            <i className="bi bi-exclamation-triangle d-block mb-2" style={{ fontSize: '2rem' }} />
            {error}
          </div>
        )}

        {content && !loading && (
          <>
            <div className="border-bottom pb-3 mb-3">
              <div className="d-flex gap-2 mb-1">
                <strong className="text-muted" style={{ minWidth: 50 }}>
                  {t('emailViewer.from', { defaultValue: 'From' })}:
                </strong>
                <span>{content.from}</span>
              </div>
              <div className="d-flex gap-2">
                <strong className="text-muted" style={{ minWidth: 50 }}>
                  {t('emailViewer.date', { defaultValue: 'Date' })}:
                </strong>
                <span>{content.date}</span>
              </div>
            </div>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                lineHeight: 1.6,
                maxHeight: '60vh',
                overflowY: 'auto',
              }}
            >
              {content.body_text}
            </div>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
};
