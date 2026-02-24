import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Badge, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { StaffAvatar } from '../Ops/Shared/StaffAvatar';
import type { StaffProfile } from '../../types/ops';

interface UserPickerProps {
  staff: StaffProfile[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  mode: 'single' | 'multi';
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: string[];
}

/**
 * UserPicker — searchable dropdown for selecting users from the staff directory.
 *
 * Multi-mode: selected users appear as removable pills above the input (visible while picking).
 * Single-mode: selected user shows inline; clicking clears and re-opens the dropdown.
 */
export function UserPicker({
  staff,
  selectedIds,
  onChange,
  mode,
  placeholder,
  disabled = false,
  excludeIds = [],
}: UserPickerProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const resolvedPlaceholder = placeholder ?? t('userPicker.placeholder');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered options: active staff, not excluded, not already selected, matching search
  const options = useMemo(() => {
    const excludeSet = new Set([...excludeIds, ...selectedIds]);
    const query = search.toLowerCase().trim();
    return staff.filter((s) => {
      if (!s.isActive) return false;
      if (excludeSet.has(s.id)) return false;
      if (!query) return true;
      return (s.name || '').toLowerCase().includes(query) || s.email.toLowerCase().includes(query);
    });
  }, [staff, selectedIds, excludeIds, search]);

  // Selected staff profiles (for rendering pills)
  const selectedStaff = useMemo(() => {
    const idSet = new Set(selectedIds);
    return staff.filter((s) => idSet.has(s.id));
  }, [staff, selectedIds]);

  const handleSelect = (userId: string) => {
    if (mode === 'single') {
      onChange([userId]);
      setOpen(false);
      setSearch('');
    } else {
      onChange([...selectedIds, userId]);
      setSearch('');
    }
  };

  const handleRemove = (userId: string) => {
    onChange(selectedIds.filter((id) => id !== userId));
  };

  return (
    <div ref={wrapperRef} className="position-relative">
      {/* Selected users (pills) — above the input so dropdown doesn't cover them */}
      {selectedStaff.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mb-2">
          {selectedStaff.map((s) => (
            <Badge key={s.id} bg="" className="text-bg-light border px-2 py-1 d-flex align-items-center gap-1">
              <StaffAvatar staff={s} size={20} />
              <span className="me-1">{s.name || s.email}</span>
              {!disabled && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 align-baseline text-muted"
                  onClick={() => handleRemove(s.id)}
                  aria-label={t('userPicker.removeUser', { name: s.name || s.email })}
                >
                  <i className="bi bi-x" />
                </Button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Search input */}
      <Form.Control
        type="text"
        size="sm"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
      />

      {/* Dropdown list */}
      {open && !disabled && (
        <div
          className="position-absolute w-100 bg-white border rounded shadow-sm mt-1"
          style={{ zIndex: 1050, maxHeight: 200, overflowY: 'auto' }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-muted small">{t('userPicker.noResults')}</div>
          ) : (
            options.map((s) => (
              <button
                key={s.id}
                type="button"
                className="d-flex align-items-center gap-2 w-100 border-0 bg-transparent px-3 py-2 text-start"
                style={{ cursor: 'pointer' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s.id)}
              >
                <StaffAvatar staff={s} size={24} />
                <div>
                  <div className="fw-medium" style={{ fontSize: '0.875rem' }}>
                    {s.name || s.email}
                  </div>
                  {s.name && (
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {s.email}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
