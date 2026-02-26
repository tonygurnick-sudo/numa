import React, { useState, useEffect, useCallback } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Accordion from 'react-bootstrap/Accordion';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Supplier, Activity, Document as OpsDocument, UpdateSupplierPayload, Ticket } from '../../../types/ops';
import { ContactSection } from '../Shared/ContactSection';
import { ActivitySection } from '../Shared/ActivitySection';
import { DocumentSection } from '../Shared/DocumentSection';
import { getColorForPosition, getContrastTextColor } from '../Shared/colorUtils';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { CreateTicketModal } from './CreateTicketModal';
import { TicketDetailModal } from './TicketDetailModal';

// ─── Constants ──────────────────────────────────────────────────────────────

const TEAL_ACCENT = '#0d9488';

// ─── Props ──────────────────────────────────────────────────────────────────

interface SupplierDetailModalProps {
  show: boolean;
  supplierId: string | null;
  onHide: () => void;
  onUpdated?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats a number as a currency string for display.
 */
function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Parses a currency input string back to a number.
 * Strips non-numeric characters except for the decimal point.
 */
function parseCurrencyInput(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * SupplierDetailModal is a large detail view for viewing and inline-editing
 * a supplier record. It loads full supplier data (including activities and
 * documents) on mount, and provides collapsible sections for each data area.
 *
 * Teal (#0d9488) is used as the primary accent color for section headers,
 * badges, and interactive elements.
 */
export function SupplierDetailModal({
  show,
  supplierId,
  onHide,
  onUpdated,
}: SupplierDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut } = useNumaRequest();
  const { config } = useOps();

  const supplierConfig = config?.supplierConfig ?? null;
  const staff = config?.staff ?? [];

  // ── Core state ──────────────────────────────────────────────────────────
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [documents, setDocuments] = useState<OpsDocument[]>([]);
  const [linkedTickets, setLinkedTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Notes state (separate since it's a textarea section)
  const [notesDraft, setNotesDraft] = useState('');
  const [notesEditing, setNotesEditing] = useState(false);

  // ── Data Loading ────────────────────────────────────────────────────────

  const loadSupplier = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await OpsService.getSupplier(numaGet, supplierId);
      setSupplier(response.supplier);
      setActivities(response.activities ?? []);
      setDocuments(response.documents ?? []);
      setNotesDraft(response.supplier.notes ?? '');
    } catch (err) {
      console.error('[SupplierDetailModal] Failed to load supplier', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [supplierId, numaGet]);

  useEffect(() => {
    if (show && supplierId) {
      loadSupplier();
      // Load linked tickets
      setLoadingTickets(true);
      void OpsService.listTickets(numaGet, { supplierId })
        .then((res) => setLinkedTickets(res.tickets))
        .catch((err) => console.error('[SupplierDetailModal] Failed to load linked tickets', err))
        .finally(() => setLoadingTickets(false));
    } else {
      // Reset state when modal closes
      setSupplier(null);
      setActivities([]);
      setDocuments([]);
      setLinkedTickets([]);
      setSelectedTicket(null);
      setShowCreateTicket(false);
      setEditingField(null);
      setFieldDraft('');
      setNotesEditing(false);
    }
  }, [show, supplierId, loadSupplier, numaGet]);

  // ── Save Helpers ────────────────────────────────────────────────────────

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      if (!supplierId || !supplier) return;
      setSaving(true);
      try {
        const payload: UpdateSupplierPayload = { [field]: value };
        const updated = await OpsService.updateSupplier(numaPut, supplierId, payload);
        setSupplier(updated);
        onUpdated?.();
      } catch (err) {
        console.error(`[SupplierDetailModal] Failed to save ${field}`, err);
      } finally {
        setSaving(false);
        setEditingField(null);
        setFieldDraft('');
      }
    },
    [supplierId, supplier, numaPut, onUpdated],
  );

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setFieldDraft(currentValue);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setFieldDraft('');
  };

  // ── Flag Toggle ─────────────────────────────────────────────────────────

  const toggleFlag = useCallback(
    async (flagId: string) => {
      if (!supplier) return;
      const newFlags = supplier.flags.includes(flagId)
        ? supplier.flags.filter((f) => f !== flagId)
        : [...supplier.flags, flagId];
      await saveField('flags', newFlags);
    },
    [supplier, saveField],
  );

  // ── Contacts Change ─────────────────────────────────────────────────────

  const handleContactsChange = useCallback(
    async (contacts: typeof supplier extends null ? never : NonNullable<typeof supplier>['contacts']) => {
      if (!supplierId) return;
      setSaving(true);
      try {
        const updated = await OpsService.updateSupplier(numaPut, supplierId, { contacts });
        setSupplier(updated);
        onUpdated?.();
      } catch (err) {
        console.error('[SupplierDetailModal] Failed to update contacts', err);
      } finally {
        setSaving(false);
      }
    },
    [supplierId, numaPut, onUpdated],
  );

  // ── Notes Save ──────────────────────────────────────────────────────────

  const saveNotes = useCallback(async () => {
    if (!supplierId) return;
    setSaving(true);
    try {
      const updated = await OpsService.updateSupplier(numaPut, supplierId, { notes: notesDraft });
      setSupplier(updated);
      setNotesEditing(false);
      onUpdated?.();
    } catch (err) {
      console.error('[SupplierDetailModal] Failed to save notes', err);
    } finally {
      setSaving(false);
    }
  }, [supplierId, notesDraft, numaPut, onUpdated]);

  // ── Derived Data ────────────────────────────────────────────────────────

  const currentStage = supplierConfig?.lifecycleStages.find((s) => s.id === supplier?.lifecycleStage);
  const stageColor = currentStage ? getColorForPosition(currentStage.colorPosition) : TEAL_ACCENT;
  const stageTextColor = getContrastTextColor(stageColor);

  // ── Inline Editable Field Renderer ──────────────────────────────────────

  const renderEditableField = (
    field: string,
    label: string,
    value: string | null | undefined,
    type: 'text' | 'url' = 'text',
  ) => {
    const displayValue = value ?? '';
    const isEditing = editingField === field;

    return (
      <div className="mb-2">
        <div className="small text-muted mb-0">{label}</div>
        {isEditing ? (
          <div className="d-flex gap-1 align-items-center">
            <Form.Control
              size="sm"
              type={type}
              value={fieldDraft}
              onChange={(e) => setFieldDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveField(field, fieldDraft || null);
                if (e.key === 'Escape') cancelEdit();
              }}
              disabled={saving}
            />
            <Button
              size="sm"
              variant="link"
              className="p-0"
              style={{ color: TEAL_ACCENT }}
              onClick={() => saveField(field, fieldDraft || null)}
              disabled={saving}
            >
              <i className="bi bi-check-lg" />
            </Button>
            <Button size="sm" variant="link" className="p-0 text-secondary" onClick={cancelEdit} disabled={saving}>
              <i className="bi bi-x-lg" />
            </Button>
          </div>
        ) : (
          <div
            className="small"
            role="button"
            tabIndex={0}
            onClick={() => startEdit(field, displayValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startEdit(field, displayValue);
            }}
            style={{ cursor: 'pointer', minHeight: '1.4em' }}
          >
            {displayValue || <span className="text-muted fst-italic">{t('common.edit')}</span>}
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl" fullscreen="lg-down" centered scrollable>
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <Modal.Header closeButton style={{ borderBottom: `3px solid ${TEAL_ACCENT}` }}>
          <Modal.Title className="d-flex align-items-center gap-2 flex-wrap w-100">
            {loading ? (
              <Spinner animation="border" size="sm" style={{ color: TEAL_ACCENT }} />
            ) : supplier ? (
              <>
                {/* Company name */}
                <span className="fw-bold">{supplier.companyName}</span>

                {/* Lifecycle stage badge */}
                {currentStage && (
                  <Badge
                    bg=""
                    style={{
                      backgroundColor: stageColor,
                      color: stageTextColor,
                      fontSize: '0.75rem',
                    }}
                  >
                    {currentStage.name}
                  </Badge>
                )}

                {/* Flag toggles */}
                {supplierConfig?.supplierFlags.map((flag) => {
                  const isActive = supplier.flags.includes(flag.id);
                  return (
                    <Button
                      key={flag.id}
                      variant="link"
                      size="sm"
                      className="p-0"
                      title={flag.name}
                      onClick={() => toggleFlag(flag.id)}
                      style={{
                        color: isActive ? flag.color : '#ccc',
                        fontSize: '1rem',
                        opacity: isActive ? 1 : 0.5,
                        transition: 'opacity 0.15s, color 0.15s',
                      }}
                    >
                      <i className={`bi bi-${flag.icon ?? 'flag-fill'}`} />
                    </Button>
                  );
                })}
              </>
            ) : error ? (
              <span className="text-danger">{t('errors.loadFailed', { message: error })}</span>
            ) : null}
          </Modal.Title>
        </Modal.Header>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <Modal.Body>
          {loading && !supplier && (
            <div className="d-flex justify-content-center p-5">
              <Spinner animation="border" style={{ color: TEAL_ACCENT }} />
            </div>
          )}

          {error && !supplier && (
            <div className="text-danger text-center p-3">{t('errors.loadFailed', { message: error })}</div>
          )}

          {supplier && (
            <Accordion defaultActiveKey={['0', '1']} alwaysOpen>
              {/* ── 1. Supplier Details ──────────────────────────────────────── */}
              <Accordion.Item eventKey="0">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-building me-2" />
                    {t('suppliers.supplierDetails')}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  <div className="row">
                    <div className="col-md-6">
                      {renderEditableField('companyName', t('common.name'), supplier.companyName)}
                      {renderEditableField('industry', t('crm.industry'), supplier.industry)}
                      {renderEditableField('companySize', t('crm.companySize'), supplier.companySize)}
                      {renderEditableField('website', t('crm.website'), supplier.website, 'url')}
                    </div>
                    <div className="col-md-6">
                      {renderEditableField('territory', t('crm.territory'), supplier.territory)}
                      {renderEditableField('source', t('crm.source'), supplier.source)}

                      {/* Owner (staff dropdown) */}
                      <div className="mb-2">
                        <div className="small text-muted mb-0">{t('crm.owner')}</div>
                        <Form.Select
                          size="sm"
                          value={supplier.ownerId ?? ''}
                          onChange={(e) => saveField('ownerId', e.target.value || null)}
                          disabled={saving}
                        >
                          <option value="">{t('common.none')}</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Form.Select>
                      </div>

                      {/* Lifecycle Stage (select) */}
                      <div className="mb-2">
                        <div className="small text-muted mb-0">{t('crm.lifecycleStage')}</div>
                        <Form.Select
                          size="sm"
                          value={supplier.lifecycleStage}
                          onChange={(e) => saveField('lifecycleStage', e.target.value)}
                          disabled={saving}
                        >
                          {supplierConfig?.lifecycleStages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                        </Form.Select>
                      </div>
                    </div>
                  </div>
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 2. Commercial ────────────────────────────────────────────── */}
              <Accordion.Item eventKey="1">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-cash-stack me-2" />
                    {t('suppliers.commercial')}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  <div className="row">
                    <div className="col-md-6">
                      {/* Annual Spend (currency input) */}
                      <div className="mb-2">
                        <div className="small text-muted mb-0">{t('suppliers.annualSpend')}</div>
                        {editingField === 'annualSpend' ? (
                          <div className="d-flex gap-1 align-items-center">
                            <Form.Control
                              size="sm"
                              type="text"
                              value={fieldDraft}
                              onChange={(e) => setFieldDraft(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveField('annualSpend', parseCurrencyInput(fieldDraft));
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              disabled={saving}
                              placeholder="$0"
                            />
                            <Button
                              size="sm"
                              variant="link"
                              className="p-0"
                              style={{ color: TEAL_ACCENT }}
                              onClick={() => saveField('annualSpend', parseCurrencyInput(fieldDraft))}
                              disabled={saving}
                            >
                              <i className="bi bi-check-lg" />
                            </Button>
                            <Button
                              size="sm"
                              variant="link"
                              className="p-0 text-secondary"
                              onClick={cancelEdit}
                              disabled={saving}
                            >
                              <i className="bi bi-x-lg" />
                            </Button>
                          </div>
                        ) : (
                          <div
                            className="small"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              startEdit('annualSpend', supplier.annualSpend != null ? String(supplier.annualSpend) : '')
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                startEdit(
                                  'annualSpend',
                                  supplier.annualSpend != null ? String(supplier.annualSpend) : '',
                                );
                            }}
                            style={{ cursor: 'pointer', minHeight: '1.4em' }}
                          >
                            {supplier.annualSpend != null ? (
                              <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                                {formatCurrency(supplier.annualSpend)}
                              </span>
                            ) : (
                              <span className="text-muted fst-italic">{t('common.edit')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-md-6">
                      {renderEditableField('paymentTerms', t('suppliers.paymentTerms'), supplier.paymentTerms)}
                    </div>
                  </div>
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 3. Contacts ──────────────────────────────────────────────── */}
              <Accordion.Item eventKey="2">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-people me-2" />
                    {t('crm.contacts')}
                    {supplier.contacts.length > 0 && (
                      <Badge bg="" className="ms-2" style={{ backgroundColor: TEAL_ACCENT, fontSize: '0.7rem' }}>
                        {supplier.contacts.length}
                      </Badge>
                    )}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  <ContactSection contacts={supplier.contacts} onChange={handleContactsChange} />
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 4. Activities ────────────────────────────────────────────── */}
              <Accordion.Item eventKey="3">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-clock-history me-2" />
                    {t('crm.activities')}
                    {activities.length > 0 && (
                      <Badge bg="" className="ms-2" style={{ backgroundColor: TEAL_ACCENT, fontSize: '0.7rem' }}>
                        {activities.length}
                      </Badge>
                    )}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  <ActivitySection entityType="supplier" entityId={supplier.id} activities={activities} />
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 5. Documents ─────────────────────────────────────────────── */}
              <Accordion.Item eventKey="4">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-folder me-2" />
                    {t('crm.documents')}
                    {documents.length > 0 && (
                      <Badge bg="" className="ms-2" style={{ backgroundColor: TEAL_ACCENT, fontSize: '0.7rem' }}>
                        {documents.length}
                      </Badge>
                    )}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  <DocumentSection
                    entityType="supplier"
                    entityId={supplier.id}
                    documents={documents}
                    documentTypes={supplierConfig?.documentTypes}
                  />
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 6. Linked Work ───────────────────────────────────────────── */}
              <Accordion.Item eventKey="5">
                <Accordion.Header>
                  <div className="d-flex align-items-center gap-2 w-100 pe-2">
                    <span className="fw-semibold d-flex align-items-center gap-1" style={{ color: TEAL_ACCENT }}>
                      <i className="bi bi-link-45deg" />
                      {t('crm.linkedWork')}
                      {linkedTickets.length > 0 && (
                        <Badge bg="" className="ms-1" style={{ backgroundColor: TEAL_ACCENT, fontSize: '0.7rem' }}>
                          {linkedTickets.length}
                        </Badge>
                      )}
                    </span>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="ms-auto"
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 8px',
                        flexShrink: 0,
                        borderColor: TEAL_ACCENT,
                        color: TEAL_ACCENT,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCreateTicket(true);
                      }}
                    >
                      <i className="bi bi-plus me-1" />
                      {t('tickets.newTicket')}
                    </Button>
                  </div>
                </Accordion.Header>
                <Accordion.Body>
                  {loadingTickets ? (
                    <div className="d-flex justify-content-center py-3">
                      <Spinner animation="border" size="sm" style={{ color: TEAL_ACCENT }} />
                    </div>
                  ) : linkedTickets.length === 0 ? (
                    <div className="text-muted small">{t('empty.noTickets')}</div>
                  ) : (
                    <div>
                      {linkedTickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="d-flex align-items-center gap-2 py-2 border-bottom"
                          style={{ cursor: 'pointer', fontSize: '0.85rem' }}
                          onClick={() => setSelectedTicket(ticket)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') setSelectedTicket(ticket);
                          }}
                        >
                          <Badge
                            bg="light"
                            text="dark"
                            className="border"
                            style={{ fontFamily: 'monospace', flexShrink: 0, fontSize: '0.72rem' }}
                          >
                            {ticket.displayId}
                          </Badge>
                          <span className="text-truncate flex-grow-1" title={ticket.title}>
                            {ticket.title}
                          </span>
                          <PriorityIndicator priority={ticket.priority} />
                          {ticket.assigneeName && (
                            <span className="text-muted small flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                              {ticket.assigneeName}
                            </span>
                          )}
                          <i
                            className="bi bi-chevron-right text-muted"
                            style={{ fontSize: '0.65rem', flexShrink: 0 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </Accordion.Body>
              </Accordion.Item>

              {/* ── 7. Service Notes ─────────────────────────────────────────── */}
              <Accordion.Item eventKey="6">
                <Accordion.Header>
                  <span className="fw-semibold" style={{ color: TEAL_ACCENT }}>
                    <i className="bi bi-journal-text me-2" />
                    {t('suppliers.serviceNotes')}
                  </span>
                </Accordion.Header>
                <Accordion.Body>
                  {notesEditing ? (
                    <div>
                      <Form.Control
                        as="textarea"
                        rows={5}
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        disabled={saving}
                      />
                      <div className="d-flex gap-1 justify-content-end mt-2">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => {
                            setNotesDraft(supplier.notes ?? '');
                            setNotesEditing(false);
                          }}
                          disabled={saving}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          style={{ backgroundColor: TEAL_ACCENT, borderColor: TEAL_ACCENT, color: '#fff' }}
                          onClick={saveNotes}
                          disabled={saving}
                        >
                          {saving ? t('common.loading') : t('common.save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      className="small"
                      style={{ cursor: 'pointer', minHeight: '2em', whiteSpace: 'pre-wrap' }}
                      onClick={() => setNotesEditing(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setNotesEditing(true);
                      }}
                    >
                      {supplier.notes || <span className="text-muted fst-italic">{t('common.edit')}</span>}
                    </div>
                  )}
                </Accordion.Body>
              </Accordion.Item>
            </Accordion>
          )}
        </Modal.Body>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <Modal.Footer style={{ borderTop: `2px solid ${TEAL_ACCENT}20` }}>
          <Button variant="outline-secondary" size="sm" onClick={onHide}>
            {t('common.close')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Create ticket pre-linked to this supplier */}
      <CreateTicketModal
        show={showCreateTicket}
        onHide={() => setShowCreateTicket(false)}
        onSuccess={(ticket) => {
          setShowCreateTicket(false);
          setLinkedTickets((prev) => [ticket, ...prev]);
        }}
        prefilledSupplierId={supplierId}
        prefilledSupplierName={supplier?.companyName}
      />

      {/* Open a linked ticket's detail modal */}
      {selectedTicket && (
        <TicketDetailModal
          show={!!selectedTicket}
          ticketId={selectedTicket.id}
          onHide={() => setSelectedTicket(null)}
          onDeleted={() => {
            setLinkedTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id));
            setSelectedTicket(null);
          }}
        />
      )}
    </>
  );
}
