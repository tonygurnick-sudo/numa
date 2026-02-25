import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type {
  Ticket,
  TicketLink,
  TicketPriority,
  TicketType,
  FieldDefinition,
  Customer,
  Supplier,
} from '../../../types/ops';
import { CommentSection } from '../Shared/CommentSection';
import { LinkedTicketsSection } from '../Shared/LinkedTicketsSection';
import { AttachmentsSection } from '../Shared/AttachmentsSection';
import { RichTextEditor } from '../Shared/RichTextEditor';
import type { RichTextEditorHandle } from '../Shared/RichTextEditor';
import { DynamicField } from '../Shared/DynamicField';
import { ConfirmModal } from './ConfirmModal';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { StaffAvatar } from '../Shared/StaffAvatar';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TicketDetailModalProps {
  show: boolean;
  ticketId: string | null;
  onHide: () => void;
  onDeleted?: () => void;
  teamIdOverride?: string | null;
}

// ─── Priority Options ───────────────────────────────────────────────────────

const PRIORITY_OPTIONS: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats an ISO date string to a locale-friendly display string.
 * Returns a dash if the value is null or undefined.
 */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats an ISO date string to a compact display string (no time component).
 * Used for the lifecycle dates strip.
 */
function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Formats an ISO date string to an input[type=date]-compatible YYYY-MM-DD value.
 */
function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Returns a short relative time for audit entries like "2h ago" or "3d ago".
 */
function relativeTimeShort(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${String(days)}d ago`;
  if (hours > 0) return `${String(hours)}h ago`;
  if (minutes > 0) return `${String(minutes)}m ago`;
  return 'just now';
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * TicketDetailModal is a large detail view for viewing and inline-editing a ticket.
 *
 * It loads the full ticket data (including comments and links) on mount, and
 * provides inline editing for all mutable fields. Optimistic locking is enforced
 * by passing `version` with every update call.
 *
 * Layout:
 * - Header: display ID badge, ticket type icon, inline-editable title, close button
 * - Body: 2-column layout
 *   - Left (~65%): tabbed area with Description, Comments, Links, History
 *   - Right (~35%): sidebar with inline-editable fields
 * - Footer: lifecycle dates row
 */
export function TicketDetailModal({
  show,
  ticketId,
  onHide,
  onDeleted,
  teamIdOverride = null,
}: TicketDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut, numaDelete } = useNumaRequest();
  const [archiving, setArchiving] = useState(false);
  const { config, teamData, workUnits, refreshTickets, refreshCrmData } = useOps();

  // ── Core state ──────────────────────────────────────────────────────────
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // ── CRM lists for selector dropdowns ───────────────────────────────────

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Share / copy link feedback ────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ── Ref for title input auto-focus ──────────────────────────────────────
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionEditorRef = useRef<RichTextEditorHandle>(null);

  // ── Derived data ────────────────────────────────────────────────────────
  const ticketType: TicketType | undefined = ticket
    ? config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId)
    : undefined;

  const team = teamData?.team ?? null;
  const effectiveTeamId = teamIdOverride ?? team?.id ?? null;

  // ── Load ticket ─────────────────────────────────────────────────────────

  const loadTicket = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await OpsService.getTicket(numaGet, ticketId, effectiveTeamId ?? undefined);
      setTicket(response.ticket);
      setLinks(response.links ?? []);
    } catch (err) {
      console.error('[TicketDetailModal] Failed to load ticket', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [numaGet, ticketId, effectiveTeamId]);

  useEffect(() => {
    if (show && ticketId) {
      void loadTicket();
      // Load CRM lists for selector dropdowns
      void OpsService.listCustomers(numaGet)
        .then(setCustomers)
        .catch(() => {
          /* non-fatal */
        });
      void OpsService.listSuppliers(numaGet)
        .then(setSuppliers)
        .catch(() => {
          /* non-fatal */
        });
      // Reset editing states when opening
      setEditingTitle(false);
      setEditingTags(false);
    }
    if (!show) {
      setTicket(null);
      setLinks([]);
      setError(null);
      setCustomers([]);
      setSuppliers([]);
    }
  }, [show, ticketId, loadTicket, numaGet]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;

    const loadCrmEntities = async () => {
      try {
        const [customersResponse, suppliersResponse] = await Promise.all([
          OpsService.listCustomers(numaGet),
          OpsService.listSuppliers(numaGet),
        ]);
        if (cancelled) return;
        setCustomers(customersResponse);
        setSuppliers(suppliersResponse);
      } catch (err) {
        console.error('[TicketDetailModal] Failed to load CRM entities', err);
      }
    };

    void loadCrmEntities();

    return () => {
      cancelled = true;
    };
  }, [show, numaGet]);

  // ── Auto-focus title input ──────────────────────────────────────────────

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // ── Generic update handler with optimistic locking ──────────────────────

  const handleUpdate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!ticket || !ticketId) return;
      setSaving(true);
      try {
        const updated = await OpsService.updateTicket(numaPut, ticketId, {
          ...payload,
          teamId: ticket.teamId,
          version: ticket.version,
        });
        setTicket(updated);
        void refreshTickets();
        const crmImpactingKeys = ['customerId', 'supplierId', 'statusType', 'stageId', 'archived'] as const;
        if (crmImpactingKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
          refreshCrmData();
        }
      } catch (err: unknown) {
        // Check for 409 conflict
        const isConflict = err instanceof Error && (err.message.includes('409') || err.message.includes('conflict'));
        if (isConflict) {
          window.alert(t('tickets.conflictMessage'));
          void loadTicket();
        } else {
          console.error('[TicketDetailModal] Update failed', err);
        }
      } finally {
        setSaving(false);
      }
    },
    [ticket, ticketId, numaPut, refreshTickets, refreshCrmData, loadTicket, t],
  );

  // ── Title editing handlers ──────────────────────────────────────────────

  const startEditTitle = () => {
    if (!ticket) return;
    setTitleDraft(ticket.title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === ticket?.title) {
      setEditingTitle(false);
      return;
    }
    await handleUpdate({ title: trimmed });
    setEditingTitle(false);
  };

  const cancelTitle = () => {
    setEditingTitle(false);
  };

  // ── Tags editing handlers ──────────────────────────────────────────────

  const startEditTags = () => {
    if (!ticket) return;
    setTagsDraft(ticket.tags.join(', '));
    setEditingTags(true);
  };

  const saveTags = async () => {
    const newTags = tagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    await handleUpdate({ tags: newTags });
    setEditingTags(false);
  };

  const cancelTags = () => {
    setEditingTags(false);
  };

  // ── Archive handler ──────────────────────────────────────────────────

  const handleToggleArchive = async () => {
    if (!ticket || !ticketId) return;
    setArchiving(true);
    try {
      const updated = ticket.archived
        ? await OpsService.unarchiveTicket(numaPut, ticketId, ticket.version)
        : await OpsService.archiveTicket(numaPut, ticketId, ticket.version);
      setTicket(updated);
      void refreshTickets();
      refreshCrmData();
    } catch (err) {
      console.error('[TicketDetailModal] Archive toggle failed', err);
    } finally {
      setArchiving(false);
    }
  };

  // ── Delete handler ────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!ticketId) return;
    try {
      await OpsService.deleteTicket(numaDelete, ticketId, team?.id);
      setShowDeleteConfirm(false);
      onDeleted?.();
      onHide();
      void refreshTickets();
      refreshCrmData();
    } catch (err) {
      console.error('[TicketDetailModal] Delete failed', err);
    }
  };

  // ── Reload ticket (for linked tickets refresh) ────────────────────────

  const reloadTicket = useCallback(() => {
    void loadTicket();
  }, [loadTicket]);

  // ── Custom field update handler ───────────────────────────────────────

  const handleCustomFieldChange = useCallback(
    async (fieldId: string, value: unknown) => {
      if (!ticket) return;
      const updatedFields = { ...(ticket.fields ?? {}), [fieldId]: value };
      await handleUpdate({ fields: updatedFields });
    },
    [ticket, handleUpdate],
  );

  // ── Get ticket type fields with overrides ─────────────────────────────

  const getVisibleFields = useCallback((): {
    field: FieldDefinition;
    override: { visible: boolean; required: boolean } | undefined;
  }[] => {
    if (!ticketType || !config) return [];
    const fieldOverrides = team?.fieldOverrides ?? {};
    const hasWorkUnits = team?.workUnitSeries?.enabled === true;

    // Fields that already have dedicated sidebar rows or are rendered elsewhere.
    // These are excluded from "Additional Fields" to prevent duplication.
    const excluded = new Set([
      'field-name', // title in modal header
      'field-description', // description tab
      'field-priority', // Priority sidebar row
      'field-assignee', // Assignee sidebar row
      'field-reporter', // Reporter sidebar row
      'field-due-date', // Due Date sidebar row
      'field-project', // Project sidebar row
      'field-client', // Customer sidebar row
      'field-supplier', // Supplier sidebar row
      'field-labels', // Tags sidebar row
      'field-watchers', // not yet implemented
      // Hide sprint & effort when work units are not enabled for this team
      ...(!hasWorkUnits ? ['field-work-unit-id', 'field-effort-points'] : []),
    ]);

    return ticketType.defaultFields
      .map((fieldId) => {
        if (excluded.has(fieldId)) return null;
        const field = config.fields.find((f) => f.id === fieldId);
        if (!field) return null;
        const override = fieldOverrides[fieldId];
        if (override?.visible === false) return null;
        return { field, override };
      })
      .filter(
        (item): item is { field: FieldDefinition; override: { visible: boolean; required: boolean } | undefined } =>
          item !== null,
      );
  }, [ticketType, config, team]);

  // ── Render: Loading state ─────────────────────────────────────────────

  if (!show) return <></>;

  const renderLoading = () => (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 300 }}>
      <Spinner animation="border" />
    </div>
  );

  const renderError = () => (
    <div className="text-center py-5">
      <p className="text-danger">{t('errors.loadFailed', { message: error ?? '' })}</p>
      <Button variant="outline-primary" size="sm" onClick={() => void loadTicket()}>
        {t('common.loading')}
      </Button>
    </div>
  );

  // ── Render: Lifecycle dates strip ────────────────────────────────────────

  const renderLifecycleDates = () => {
    if (!ticket) return null;

    const events: { label: string; date: string | null | undefined }[] = [
      { label: t('tickets.created'), date: ticket.createdAt },
      { label: t('tickets.scoped'), date: ticket.scopedAt },
      { label: t('tickets.started'), date: ticket.startedAt },
      { label: t('tickets.completed'), date: ticket.completedAt },
      { label: t('tickets.ended'), date: ticket.endedAt },
    ];

    return (
      <div
        className="d-flex align-items-center gap-3 flex-wrap border-top px-3"
        style={{
          backgroundColor: '#f9fafb',
          fontSize: '0.72rem',
          color: '#6b7280',
          flexShrink: 0,
          paddingTop: 7,
          paddingBottom: 7,
        }}
      >
        {events.map(({ label, date }) => (
          <div key={label} className="d-flex align-items-center gap-1">
            <span style={{ fontWeight: 600 }}>{label}:</span>
            <span>{formatDateShort(date)}</span>
          </div>
        ))}
        {ticket.createdByName && (
          <div className="d-flex align-items-center gap-1 ms-auto">
            <i className="bi bi-person" />
            <span>{ticket.createdByName}</span>
            <span style={{ opacity: 0.7 }}>· {relativeTimeShort(ticket.createdAt)}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Render: Sidebar ───────────────────────────────────────────────────

  const renderSidebar = () => {
    if (!ticket || !config) return null;

    const staff = config.staff;
    const projects = config.projects;
    const hasWorkUnits = team?.workUnitSeries?.enabled === true;
    const allZones = teamData?.zones ?? [];
    const allStages = teamData?.stages ?? [];
    const selectStyle: React.CSSProperties = { fontSize: '0.85rem' };

    return (
      <div style={{ fontSize: '0.875rem' }}>
        {/* Status — full width */}
        <div className="ticket-sidebar-section-title">{t('tickets.status')}</div>
        <Form.Select
          size="sm"
          value={ticket.stageId}
          onChange={(e) => {
            const newStageId = e.target.value;
            const stage = allStages.find((s) => s.id === newStageId);
            void handleUpdate({ stageId: newStageId, zoneId: stage?.zoneId });
          }}
          style={selectStyle}
        >
          {allZones.map((zone) => (
            <optgroup key={zone.id} label={zone.name}>
              {allStages
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

        {/* Priority */}
        <div style={{ marginTop: 16, marginBottom: 12 }}>
          <div className="ticket-sidebar-field-label">{t('tickets.priority')}</div>
          <Form.Select
            size="sm"
            value={ticket.priority}
            onChange={(e) => void handleUpdate({ priority: e.target.value as TicketPriority })}
            style={selectStyle}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Form.Select>
        </div>

        {/* Assignee — full width row with avatar */}
        <div style={{ marginBottom: 12 }}>
          <div className="ticket-sidebar-field-label">{t('tickets.assignee')}</div>
          <div className="d-flex align-items-center gap-2">
            <StaffAvatar
              staff={ticket.assigneeId ? staff.find((s) => s.id === ticket.assigneeId) : undefined}
              name={ticket.assigneeName}
              size={28}
            />
            <Form.Select
              size="sm"
              value={ticket.assigneeId ?? ''}
              onChange={(e) => void handleUpdate({ assigneeId: e.target.value || null })}
              style={selectStyle}
            >
              <option value="">{t('fields.unassigned')}</option>
              {staff
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.email}
                  </option>
                ))}
            </Form.Select>
          </div>
        </div>

        {/* Reporter — full width row with avatar */}
        <div style={{ marginBottom: 12 }}>
          <div className="ticket-sidebar-field-label">{t('tickets.reporter')}</div>
          <div className="d-flex align-items-center gap-2">
            <StaffAvatar
              staff={ticket.reporterId ? (config?.staff ?? []).find((s) => s.id === ticket.reporterId) : undefined}
              name={ticket.reporterName}
              size={28}
            />
            <Form.Select
              size="sm"
              value={ticket.reporterId ?? ''}
              onChange={(e) => {
                const selectedStaff = config?.staff.find((s) => s.id === e.target.value);
                void handleUpdate({
                  reporterId: e.target.value || null,
                  reporterName: selectedStaff?.name || selectedStaff?.email || null,
                });
              }}
              style={selectStyle}
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

        {/* Created by */}
        <div style={{ marginBottom: 12 }}>
          <div className="ticket-sidebar-field-label">{t('tickets.createdBy')}</div>
          <span style={{ fontSize: '0.85rem', display: 'block', paddingTop: 6 }}>{ticket.createdByName}</span>
        </div>

        {/* Due Date + Project — 2 column */}
        <div className="ticket-sidebar-grid-row">
          <div>
            <div className="ticket-sidebar-field-label">{t('tickets.dueDate')}</div>
            <Form.Control
              type="date"
              size="sm"
              value={toDateInputValue(ticket.dueDate)}
              onChange={(e) => void handleUpdate({ dueDate: e.target.value || null })}
              style={selectStyle}
            />
          </div>
          <div>
            <div className="ticket-sidebar-field-label">{t('tickets.project')}</div>
            <Form.Select
              size="sm"
              value={ticket.projectId ?? ''}
              onChange={(e) => void handleUpdate({ projectId: e.target.value || null })}
              style={selectStyle}
            >
              <option value="">{t('common.none')}</option>
              {projects
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
            <Form.Select
              size="sm"
              value={ticket.customerId ?? ''}
              onChange={(e) => {
                const selected = customers.find((c) => c.id === e.target.value);
                void handleUpdate({
                  customerId: e.target.value || null,
                  customerName: selected?.companyName ?? null,
                });
              }}
              style={selectStyle}
            >
              <option value="">{t('common.none')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </Form.Select>
          </div>
          <div>
            <div className="ticket-sidebar-field-label">{t('tickets.supplier')}</div>
            <Form.Select
              size="sm"
              value={ticket.supplierId ?? ''}
              onChange={(e) => {
                const selected = suppliers.find((s) => s.id === e.target.value);
                void handleUpdate({
                  supplierId: e.target.value || null,
                  supplierName: selected?.companyName ?? null,
                });
              }}
              style={selectStyle}
            >
              <option value="">{t('common.none')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName}
                </option>
              ))}
            </Form.Select>
          </div>
        </div>

        {/* Sprint — full width (only if work units enabled) */}
        {hasWorkUnits && (
          <div className="mb-3">
            <div className="ticket-sidebar-field-label">{t('tickets.workUnit')}</div>
            <Form.Select
              size="sm"
              value={ticket.workUnitId ?? ''}
              onChange={(e) => void handleUpdate({ workUnitId: e.target.value || null })}
              style={selectStyle}
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
        <div
          className="mb-3"
          style={{ cursor: editingTags ? 'default' : 'pointer' }}
          onClick={editingTags ? undefined : startEditTags}
          role={editingTags ? undefined : 'button'}
          tabIndex={editingTags ? undefined : 0}
          onKeyDown={
            editingTags
              ? undefined
              : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') startEditTags();
                }
          }
        >
          <div className="ticket-sidebar-field-label">{t('tickets.tags')}</div>
          {editingTags ? (
            <Form.Control
              type="text"
              size="sm"
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTags();
                if (e.key === 'Escape') cancelTags();
              }}
              onBlur={() => void saveTags()}
              style={{ fontSize: '0.85rem' }}
              autoFocus
            />
          ) : (
            <div className="d-flex flex-wrap gap-1">
              {ticket.tags.length > 0 ? (
                ticket.tags.map((tag) => (
                  <Badge key={tag} bg="light" text="dark" className="border" style={{ fontSize: '0.75rem' }}>
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {t('common.none')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Custom / Dynamic Fields */}
        {getVisibleFields().length > 0 && (
          <div className="pt-2 border-top">
            <div className="ticket-sidebar-section-title">{t('fields.dynamicFields')}</div>
            {getVisibleFields().map(({ field, override }) => (
              <DynamicField
                key={field.id}
                field={field}
                value={ticket.fields?.[field.id] ?? field.defaultValue ?? null}
                onChange={(value) => void handleCustomFieldChange(field.id, value)}
                compact
                fieldOverride={override}
                staff={config.staff}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Render: Header ────────────────────────────────────────────────────

  const renderHeader = () => {
    if (!ticket) return null;

    const typeColor = ticketType?.color ?? '#6c757d';
    const currentStage = (teamData?.stages ?? []).find((s) => s.id === ticket.stageId);

    return (
      <Modal.Header closeButton className="align-items-start pb-2">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          {/* Line 1: ID badge + Title */}
          <div className="d-flex align-items-center gap-2">
            <span className="ticket-detail-id">{ticket.displayId}</span>

            {ticket.archived && (
              <Badge bg="warning" text="dark" style={{ fontSize: '0.7rem' }}>
                <i className="bi bi-archive me-1" />
                {t('archive.archived')}
              </Badge>
            )}

            {editingTitle ? (
              <Form.Control
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') cancelTitle();
                }}
                onBlur={() => void saveTitle()}
                className="fw-bold flex-grow-1"
                style={{ fontSize: '1.15rem' }}
                disabled={saving}
              />
            ) : (
              <h5
                className="mb-0 fw-bold text-truncate flex-grow-1"
                style={{ cursor: 'pointer', fontSize: '1.15rem' }}
                onClick={startEditTitle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') startEditTitle();
                }}
                title={ticket.title}
              >
                {ticket.title}
              </h5>
            )}

            {saving && <Spinner animation="border" size="sm" className="flex-shrink-0" />}

            {/* Share button — copies ticket link to clipboard */}
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 flex-shrink-0"
              style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 6 }}
              onClick={() => {
                const url = `${window.location.origin}${window.location.pathname}?ticket=${ticket.displayId}`;
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              <i className={`bi ${copied ? 'bi-check-lg text-success' : 'bi-link-45deg'}`} />
              {copied ? t('common.copied', 'Copied!') : t('common.share', 'Share')}
            </button>
          </div>

          {/* Line 2: Type + Team breadcrumb */}
          <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: '0.8rem' }}>
            {ticketType && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  color: typeColor,
                  fontSize: '0.78rem',
                  fontWeight: 500,
                }}
              >
                {ticketType.icon && (
                  <i className={getTicketTypeIconClass(ticketType.icon)} style={{ fontSize: '0.7rem' }} />
                )}
                {ticketType.name}
              </span>
            )}
            {teamData?.team?.name && (
              <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                {teamData.team.name}
                {currentStage && (
                  <>
                    {' '}
                    <i className="bi bi-chevron-right" style={{ fontSize: '0.55rem' }} /> {currentStage.name}
                  </>
                )}
              </span>
            )}
          </div>

          {/* Line 3: Created date */}
          <div className="ticket-detail-header-meta">
            {t('tickets.created')} {formatDate(ticket.createdAt)}
          </div>
        </div>
      </Modal.Header>
    );
  };

  // ── Render: Main body ─────────────────────────────────────────────────

  const renderBody = () => {
    if (!ticket || !config) return null;

    return (
      <div className="d-flex" style={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {/* Left column: stacked sections (65%) */}
        <div
          style={{
            flex: '0 0 65%',
            maxWidth: '65%',
            overflowY: 'auto',
            paddingRight: '1.5rem',
            borderRight: '1px solid #f0f0f0',
          }}
        >
          {/* Description — rich text editor, saves on blur */}
          <div className="mb-4">
            <div className="ticket-section-heading">{t('tickets.description')}</div>
            <RichTextEditor
              ref={descriptionEditorRef}
              value={ticket.description ?? ''}
              onSave={(html) => {
                if (html !== ticket.description) {
                  void handleUpdate({ description: html });
                }
              }}
              placeholder={t('common.description') + '\u2026'}
              minHeight={120}
              disabled={saving}
            />
          </div>

          {/* Attachments */}
          <div className="mb-4">
            <div className="ticket-section-heading">{t('tickets.attachments')}</div>
            <AttachmentsSection ticketId={ticket.id} />
          </div>

          {/* Activity / Comments */}
          <div className="mb-4">
            <div className="ticket-section-heading">
              {t('tickets.activity')}
              {ticket.commentCount > 0 && (
                <span className="text-muted ms-1" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                  ({ticket.commentCount})
                </span>
              )}
            </div>
            <CommentSection ticketId={ticket.id} />
          </div>
        </div>

        {/* Right column: sidebar fields + linked tickets + history (35%) */}
        <div style={{ flex: '0 0 35%', maxWidth: '35%', overflowY: 'auto', paddingLeft: '1.5rem' }}>
          <div className="ticket-detail-sidebar">{renderSidebar()}</div>

          {/* Linked Tickets — rendered directly (component has its own heading + Add Link button) */}
          <div className="mt-3">
            <LinkedTicketsSection ticketId={ticket.id} links={links} onRefresh={reloadTicket} />
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Modal ─────────────────────────────────────────────────────

  return (
    <>
      <Modal
        show={show}
        onHide={onHide}
        size="xl"
        dialogClassName="ticket-detail-modal"
        contentClassName="d-flex flex-column"
      >
        {loading && renderLoading()}
        {!loading && error && renderError()}
        {!loading && !error && ticket && (
          <>
            {renderHeader()}
            <Modal.Body className="d-flex flex-column" style={{ overflow: 'hidden', flex: 1 }}>
              {renderBody()}
            </Modal.Body>
            {/* Lifecycle dates — always-visible strip between body and footer */}
            {renderLifecycleDates()}
            {/* Footer: archive/delete on left, close on right — pinned by Bootstrap */}
            <Modal.Footer
              className="d-flex align-items-center justify-content-between py-2"
              style={{ backgroundColor: '#f9fafb', flexShrink: 0 }}
            >
              <div className="d-flex align-items-center gap-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  disabled={archiving}
                  onClick={() => void handleToggleArchive()}
                  style={{ fontSize: '0.8rem' }}
                >
                  <i className={`bi ${ticket.archived ? 'bi-arrow-counterclockwise' : 'bi-archive'} me-1`} />
                  {ticket.archived ? t('archive.unarchive') : t('archive.archive')}
                </Button>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{ fontSize: '0.8rem' }}
                >
                  <i className="bi bi-trash me-1" />
                  {t('common.delete')}
                </Button>
              </div>
              <div className="d-flex align-items-center gap-2">
                <Button variant="outline-secondary" size="sm" onClick={onHide} style={{ fontSize: '0.8rem' }}>
                  {t('common.close')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  style={{ fontSize: '0.8rem', minWidth: 70 }}
                  onClick={() => {
                    descriptionEditorRef.current?.flush();
                    onHide();
                  }}
                >
                  {t('common.save')}
                </Button>
              </div>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      {ticket && (
        <ConfirmModal
          show={showDeleteConfirm}
          onHide={() => setShowDeleteConfirm(false)}
          onConfirm={() => void handleDelete()}
          title={t('tickets.delete')}
          message={t('tickets.deleteConfirm')}
          confirmLabel={t('confirm.delete')}
          variant="danger"
          typeToConfirm={ticket.displayId}
        />
      )}
    </>
  );
}
