/**
 * Public Demo Full-Screen File Preview
 *
 * Unauthenticated version of FilePreviewFullScreen for the public demo.
 * Uses scoped demo credentials instead of Cognito auth.
 */

import { useSearchParams } from 'react-router-dom';
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import { fetchDemoCredentials, convertDemoDocxPreview } from '../Services/publicDemoChatService';
import type { DemoCredentials } from '../Services/publicDemoChatService';
import type { FilePreview } from '../hooks/useFilePreviewProcessor';

export const PublicDemoFilePreview = () => {
  const { t } = useTranslation('chat');
  const [searchParams] = useSearchParams();

  const key = searchParams.get('key');
  const name = searchParams.get('name');
  const ext = searchParams.get('ext');
  const bucket = searchParams.get('bucket');

  const [demoCreds, setDemoCreds] = useState<DemoCredentials | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDemoCredentials().then((creds) => {
      setDemoCreds(creds);
      setLoading(false);
    });
  }, []);

  const getCredentials = useCallback(async () => {
    // Refresh if needed
    let creds = demoCreds;
    if (!creds) {
      creds = await fetchDemoCredentials();
      if (creds) setDemoCreds(creds);
    }
    if (!creds) throw new Error('Demo credentials unavailable');
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    };
  }, [demoCreds]);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="spinner-border text-primary" role="status" aria-hidden="true" />
      </div>
    );
  }

  if (!key || !name || !ext || !bucket) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="text-center text-muted">
          <i className="bi bi-exclamation-triangle" style={{ fontSize: '3rem' }}></i>
          <p className="mt-3">{t('filePreview.previewNotAvailable')}</p>
        </div>
      </div>
    );
  }

  const preview: FilePreview = {
    type: 'file',
    filename: name,
    extension: ext,
    fullPath: key,
    relativePath: name,
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bs-body-bg, #fff)',
      }}
    >
      <FilePreviewPanel
        preview={preview}
        onClose={() => window.close()}
        bucket={bucket}
        region={demoCreds?.region || ''}
        getCredentials={getCredentials}
        convertDocxFn={convertDemoDocxPreview}
      />
    </div>
  );
};
