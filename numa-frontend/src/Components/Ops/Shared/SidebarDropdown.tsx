import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional icon/element rendered before the label */
  icon?: React.ReactNode;
  /** Optional action button rendered at the end of the row (e.g. open link) */
  action?: React.ReactNode;
  /** Optional group header this option belongs to */
  group?: string;
  disabled?: boolean;
}

interface SidebarDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  /** Element rendered as the trigger (current value display) */
  renderValue?: (option: DropdownOption | undefined) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Show a search input at the top of the menu. Defaults to `true`; pass
   * `false` to suppress (e.g. for very short fixed lists like Yes/No).
   */
  searchable?: boolean;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SidebarDropdown({
  options,
  value,
  onChange,
  renderValue,
  placeholder = 'Select...',
  disabled = false,
  searchable,
  searchPlaceholder,
}: SidebarDropdownProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  // Default: always show search. Suppress only if explicitly disabled or if
  // there's at most one option (where searching is pointless).
  const isSearchable = searchable ?? options.length > 1;

  // Reset search when menu closes; focus input when it opens.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (isSearchable) {
      // Defer focus to next paint so the input is mounted.
      const id = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, isSearchable]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!isSearchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, isSearchable]);

  // Group options
  const groups: { key: string; label: string | null; items: DropdownOption[] }[] = [];
  const seen = new Set<string>();
  for (const opt of filteredOptions) {
    const groupKey = opt.group ?? '__none__';
    if (!seen.has(groupKey)) {
      seen.add(groupKey);
      groups.push({ key: groupKey, label: opt.group ?? null, items: [] });
    }
    groups.find((g) => g.key === groupKey)?.items.push(opt);
  }

  return (
    <div ref={containerRef} className="sidebar-dropdown" style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        className={`sidebar-dropdown-trigger${!selected || !selected.value ? ' sidebar-dropdown-trigger--empty' : ''}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className="sidebar-dropdown-trigger-content">
          {renderValue ? (
            renderValue(selected)
          ) : (
            <span className={!selected?.value ? 'sidebar-dropdown-placeholder' : ''}>
              {selected?.label ?? placeholder}
            </span>
          )}
        </span>
        <i className="bi bi-chevron-down sidebar-dropdown-chevron" />
      </button>

      {/* Menu */}
      {open && (
        <div className="sidebar-dropdown-menu">
          {isSearchable && (
            <div className="sidebar-dropdown-search">
              <i className="bi bi-search sidebar-dropdown-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="sidebar-dropdown-search-input"
                placeholder={searchPlaceholder ?? t('common.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (query) setQuery('');
                    else setOpen(false);
                  }
                }}
              />
            </div>
          )}
          {groups.length === 0 && <div className="sidebar-dropdown-empty">{t('common.noResults')}</div>}
          {groups.map((group) => (
            <React.Fragment key={group.key}>
              {group.label && <div className="sidebar-dropdown-group-label">{group.label}</div>}
              {group.items.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`sidebar-dropdown-item${opt.value === value ? ' sidebar-dropdown-item--selected' : ''}${opt.disabled ? ' sidebar-dropdown-item--disabled' : ''}`}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  disabled={opt.disabled}
                >
                  {opt.icon && <span className="sidebar-dropdown-item-icon">{opt.icon}</span>}
                  <span className="sidebar-dropdown-item-label">{opt.label}</span>
                  {opt.action && (
                    <span
                      className="sidebar-dropdown-item-action"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {opt.action}
                    </span>
                  )}
                  {opt.value === value && <i className="bi bi-check2 sidebar-dropdown-check" />}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
