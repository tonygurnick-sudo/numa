import React, { useState, useMemo, useCallback } from 'react';
import { Modal, Form, Button, Badge, ListGroup } from 'react-bootstrap';
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

const categoryVariant = (cat: string): string => {
  const variants: Record<string, string> = {
    system: 'secondary',
    common: 'primary',
    development: 'info',
    support: 'warning',
    crm: 'success',
    operations: 'dark',
  };
  return variants[cat] ?? 'secondary';
};

// ─── Default column set ────────────────────────────────────────────────────

const DEFAULT_VISIBLE_IDS = new Set(['displayId', 'title', 'status', 'priority', 'assignee', 'type', 'created']);

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnPicker({ show, onHide, columns, onColumnsChange }: ColumnPickerProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [search, setSearch] = useState('');

  // ── Derived data ──────────────────────────────────────────────────────────

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const groupedColumns = useMemo(() => {
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
      const updated = columns.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
      onColumnsChange(updated);
    },
    [columns, onColumnsChange],
  );

  const moveColumn = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const visibleIds = columns.filter((c) => c.visible).map((c) => c.id);
      const idx = visibleIds.indexOf(id);
      if (idx < 0) return;

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= visibleIds.length) return;

      // Swap in the visible list
      [visibleIds[idx], visibleIds[swapIdx]] = [visibleIds[swapIdx], visibleIds[idx]];

      // Rebuild the full columns array: visible columns first (in new order),
      // then hidden columns (preserving their existing order).
      const colMap = new Map(columns.map((c) => [c.id, c]));
      const reordered: ColumnDef[] = [];

      for (const vid of visibleIds) {
        const col = colMap.get(vid);
        if (col) reordered.push(col);
      }

      for (const col of columns) {
        if (!col.visible) reordered.push(col);
      }

      onColumnsChange(reordered);
    },
    [columns, onColumnsChange],
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
        <Modal.Title>{t('columns.manage')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="d-flex gap-3" style={{ minHeight: 400 }}>
          {/* ── Left Panel: Available Columns ─────────────────────────────── */}
          <div className="flex-grow-1" style={{ flex: '0 0 60%' }}>
            <Form.Control
              type="text"
              placeholder={t('columns.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3"
              size="sm"
            />

            <div style={{ maxHeight: 340, overflowY: 'auto' }} className="pe-2">
              {groupedColumns.map(([category, cols]) => (
                <div key={category} className="mb-3">
                  <div className="fw-semibold text-muted small text-uppercase mb-1">{categoryLabel(category)}</div>
                  {cols.map((col) => (
                    <div
                      key={col.id}
                      className="d-flex align-items-center py-1 px-2 rounded hover-bg-light"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleColumn(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleColumn(col.id);
                        }
                      }}
                    >
                      <Form.Check
                        type="checkbox"
                        checked={col.visible}
                        onChange={() => toggleColumn(col.id)}
                        className="me-2"
                        id={`col-check-${col.id}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="flex-grow-1 small">{col.label}</span>
                      <Badge bg={categoryVariant(col.category || 'system')} className="ms-2" pill>
                        {categoryLabel(col.category || 'system')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ── Divider ───────────────────────────────────────────────────── */}
          <div className="border-start" />

          {/* ── Right Panel: Visible Columns (ordered) ────────────────────── */}
          <div style={{ flex: '0 0 37%' }}>
            <div className="fw-semibold small text-muted text-uppercase mb-2">{t('columns.manage')}</div>

            <ListGroup variant="flush" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {visibleColumns.map((col, idx) => (
                <ListGroup.Item key={col.id} className="d-flex align-items-center px-2 py-1">
                  <span className="flex-grow-1 small">{col.label}</span>
                  <div className="d-flex gap-1">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-muted"
                      disabled={idx === 0}
                      onClick={() => moveColumn(col.id, 'up')}
                      aria-label="Move up"
                    >
                      <i className="bi bi-arrow-up" />
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-muted"
                      disabled={idx === visibleColumns.length - 1}
                      onClick={() => moveColumn(col.id, 'down')}
                      aria-label="Move down"
                    >
                      <i className="bi bi-arrow-down" />
                    </Button>
                  </div>
                </ListGroup.Item>
              ))}

              {visibleColumns.length === 0 && (
                <ListGroup.Item className="text-muted small text-center py-3">{t('common.noResults')}</ListGroup.Item>
              )}
            </ListGroup>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={resetToDefaults}>
          {t('columns.reset')}
        </Button>
        <Button variant="secondary" onClick={onHide}>
          {t('common.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
