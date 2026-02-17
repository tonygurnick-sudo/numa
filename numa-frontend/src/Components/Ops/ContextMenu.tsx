import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Ticket, WorkStage, WorkZone, StaffProfile } from '../../types/ops';
import { getStatusTypeColor } from './Shared/colorUtils';

interface ContextMenuProps {
  show: boolean;
  position: { x: number; y: number };
  ticket: Ticket | null;
  context: 'board' | 'table';
  stages: WorkStage[];
  zones: WorkZone[];
  staff: StaffProfile[];
  onClose: () => void;
  onAction: (action: string, payload?: unknown) => void;
}

const MENU_WIDTH = 220;
const SUBMENU_WIDTH = 200;

const ContextMenu = ({
  show,
  position,
  ticket,
  context,
  stages,
  zones,
  staff,
  onClose,
  onAction,
}: ContextMenuProps) => {
  const { t } = useTranslation('ops');
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Keyboard & outside-click handling ─────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
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

  // ── Viewport-adjusted position ────────────────────────────────────────
  const adjustedPosition = (() => {
    let x = position.x;
    let y = position.y;
    if (typeof window !== 'undefined') {
      if (x + MENU_WIDTH > window.innerWidth) {
        x = window.innerWidth - MENU_WIDTH - 8;
      }
      // Rough estimate: each item ~32px, ~14 items + dividers
      const estimatedHeight = 480;
      if (y + estimatedHeight > window.innerHeight) {
        y = Math.max(8, window.innerHeight - estimatedHeight - 8);
      }
    }
    return { x, y };
  })();

  if (!show || !ticket) return null;

  const moveDisabled = context === 'table';

  const menuContent = (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: adjustedPosition.y,
        left: adjustedPosition.x,
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
      {/* Assign to Me */}
      <MenuItem label={t('contextMenu.assignToMe')} onClick={() => onAction('assignToMe')} />

      {/* Assign to... (submenu) */}
      <SubMenuItem label={t('contextMenu.assignTo')} submenuWidth={SUBMENU_WIDTH}>
        {staff
          .filter((s) => s.isActive)
          .map((s) => (
            <MenuItem key={s.id} label={s.name} onClick={() => onAction('assignTo', s.id)} />
          ))}
      </SubMenuItem>

      {/* Change Status (submenu — shows team stages grouped by zone) */}
      <SubMenuItem label={t('contextMenu.changeStatus')} submenuWidth={SUBMENU_WIDTH}>
        {zones.map((zone) => {
          const zoneStages = stages.filter((s) => s.zoneId === zone.id).sort((a, b) => a.order - b.order);
          if (zoneStages.length === 0) return null;
          return (
            <div key={zone.id}>
              <MenuHeader label={zone.name} />
              {zoneStages.map((stage) => (
                <MenuItem
                  key={stage.id}
                  label={stage.name}
                  icon={
                    <span
                      className="d-inline-block rounded-circle"
                      style={{
                        width: 8,
                        height: 8,
                        backgroundColor: getStatusTypeColor(stage.statusType ?? 'backlog'),
                        flexShrink: 0,
                      }}
                    />
                  }
                  onClick={() => onAction('changeStage', stage.id)}
                />
              ))}
            </div>
          );
        })}
      </SubMenuItem>

      {/* Move to... section */}
      <MenuDivider />
      <MenuHeader label={t('contextMenu.moveTo')} />
      <MenuItem label={t('contextMenu.moveTop')} disabled={moveDisabled} onClick={() => onAction('moveTop')} />
      <MenuItem label={t('contextMenu.moveUp')} disabled={moveDisabled} onClick={() => onAction('moveUp')} />
      <MenuItem label={t('contextMenu.moveDown')} disabled={moveDisabled} onClick={() => onAction('moveDown')} />
      <MenuItem label={t('contextMenu.moveBottom')} disabled={moveDisabled} onClick={() => onAction('moveBottom')} />

      <MenuDivider />

      {/* Copy Link & Open Details */}
      <MenuItem label={t('contextMenu.copyLink')} onClick={() => onAction('copyLink')} />
      <MenuItem label={t('contextMenu.openDetail')} onClick={() => onAction('openDetail')} />

      <MenuDivider />

      {/* Archive / Unarchive */}
      {ticket.archived ? (
        <MenuItem label={t('contextMenu.unarchive')} onClick={() => onAction('unarchive')} />
      ) : (
        <MenuItem label={t('contextMenu.archive')} onClick={() => onAction('archive')} />
      )}

      {/* Delete */}
      <MenuItem label={t('contextMenu.delete')} danger onClick={() => onAction('delete')} />
    </div>
  );

  return createPortal(menuContent, document.body);
};

// ─── Sub-components ─────────────────────────────────────────────────────────

interface MenuItemProps {
  label: string;
  icon?: React.ReactNode;
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
      color: danger ? '#dc3545' : '#212529',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
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
    {icon}
    {label}
  </div>
);

interface SubMenuItemProps {
  label: string;
  submenuWidth: number;
  children: React.ReactNode;
}

const SubMenuItem = ({ label, submenuWidth, children }: SubMenuItemProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="position-relative" style={{ cursor: 'pointer' }}>
      <div
        role="menuitem"
        tabIndex={0}
        style={{
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa';
          const sub = containerRef.current?.querySelector('[data-submenu]') as HTMLElement | null;
          if (sub) sub.style.display = 'block';
        }}
        onMouseLeave={() => {
          /* hide handled by parent */
        }}
      >
        <span>{label}</span>
        <i className="bi bi-chevron-right small opacity-50" />
      </div>

      {/* Submenu */}
      <div
        data-submenu
        style={{
          display: 'none',
          position: 'absolute',
          top: 0,
          left: '100%',
          minWidth: submenuWidth,
          backgroundColor: '#fff',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
          border: '1px solid #dee2e6',
          padding: '4px 0',
          zIndex: 10000,
          maxHeight: 280,
          overflowY: 'auto',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.display = 'block';
          // also keep parent highlighted
          const parent = containerRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null;
          if (parent) parent.style.backgroundColor = '#f8f9fa';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.display = 'none';
          const parent = containerRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null;
          if (parent) parent.style.backgroundColor = 'transparent';
        }}
      >
        {children}
      </div>
    </div>
  );
};

const MenuDivider = () => <hr style={{ margin: '4px 0', borderColor: '#dee2e6' }} />;

interface MenuHeaderProps {
  label: string;
}

const MenuHeader = ({ label }: MenuHeaderProps) => (
  <div
    style={{
      padding: '4px 12px',
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      color: '#6c757d',
      letterSpacing: '0.04em',
      userSelect: 'none',
    }}
  >
    {label}
  </div>
);

export default ContextMenu;
