import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * Right-click context menu for a Synergy file row. Mirrors the portal +
 * viewport-clamp + outside-click pattern of `Files/FileContextMenu` but exposes
 * only the Synergy read-parity actions (download / details / version history /
 * copy link). Kept separate from the OAuth/KB menu so we don't fork that
 * component's larger action set.
 */
export type SynergyFileAction = 'download' | 'details' | 'history' | 'copyLink';

interface SynergyFileContextMenuProps {
  position: { x: number; y: number };
  onAction: (action: SynergyFileAction) => void;
  onClose: () => void;
}

const MENU_WIDTH = 210;
const ESTIMATED_HEIGHT = 180;

export function SynergyFileContextMenu({
  position,
  onAction,
  onClose,
}: SynergyFileContextMenuProps): React.ReactPortal {
  const { t } = useTranslation('files');
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [handleKeyDown, handleMouseDown]);

  let x = position.x;
  let y = position.y;
  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH > window.innerWidth) x = window.innerWidth - MENU_WIDTH - 8;
    if (y + ESTIMATED_HEIGHT > window.innerHeight) y = Math.max(8, window.innerHeight - ESTIMATED_HEIGHT - 8);
  }

  const act = (action: SynergyFileAction) => {
    onAction(action);
    onClose();
  };

  const items: { action: SynergyFileAction; icon: string; label: string }[] = [
    { action: 'download', icon: 'bi-download', label: t('remote.download', 'Download') },
    { action: 'details', icon: 'bi-info-circle', label: t('actions.fileInfo', 'File information') },
    { action: 'history', icon: 'bi-clock-history', label: t('synergy.versionHistory', 'Version history') },
    { action: 'copyLink', icon: 'bi-link-45deg', label: t('synergy.copyLink', 'Copy link') },
  ];

  return createPortal(
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
      {items.map((it) => (
        <div
          key={it.action}
          role="menuitem"
          tabIndex={0}
          style={{
            padding: '6px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
          }}
          onClick={() => act(it.action)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              act(it.action);
            }
          }}
        >
          <i className={`bi ${it.icon}`} style={{ width: 16, textAlign: 'center' }} aria-hidden />
          {it.label}
        </div>
      ))}
    </div>,
    document.body
  );
}
