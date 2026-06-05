import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Modal, Form, Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAuth } from '../../../Providers/AuthProvider';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { RichTextEditor } from '../Shared/RichTextEditor';
import { uploadAttachmentToTicket } from '../Shared/attachmentUploader';
import { useToast } from '../../../Providers/ToastContext';
import { DynamicField } from '../Shared/DynamicField';
import { SidebarDropdown } from '../Shared/SidebarDropdown';
import type { DropdownOption } from '../Shared/SidebarDropdown';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import {
  getFieldOptionColor,
  isCanonicalPriority,
  resolveBoardFieldList,
  resolveFieldOptions,
} from '../Shared/fieldResolution';
import type {
  Ticket,
  TicketType,
  TicketPriority,
  FieldDefinition,
  FieldOverride,
  Customer,
  Supplier,
} from '../../../types/ops';
import { getTicketTypeIconClass, getPreset } from '../../../constants/opsConstants';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { resolveBoardMembers } from '../Shared/boardMembers';

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
  /** Pre-fill the project (e.g. when creating from a project detail view) */
  prefilledProjectId?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Field IDs rendered outside the right sidebar entirely (title input handles
 * field-name in the header; description textarea handles field-description in
 * the left panel; field-watchers isn't implemented). Everything else goes
 * through the ordered sidebar loop so Board Settings reordering takes effect.
 */
const RENDERED_ELSEWHERE = new Set(['field-name', 'field-description', 'field-watchers']);

/**
 * Field IDs that map directly to top-level ticket payload properties.
 * Their values are extracted from customFields and mapped at submit time
 * rather than being sent inside the `fields` object.
 */
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
  prefilledSupplierId,
  prefilledZoneId,
  prefilledProjectId,
}: CreateTicketModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaPost, numaGet } = useNumaRequest();
  const { user } = useAuth();
  const { config, boardData, workUnits, refreshTickets, refreshCrmData } = useOps();
  const { showToast } = useToast();

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [initialComment, setInitialComment] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Pasted images that exceeded the inline-embed threshold; uploaded as
  // attachments on the new ticket after creation.
  const [pendingPastedAttachments, setPendingPastedAttachments] = useState<File[]>([]);

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

  // Attachment dropzone state — files are buffered locally and uploaded
  // after the ticket is created (presigned URL needs a real ticketId).
  const [dragOver, setDragOver] = useState(false);

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
    if (!config || !boardData?.board) return [];
    const restricted = boardData.board.allowedTicketTypes;
    if (!restricted || restricted.length === 0) {
      return [...config.ticketTypes].sort((a, b) => a.order - b.order);
    }
    const allowed = new Set(restricted);
    return config.ticketTypes.filter((tt) => allowed.has(tt.id)).sort((a, b) => a.order - b.order);
  }, [config, boardData]);

  // Separate into Core vs Additional types based on the Board's preset
  const { coreTypes, additionalTypes } = useMemo(() => {
    const preset = getPreset(boardData?.board?.preset);
    const suggestedPrefixes = new Set(preset.suggestedTicketTypes?.map((st) => st.prefix) || []);

    const core: TicketType[] = [];
    const additional: TicketType[] = [];

    allowedTypes.forEach((tt) => {
      if (suggestedPrefixes.has(tt.prefix)) {
        core.push(tt);
      } else {
        additional.push(tt);
      }
    });

    // Fallback: If no core types matched the preset (e.g. all suggested were deleted), just dump all into core.
    if (core.length === 0) {
      return { coreTypes: additional, additionalTypes: [] };
    }

    return { coreTypes: core, additionalTypes: additional };
  }, [allowedTypes, boardData?.board?.preset]);

  const selectedType: TicketType | undefined = useMemo(
    () => allowedTypes.find((tt) => tt.id === selectedTypeId),
    [allowedTypes, selectedTypeId]
  );

  const zones = useMemo(() => boardData?.zones ?? [], [boardData]);

  const filteredStages = useMemo(() => {
    if (!boardData || !zoneId) return [];
    return boardData.stages.filter((s) => s.zoneId === zoneId).sort((a, b) => a.order - b.order);
  }, [boardData, zoneId]);

  const fieldOverrides: Record<string, FieldOverride> = useMemo(
    () => boardData?.board?.fieldOverrides ?? {},
    [boardData]
  );

  /**
   * Resolved priority options for this board. If the board's priority field
   * override defines custom options (e.g. Ian adds "Tom"), use those. Otherwise
   * fall back to the canonical TicketPriority enum so existing boards keep
   * their familiar list.
   */
  const priorityOptions = useMemo(
    () => resolveFieldOptions(config?.fields, fieldOverrides, 'field-priority'),
    [config?.fields, fieldOverrides]
  );

  /**
   * Dynamic fields for the right panel: ticket type's defaultFields minus
   * system fields (name, description) which are rendered separately on left.
   * Filtered by team field overrides.
   */
  const hasWorkUnits = boardData?.board?.workUnitSeries?.enabled === true;

  // Staff scoped to the current board's membership — used for the Assignee picker.
  const boardMembers = useMemo(
    () => resolveBoardMembers(boardData?.board, config?.staff),
    [boardData?.board, config?.staff]
  );

  const dynamicFields: FieldDefinition[] = useMemo(() => {
    if (!selectedType || !config) return [];
    // Hide sprint when the board doesn't have work units enabled.
    const hiddenWhenNoWorkUnits = new Set(hasWorkUnits ? [] : ['field-work-unit-id']);
    // The board owns its effective list — falls back to template defaults
    // when the board has never touched this ticket type. resolveBoardFieldList
    // handles both the post-FEAT-171 complete-snapshot shape and the legacy
    // "extras on top of defaults" shape transparently. The list IS the order:
    // we no longer consult `fieldOverrides[].order`, since the editor and the
    // sidebar would otherwise drift apart on legacy boards where the old
    // reorder handler wrote `.order` values that the new editor doesn't.
    const ids = resolveBoardFieldList(selectedType, boardData?.board?.addedFields);
    return ids
      .map((fId) => config.fields.find((f) => f.id === fId))
      .filter((f): f is FieldDefinition => {
        if (!f) return false;
        if (RENDERED_ELSEWHERE.has(f.id)) return false;
        if (hiddenWhenNoWorkUnits.has(f.id)) return false;
        if (fieldOverrides[f.id]?.visible === false) return false;
        return true;
      });
  }, [selectedType, config, fieldOverrides, hasWorkUnits, boardData?.board?.addedFields]);

  // ── Reset on open / close ─────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setSelectedTypeId('');
    setTitle('');
    setDescription('');

    const currentUserId = user?.decoded_tokens?.idToken?.sub as string | undefined;

    setCustomFields({
      ...(prefilledCustomerId ? { 'field-client': prefilledCustomerId } : {}),
      ...(prefilledSupplierId ? { 'field-supplier': prefilledSupplierId } : {}),
      ...(prefilledProjectId ? { 'field-project': prefilledProjectId } : {}),
      ...(currentUserId ? { 'field-reporter': currentUserId } : {}),
    });
    setInitialComment('');
    setTagsInput('');
    setPendingPastedAttachments([]);
    setError(null);
    setValidated(false);
    // Resolve a zone that actually exists on the board. defaultZoneId can
    // become stale (e.g. the original default zone was deleted), and without
    // this guard the stage cascade resolves to nothing and the form silently
    // submits with stageId undefined — backend then rejects with a 400.
    const zones = boardData?.zones ?? [];
    const candidateZone = prefilledZoneId ?? boardData?.board?.defaultZoneId ?? '';
    const candidateValid = !!candidateZone && zones.some((z) => z.id === candidateZone);
    const sortedZones = [...zones].sort((a, b) => a.order - b.order);
    const fallbackZone = sortedZones.find((z) => z.zoneType === 'board') ?? sortedZones[0];
    const defaultZone = candidateValid ? candidateZone : (fallbackZone?.id ?? '');
    setZoneId(defaultZone);
    if (defaultZone && boardData) {
      const first = boardData.stages.filter((s) => s.zoneId === defaultZone).sort((a, b) => a.order - b.order)[0];
      setStageId(first?.id ?? '');
    } else {
      setStageId('');
    }
  }, [
    boardData,
    prefilledCustomerId,
    prefilledSupplierId,
    prefilledProjectId,
    prefilledZoneId,
    user?.decoded_tokens?.idToken?.sub,
  ]);

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

  // Pasted image too large to embed inline. Defer it as an attachment that
  // we upload after the ticket is created (the presigned upload + comment
  // path needs a real ticketId).
  const handleLargeImagePaste = useCallback(
    (file: File) => {
      setPendingPastedAttachments((prev) => [...prev, file]);
      showToast({ message: t('tickets.largeImagePastedQueued'), variant: 'info' });
    },
    [showToast, t]
  );

  const removePendingAttachment = useCallback((index: number) => {
    setPendingPastedAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addPendingFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setPendingPastedAttachments((prev) => [...prev, ...Array.from(fileList)]);
  }, []);

  const handleAttachmentDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addPendingFiles(e.dataTransfer.files);
    },
    [addPendingFiles]
  );

  // ── Submission ────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidated(true);
    if (!e.currentTarget.checkValidity()) return;
    if (!boardData || !selectedTypeId || !title.trim()) return;

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

      // Extract known field IDs into their canonical ticket properties.
      // Priority is dual-tracked: canonical values (highest/high/medium/low/lowest)
      // go on the enum `priority` column; board-defined custom values (e.g. Ian's
      // "Tom") go in `fields['field-priority']` so the dropdown can re-render them.
      const rawPriority = customFields['field-priority'] as string | undefined;
      const cfPriority: TicketPriority = isCanonicalPriority(rawPriority) ? rawPriority : 'medium';
      if (rawPriority && !isCanonicalPriority(rawPriority)) {
        remainingFields['field-priority'] = rawPriority;
      }
      const cfAssigneeId = customFields['field-assignee'] ? String(customFields['field-assignee']) : null;
      const currentUserSub = user?.decoded_tokens?.idToken?.sub ?? null;
      const cfReporterId = customFields['field-reporter'] ? String(customFields['field-reporter']) : currentUserSub;
      const cfWorkUnitId = customFields['field-work-unit-id'] ? String(customFields['field-work-unit-id']) : null;
      const cfCustomerId = customFields['field-client'] ? String(customFields['field-client']) : null;
      const cfSupplierId = customFields['field-supplier'] ? String(customFields['field-supplier']) : null;
      const cfDueDate = customFields['field-due-date'] ? String(customFields['field-due-date']) : null;
      const cfEffort =
        customFields['field-effort-points'] != null ? Number(customFields['field-effort-points']) : undefined;
      const cfProjectId = customFields['field-project'] ? String(customFields['field-project']) : null;

      const activeStaff = config?.staff ?? [];

      const ticket = await OpsService.createTicket(numaPost, {
        boardId: boardData.board.id,
        ticketTypeId: selectedTypeId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority: cfPriority,
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

      // Upload any images that were too large to embed inline as ticket
      // attachments. Failures here are non-fatal: the ticket exists and the
      // user can re-attach manually from the detail view.
      if (pendingPastedAttachments.length > 0) {
        const failures: string[] = [];
        for (const file of pendingPastedAttachments) {
          try {
            await uploadAttachmentToTicket(numaPost, ticket.id, file);
          } catch {
            failures.push(file.name);
          }
        }
        if (failures.length > 0) {
          showToast({
            message: t('errors.pendingAttachmentsFailed', { files: failures.join(', ') }),
            variant: 'error',
          });
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
      <Modal show={show} onHide={onHide} size="lg" centered>
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
            {coreTypes.map((tt) => (
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

          {additionalTypes.length > 0 && (
            <>
              <div
                className="d-flex align-items-center justify-content-center my-4"
                style={{ color: '#9ca3af', fontSize: '0.85rem' }}
              >
                <div style={{ flex: 1, height: 1, backgroundColor: '#eaebed', maxWidth: 100 }} />
                <span className="mx-3">{t('tickets.moreOptions', 'More options')}</span>
                <div style={{ flex: 1, height: 1, backgroundColor: '#eaebed', maxWidth: 100 }} />
              </div>

              <div className="d-flex flex-wrap gap-2 justify-content-center px-2">
                {additionalTypes.map((tt) => (
                  <button
                    key={tt.id}
                    type="button"
                    onClick={() => setSelectedTypeId(tt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      border: `1px solid ${tt.color}40`,
                      borderRadius: 20,
                      background: '#fff',
                      color: tt.color,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      fontFamily: 'inherit',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${tt.color}12`;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff';
                    }}
                  >
                    <i className={getTicketTypeIconClass(tt.icon)} style={{ fontSize: '1rem' }} />
                    <span>{tt.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Modal.Body>

        <Modal.Footer className="border-top-0" style={{ backgroundColor: '#f9fafb' }}>
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
    <Modal show={show} onHide={onHide} size="xl" centered dialogClassName="ticket-detail-modal">
      <Form
        noValidate
        validated={validated}
        onSubmit={handleSubmit}
        className="d-flex flex-column"
        style={{ overflow: 'hidden', flex: 1, minHeight: 0 }}
      >
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
        <Modal.Body className="d-flex flex-column" style={{ padding: '1.25rem 1.5rem', overflow: 'hidden', flex: 1 }}>
          <div className="d-flex" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Left: description + attachments + initial comment ─────── */}
            <div className="ticket-detail-left-col">
              {/* Description — the editor is self-evidently the description, so
                  no section heading (matches the ticket detail modal). */}
              <Form.Group className="ticket-detail-section">
                <RichTextEditor
                  value={description}
                  onChange={(html) => setDescription(html)}
                  onSave={(html) => setDescription(html)}
                  onLargeImagePaste={handleLargeImagePaste}
                  placeholder={t('common.description') + '\u2026'}
                  minHeight={140}
                />
              </Form.Group>

              {/* Attachments */}
              <Form.Group className="ticket-detail-section">
                <div className="ticket-section-heading">
                  <i className="bi bi-paperclip me-2" />
                  {t('tickets.attachments')}
                </div>
                {pendingPastedAttachments.length > 0 ? (
                  <div
                    className="d-flex flex-wrap gap-2 align-items-center"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleAttachmentDrop}
                    style={dragOver ? { outline: '2px dashed #6366f1', borderRadius: 8, outlineOffset: 2 } : undefined}
                  >
                    {pendingPastedAttachments.map((file, i) => (
                      <span
                        key={`${file.name}-${i}`}
                        className="d-inline-flex align-items-center gap-2"
                        style={{
                          background: '#eef2ff',
                          color: '#4338ca',
                          borderRadius: 999,
                          padding: '4px 10px',
                          fontSize: '0.8rem',
                        }}
                        title={`${file.name} \u2014 ${(file.size / 1024).toFixed(0)} KB`}
                      >
                        <i className="bi bi-paperclip" />
                        {file.name}
                        <button
                          type="button"
                          aria-label={t('common.remove', 'Remove')}
                          onClick={() => removePendingAttachment(i)}
                          style={{
                            background: 'transparent',
                            border: 0,
                            color: '#4338ca',
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          <i className="bi bi-x-lg" />
                        </button>
                      </span>
                    ))}
                    <label
                      htmlFor="ticket-create-attachment-input"
                      className="d-inline-flex align-items-center gap-1 mb-0"
                      style={{
                        background: 'transparent',
                        border: '1px dashed var(--ops-border)',
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        color: '#6b7280',
                        cursor: 'pointer',
                      }}
                    >
                      <i className="bi bi-plus-lg" />
                      {t('common.add', 'Add')}
                    </label>
                    <input
                      id="ticket-create-attachment-input"
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        addPendingFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                ) : (
                  <label
                    htmlFor="ticket-create-attachment-input"
                    className="ops-attachment-empty-zone d-block mb-0"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleAttachmentDrop}
                    style={dragOver ? { borderColor: '#6366f1', background: '#eef2ff' } : undefined}
                  >
                    <i
                      className="bi bi-paperclip"
                      style={{ fontSize: '1.25rem', color: '#9ca3af', display: 'block', marginBottom: 4 }}
                    />
                    <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                      {t('tickets.dropOrAttach', 'Drop files here or click to attach')}
                    </span>
                    <input
                      id="ticket-create-attachment-input"
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        addPendingFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </Form.Group>

              {/* Initial comment */}
              <Form.Group className="ticket-detail-section">
                <div className="ticket-section-heading">
                  <i className="bi bi-chat-dots me-2" />
                  {t('tickets.initialComment', 'Initial comment')}
                  <span className="ms-2 fw-normal text-muted" style={{ fontSize: '0.78rem' }}>
                    {t('common.optional', '(optional)')}
                  </span>
                </div>
                <RichTextEditor
                  value={initialComment}
                  onChange={(html) => setInitialComment(html)}
                  onSave={(html) => setInitialComment(html)}
                  placeholder={t('tickets.commentPlaceholder', 'Add an initial comment or note…')}
                  minHeight={100}
                />
              </Form.Group>
            </div>

            {/* Right: sidebar fields matching detail modal layout ─────── */}
            <div className="ticket-detail-right-col">
              <div className="ticket-detail-sidebar">
                {/* Status */}
                <div style={{ padding: '12px 14px 6px' }}>
                  <div className="ticket-sidebar-field-label">{t('tickets.status')}</div>
                  <Form.Select
                    size="sm"
                    value={stageId}
                    onChange={(e) => {
                      const newStageId = e.target.value;
                      const allStages = boardData?.stages ?? [];
                      const stage = allStages.find((s) => s.id === newStageId);
                      setStageId(newStageId);
                      if (stage) setZoneId(stage.zoneId);
                    }}
                  >
                    {zones.map((zone) => (
                      <optgroup key={zone.id} label={zone.name}>
                        {(boardData?.stages ?? [])
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
                </div>

                <div style={{ padding: '0 14px 10px' }}>
                  {/* Every field renders in the order set in Board Settings —
                      system fields get their rich UI; anything else falls
                      through to DynamicField. The label always comes from the
                      field's own `name` (with board override.label taking
                      precedence) so the modal matches Board Settings exactly. */}
                  {dynamicFields.map((field) => {
                    const override = fieldOverrides[field.id];
                    const label = override?.label?.trim() || field.name;
                    switch (field.id) {
                      case 'field-priority':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-priority'] as string) || 'medium'}
                              onChange={(val) => setFieldValue('field-priority', val)}
                              options={priorityOptions.map((p) => ({
                                value: p,
                                label: isCanonicalPriority(p) ? t(`priority.${p}`) : p,
                                icon: (
                                  <span
                                    style={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: '50%',
                                      backgroundColor: getFieldOptionColor('field-priority', p),
                                      display: 'inline-block',
                                      flexShrink: 0,
                                    }}
                                  />
                                ),
                              }))}
                              renderValue={(opt) => {
                                const currentRaw = (customFields['field-priority'] as string) || 'medium';
                                return (
                                  <>
                                    {isCanonicalPriority(currentRaw) ? (
                                      <PriorityIndicator priority={currentRaw} />
                                    ) : (
                                      <span
                                        style={{
                                          width: 12,
                                          height: 12,
                                          borderRadius: '50%',
                                          backgroundColor: getFieldOptionColor('field-priority', currentRaw),
                                          display: 'inline-block',
                                          flexShrink: 0,
                                        }}
                                      />
                                    )}
                                    <span>{opt?.label ?? currentRaw}</span>
                                  </>
                                );
                              }}
                            />
                          </div>
                        );
                      case 'field-assignee':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-assignee'] as string) || ''}
                              onChange={(val) => setFieldValue('field-assignee', val || null)}
                              options={[
                                { value: '', label: t('fields.unassigned') },
                                ...boardMembers
                                  .filter((s) => s.isActive)
                                  .map(
                                    (s): DropdownOption => ({
                                      value: s.id,
                                      label: s.name || s.email,
                                      icon: <StaffAvatar staff={s} size={22} />,
                                    })
                                  ),
                              ]}
                              renderValue={() => {
                                const assignee = customFields['field-assignee']
                                  ? (config?.staff ?? []).find((s) => s.id === customFields['field-assignee'])
                                  : undefined;
                                return (
                                  <>
                                    <StaffAvatar staff={assignee} size={28} />
                                    <span
                                      className={!customFields['field-assignee'] ? 'sidebar-dropdown-placeholder' : ''}
                                    >
                                      {assignee?.name || assignee?.email || t('fields.unassigned')}
                                    </span>
                                  </>
                                );
                              }}
                            />
                          </div>
                        );
                      case 'field-reporter':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-reporter'] as string) || ''}
                              onChange={(val) => setFieldValue('field-reporter', val || null)}
                              options={[
                                { value: '', label: t('fields.unassigned') },
                                ...(config?.staff ?? [])
                                  .filter((s) => s.isActive)
                                  .map(
                                    (s): DropdownOption => ({
                                      value: s.id,
                                      label: s.name || s.email,
                                      icon: <StaffAvatar staff={s} size={22} />,
                                    })
                                  ),
                              ]}
                              renderValue={() => {
                                const reporter = customFields['field-reporter']
                                  ? (config?.staff ?? []).find((s) => s.id === customFields['field-reporter'])
                                  : undefined;
                                return (
                                  <>
                                    <StaffAvatar staff={reporter} size={28} />
                                    <span
                                      className={!customFields['field-reporter'] ? 'sidebar-dropdown-placeholder' : ''}
                                    >
                                      {reporter?.name || reporter?.email || t('fields.unassigned')}
                                    </span>
                                  </>
                                );
                              }}
                            />
                          </div>
                        );
                      case 'field-due-date':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <Form.Control
                              type="date"
                              size="sm"
                              value={(customFields['field-due-date'] as string) || ''}
                              onChange={(e) => setFieldValue('field-due-date', e.target.value || null)}
                            />
                          </div>
                        );
                      case 'field-project':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-project'] as string) || ''}
                              onChange={(val) => setFieldValue('field-project', val || null)}
                              options={[
                                { value: '', label: t('common.none') },
                                ...(config?.projects ?? [])
                                  .filter(
                                    (p) =>
                                      p.isActive &&
                                      (!p.boardIds?.length || p.boardIds.includes(boardData?.board?.id ?? ''))
                                  )
                                  .map(
                                    (p): DropdownOption => ({
                                      value: p.id,
                                      label: p.name,
                                      icon: (
                                        <i
                                          className="bi bi-folder"
                                          style={{ fontSize: '0.78rem', color: p.color || '#6d28d9' }}
                                        />
                                      ),
                                    })
                                  ),
                              ]}
                              renderValue={(opt) => {
                                if (!opt?.value)
                                  return <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>;
                                const proj = (config?.projects ?? []).find((p) => p.id === opt.value);
                                const pColor = proj?.color || '#6d28d9';
                                return (
                                  <span
                                    className="ticket-badge ticket-badge-project"
                                    style={{
                                      margin: 0,
                                      backgroundColor: `${pColor}18`,
                                      color: pColor,
                                      borderColor: `${pColor}30`,
                                    }}
                                  >
                                    <i className="bi bi-folder me-1" />
                                    {opt.label}
                                  </span>
                                );
                              }}
                            />
                          </div>
                        );
                      case 'field-client':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-client'] as string) || ''}
                              onChange={(val) => setFieldValue('field-client', val || null)}
                              disabled={!!prefilledCustomerId}
                              options={[
                                { value: '', label: t('common.none') },
                                ...customers.map(
                                  (c): DropdownOption => ({
                                    value: c.id,
                                    label: c.companyName,
                                    icon: (
                                      <i className="bi bi-building" style={{ fontSize: '0.78rem', color: '#1d4ed8' }} />
                                    ),
                                  })
                                ),
                              ]}
                              renderValue={(opt) =>
                                opt?.value ? (
                                  <span className="ticket-badge ticket-badge-customer" style={{ margin: 0 }}>
                                    <i className="bi bi-building me-1" />
                                    {opt.label}
                                  </span>
                                ) : (
                                  <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>
                                )
                              }
                            />
                          </div>
                        );
                      case 'field-supplier':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-supplier'] as string) || ''}
                              onChange={(val) => setFieldValue('field-supplier', val || null)}
                              disabled={!!prefilledSupplierId}
                              options={[
                                { value: '', label: t('common.none') },
                                ...suppliers.map(
                                  (s): DropdownOption => ({
                                    value: s.id,
                                    label: s.companyName,
                                    icon: (
                                      <i className="bi bi-truck" style={{ fontSize: '0.78rem', color: '#c2410c' }} />
                                    ),
                                  })
                                ),
                              ]}
                              renderValue={(opt) =>
                                opt?.value ? (
                                  <span className="ticket-badge ticket-badge-supplier" style={{ margin: 0 }}>
                                    <i className="bi bi-truck me-1" />
                                    {opt.label}
                                  </span>
                                ) : (
                                  <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>
                                )
                              }
                            />
                          </div>
                        );
                      case 'field-work-unit-id':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <SidebarDropdown
                              value={(customFields['field-work-unit-id'] as string) || ''}
                              onChange={(val) => setFieldValue('field-work-unit-id', val || null)}
                              options={[
                                { value: '', label: t('common.none') },
                                ...workUnits.map(
                                  (wu): DropdownOption => ({
                                    value: wu.id,
                                    label: wu.name,
                                    icon: (
                                      <i className="bi bi-flag" style={{ fontSize: '0.78rem', color: '#065f46' }} />
                                    ),
                                  })
                                ),
                              ]}
                              renderValue={(opt) =>
                                opt?.value ? (
                                  <span className="ticket-badge ticket-badge-sprint" style={{ margin: 0 }}>
                                    <i
                                      className="bi bi-circle-fill me-1"
                                      style={{ fontSize: '0.28rem', verticalAlign: 'middle' }}
                                    />
                                    {opt.label}
                                  </span>
                                ) : (
                                  <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>
                                )
                              }
                            />
                          </div>
                        );
                      case 'field-labels':
                        return (
                          <div key={field.id} className="ticket-sidebar-field">
                            <div className="ticket-sidebar-field-label">{label}</div>
                            <Form.Control
                              size="sm"
                              type="text"
                              value={tagsInput}
                              onChange={(e) => setTagsInput(e.target.value)}
                              placeholder={t('tickets.tagsHelp')}
                            />
                          </div>
                        );
                      default:
                        return (
                          <DynamicField
                            key={field.id}
                            field={field}
                            value={customFields[field.id] ?? field.defaultValue ?? null}
                            onChange={(val) => setFieldValue(field.id, val)}
                            fieldOverride={fieldOverrides[field.id]}
                            ticketValues={customFields}
                            compact
                            staff={config?.staff}
                            customers={customers}
                            suppliers={suppliers}
                            workUnits={workUnits}
                            projects={config?.projects}
                          />
                        );
                    }
                  })}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="alert alert-danger mt-3 mb-0" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
              {error}
            </div>
          )}
        </Modal.Body>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <Modal.Footer className="border-top" style={{ backgroundColor: '#f9fafb', flexShrink: 0 }}>
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
