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

const FileRowActions = ({ onKebab }: FileRowActionsProps) => {
  const { t } = useTranslation('files');

  return (
    <div className="file-actions">
      {/* Kebab (more) — all actions available via context menu */}
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
