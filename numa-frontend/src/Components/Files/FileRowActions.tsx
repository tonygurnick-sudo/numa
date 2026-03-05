import { useTranslation } from 'react-i18next';

interface FileRowActionsProps {
  /** 'file' shows summarize + share; 'folder' shows rename instead */
  kind: 'file' | 'folder';
  sharingEnabled: boolean;
  /** Action keys that render disabled with tooltip */
  disabledActions?: Set<string>;
  /** Tooltip shown on disabled buttons */
  disabledTooltip?: string;
  onSummarize?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onAddToKB?: () => void;
  onDelete?: () => void;
  onKebab: (e: React.MouseEvent) => void;
}

const FileRowActions = ({
  kind,
  sharingEnabled,
  disabledActions,
  disabledTooltip,
  onSummarize,
  onShare,
  onDownload,
  onRename,
  onMove,
  onAddToKB,
  onDelete,
  onKebab,
}: FileRowActionsProps) => {
  const { t } = useTranslation('files');
  const isFile = kind === 'file';
  const isDisabled = (action: string) => !!disabledActions?.has(action);
  const tip = (action: string, fallback: string) =>
    isDisabled(action) && disabledTooltip ? disabledTooltip : fallback;

  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div className="file-actions">
      {/* Summarize — files only */}
      {isFile && (
        <button
          className="btn-icon btn-icon--always"
          title={tip('summarize', t('actions.summarize'))}
          disabled={isDisabled('summarize')}
          onClick={(e) => stop(e, onSummarize)}
        >
          <i className="bi bi-stars" />
        </button>
      )}

      {/* Rename — folders only */}
      {!isFile && (
        <button
          className="btn-icon btn-icon--always"
          title={tip('rename', t('actions.rename'))}
          disabled={isDisabled('rename')}
          onClick={(e) => stop(e, onRename)}
        >
          <i className="bi bi-pencil" />
        </button>
      )}

      {/* Share — files only when sharing enabled */}
      {isFile && sharingEnabled && (
        <button
          className="btn-icon btn-icon--always"
          title={tip('share', t('actions.share'))}
          disabled={isDisabled('share')}
          onClick={(e) => stop(e, onShare)}
        >
          <i className="bi bi-share" />
        </button>
      )}

      {/* Download — files only (folders can't be downloaded) */}
      {isFile && (
        <button
          className="btn-icon btn-icon--always"
          title={tip('download', t('actions.download'))}
          disabled={isDisabled('download')}
          onClick={(e) => stop(e, onDownload)}
        >
          <i className="bi bi-download" />
        </button>
      )}

      {/* Move */}
      <button
        className="btn-icon btn-icon--always"
        title={tip('moveTo', t('actions.moveTo'))}
        disabled={isDisabled('moveTo')}
        onClick={(e) => stop(e, onMove)}
      >
        <i className="bi bi-folder-symlink" />
      </button>

      {/* Add to KB */}
      <button
        className="btn-icon btn-icon--always"
        title={tip('addToKB', t('actions.addToKB'))}
        disabled={isDisabled('addToKB')}
        onClick={(e) => stop(e, onAddToKB)}
      >
        <i className="bi bi-book" />
      </button>

      {/* Delete */}
      <button
        className="btn-icon btn-icon--always"
        title={tip('delete', t('actions.delete'))}
        disabled={isDisabled('delete')}
        onClick={(e) => stop(e, onDelete)}
      >
        <i className="bi bi-trash" />
      </button>

      {/* Kebab (more) */}
      <button
        className="btn-icon btn-icon--always"
        title={t('actions.more')}
        onClick={(e) => {
          e.stopPropagation();
          onKebab(e);
        }}
      >
        <i className="bi bi-three-dots-vertical" />
      </button>
    </div>
  );
};

export default FileRowActions;
