import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Modal, Form, Button, Col, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { RichTextEditor } from '../Shared/RichTextEditor';
import { DynamicField } from '../Shared/DynamicField';
import type {
  Ticket,
  TicketType,
  TicketPriority,
  FieldDefinition,
  FieldOverride,
  Customer,
  Supplier,
} from '../../../types/ops';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { StaffAvatar } from '../Shared/StaffAvatar';

// ─── Props ──────────────────────────────────────────────────────────────────

interface CreateTicketModalProps {
  show: boolean;
  onHide: () => void;
  onSuccess: (ticket: Ticket) => void;
  /** Pre-fill the customer field (e.g. when opening from a customer modal) */
  prefilledCustomerId?: string | null;
  prefilledCustomerName?: string | null;
  /** Pre-fill the supplier field (e.g. when opening from a supplier modal) */
  prefilledSupplierId?: string | null;
  prefilledSupplierName?: string | null;
  /** Pre-fill the zone (e.g. when creating from a backlog group "+" button) */
  prefilledZoneId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Field IDs handled as first-class ticket properties — excluded from the
 * dynamic fields grid to prevent duplication. The title input handles
 * field-name; the description textarea handles field-description.
 */
const SYSTEM_FIELD_IDS = new Set([
  'field-name',
  'field-description',
  'field-priority',
  'field-assignee',
  'field-reporter',
  'field-due-date',
  'field-project',
  'field-client',
  'field-supplier',
  'field-labels',
  'field-watchers',
]);

/**
 * Field IDs that map directly to top-level ticket payload properties.
 * Their values are extracted from customFields and mapped at submit time
 * rather than being sent inside the `fields` object.
 */
const PRIORITY_OPTIONS: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

const TICKET_PROP_FIELD_IDS = new Set([
  'field-name',
  'field-description',
  'field-priority',
  'field-assignee',
  'field-reporter',
  'field-work-unit-id',
  'field-client',
  'field-supplier',
  'field-due-date',
  'field-effort-points',
  'field-project',
]);

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * CreateTicketModal — Ian's two-phase design.
 *
 * Phase 1: Prominent type tile selection ("What type of ticket?")
 * Phase 2: Full form with title in header, description/attachments/comment
 *          on the left, and all ticket-type fields on the right as a compact
 *          two-column dynamic grid.
 *
 * The right panel is driven entirely by the ticket type's defaultFields,
 * preventing duplication with the left-panel content. Smart payload mapping
 * extracts well-known field IDs into their canonical ticket properties.
 */
export function CreateTicketModal({
  show,
  onHide,
  onSuccess,
  prefilledCustomerId,
  prefilledCustomerName,
  prefilledSupplierId,
  prefilledSupplierName,
  prefilledZoneId,
}: CreateTicketModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaGet } = useNumaRequest();
  const { config, teamData, workUnits, refreshTickets, refreshCrmData } = useOps();

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [initialComment, setInitialComment] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Zone/stage — auto-resolved from team defaults
  const [zoneId, setZoneId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  // ── CRM data ──────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load CRM lists when modal opens
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    void Promise.all([OpsService.listCustomers(numaGet), OpsService.listSuppliers(numaGet)])
      .then(([custs, supps]) => {
        if (!cancelled) {
          setCustomers(custs);
          setSuppliers(supps);
        }
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [show, numaGet]);

  // ── Derived values ────────────────────────────────────────────────────────

  const allowedTypes: TicketType[] = useMemo(() => {
    if (!config || !teamData?.team) return [];
    const restricted = teamData.team.allowedTicketTypes;
    if (!restricted || restricted.length === 0) {
      return [...config.ticketTypes].sort((a, b) => a.order - b.order);
    }
    const allowed = new Set(restricted);
    return config.ticketTypes.filter((tt) => allowed.has(tt.id)).sort((a, b) => a.order - b.order);
  }, [config, teamData]);

  const selectedType: TicketType | undefined = useMemo(
    () => allowedTypes.find((tt) => tt.id === selectedTypeId),
    [allowedTypes, selectedTypeId]
  );

  const zones = useMemo(() => teamData?.zones ?? [], [teamData]);

  const filteredStages = useMemo(() => {
    if (!teamData || !zoneId) return [];
    return teamData.stages.filter((s) => s.zoneId === zoneId).sort((a, b) => a.order - b.order);
  }, [teamData, zoneId]);

  const fieldOverrides: Record<string, FieldOverride> = useMemo(() => teamData?.team?.fieldOverrides ?? {}, [teamData]);

  /**
   * Dynamic fields for the right panel: ticket type's defaultFields minus
   * system fields (name, description) which are rendered separately on left.
   * Filtered by team field overrides.
   */
  const hasWorkUnits = teamData?.team?.workUnitSeries?.enabled === true;

  const dynamicFields: FieldDefinition[] = useMemo(() => {
    if (!selectedType || !config) return [];
    // Hide sprint & effort fields when work units are not enabled (same as detail modal)
    const hiddenWhenNoWorkUnits = new Set(hasWorkUnits ? [] : ['field-work-unit-id', 'field-effort-points']);
    return selectedType.defaultFields
      .map((fId) => config.fields.find((f) => f.id === fId))
      .filter((f): f is FieldDefinition => {
        if (!f) return false;
        if (SYSTEM_FIELD_IDS.has(f.id)) return false;
        if (hiddenWhenNoWorkUnits.has(f.id)) return false;
        if (fieldOverrides[f.id]?.visible === false) return false;
        return true;
      });
  }, [selectedType, config, fieldOverrides, hasWorkUnits]);

  // ── Reset on open / close ─────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setSelectedTypeId('');
    setTitle('');
    setDescription('');
    setCustomFields({
      ...(prefilledCustomerId ? { 'field-client': prefilledCustomerId } : {}),
      ...(prefilledSupplierId ? { 'field-supplier': prefilledSupplierId } : {}),
    });
    setInitialComment('');
    setTagsInput('');
    setError(null);
    setValidated(false);
    const defaultZone = prefilledZoneId ?? teamData?.team?.defaultZoneId ?? '';
    setZoneId(defaultZone);
    if (defaultZone && teamData) {
      const first = teamData.stages.filter((s) => s.zoneId === defaultZone).sort((a, b) => a.order - b.order)[0];
      setStageId(first?.id ?? '');
    } else {
      setStageId('');
    }
  }, [teamData, prefilledCustomerId, prefilledSupplierId, prefilledZoneId]);

  useEffect(() => {
    if (!show) resetForm();
  }, [show, resetForm]);

  // Auto-cascade stage when zone changes
  useEffect(() => {
    if (filteredStages.length > 0 && !filteredStages.find((s) => s.id === stageId)) {
      setStageId(filteredStages[0].id);
    } else if (filteredStages.length === 0) {
      setStageId('');
    }
  }, [zoneId, filteredStages]);

  // Focus title input when type is chosen
  useEffect(() => {
    if (selectedTypeId && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [selectedTypeId]);

  // ── Field value helper ────────────────────────────────────────────────────

  const setFieldValue = useCallback((fieldId: string, value: unknown) => {
    setCustomFields((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  // ── Submission ────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidated(true);
    if (!e.currentTarget.checkValidity()) return;
    if (!teamData || !selectedTypeId || !title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const tags = tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // Build the remaining `fields` object (strip mapped ticket-prop fields)
      const remainingFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(customFields)) {
        if (!TICKET_PROP_FIELD_IDS.has(k) && v !== null && v !== undefined && v !== '') {
          remainingFields[k] = v;
        }
      }

      // Extract known field IDs into their canonical ticket properties
      const cfPriority = customFields['field-priority'] as TicketPriority | undefined;
      const cfAssigneeId = customFields['field-assignee'] ? String(customFields['field-assignee']) : null;
      const cfReporterId = customFields['field-reporter'] ? String(customFields['field-reporter']) : null;
      const cfWorkUnitId = customFields['field-work-unit-id'] ? String(customFields['field-work-unit-id']) : null;
      const cfCustomerId = customFields['field-client'] ? String(customFields['field-client']) : null;
      const cfSupplierId = customFields['field-supplier'] ? String(customFields['field-supplier']) : null;
      const cfDueDate = customFields['field-due-date'] ? String(customFields['field-due-date']) : null;
      const cfEffort =
        customFields['field-effort-points'] != null ? Number(customFields['field-effort-points']) : undefined;
      const cfProjectId = customFields['field-project'] ? String(customFields['field-project']) : null;

      const activeStaff = config?.staff ?? [];

      const ticket = await OpsService.createTicket(numaPost, {
        teamId: teamData.team.id,
        ticketTypeId: selectedTypeId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority: cfPriority || 'medium',
        zoneId: zoneId || undefined,
        stageId: stageId || undefined,
        assigneeId: cfAssigneeId,
        assigneeName: cfAssigneeId
          ? (() => {
              const s = activeStaff.find((st) => st.id === cfAssigneeId);
              return s ? s.name || s.email : null;
            })()
          : null,
        reporterId: cfReporterId,
        reporterName: cfReporterId
          ? (() => {
              const s = activeStaff.find((st) => st.id === cfReporterId);
              return s ? s.name || s.email : null;
            })()
          : null,
        customerId: cfCustomerId,
        customerName: cfCustomerId ? (customers.find((c) => c.id === cfCustomerId)?.companyName ?? null) : null,
        supplierId: cfSupplierId,
        supplierName: cfSupplierId ? (suppliers.find((s) => s.id === cfSupplierId)?.companyName ?? null) : null,
        workUnitId: cfWorkUnitId,
        dueDate: cfDueDate,
        effortPoints: isNaN(cfEffort as number) ? undefined : cfEffort,
        projectId: cfProjectId,
        tags: tags.length > 0 ? tags : undefined,
        fields: Object.keys(remainingFields).length > 0 ? remainingFields : undefined,
      });

      // Post initial comment if provided
      if (initialComment.trim()) {
        try {
          await OpsService.createComment(numaPost, ticket.id, { content: initialComment.trim() });
        } catch {
          // Non-fatal — ticket was created successfully
        }
      }

      await refreshTickets();
      refreshCrmData();
      onSuccess(ticket);
      onHide();
    } catch (err) {
      setError(t('errors.saveFailed', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  };

  // ── Phase 1: Type selection ───────────────────────────────────────────────

  if (!selectedTypeId) {
    return (
      <Modal show={show} onHide={onHide} size="xl" centered>
        <Modal.Header closeButton className="border-bottom-0 pb-2">
          <div>
            <h5 className="mb-0 fw-bold" style={{ fontSize: '1.15rem' }}>
              {t('tickets.selectType')}
            </h5>
            <p className="text-muted mb-0 mt-1" style={{ fontSize: '0.875rem' }}>
              {t('tickets.selectTypeHint')}
            </p>
          </div>
        </Modal.Header>

        <Modal.Body className="py-4">
          <div className="d-flex flex-wrap gap-3 justify-content-center px-2">
            {allowedTypes.map((tt) => (
              <button
                key={tt.id}
                type="button"
                onClick={() => setSelectedTypeId(tt.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  padding: '24px 28px',
                  minWidth: 130,
                  border: `2px solid ${tt.color}`,
                  borderRadius: 12,
                  background: '#fff',
                  color: tt.color,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${tt.color}12`;
                  (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 6px 16px ${tt.color}30`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff';
                  (e.currentTarget as HTMLButtonElement).style.transform = 'none';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                }}
              >
                <i className={getTicketTypeIconClass(tt.icon)} style={{ fontSize: '2rem' }} />
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{tt.name}</span>
              </button>
            ))}
          </div>
        </Modal.Body>

        <Modal.Footer className="border-top-0">
          <Button variant="outline-secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  // ── Phase 2: Full form ────────────────────────────────────────────────────

  const typeColor = selectedType?.color ?? '#6c757d';

  return (
    <Modal show={show} onHide={onHide} size="xl" centered>
      <Form noValidate validated={validated} onSubmit={handleSubmit}>
        {/* ── Header: back + type badge + title input ─────────────────── */}
        <Modal.Header closeButton className="flex-column align-items-start pb-1">
          <div className="d-flex align-items-center gap-2 w-100 mb-2">
            {/* Back to type selection */}
            <button
              type="button"
              onClick={() => {
                setSelectedTypeId('');
                setTitle('');
                setCustomFields({});
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                background: '#fff',
                padding: '3px 8px',
                cursor: 'pointer',
                color: '#6b7280',
                fontSize: '0.8rem',
              }}
              title={t('tickets.selectType')}
            >
              <i className="bi bi-chevron-left me-1" />
              {t('tickets.selectType')}
            </button>

            {/* Type badge */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                backgroundColor: `${typeColor}18`,
                color: typeColor,
                border: `1px solid ${typeColor}35`,
                borderRadius: 100,
                padding: '3px 10px',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              {selectedType?.icon && (
                <i className={getTicketTypeIconClass(selectedType.icon)} style={{ fontSize: '0.72rem' }} />
              )}
              {selectedType?.name}
            </span>
          </div>

          {/* Large title input */}
          <Form.Control
            ref={titleInputRef}
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('tickets.title') + '…'}
            style={{
              fontSize: '1.3rem',
              fontWeight: 600,
              border: 'none',
              borderBottom: '2px solid #e5e7eb',
              borderRadius: 0,
              paddingLeft: 0,
              paddingRight: 0,
              boxShadow: 'none',
              width: '100%',
            }}
            className="shadow-none"
          />
          <Form.Control.Feedback type="invalid">{t('common.required')}</Form.Control.Feedback>
        </Modal.Header>

        {/* ── Body: left content + right fields ───────────────────────── */}
        <Modal.Body style={{ padding: '1.25rem 1.5rem', minHeight: 460 }}>
          <Row>
            {/* Left: description + attachments + initial comment ─────── */}
            <Col md={7} style={{ borderRight: '1px solid #f0f0f0', paddingRight: '1.5rem' }}>
              {/* Description */}
              <Form.Group className="mb-4">
                <div className="ticket-section-heading">{t('tickets.description')}</div>
                <RichTextEditor
                  value={description}
                  onSave={(html) => setDescription(html)}
                  placeholder={t('common.description') + '\u2026'}
                  minHeight={140}
                />
              </Form.Group>

              {/* Attachments */}
              <Form.Group className="mb-4">
                <div className="ticket-section-heading">{t('tickets.attachments')}</div>
                <div
                  style={{
                    border: '2px dashed #e5e7eb',
                    borderRadius: 8,
                    padding: '18px',
                    textAlign: 'center',
                    color: '#9ca3af',
                    fontSize: '0.85rem',
                    cursor: 'default',
                  }}
                >
                  <i className="bi bi-paperclip me-1" />
                  {t('tickets.attachmentHint', 'Drop files here or use the detail view to attach')}
                </div>
              </Form.Group>

              {/* Initial comment */}
              <Form.Group className="mb-2">
                <div className="ticket-section-heading">
                  {t('tickets.addComment', 'Add a comment')}
                  <span className="ms-2 fw-normal text-muted" style={{ fontSize: '0.78rem' }}>
                    {t('common.optional', '(optional)')}
                  </span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={initialComment}
                  onChange={(e) => setInitialComment(e.target.value)}
                  placeholder={t('tickets.commentPlaceholder', 'Add an initial comment or note…')}
                  style={{ fontSize: '0.9rem', border: '1px solid #e5e7eb', borderRadius: 8 }}
                />
              </Form.Group>
            </Col>

            {/* Right: sidebar fields matching detail modal layout ─────── */}
            <Col md={5} style={{ paddingLeft: '1.5rem' }}>
              <div className="ticket-detail-sidebar">
                {/* Status — full width dropdown, stages grouped by zone */}
                <div className="ticket-sidebar-section-title">{t('tickets.status')}</div>
                <Form.Select
                  size="sm"
                  value={stageId}
                  onChange={(e) => {
                    const newStageId = e.target.value;
                    const allStages = teamData?.stages ?? [];
                    const stage = allStages.find((s) => s.id === newStageId);
                    setStageId(newStageId);
                    if (stage) setZoneId(stage.zoneId);
                  }}
                  style={{ fontSize: '0.85rem' }}
                >
                  {zones.map((zone) => (
                    <optgroup key={zone.id} label={zone.name}>
                      {(teamData?.stages ?? [])
                        .filter((s) => s.zoneId === zone.id)
                        .sort((a, b) => a.order - b.order)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Form.Select>

                {/* Priority + Assignee — 2 column */}
                <div className="ticket-sidebar-grid-row" style={{ marginTop: 16 }}>
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.priority')}</div>
                    <Form.Select
                      size="sm"
                      value={(customFields['field-priority'] as string) || 'medium'}
                      onChange={(e) => setFieldValue('field-priority', e.target.value)}
                      style={{ fontSize: '0.85rem' }}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {t(`priority.${p}`)}
                        </option>
                      ))}
                    </Form.Select>
                  </div>
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.assignee')}</div>
                    <div className="d-flex align-items-center gap-2">
                      {customFields['field-assignee'] && (
                        <StaffAvatar
                          staff={(config?.staff ?? []).find((s) => s.id === customFields['field-assignee'])}
                          size={28}
                        />
                      )}
                      <Form.Select
                        size="sm"
                        value={(customFields['field-assignee'] as string) || ''}
                        onChange={(e) => setFieldValue('field-assignee', e.target.value || null)}
                        style={{ fontSize: '0.85rem' }}
                      >
                        <option value="">{t('fields.unassigned')}</option>
                        {(config?.staff ?? [])
                          .filter((s) => s.isActive)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.email}
                            </option>
                          ))}
                      </Form.Select>
                    </div>
                  </div>
                </div>

                {/* Reporter — 2 column (second cell empty, mirrors detail modal's Reporter + Created by row) */}
                <div className="ticket-sidebar-grid-row">
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.reporter')}</div>
                    <Form.Select
                      size="sm"
                      value={(customFields['field-reporter'] as string) || ''}
                      onChange={(e) => setFieldValue('field-reporter', e.target.value || null)}
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="">{t('fields.unassigned')}</option>
                      {(config?.staff ?? [])
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </Form.Select>
                  </div>
                  <div />
                </div>

                {/* Due Date + Project — 2 column */}
                <div className="ticket-sidebar-grid-row">
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.dueDate')}</div>
                    <Form.Control
                      type="date"
                      size="sm"
                      value={(customFields['field-due-date'] as string) || ''}
                      onChange={(e) => setFieldValue('field-due-date', e.target.value || null)}
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.project')}</div>
                    <Form.Select
                      size="sm"
                      value={(customFields['field-project'] as string) || ''}
                      onChange={(e) => setFieldValue('field-project', e.target.value || null)}
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="">{t('common.none')}</option>
                      {(config?.projects ?? [])
                        .filter((p) => p.isActive)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Form.Select>
                  </div>
                </div>

                {/* Customer + Supplier — 2 column */}
                <div className="ticket-sidebar-grid-row">
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.customer')}</div>
                    {prefilledCustomerId ? (
                      <div
                        className="form-control form-control-sm text-truncate"
                        style={{ fontSize: '0.85rem', backgroundColor: '#f3f4f6', cursor: 'default', color: '#374151' }}
                        title={prefilledCustomerName ?? prefilledCustomerId}
                      >
                        {prefilledCustomerName ?? prefilledCustomerId}
                      </div>
                    ) : (
                      <Form.Select
                        size="sm"
                        value={(customFields['field-client'] as string) || ''}
                        onChange={(e) => setFieldValue('field-client', e.target.value || null)}
                        style={{ fontSize: '0.85rem' }}
                      >
                        <option value="">{t('common.none')}</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.companyName}
                          </option>
                        ))}
                      </Form.Select>
                    )}
                  </div>
                  <div>
                    <div className="ticket-sidebar-field-label">{t('tickets.supplier')}</div>
                    {prefilledSupplierId ? (
                      <div
                        className="form-control form-control-sm text-truncate"
                        style={{ fontSize: '0.85rem', backgroundColor: '#f3f4f6', cursor: 'default', color: '#374151' }}
                        title={prefilledSupplierName ?? prefilledSupplierId}
                      >
                        {prefilledSupplierName ?? prefilledSupplierId}
                      </div>
                    ) : (
                      <Form.Select
                        size="sm"
                        value={(customFields['field-supplier'] as string) || ''}
                        onChange={(e) => setFieldValue('field-supplier', e.target.value || null)}
                        style={{ fontSize: '0.85rem' }}
                      >
                        <option value="">{t('common.none')}</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.companyName}
                          </option>
                        ))}
                      </Form.Select>
                    )}
                  </div>
                </div>

                {/* Sprint — full width, only if work units enabled */}
                {hasWorkUnits && (
                  <div className="mb-3">
                    <div className="ticket-sidebar-field-label">{t('tickets.workUnit')}</div>
                    <Form.Select
                      size="sm"
                      value={(customFields['field-work-unit-id'] as string) || ''}
                      onChange={(e) => setFieldValue('field-work-unit-id', e.target.value || null)}
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value="">{t('common.none')}</option>
                      {workUnits.map((wu) => (
                        <option key={wu.id} value={wu.id}>
                          {wu.name}
                        </option>
                      ))}
                    </Form.Select>
                  </div>
                )}

                {/* Tags */}
                <div className="mb-3">
                  <div className="ticket-sidebar-field-label">{t('tickets.tags')}</div>
                  <Form.Control
                    size="sm"
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder={t('tickets.tagsHelp')}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>

                {/* Custom / Dynamic Fields (only truly custom fields not rendered above) */}
                {dynamicFields.length > 0 && (
                  <div className="pt-2 border-top">
                    <div className="ticket-sidebar-section-title">{t('fields.dynamicFields')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      {dynamicFields.map((field) => (
                        <div key={field.id}>
                          <DynamicField
                            field={field}
                            value={customFields[field.id] ?? field.defaultValue ?? null}
                            onChange={(val) => setFieldValue(field.id, val)}
                            fieldOverride={fieldOverrides[field.id]}
                            compact
                            staff={config?.staff}
                            customers={customers}
                            suppliers={suppliers}
                            workUnits={workUnits}
                            projects={config?.projects}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Col>
          </Row>

          {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        </Modal.Body>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <Modal.Footer className="border-top" style={{ backgroundColor: '#f9fafb' }}>
          <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={saving || !title.trim()}
            style={{ minWidth: 130, fontWeight: 600 }}
          >
            {saving ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {t('tickets.creating')}
              </>
            ) : (
              t('tickets.create')
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
