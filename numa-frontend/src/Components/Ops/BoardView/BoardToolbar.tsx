import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StaffAvatar } from '../Shared/StaffAvatar';
import type { StaffProfile } from '../../../types/ops';

type BoardToolbarProps = {
  members: StaffProfile[];
  assigneeFilter: Set<string>;
  onToggleAssignee: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  progressPercent: number;
  progressLabel: string | null;
  children?: React.ReactNode;
};

const BoardToolbar: React.FC<BoardToolbarProps> = ({
  members,
  assigneeFilter,
  onToggleAssignee,
  searchQuery,
  onSearchChange,
  progressPercent,
  progressLabel,
  children,
}) => {
  const { t } = useTranslation('ops');
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: '/' to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isEditableField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !isEditableField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="ops-board-toolbar">
      <div className="ops-board-toolbar-row">
        {/* ── Sprint bar (inline, before avatars) ── */}
        {children}

        {/* ── Assignee avatars (Jira-style overlap) ── */}
        <div className="ops-toolbar-avatars">
          {members.map((staff, i) => {
            const isActive = assigneeFilter.has(staff.id);
            return (
              <button
                key={staff.id}
                type="button"
                className={`ops-toolbar-avatar-btn${isActive ? ' active' : ''}`}
                onClick={() => onToggleAssignee(staff.id)}
                title={staff.name || staff.email || staff.id}
                style={{ marginLeft: i > 0 ? -4 : 0, zIndex: members.length - i }}
              >
                <StaffAvatar staff={staff} size={28} />
              </button>
            );
          })}
        </div>

        {/* ── Search ── */}
        <div className="ops-toolbar-search">
          <i className="bi bi-search ops-toolbar-search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="ops-toolbar-search-input"
            placeholder={t('toolbar.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="ops-toolbar-search-clear" onClick={() => onSearchChange('')}>
              <i className="bi bi-x" />
            </button>
          )}
        </div>

        {/* ── Sprint label (right side) ── */}
        {progressLabel && <div className="ops-toolbar-sprint-label">{progressLabel}</div>}
      </div>

      {/* ── Full-width progress bar (baseline beneath all content) ── */}
      <div className="ops-zone-progress" title={`${progressPercent}%`}>
        <div className="ops-zone-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
};

export default BoardToolbar;
