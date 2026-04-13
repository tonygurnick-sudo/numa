import React, { useState, useRef, useEffect } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional icon/element rendered before the label */
  icon?: React.ReactNode;
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
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SidebarDropdown({
  options,
  value,
  onChange,
  renderValue,
  placeholder = 'Select...',
  disabled = false,
}: SidebarDropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

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

  // Group options
  const groups: { key: string; label: string | null; items: DropdownOption[] }[] = [];
  const seen = new Set<string>();
  for (const opt of options) {
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
