// FileMessage.tsx - Unified component for file upload/download success messages
import { useTranslation } from 'react-i18next';
import { getFileIconClass } from '../utils/fileUtils';

type FileMessageProps = {
  filename: string;
  type?: 'success' | 'processing';
  showSpinner?: boolean;
  onClick?: () => void;
  clickable?: boolean;
};

/**
 * Displays a clean file message with icon, name, and optional success indicator
 * Used for both file uploads and integration file downloads
 */
export const FileMessage = ({
  filename,
  type = 'success',
  showSpinner = false,
  onClick,
  clickable = false,
}: FileMessageProps) => {
  const { t } = useTranslation('common');
  const iconClass = getFileIconClass(filename);
  const isClickable = clickable || !!onClick;

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={`file-message ${type} ${isClickable ? 'clickable' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      style={{ cursor: isClickable ? 'pointer' : 'default' }}
    >
      <i className={iconClass} />
      <span className="file-name">{filename}</span>
      {type === 'success' && (
        <div className="success-indicator">
          <i className="bi bi-box-arrow-up-right" />
        </div>
      )}
      {showSpinner && (
        <div className="spinner-border spinner-border-sm ms-2" role="status">
          <span className="visually-hidden">{t('fileMessage.processing')}</span>
        </div>
      )}
    </div>
  );
};
