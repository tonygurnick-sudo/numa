import { useSearchParams, Navigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { useTranslation } from 'react-i18next';
import { FilePreviewPanel } from '../Components/FilePreviewPanel';
import type { FilePreview } from '../hooks/useFilePreviewProcessor';

/**
 * Standalone full-screen file preview page.
 * Opens in a new tab from the split-view preview panel.
 * Reads file info from URL search params and renders the same preview components.
 */
export const FilePreviewFullScreen = () => {
  const { user, getCredentials } = useAuth();
  const { t } = useTranslation('chat');
  const [searchParams] = useSearchParams();

  const key = searchParams.get('key');
  const name = searchParams.get('name');
  const ext = searchParams.get('ext');
  const bucket = searchParams.get('bucket');
  const contentKey = searchParams.get('contentKey');

  const [REGION] = useState(() => window.sessionStorage.getItem('REGION'));

  // Retrieve inline document content from localStorage (if passed via contentKey)
  const [inlineContent] = useState(() => {
    if (!contentKey) return null;
    const content = localStorage.getItem(contentKey);
    if (content != null) {
      localStorage.removeItem(contentKey);
    }
    return content;
  });

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Valid if we have either an S3 key+bucket or inline content via contentKey
  const hasS3Source = key && bucket;
  const hasInlineSource = inlineContent != null;

  if (!name || !ext || (!hasS3Source && !hasInlineSource)) {
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
    fullPath: key || '',
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
        bucket={bucket || ''}
        region={REGION || ''}
        getCredentials={getCredentials}
        initialContent={inlineContent ?? undefined}
      />
    </div>
  );
};
