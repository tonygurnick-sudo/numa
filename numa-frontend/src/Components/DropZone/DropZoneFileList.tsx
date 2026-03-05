import { useTranslation } from 'react-i18next';
import type { DropZoneFile } from '../../Services/sharedChatService';

interface DropZoneFileListProps {
  files: DropZoneFile[];
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

export const DropZoneFileList: React.FC<DropZoneFileListProps> = ({ files }) => {
  const { t } = useTranslation('files');

  if (files.length === 0) {
    return (
      <div className="text-center text-muted py-3">
        <i className="bi bi-inbox" style={{ fontSize: '2rem' }} />
        <p className="mt-2 mb-0 small">{t('dropzones.noFilesYet')}</p>
      </div>
    );
  }

  return (
    <div className="list-group list-group-flush">
      {files.map((file) => (
        <div key={file.file_id} className="list-group-item d-flex align-items-center gap-2 px-0">
          <i className="bi bi-file-earmark text-muted" />
          <div className="flex-grow-1 text-truncate">
            <div className="fw-semibold small">{file.name}</div>
            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
              {formatBytes(file.size_bytes)} &middot; {formatTime(file.uploaded_at)}
            </div>
          </div>
          <i className="bi bi-check-circle text-success" />
        </div>
      ))}
    </div>
  );
};
