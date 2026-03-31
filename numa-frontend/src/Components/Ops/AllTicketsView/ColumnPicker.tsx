import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Modal, Form, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ColumnDef = {
  id: string;
  label: string;
  category: string;
  visible: boolean;
};

interface ColumnPickerProps {
  show: boolean;
  onHide: () => void;
  columns: ColumnDef[];
  onColumnsChange: (columns: ColumnDef[]) => void;
}

// ─── Category helpers ───────────────────────────────────────────────────────

const CATEGORY_ORDER: Record<string, number> = {
  system: 0,
  common: 1,
  development: 2,
  support: 3,
  crm: 4,
  operations: 5,
};

const categoryLabel = (cat: string): string => {
  const labels: Record<string, string> = {
    system: 'System',
    common: 'Common',
    development: 'Development',
    support: 'Support',
    crm: 'CRM',
    operations: 'Operations',
  };
  return labels[cat] ?? cat;
};

// ─── Default column set ────────────────────────────────────────────────────

const DEFAULT_VISIBLE_IDS = new Set([
  'displayId',
  'title',
  'ticketTypeId',
  'stageId',
  'workUnit',
  'priority',
  'dueDate',
  'assigneeName',
  'customerName',
]);

// Required columns that cannot be removed
const REQUIRED_IDS = new Set(['displayId', 'title']);

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnPicker({ show, onHide, columns, onColumnsChange }: ColumnPickerProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [search, setSearch] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Derived data ──────────────────────────────────────────────────────────

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);
  const visibleIds = useMemo(() => new Set(visibleColumns.map((c) => c.id)), [visibleColumns]);

  const groupedAvailable = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const filtered = search ? columns.filter((c) => c.label.toLowerCase().includes(lowerSearch)) : columns;

    const groups: Record<string, ColumnDef[]> = {};
    for (const col of filtered) {
      const cat = col.category || 'system';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(col);
    }

    return Object.entries(groups).sort(([a], [b]) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99));
  }, [columns, search]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleColumn = useCallback(
    (id: string) => {
      if (REQUIRED_IDS.has(id)) return;
      const updated = columns.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
      onColumnsChange(updated);
    },
    [columns, onColumnsChange]
  );

  // Drag-and-drop reorder for visible columns
  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!draggedId || draggedId === targetId) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }

      const visIds = visibleColumns.map((c) => c.id);
      const fromIdx = visIds.indexOf(draggedId);
      const toIdx = visIds.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;

      // Move the dragged column to the target position
      visIds.splice(fromIdx, 1);
      visIds.splice(toIdx, 0, draggedId);

      // Rebuild full column array: visible in new order, then hidden
      const colMap = new Map(columns.map((c) => [c.id, c]));
      const reordered: ColumnDef[] = [];
      for (const vid of visIds) {
        const col = colMap.get(vid);
        if (col) reordered.push(col);
      }
      for (const col of columns) {
        if (!col.visible) reordered.push(col);
      }

      onColumnsChange(reordered);
      setDraggedId(null);
      setDragOverId(null);
    },
    [draggedId, visibleColumns, columns, onColumnsChange]
  );

  const resetToDefaults = useCallback(() => {
    const updated = columns.map((c) => ({
      ...c,
      visible: DEFAULT_VISIBLE_IDS.has(c.id),
    }));
    onColumnsChange(updated);
  }, [columns, onColumnsChange]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>{t('columns.manage')}</Modal.Title>
      </Modal.Header>

      <Modal.Body className="p-0">
        <div className="d-flex" style={{ minHeight: 420 }}>
          {/* ── Left Panel: Visible Columns (ordered, draggable) ──────────── */}
          <div className="d-flex flex-column p-3" style={{ flex: '0 0 50%', borderRight: '1px solid #e5e7eb' }}>
            <div className="fw-semibold small text-muted text-uppercase mb-2">{t('columns.manage')}</div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {visibleColumns.map((col) => {
                const isRequired = REQUIRED_IDS.has(col.id);
                const isDragOver = dragOverId === col.id;
                return (
                  <div
                    key={col.id}
                    draggable={!isRequired}
                    onDragStart={() => handleDragStart(col.id)}
                    onDragOver={(e) => handleDragOver(e, col.id)}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={() => handleDrop(col.id)}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    className={`d-flex align-items-center gap-2 px-3 py-2 rounded mb-1 ${
                      isDragOver ? 'border border-primary bg-light' : 'border border-light'
                    } ${draggedId === col.id ? 'opacity-50' : ''}`}
                    style={{
                      backgroundColor: isDragOver ? '#eef2ff' : '#f9fafb',
                      cursor: isRequired ? 'default' : 'grab',
                      transition: 'background-color 0.15s, border-color 0.15s',
                    }}
                  >
                    {/* Grip handle */}
                    <i
                      className={`bi bi-grip-vertical ${isRequired ? 'opacity-25' : 'text-muted'}`}
                      style={{ fontSize: '0.9rem' }}
                    />
                    {/* Checkbox */}
                    <Form.Check
                      type="checkbox"
                      checked
                      disabled={isRequired}
                      onChange={() => toggleColumn(col.id)}
                      id={`vis-col-${col.id}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="small flex-grow-1">
                      {col.label}
                      {isRequired && (
                        <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>
                          ({t('common.required').toLowerCase()})
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}

              {visibleColumns.length === 0 && (
                <div className="text-muted small text-center py-3">{t('common.noResults')}</div>
              )}
            </div>

            <div className="text-muted mt-2" style={{ fontSize: '0.72rem' }}>
              {t('settings.dragToReorder')}
            </div>
          </div>

          {/* ── Right Panel: Available Fields (grouped, searchable) ────────── */}
          <div className="d-flex flex-column p-3" style={{ flex: '0 0 50%' }}>
            <div className="fw-semibold small text-muted text-uppercase mb-2">{t('fieldsTab.title')}</div>

            {/* Search */}
            <div className="position-relative mb-3">
              <i
                className="bi bi-search position-absolute top-50 translate-middle-y"
                style={{ left: 10, fontSize: '0.75rem', color: '#9ca3af' }}
              />
              <Form.Control
                ref={searchRef}
                type="text"
                placeholder={t('columns.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                size="sm"
                style={{ paddingLeft: 30 }}
              />
              {search && (
                <button
                  type="button"
                  className="btn btn-link position-absolute top-50 translate-middle-y p-0 text-muted"
                  style={{ right: 8, fontSize: '0.8rem' }}
                  onClick={() => {
                    setSearch('');
                    searchRef.current?.focus();
                  }}
                >
                  <i className="bi bi-x" />
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {groupedAvailable.map(([category, cols]) => (
                <div key={category} className="mb-3">
                  <div
                    className="fw-semibold text-muted text-uppercase mb-1"
                    style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}
                  >
                    {categoryLabel(category)}
                  </div>
                  {cols.map((col) => {
                    const isVisible = visibleIds.has(col.id);
                    const isRequired = REQUIRED_IDS.has(col.id);
                    return (
                      <label
                        key={col.id}
                        htmlFor={`avail-col-${col.id}`}
                        className={`d-flex align-items-center gap-2 px-3 py-2 rounded mb-1 ${isVisible ? '' : ''}`}
                        style={{
                          backgroundColor: isVisible ? '#eef2ff' : 'transparent',
                          cursor: isRequired ? 'default' : 'pointer',
                          transition: 'background-color 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isVisible) (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = isVisible
                            ? '#eef2ff'
                            : 'transparent';
                        }}
                      >
                        <Form.Check
                          type="checkbox"
                          checked={isVisible}
                          disabled={isRequired}
                          onChange={() => toggleColumn(col.id)}
                          id={`avail-col-${col.id}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="small" style={{ color: isVisible ? '#4338ca' : '#374151' }}>
                          {col.label}
                          {isRequired && (
                            <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>
                              ({t('common.required').toLowerCase()})
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <div className="d-flex align-items-center gap-2 w-100">
          <Button variant="outline-secondary" size="sm" onClick={resetToDefaults}>
            <i className="bi bi-arrow-counterclockwise me-1" />
            {t('columns.reset')}
          </Button>
          <div className="flex-grow-1" />
          <Button variant="primary" size="sm" onClick={onHide}>
            {t('common.close')}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
