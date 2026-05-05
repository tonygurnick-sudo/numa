import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { UserKB } from '../../Services/knowledgeBaseService';

export type FolderContextAction = 'addSubfolder' | 'upload' | 'settings' | 'delete';

export type FolderContextTarget =
  | { kind: 'topLevel'; kb: UserKB }
  | { kind: 'subfolder'; kbId: string; folderId: string; folderName: string };

interface FolderContextMenuProps {
  show: boolean;
  position: { x: number; y: number };
  target: FolderContextTarget | null;
  /** Whether the current user can edit (write to) the target. */
  canEdit: boolean;
  /** Whether the current user owns the target's top-level folder (for delete on KBs). */
  canDeleteTopLevel: boolean;
  onClose: () => void;
  onAction: (action: FolderContextAction) => void;
}

const MENU_WIDTH = 220;

export function FolderContextMenu({
  show,
  position,
  target,
  canEdit,
  canDeleteTopLevel,
  onClose,
  onAction,
}: FolderContextMenuProps) {
  const { t } = useTranslation('unifiedFiles');
  const menuRef = useRef<HTMLDivElement>(null);

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

  let x = position.x;
  let y = position.y;
  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - 8;
    }
    const estimatedHeight = target.kind === 'topLevel' ? 200 : 120;
    if (y + estimatedHeight > window.innerHeight) {
      y = Math.max(8, window.innerHeight - estimatedHeight - 8);
    }
  }

  const isTopLevel = target.kind === 'topLevel';

  const dispatch = (action: FolderContextAction) => {
    onAction(action);
    onClose();
  };

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
      <MenuItem
        icon="bi-folder-plus"
        label={t('contextMenu.addSubfolder')}
        disabled={!canEdit}
        onClick={() => dispatch('addSubfolder')}
      />

      {isTopLevel && (
        <>
          <MenuItem
            icon="bi-upload"
            label={t('contextMenu.upload')}
            disabled={!canEdit}
            onClick={() => dispatch('upload')}
          />
          <MenuDivider />
          <MenuItem icon="bi-gear" label={t('contextMenu.settings')} onClick={() => dispatch('settings')} />
        </>
      )}

      <MenuDivider />
      <MenuItem
        icon="bi-trash"
        label={t('contextMenu.delete')}
        danger
        disabled={isTopLevel ? !canDeleteTopLevel : !canEdit}
        onClick={() => dispatch('delete')}
      />
    </div>
  );

  return createPortal(menuContent, document.body);
}

interface MenuItemProps {
  label: string;
  icon: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

const MenuItem = ({ label, icon, disabled = false, danger = false, onClick }: MenuItemProps) => (
  <div
    role="menuitem"
    tabIndex={disabled ? -1 : 0}
    style={{
      padding: '6px 12px',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      color: danger && !disabled ? '#dc3545' : '#212529',
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

export default FolderContextMenu;
