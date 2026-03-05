import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { FileItem, FolderItem } from '../../Services/filesService';

export interface RemoteFileItem {
  name: string;
  file_id: string;
  size?: number;
  modified_at?: string;
  content_type?: string;
  provider: 'oauth' | 'synergy';
  oauthProvider?: string;
}

type FileOrFolder =
  | { kind: 'file'; item: FileItem }
  | { kind: 'folder'; item: FolderItem }
  | { kind: 'remoteFile'; item: RemoteFileItem };

interface FileContextMenuProps {
  show: boolean;
  position: { x: number; y: number };
  target: FileOrFolder | null;
  sharingEnabled: boolean;
  /** Actions that are shown but greyed-out / disabled. */
  disabledActions?: FileContextAction[];
  /** Tooltip text shown on disabled actions. */
  disabledTooltip?: string;
  onClose: () => void;
  onAction: (action: FileContextAction) => void;
}

export type FileContextAction =
  | 'download'
  | 'rename'
  | 'makeCopy'
  | 'summarize'
  | 'share'
  | 'moveTo'
  | 'addToKB'
  | 'fileInfo'
  | 'delete';

const MENU_WIDTH = 220;

const FileContextMenu = ({
  show,
  position,
  target,
  sharingEnabled,
  disabledActions,
  disabledTooltip,
  onClose,
  onAction,
}: FileContextMenuProps) => {
  const { t } = useTranslation('files');
  const menuRef = useRef<HTMLDivElement>(null);
  const disabledSet = disabledActions ? new Set(disabledActions) : null;
  const isDisabled = (action: FileContextAction) => !!disabledSet?.has(action);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!show) return;
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [show, handleKeyDown, handleMouseDown]);

  if (!show || !target) return null;

  const isFile = target.kind === 'file' || target.kind === 'remoteFile';

  // Adjust position to stay within viewport
  let x = position.x;
  let y = position.y;
  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - 8;
    }
    const estimatedHeight = isFile ? 340 : 200;
    if (y + estimatedHeight > window.innerHeight) {
      y = Math.max(8, window.innerHeight - estimatedHeight - 8);
    }
  }

  const handleAction = (action: FileContextAction) => {
    onAction(action);
    onClose();
  };

  const tooltipFor = (action: FileContextAction) => (isDisabled(action) ? disabledTooltip : undefined);

  const menuContent = (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        minWidth: MENU_WIDTH,
        backgroundColor: '#fff',
        borderRadius: 6,
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        border: '1px solid #dee2e6',
        padding: '4px 0',
        fontSize: 14,
      }}
    >
      {/* Download */}
      <MenuItem
        icon="bi-download"
        label={t('actions.download')}
        disabled={isDisabled('download')}
        tooltip={tooltipFor('download')}
        onClick={() => handleAction('download')}
      />

      {/* Rename */}
      <MenuItem
        icon="bi-pencil"
        label={t('actions.rename')}
        disabled={isDisabled('rename')}
        tooltip={tooltipFor('rename')}
        onClick={() => handleAction('rename')}
      />

      {/* Make a copy — files only */}
      {isFile && (
        <MenuItem
          icon="bi-copy"
          label={t('actions.makeCopy')}
          disabled={isDisabled('makeCopy')}
          tooltip={tooltipFor('makeCopy')}
          onClick={() => handleAction('makeCopy')}
        />
      )}

      <MenuDivider />

      {/* Summarize — files only */}
      {isFile && (
        <MenuItem
          icon="bi-stars"
          label={t('actions.summarize')}
          disabled={isDisabled('summarize')}
          tooltip={tooltipFor('summarize')}
          onClick={() => handleAction('summarize')}
        />
      )}

      {/* Share — files only, when sharing is enabled */}
      {isFile && sharingEnabled && (
        <MenuItem
          icon="bi-share"
          label={t('actions.share')}
          disabled={isDisabled('share')}
          tooltip={tooltipFor('share')}
          onClick={() => handleAction('share')}
        />
      )}

      {/* Move to */}
      <MenuItem
        icon="bi-folder-symlink"
        label={t('actions.moveTo')}
        disabled={isDisabled('moveTo')}
        tooltip={tooltipFor('moveTo')}
        onClick={() => handleAction('moveTo')}
      />

      {/* Add to Knowledge Base */}
      <MenuItem
        icon="bi-book"
        label={t('actions.addToKB')}
        disabled={isDisabled('addToKB')}
        tooltip={tooltipFor('addToKB')}
        onClick={() => handleAction('addToKB')}
      />

      {/* File information */}
      <MenuItem
        icon="bi-info-circle"
        label={t('actions.fileInfo')}
        disabled={isDisabled('fileInfo')}
        tooltip={tooltipFor('fileInfo')}
        onClick={() => handleAction('fileInfo')}
      />

      <MenuDivider />

      {/* Delete */}
      <MenuItem
        icon="bi-trash"
        label={t('actions.delete')}
        danger={!isDisabled('delete')}
        disabled={isDisabled('delete')}
        tooltip={tooltipFor('delete')}
        onClick={() => handleAction('delete')}
      />
    </div>
  );

  return createPortal(menuContent, document.body);
};

// ─── Sub-components ──────────────────────────────────────────────────────────

interface MenuItemProps {
  label: string;
  icon: string;
  disabled?: boolean;
  danger?: boolean;
  tooltip?: string;
  onClick?: () => void;
}

const MenuItem = ({ label, icon, disabled = false, danger = false, tooltip, onClick }: MenuItemProps) => (
  <div
    role="menuitem"
    tabIndex={disabled ? -1 : 0}
    title={tooltip}
    style={{
      padding: '6px 12px',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      color: danger ? '#dc3545' : '#212529',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      userSelect: 'none',
    }}
    onMouseEnter={(e) => {
      if (!disabled) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa';
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
    }}
    onClick={() => {
      if (!disabled && onClick) onClick();
    }}
    onKeyDown={(e) => {
      if (!disabled && (e.key === 'Enter' || e.key === ' ') && onClick) {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <i className={`bi ${icon}`} style={{ width: 16, textAlign: 'center' }} />
    {label}
  </div>
);

const MenuDivider = () => <hr style={{ margin: '4px 0', borderColor: '#dee2e6' }} />;

export type { FileOrFolder };
export default FileContextMenu;
