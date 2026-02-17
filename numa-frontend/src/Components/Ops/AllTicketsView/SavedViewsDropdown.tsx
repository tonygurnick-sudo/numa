import React, { useState, useCallback } from 'react';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import { useTranslation } from 'react-i18next';
import type { SavedFilter } from '../../../types/ops';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SavedViewsDropdownProps {
  currentViewName?: string;
  isModified: boolean;
  onSave: (name: string) => void;
  onLoad: (filter: SavedFilter) => void;
  onUpdate: () => void;
  onClear: () => void;
  savedViews: SavedFilter[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SavedViewsDropdown({
  currentViewName,
  isModified,
  onSave,
  onLoad,
  onUpdate,
  onClear,
  savedViews,
}: SavedViewsDropdownProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const handleSave = useCallback(() => {
    const trimmed = newViewName.trim();
    if (trimmed) {
      onSave(trimmed);
      setNewViewName('');
      setShowSaveInput(false);
    }
  }, [newViewName, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        setShowSaveInput(false);
        setNewViewName('');
      }
    },
    [handleSave],
  );

  return (
    <Dropdown>
      <Dropdown.Toggle variant="outline-secondary" size="sm" id="saved-views-dropdown">
        <i className="bi bi-bookmark me-1" />
        {currentViewName ? (
          <>
            {currentViewName}
            {isModified && (
              <Badge bg="warning" text="dark" className="ms-1" pill>
                {t('filters.modified')}
              </Badge>
            )}
          </>
        ) : (
          t('filters.savedViews')
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu className="shadow-sm" style={{ minWidth: 240 }}>
        {/* Save Current View */}
        {showSaveInput ? (
          <div className="px-3 py-2">
            <div className="d-flex gap-1">
              <Form.Control
                size="sm"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <Button size="sm" variant="primary" onClick={handleSave}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <Dropdown.Item onClick={() => setShowSaveInput(true)}>
            <i className="bi bi-plus-circle me-2" />
            {t('filters.saveView')}
          </Dropdown.Item>
        )}

        {/* Update View (only when a view is loaded and modified) */}
        {currentViewName && isModified && (
          <Dropdown.Item onClick={onUpdate}>
            <i className="bi bi-arrow-repeat me-2" />
            {t('filters.updateView')}
          </Dropdown.Item>
        )}

        {savedViews.length > 0 && <Dropdown.Divider />}

        {/* Saved view list */}
        {savedViews.map((view) => (
          <Dropdown.Item key={view.name} active={view.name === currentViewName} onClick={() => onLoad(view)}>
            <i className="bi bi-bookmark-fill me-2" />
            {view.name}
          </Dropdown.Item>
        ))}

        <Dropdown.Divider />

        {/* Clear / Reset */}
        <Dropdown.Item onClick={onClear}>
          <i className="bi bi-x-circle me-2" />
          {t('filters.clearView')}
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}
