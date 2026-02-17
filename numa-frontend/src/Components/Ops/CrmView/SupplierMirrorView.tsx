import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Form, Badge, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Supplier } from '../../../types/ops';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { SupplierCard } from './SupplierCard';
import { SupplierDetailModal } from '../Modals/SupplierDetailModal';

// ─── Constants ──────────────────────────────────────────────────────────────

const TEAL_ACCENT = '#0d9488';

type FilterMode = 'all' | 'with-tickets';

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * SupplierMirrorView renders a Kanban-style board of suppliers grouped by
 * lifecycle stage. Each column represents a stage from the supplier config,
 * colored via `getColorForPosition`. Suppliers can be filtered by name search
 * and by active ticket status.
 *
 * Clicking "+ New Supplier" prompts for a company name, creates the supplier
 * via OpsService, and refreshes the list. Clicking a supplier card opens the
 * SupplierDetailModal.
 */
export function SupplierMirrorView(): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost } = useNumaRequest();
  const { config } = useOps();

  const supplierConfig = config?.supplierConfig ?? null;

  // ── State ──────────────────────────────────────────────────────────────

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  // New supplier creation
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail modal
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // ── Data Loading ───────────────────────────────────────────────────────

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await OpsService.listSuppliers(numaGet);
      setSuppliers(data);
    } catch (err) {
      console.error('[SupplierMirrorView] Failed to load suppliers', err);
    } finally {
      setLoading(false);
    }
  }, [numaGet]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  // ── Filtering ──────────────────────────────────────────────────────────

  const filteredSuppliers = useMemo(() => {
    let result = suppliers;

    // Text search on company name
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((s) => s.companyName.toLowerCase().includes(q));
    }

    // Filter by active tickets
    if (filterMode === 'with-tickets') {
      result = result.filter((s) => s.openTicketCount > 0);
    }

    return result;
  }, [suppliers, searchQuery, filterMode]);

  // Counts for filter badges
  const totalCount = suppliers.length;
  const withTicketsCount = useMemo(() => suppliers.filter((s) => s.openTicketCount > 0).length, [suppliers]);

  // ── Create Supplier ────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setCreating(true);
    try {
      await OpsService.createSupplier(numaPost, { companyName: trimmed });
      setNewName('');
      setShowNewInput(false);
      await loadSuppliers();
    } catch (err) {
      console.error('[SupplierMirrorView] Failed to create supplier', err);
    } finally {
      setCreating(false);
    }
  }, [newName, numaPost, loadSuppliers]);

  // ── Detail Modal ───────────────────────────────────────────────────────

  const openDetail = useCallback((supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setShowDetail(true);
  }, []);

  const handleDetailHide = useCallback(() => {
    setShowDetail(false);
    setSelectedSupplierId(null);
  }, []);

  const handleDetailUpdated = useCallback(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  // ── Lifecycle Stages ───────────────────────────────────────────────────

  const stages = supplierConfig?.lifecycleStages ?? [];

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading && suppliers.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center p-5">
        <Spinner animation="border" style={{ color: TEAL_ACCENT }} />
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="d-flex flex-wrap align-items-center gap-2 px-3 py-2 border-bottom">
        {/* Filter toggles */}
        <div className="d-flex gap-1">
          <Button
            size="sm"
            variant={filterMode === 'all' ? '' : 'outline-secondary'}
            style={
              filterMode === 'all'
                ? { backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }
                : undefined
            }
            onClick={() => setFilterMode('all')}
          >
            {t('suppliers.allSuppliers')}{' '}
            <Badge bg="light" text="dark" className="ms-1">
              {totalCount}
            </Badge>
          </Button>
          <Button
            size="sm"
            variant={filterMode === 'with-tickets' ? '' : 'outline-secondary'}
            style={
              filterMode === 'with-tickets'
                ? { backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }
                : undefined
            }
            onClick={() => setFilterMode('with-tickets')}
          >
            {t('crm.withActiveTickets')}{' '}
            <Badge bg="light" text="dark" className="ms-1">
              {withTicketsCount}
            </Badge>
          </Button>
        </div>

        {/* Search */}
        <Form.Control
          size="sm"
          type="text"
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />

        {/* Spacer */}
        <div className="flex-grow-1" />

        {/* New supplier */}
        {showNewInput ? (
          <div className="d-flex gap-1 align-items-center">
            <Form.Control
              size="sm"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('common.name')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setShowNewInput(false);
                  setNewName('');
                }
              }}
              style={{ width: 200 }}
              disabled={creating}
            />
            <Button
              size="sm"
              style={{ backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t('common.loading') : t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => {
                setShowNewInput(false);
                setNewName('');
              }}
              disabled={creating}
            >
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            style={{ backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }}
            onClick={() => setShowNewInput(true)}
          >
            <i className="bi bi-plus me-1" />
            {t('suppliers.newSupplier')}
          </Button>
        )}
      </div>

      {/* ── Filtered count ─────────────────────────────────────────────────── */}
      {filteredSuppliers.length !== totalCount && totalCount > 0 && (
        <div className="px-3 py-1 text-muted small">
          {filteredSuppliers.length}{' '}
          {t('crm.customersOf', {
            shown: String(filteredSuppliers.length),
            total: String(totalCount),
          }).replace(/customers/i, '')}
        </div>
      )}

      {/* ── Kanban Columns ─────────────────────────────────────────────────── */}
      <div className="flex-grow-1 d-flex overflow-auto" style={{ gap: 12, padding: '12px 12px 12px 12px' }}>
        {stages.map((stage) => {
          const stageColor = getColorForPosition(stage.colorPosition);
          const textColor = getContrastTextColor(stageColor);
          const stageSuppliers = filteredSuppliers.filter((s) => s.lifecycleStage === stage.id);

          return (
            <div
              key={stage.id}
              className="d-flex flex-column flex-shrink-0"
              style={{
                width: 280,
                minHeight: 0,
              }}
            >
              {/* Column header */}
              <div
                className="d-flex justify-content-between align-items-center px-2 py-1 rounded-top"
                style={{
                  backgroundColor: stageColor,
                  color: textColor,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                <span>{stage.name}</span>
                <Badge
                  bg=""
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    color: textColor,
                    fontSize: '0.7rem',
                  }}
                >
                  {stageSuppliers.length}
                </Badge>
              </div>

              {/* Column body */}
              <div
                className="flex-grow-1 overflow-auto d-flex flex-column gap-2 p-2"
                style={{
                  backgroundColor: '#f8f9fa',
                  borderLeft: `2px solid ${stageColor}20`,
                  borderRight: `2px solid ${stageColor}20`,
                  borderBottom: `2px solid ${stageColor}20`,
                  borderRadius: '0 0 6px 6px',
                  minHeight: 100,
                }}
              >
                {stageSuppliers.length === 0 && (
                  <div className="text-muted small text-center py-3">{t('empty.noSuppliers')}</div>
                )}

                {stageSuppliers.map((supplier) => (
                  <SupplierCard
                    key={supplier.id}
                    supplier={supplier}
                    supplierConfig={supplierConfig!}
                    onClick={openDetail}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Detail Modal ───────────────────────────────────────────────────── */}
      <SupplierDetailModal
        show={showDetail}
        supplierId={selectedSupplierId}
        onHide={handleDetailHide}
        onUpdated={handleDetailUpdated}
      />
    </div>
  );
}
