import { useTranslation } from 'react-i18next';

interface FileSelectionToolbarProps {
  count: number;
  hasFileSelected: boolean;
  sharingEnabled: boolean;
  /** Actions that are rendered but greyed-out / disabled. */
  disabledActions?: Set<string>;
  /** Tooltip shown on disabled action buttons. */
  disabledTooltip?: string;
  onSummarize?: () => void;
  onShare?: () => void;
  onDownload: () => void;
  onMove?: () => void;
  onAddToKB?: () => void;
  onDelete?: () => void;
  onClear: () => void;
}

const FileSelectionToolbar = ({
  count,
  hasFileSelected,
  sharingEnabled,
  disabledActions,
  disabledTooltip,
  onSummarize,
  onShare,
  onDownload,
  onMove,
  onAddToKB,
  onDelete,
  onClear,
}: FileSelectionToolbarProps) => {
  const { t } = useTranslation('files');

  if (count === 0) return null;

  const isActionDisabled = (action: string) => !!disabledActions?.has(action);
  const titleFor = (action: string, fallback: string) =>
    isActionDisabled(action) && disabledTooltip ? disabledTooltip : fallback;

  return (
    <div
      className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light"
      style={{ position: 'sticky', top: 0, zIndex: 10 }}
    >
      <span className="fw-semibold text-nowrap">{t('selectionToolbar.selected', { count })}</span>
      <button className="btn btn-link btn-sm text-decoration-none p-0 ms-1" onClick={onClear}>
        {t('selectionToolbar.clearSelection')}
      </button>

      <div className="ms-auto d-flex align-items-center gap-1">
        {/* Summarize — single file only */}
        {onSummarize && hasFileSelected && count === 1 && (
          <button
            className="btn btn-sm btn-outline-secondary"
            title={titleFor('summarize', t('actions.summarize'))}
            disabled={isActionDisabled('summarize')}
            onClick={onSummarize}
          >
            <i className="bi bi-stars" />
          </button>
        )}

        {/* Share — single file only */}
        {onShare && hasFileSelected && sharingEnabled && count === 1 && (
          <button
            className="btn btn-sm btn-outline-secondary"
            title={titleFor('share', t('actions.share'))}
            disabled={isActionDisabled('share')}
            onClick={onShare}
          >
            <i className="bi bi-share" />
          </button>
        )}

        {/* Download */}
        <button
          className="btn btn-sm btn-outline-secondary"
          title={titleFor('download', t('actions.download'))}
          disabled={isActionDisabled('download')}
          onClick={onDownload}
        >
          <i className="bi bi-download" />
        </button>

        {/* Move */}
        {onMove && (
          <button
            className="btn btn-sm btn-outline-secondary"
            title={titleFor('moveTo', t('actions.moveTo'))}
            disabled={isActionDisabled('moveTo')}
            onClick={onMove}
          >
            <i className="bi bi-folder-symlink" />
          </button>
        )}

        {/* Add to KB */}
        {onAddToKB && (
          <button
            className="btn btn-sm btn-outline-secondary"
            title={titleFor('addToKB', t('actions.addToKB'))}
            disabled={isActionDisabled('addToKB')}
            onClick={onAddToKB}
          >
            <i className="bi bi-book" />
          </button>
        )}

        {/* Delete */}
        {onDelete && (
          <button
            className={`btn btn-sm ${isActionDisabled('delete') ? 'btn-outline-secondary' : 'btn-outline-danger'}`}
            title={titleFor('delete', t('actions.delete'))}
            disabled={isActionDisabled('delete')}
            onClick={onDelete}
          >
            <i className="bi bi-trash" />
          </button>
        )}
      </div>
    </div>
  );
};

export default FileSelectionToolbar;
