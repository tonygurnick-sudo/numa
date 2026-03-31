import React, { useState, useCallback, useRef, useEffect } from 'react';
import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';
import type { SavedFilter } from '../../../types/ops';

// ─── Save View Modal ───────────────────────────────────────────────────────

interface SaveViewModalProps {
  show: boolean;
  onHide: () => void;
  onSave: (name: string) => void;
  currentViewName?: string;
  onUpdate?: () => void;
  /** Summary of what's being saved */
  viewSummary: {
    scope: string;
    columnCount: number;
    sortColumn: string;
    sortDirection: string;
    filterCount: number;
    filterDetails: { label: string; value: string }[];
  };
}

export function SaveViewModal({
  show,
  onHide,
  onSave,
  currentViewName,
  onUpdate,
  viewSummary,
}: SaveViewModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [mode, setMode] = useState<'create' | 'update'>(() => (currentViewName ? 'update' : 'create'));
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setMode(currentViewName ? 'update' : 'create');
      setNewName('');
    }
  }, [show, currentViewName]);

  // Focus input when switching to create mode
  useEffect(() => {
    if (show && mode === 'create') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [show, mode]);

  const handleSave = useCallback(() => {
    if (mode === 'update' && currentViewName && onUpdate) {
      onUpdate();
      onHide();
    } else if (mode === 'create' && newName.trim()) {
      onSave(newName.trim());
      onHide();
    }
  }, [mode, currentViewName, onUpdate, newName, onSave, onHide]);

  return (
    <Modal show={show} onHide={onHide} centered size="sm">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>{t('filters.saveView')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Mode selection when there's an active view */}
        {currentViewName && onUpdate && (
          <div className="mb-3">
            <Form.Check
              type="radio"
              id="save-mode-update"
              name="saveMode"
              label={
                <span>
                  {t('filters.updateView')} <strong>&quot;{currentViewName}&quot;</strong>
                </span>
              }
              checked={mode === 'update'}
              onChange={() => setMode('update')}
              className="mb-2"
            />
            <Form.Check
              type="radio"
              id="save-mode-create"
              name="saveMode"
              label={t('filters.createNewView')}
              checked={mode === 'create'}
              onChange={() => setMode('create')}
            />
          </div>
        )}

        {/* Name input for create mode */}
        {(mode === 'create' || !currentViewName) && (
          <Form.Control
            ref={inputRef}
            size="sm"
            type="text"
            placeholder={t('filters.viewNamePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            className="mb-3"
          />
        )}

        {/* Config summary */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div
            className="px-3 py-2 small fw-medium"
            style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb', color: '#374151' }}
          >
            {t('filters.viewConfigSummary')}
          </div>
          <div className="p-3">
            <div className="d-flex justify-content-between mb-1">
              <span className="small text-muted">{t('filters.scope')}</span>
              <span className="small fw-medium">{viewSummary.scope}</span>
            </div>
            <div className="d-flex justify-content-between mb-1">
              <span className="small text-muted">{t('columns.manage')}</span>
              <span className="small fw-medium" style={{ color: '#4f46e5' }}>
                {t('filters.columnsCount', { count: viewSummary.columnCount })}
              </span>
            </div>
            <div className="d-flex justify-content-between mb-1">
              <span className="small text-muted">{t('filters.sort')}</span>
              <span className="small fw-medium">
                {viewSummary.sortColumn} ({viewSummary.sortDirection === 'asc' ? '\u2191' : '\u2193'})
              </span>
            </div>
            <div className="d-flex justify-content-between">
              <span className="small text-muted">{t('filters.activeFilters')}</span>
              <span className="small fw-medium" style={{ color: viewSummary.filterCount > 0 ? '#4f46e5' : '#9ca3af' }}>
                {viewSummary.filterCount > 0
                  ? t('filters.filtersCount', { count: viewSummary.filterCount })
                  : t('filters.noFilters')}
              </span>
            </div>
            {viewSummary.filterDetails.length > 0 && (
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid #f3f4f6' }}>
                {viewSummary.filterDetails.map((f) => (
                  <div key={f.label} className="small text-muted">
                    <span className="fw-medium">{f.label}:</span> {f.value}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="outline-secondary" size="sm" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={mode === 'create' && !newName.trim()}>
          {mode === 'update' && currentViewName
            ? `${t('filters.updateView')} "${currentViewName}"`
            : t('filters.saveView')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ─── Load View Dropdown ────────────────────────────────────────────────────

interface LoadViewDropdownProps {
  savedViews: SavedFilter[];
  currentViewName?: string;
  isModified: boolean;
  onLoad: (filter: SavedFilter) => void;
  onDelete: (name: string) => void;
  onClear: () => void;
}

export function LoadViewDropdown({
  savedViews,
  currentViewName,
  isModified,
  onLoad,
  onDelete,
  onClear,
}: LoadViewDropdownProps): React.JSX.Element | null {
  const { t } = useTranslation('ops');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  if (savedViews.length === 0 && !currentViewName) return null;

  return (
    <div ref={wrapperRef} className="position-relative d-inline-block">
      <button
        type="button"
        className="btn btn-sm d-inline-flex align-items-center gap-1"
        style={{
          backgroundColor: currentViewName ? '#eef2ff' : '#f8f9fa',
          border: `1px solid ${currentViewName ? '#818cf8' : '#dee2e6'}`,
          color: currentViewName ? '#4f46e5' : '#495057',
          borderRadius: 8,
        }}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <i className="bi bi-bookmark" />
        {currentViewName ? (
          <>
            {currentViewName}
            {isModified && (
              <span className="opacity-75 fst-italic ms-1" style={{ fontSize: '0.7rem' }}>
                {t('filters.modified')}
              </span>
            )}
          </>
        ) : (
          t('filters.savedViews')
        )}
        <i className="bi bi-chevron-down" style={{ fontSize: '0.55rem' }} />
      </button>

      {isOpen && (
        <div
          className="position-absolute bg-white border rounded shadow-sm"
          style={{ top: '100%', left: 0, zIndex: 1050, minWidth: 220, marginTop: 4 }}
        >
          {savedViews.map((view) => (
            <div
              key={view.name}
              className={`d-flex align-items-center justify-content-between px-3 py-2 ${view.name === currentViewName ? 'bg-light' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                onLoad(view);
                setIsOpen(false);
              }}
            >
              <div className="d-flex align-items-center gap-2 small">
                <i
                  className={`bi ${view.name === currentViewName ? 'bi-bookmark-fill text-primary' : 'bi-bookmark'}`}
                />
                <span className={view.name === currentViewName ? 'fw-semibold' : ''}>{view.name}</span>
              </div>
              <i
                className="bi bi-x text-muted"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(view.name);
                }}
                style={{ fontSize: '0.9rem' }}
              />
            </div>
          ))}

          {currentViewName && (
            <>
              <hr className="my-1" />
              <div
                className="px-3 py-2 small text-muted d-flex align-items-center gap-2"
                role="button"
                onClick={() => {
                  onClear();
                  setIsOpen(false);
                }}
                style={{ cursor: 'pointer' }}
              >
                <i className="bi bi-x-circle" />
                {t('filters.clearView')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
