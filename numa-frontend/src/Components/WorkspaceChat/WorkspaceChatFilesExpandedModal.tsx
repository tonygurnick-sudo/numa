/**
 * WorkspaceChatFilesExpandedModal
 *
 * A larger, table-style view of the current conversation's input or output
 * files. Opened from the "expand" button on the Chat Uploads / Output Files
 * sections of the workspace settings drawer. Same visual language as the
 * Chat Artifacts tab (finder-grid layout) so users get full filenames,
 * types, sizes, and modified dates without leaving the chat.
 */
import { Dropdown, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Download, Eye, X } from 'lucide-react';
import { formatFileSize, getFileIconClass, getFileIconColorClass } from '../../utils/fileUtils';
import type { WorkspaceChatFileInfo } from '../../types/workspaceChatTypes';
import { getVariantExtension, type OutputFileGroup } from '../../utils/outputFileGroups';

interface WorkspaceChatFilesExpandedModalProps {
  show: boolean;
  onHide: () => void;
  title: string;
  files: WorkspaceChatFileInfo[];
  /** When provided, render one row per group with a multi-format download dropdown. */
  groups?: OutputFileGroup[];
  rootPrefix: string;
  onOpen?: (file: WorkspaceChatFileInfo) => void;
  onDownload?: (file: WorkspaceChatFileInfo) => void;
}

const formatModified = (modifiedAt: string): string => {
  const parsed = new Date(modifiedAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type DisplayRow = {
  key: string;
  primary: WorkspaceChatFileInfo;
  displayName: string;
  relativePath: string;
  variants: WorkspaceChatFileInfo[];
};

export const WorkspaceChatFilesExpandedModal = ({
  show,
  onHide,
  title,
  files,
  groups,
  rootPrefix,
  onOpen,
  onDownload,
}: WorkspaceChatFilesExpandedModalProps) => {
  const { t } = useTranslation('chat');

  const rows: DisplayRow[] = groups
    ? groups.map((group) => {
        const primary = group.variants[0];
        const relativePath = primary.path.startsWith(rootPrefix) ? primary.path.slice(rootPrefix.length) : primary.path;
        return {
          key: group.key,
          primary,
          displayName: group.displayName,
          relativePath,
          variants: group.variants,
        };
      })
    : files
        .filter((file) => !file.isDirectory)
        .map((file) => {
          const relativePath = file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path;
          const fallbackName = relativePath.split('/').filter(Boolean).pop() || relativePath;
          return {
            key: file.path,
            primary: file,
            displayName: file.name || fallbackName,
            relativePath,
            variants: [file],
          };
        })
        .sort((a, b) => {
          const timestampDiff = new Date(b.primary.modifiedAt).getTime() - new Date(a.primary.modifiedAt).getTime();
          if (!Number.isNaN(timestampDiff) && timestampDiff !== 0) return timestampDiff;
          return a.displayName.localeCompare(b.displayName);
        });

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="xl"
      centered
      dialogClassName="workspace-chat-files-expanded-modal"
      contentClassName="workspace-chat-files-expanded-modal__content"
    >
      <div className="workspace-chat-files-expanded-modal__header">
        <h5 className="workspace-chat-files-expanded-modal__title">
          {title}
          <span className="workspace-chat-files-expanded-modal__count">{rows.length}</span>
        </h5>
        <button
          type="button"
          className="workspace-chat-files-expanded-modal__close"
          onClick={onHide}
          aria-label={t('workspaceSettings.expandedClose')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="workspace-chat-files-expanded-modal__body finder-files">
        {rows.length === 0 ? (
          <div className="finder-empty">
            <i className="bi bi-folder2-open" aria-hidden="true" />
            <span>{t('workspaceSettings.expandedEmpty')}</span>
          </div>
        ) : (
          <>
            <div className="finder-columns finder-grid-artifacts">
              <div className="finder-col">{t('workspaceSettings.expandedColName')}</div>
              <div className="finder-col d-none d-md-block">{t('workspaceSettings.expandedColType')}</div>
              <div className="finder-col d-none d-sm-block">{t('workspaceSettings.expandedColSize')}</div>
              <div className="finder-col d-none d-md-block">{t('workspaceSettings.expandedColModified')}</div>
              <div className="finder-col">{t('workspaceSettings.expandedColActions')}</div>
            </div>
            <div className="finder-list">
              {rows.map((row) => {
                const isMultiVariant = row.variants.length > 1;
                const typeLabel = isMultiVariant
                  ? row.variants.map((v) => getVariantExtension(v).toUpperCase()).join(' · ')
                  : row.primary.name.includes('.')
                    ? (row.primary.name.split('.').pop()?.toUpperCase() ?? '')
                    : '';
                return (
                  <div key={row.key} className="finder-row finder-grid-artifacts">
                    <div className="finder-row__name-content">
                      <i
                        className={`${getFileIconClass(row.primary.name)} finder-icon finder-icon--file ${getFileIconColorClass(row.primary.name)}`}
                        aria-hidden="true"
                      />
                      <span className="finder-name" title={row.relativePath}>
                        {row.displayName}
                      </span>
                    </div>
                    <div className="finder-row__meta finder-row__meta--type d-none d-md-block">{typeLabel}</div>
                    <div className="finder-row__meta d-none d-sm-block">
                      {isMultiVariant ? '—' : formatFileSize(row.primary.size)}
                    </div>
                    <div className="finder-row__meta d-none d-md-block">{formatModified(row.primary.modifiedAt)}</div>
                    <div className="finder-row__actions">
                      {onOpen && (
                        <button
                          type="button"
                          onClick={() => onOpen(row.primary)}
                          title={t('workspaceSettings.preview')}
                          aria-label={t('workspaceSettings.preview')}
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      {onDownload &&
                        (isMultiVariant ? (
                          <Dropdown align="end">
                            <Dropdown.Toggle
                              as="button"
                              bsPrefix="finder-row__action-toggle"
                              title={t('workspaceSettings.chooseFormat')}
                              aria-label={t('workspaceSettings.chooseFormat')}
                            >
                              <Download size={14} />
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              {row.variants.map((variant) => {
                                const ext = getVariantExtension(variant).toUpperCase();
                                return (
                                  <Dropdown.Item
                                    key={variant.path}
                                    onClick={() => onDownload(variant)}
                                    title={variant.name}
                                  >
                                    {t('workspaceSettings.downloadAs', { format: ext || variant.name })}
                                  </Dropdown.Item>
                                );
                              })}
                            </Dropdown.Menu>
                          </Dropdown>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDownload(row.primary)}
                            title={t('workspaceSettings.download')}
                            aria-label={t('workspaceSettings.download')}
                          >
                            <Download size={14} />
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
