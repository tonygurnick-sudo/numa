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
  AuditEntry,
  AuditAction,
  WorkZone,
  WorkStage,
} from '../../../types/ops';
import { CommentSection } from '../Shared/CommentSection';
import { LinkedTicketsSection } from '../Shared/LinkedTicketsSection';
import { AttachmentsSection } from '../Shared/AttachmentsSection';
import { RichTextEditor } from '../Shared/RichTextEditor';
import type { RichTextEditorHandle } from '../Shared/RichTextEditor';
import { DynamicField } from '../Shared/DynamicField';
import { ConfirmModal } from './ConfirmModal';
import { MoveTicketModal } from './MoveTicketModal';
import { useToast } from '../../../Providers/ToastContext';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { SidebarDropdown } from '../Shared/SidebarDropdown';
import type { DropdownOption } from '../Shared/SidebarDropdown';
import { getPriorityColor } from '../Shared/colorUtils';

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

/**
 * Computes a human-readable cycle-time string between two ISO dates.
 * Returns null if either date is missing.
 */
function formatCycleTime(startStr: string | null | undefined, endStr: string | null | undefined): string | null {
  if (!startStr || !endStr) return null;
  const ms = Date.parse(endStr) - Date.parse(startStr);
  if (ms < 0 || isNaN(ms)) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${String(days)}d ${String(remainingHours)}h`;
  if (hours > 0) return `${String(hours)}h`;
  const minutes = Math.floor(ms / 60_000);
  return `${String(minutes)}m`;
}

// ─── Audit Icon Map ─────────────────────────────────────────────────────────

const AUDIT_ICON_MAP: Record<AuditAction | 'default', { icon: string; color: string }> = {
  created: { icon: 'bi-plus-circle', color: '#198754' },
  updated: { icon: 'bi-pencil', color: '#0d6efd' },
  moved: { icon: 'bi-arrows-move', color: '#6f42c1' },
  commented: { icon: 'bi-chat', color: '#6c757d' },
  linked: { icon: 'bi-link-45deg', color: '#6610f2' },
  deleted: { icon: 'bi-trash', color: '#dc3545' },
  restored: { icon: 'bi-arrow-counterclockwise', color: '#198754' },
  default: { icon: 'bi-clock-history', color: '#6c757d' },
};

function getAuditIcon(action: string): { icon: string; color: string } {
  return AUDIT_ICON_MAP[action as AuditAction] ?? AUDIT_ICON_MAP.default;
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
  const { showToast } = useToast();
  const [archiving, setArchiving] = useState(false);
  const { config, teamData, teams, workUnits, refreshTickets, refreshCrmData } = useOps();

  // ── Core state ──────────────────────────────────────────────────────────
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingCrm, setLoadingCrm] = useState(false);

  // ── Ticket's own team data (zones/stages) for cross-team accuracy ──────
  const [ticketTeamData, setTicketTeamData] = useState<{ zones: WorkZone[]; stages: WorkStage[] } | null>(null);

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // ── CRM lists for selector dropdowns ───────────────────────────────────

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // ── Move to board ──────────────────────────────────────────────────────
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);

  // ── History panel ────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ── Share / copy link feedback ────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ── Ref for title input auto-focus ──────────────────────────────────────
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionEditorRef = useRef<RichTextEditorHandle>(null);

  // ── Close handler — always flush description before closing ─────────────
  const handleClose = useCallback(() => {
    descriptionEditorRef.current?.flush();
    onHide();
  }, [onHide]);

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
      setTitleDraft(response.ticket.title);
      setLinks(response.links ?? []);

      // Load the ticket's actual team data so the stage dropdown is always accurate
      const ticketTeam = response.ticket.teamId;
      if (ticketTeam) {
        OpsService.getTeam(numaGet, ticketTeam)
          .then((teamResp) => setTicketTeamData({ zones: teamResp.zones, stages: teamResp.stages }))
          .catch(() => {
            /* fall back to context teamData */
          });
      }
    } catch (err) {
      console.error('[TicketDetailModal] Failed to load ticket', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [numaGet, ticketId, effectiveTeamId]);

  useEffect(() => {
    if (show && ticketId) {
      setTicketTeamData(null);
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
      setShowHistory(false);
      setAuditEntries([]);
    }
  }, [show, ticketId, loadTicket, numaGet]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;

    const loadCrmEntities = async () => {
      setLoadingCrm(true);
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
      } finally {
        if (!cancelled) setLoadingCrm(false);
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
    [ticket, ticketId, numaPut, refreshTickets, refreshCrmData, loadTicket, t]
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
    if (!ticket || !ticketId || !team?.id) return;
    setArchiving(true);
    try {
      const updated = ticket.archived
        ? await OpsService.unarchiveTicket(numaPut, ticketId, ticket.version, team.id)
        : await OpsService.archiveTicket(numaPut, ticketId, ticket.version, team.id);
      setTicket(updated);
      void refreshTickets();
      refreshCrmData();
    } catch (err) {
      console.error('[TicketDetailModal] Archive toggle failed', err);
      showToast({ message: t('errors.archiveFailed'), variant: 'error' });
    } finally {
      setArchiving(false);
    }
  };

  // ── Delete handler ────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!ticketId || !team?.id) return;
    try {
      await OpsService.deleteTicket(numaDelete, ticketId, team.id);
      setShowDeleteConfirm(false);
      onDeleted?.();
      onHide();
      void refreshTickets();
      refreshCrmData();
    } catch (err) {
      console.error('[TicketDetailModal] Delete failed', err);
      showToast({ message: t('errors.deleteFailed'), variant: 'error' });
    }
  };

  // ── Reload ticket (for linked tickets refresh) ────────────────────────

  const reloadTicket = useCallback(() => {
    void loadTicket();
  }, [loadTicket]);

  // ── Move to board handler ───────────────────────────────────────────
  const handleTicketMoved = useCallback(() => {
    setShowMoveModal(false);
    showToast({ message: t('moveToBoard.success'), variant: 'success' });
    void refreshTickets();
    refreshCrmData();
    onHide();
  }, [refreshTickets, refreshCrmData, onHide, showToast, t]);

  // ── Load audit history ───────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    if (!ticketId) return;
    setLoadingHistory(true);
    try {
      const entries = await OpsService.listAuditEntries(numaGet, ticketId);
      setAuditEntries(entries);
    } catch (err) {
      console.error('[TicketDetailModal] Failed to load audit history', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [numaGet, ticketId]);

  const handleOpenHistory = () => {
    setShowHistory(true);
    void loadHistory();
  };

  // ── Custom field update handler ───────────────────────────────────────

  const handleCustomFieldChange = useCallback(
    async (fieldId: string, value: unknown) => {
      if (!ticket) return;
      const updatedFields = { ...(ticket.fields ?? {}), [fieldId]: value };
      await handleUpdate({ fields: updatedFields });
    },
    [ticket, handleUpdate]
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
          item !== null
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
      <div className="ticket-lifecycle-strip">
        {events.map(({ label, date }) => (
          <div key={label} className="d-flex align-items-center gap-1">
            <strong>{label}:</strong>
            <span>{formatDateShort(date)}</span>
          </div>
        ))}
        {formatCycleTime(ticket.startedAt, ticket.completedAt) && (
          <div className="d-flex align-items-center gap-1">
            <strong>{t('tickets.cycleTime')}:</strong>
            <span>{formatCycleTime(ticket.startedAt, ticket.completedAt)}</span>
          </div>
        )}
        {ticket.createdByName && (
          <div className="d-flex align-items-center gap-1 ms-auto">
            <i className="bi bi-person" style={{ fontSize: '0.7rem' }} />
            <span>{ticket.createdByName}</span>
            <span style={{ opacity: 0.6 }}>· {relativeTimeShort(ticket.createdAt)}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Render: Sidebar ───────────────────────────────────────────────────

  const STATUS_PILL_COLORS: Record<string, string> = {
    backlog: '#9ca3af',
    scoped: '#6366f1',
    queued: '#4338ca',
    active: '#2563eb',
    completed: '#059669',
    ended: '#6b7280',
  };

  const renderSidebar = () => {
    if (!ticket || !config) return null;

    const staff = config.staff;
    const projects = config.projects;
    const hasWorkUnits = team?.workUnitSeries?.enabled === true;
    const allZones = ticketTeamData?.zones ?? teamData?.zones ?? [];
    const allStages = ticketTeamData?.stages ?? teamData?.stages ?? [];
    const currentStage = allStages.find((s) => s.id === ticket.stageId);
    const pillColor = STATUS_PILL_COLORS[currentStage?.statusType ?? 'backlog'] ?? '#9ca3af';

    return (
      <div>
        {/* ── Title + Status row ──────────────────────────────────────── */}
        <div className="d-flex align-items-center justify-content-between gap-2" style={{ padding: '12px 14px 8px' }}>
          <Form.Control
            size="sm"
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim() && titleDraft !== ticket.title) void saveTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveTitle();
            }}
            placeholder={t('tickets.title')}
            className="ticket-sidebar-title-input"
          />
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <span
              className="ticket-status-pill"
              style={{ backgroundColor: pillColor }}
              onClick={() => {
                const sel = document.getElementById('ticket-status-select');
                if (sel) (sel as HTMLSelectElement).showPicker?.();
              }}
            >
              {currentStage?.name ?? t('tickets.status')}
              <i className="bi bi-chevron-down" />
            </span>
            <Form.Select
              id="ticket-status-select"
              size="sm"
              value={ticket.stageId}
              onChange={(e) => {
                const newStageId = e.target.value;
                const stage = allStages.find((s) => s.id === newStageId);
                void handleUpdate({ stageId: newStageId, zoneId: stage?.zoneId });
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
              }}
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
          </div>
        </div>

        {/* ── Details section ─────────────────────────────────────────── */}
        <button
          className="ticket-sidebar-details-toggle"
          aria-expanded={detailsExpanded}
          onClick={() => setDetailsExpanded((prev) => !prev)}
        >
          <i className="bi bi-chevron-down" />
          {t('tickets.details', 'Details')}
        </button>

        {detailsExpanded && (
          <div className="ticket-sidebar-details-body">
            {/* Type */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.type')}</div>
              <SidebarDropdown
                value={ticket.ticketTypeId}
                onChange={(val) => void handleUpdate({ ticketTypeId: val })}
                options={(config?.ticketTypes ?? []).map((tt) => ({
                  value: tt.id,
                  label: tt.name,
                  icon: tt.icon ? (
                    <i className={getTicketTypeIconClass(tt.icon)} style={{ color: tt.color, fontSize: '0.82rem' }} />
                  ) : undefined,
                }))}
                renderValue={() => (
                  <>
                    {ticketType?.icon && (
                      <i
                        className={getTicketTypeIconClass(ticketType.icon)}
                        style={{ color: ticketType.color, fontSize: '0.82rem' }}
                      />
                    )}
                    <span style={{ color: ticketType?.color }}>{ticketType?.name ?? t('common.none')}</span>
                  </>
                )}
              />
            </div>

            {/* Priority */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.priority')}</div>
              <SidebarDropdown
                value={ticket.priority}
                onChange={(val) => void handleUpdate({ priority: val as TicketPriority })}
                options={PRIORITY_OPTIONS.map((p) => ({
                  value: p,
                  label: t(`priority.${p}`),
                  icon: (
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: getPriorityColor(p),
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                  ),
                }))}
                renderValue={(opt) => (
                  <>
                    <PriorityIndicator priority={ticket.priority} />
                    <span>{opt?.label ?? t('tickets.priority')}</span>
                  </>
                )}
              />
            </div>

            {/* Assignee */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.assignee')}</div>
              <SidebarDropdown
                value={ticket.assigneeId ?? ''}
                onChange={(val) => void handleUpdate({ assigneeId: val || null })}
                options={[
                  { value: '', label: t('fields.unassigned') },
                  ...staff
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
                  const assignee = ticket.assigneeId ? staff.find((s) => s.id === ticket.assigneeId) : undefined;
                  return (
                    <>
                      <StaffAvatar staff={assignee} name={ticket.assigneeName} size={28} />
                      <span className={!ticket.assigneeId ? 'sidebar-dropdown-placeholder' : ''}>
                        {ticket.assigneeName || t('fields.unassigned')}
                      </span>
                    </>
                  );
                }}
              />
            </div>

            {/* Reporter */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.reporter')}</div>
              <SidebarDropdown
                value={ticket.reporterId ?? ''}
                onChange={(val) => {
                  const selectedStaff = config?.staff.find((s) => s.id === val);
                  void handleUpdate({
                    reporterId: val || null,
                    reporterName: selectedStaff?.name || selectedStaff?.email || null,
                  });
                }}
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
                  const reporter = ticket.reporterId
                    ? (config?.staff ?? []).find((s) => s.id === ticket.reporterId)
                    : undefined;
                  return (
                    <>
                      <StaffAvatar staff={reporter} name={ticket.reporterName} size={28} />
                      <span className={!ticket.reporterId ? 'sidebar-dropdown-placeholder' : ''}>
                        {ticket.reporterName || t('fields.unassigned')}
                      </span>
                    </>
                  );
                }}
              />
            </div>

            {/* Created by */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.createdBy')}</div>
              <span
                className={!ticket.createdByName ? 'sidebar-dropdown-placeholder' : ''}
                style={{ fontSize: '0.82rem', display: 'block', padding: '5px 8px' }}
              >
                {ticket.createdByName || t('common.none')}
              </span>
            </div>

            {/* Sprint (if work units enabled) */}
            {hasWorkUnits && (
              <div className="ticket-sidebar-field">
                <div className="ticket-sidebar-field-label">{t('tickets.workUnit')}</div>
                <SidebarDropdown
                  value={ticket.workUnitId ?? ''}
                  onChange={(val) => void handleUpdate({ workUnitId: val || null })}
                  options={[
                    { value: '', label: t('common.none') },
                    ...workUnits.map(
                      (wu): DropdownOption => ({
                        value: wu.id,
                        label: wu.name,
                        icon: <i className="bi bi-flag" style={{ fontSize: '0.78rem', color: '#065f46' }} />,
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
            )}

            {/* Due Date */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.dueDate')}</div>
              <Form.Control
                type="date"
                size="sm"
                value={toDateInputValue(ticket.dueDate)}
                onChange={(e) => void handleUpdate({ dueDate: e.target.value || null })}
              />
            </div>

            {/* Project — full width */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.project')}</div>
              <SidebarDropdown
                value={ticket.projectId ?? ''}
                onChange={(val) => void handleUpdate({ projectId: val || null })}
                options={[
                  { value: '', label: t('common.none') },
                  ...projects
                    .filter((p) => p.isActive)
                    .map(
                      (p): DropdownOption => ({
                        value: p.id,
                        label: p.name,
                        icon: <i className="bi bi-folder" style={{ fontSize: '0.78rem', color: '#6d28d9' }} />,
                      })
                    ),
                ]}
                renderValue={(opt) =>
                  opt?.value ? (
                    <span className="ticket-badge ticket-badge-project" style={{ margin: 0 }}>
                      <i className="bi bi-folder me-1" />
                      {opt.label}
                    </span>
                  ) : (
                    <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>
                  )
                }
              />
            </div>

            {/* Customer — full width */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.customer')}</div>
              <SidebarDropdown
                value={ticket.customerId ?? ''}
                onChange={(val) => {
                  const selected = customers.find((c) => c.id === val);
                  void handleUpdate({
                    customerId: val || null,
                    customerName: selected?.companyName ?? null,
                  });
                }}
                disabled={loadingCrm}
                options={
                  loadingCrm
                    ? [{ value: '', label: t('common.loading'), disabled: true }]
                    : [
                        { value: '', label: t('common.none') },
                        ...customers.map(
                          (c): DropdownOption => ({
                            value: c.id,
                            label: c.companyName,
                            icon: <i className="bi bi-building" style={{ fontSize: '0.78rem', color: '#1d4ed8' }} />,
                          })
                        ),
                      ]
                }
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

            {/* Supplier — full width */}
            <div className="ticket-sidebar-field">
              <div className="ticket-sidebar-field-label">{t('tickets.supplier')}</div>
              <SidebarDropdown
                value={ticket.supplierId ?? ''}
                onChange={(val) => {
                  const selected = suppliers.find((s) => s.id === val);
                  void handleUpdate({
                    supplierId: val || null,
                    supplierName: selected?.companyName ?? null,
                  });
                }}
                disabled={loadingCrm}
                options={
                  loadingCrm
                    ? [{ value: '', label: t('common.loading'), disabled: true }]
                    : [
                        { value: '', label: t('common.none') },
                        ...suppliers.map(
                          (s): DropdownOption => ({
                            value: s.id,
                            label: s.companyName,
                            icon: <i className="bi bi-truck" style={{ fontSize: '0.78rem', color: '#c2410c' }} />,
                          })
                        ),
                      ]
                }
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

            {/* Tags */}
            <div
              className="ticket-sidebar-field"
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
                  autoFocus
                />
              ) : (
                <div className="d-flex flex-wrap gap-1" style={{ minHeight: 28, paddingTop: 2, paddingLeft: 8 }}>
                  {ticket.tags.length > 0 ? (
                    ticket.tags.map((tag) => (
                      <span key={tag} className="ticket-tag-badge">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="sidebar-dropdown-placeholder" style={{ fontSize: '0.82rem' }}>
                      {t('common.none')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Custom / Dynamic Fields */}
            {getVisibleFields().length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                <div
                  className="ticket-sidebar-field-label"
                  style={{ marginBottom: 6, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em' }}
                >
                  {t('fields.dynamicFields')}
                </div>
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
        )}
      </div>
    );
  };

  // ── Render: Header ────────────────────────────────────────────────────

  const renderHeader = () => {
    if (!ticket) return null;

    const typeColor = ticketType?.color ?? '#6c757d';

    return (
      <Modal.Header closeButton className="align-items-start">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          {/* Line 1: Breadcrumb - type > team */}
          <div className="d-flex align-items-center gap-1" style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            <span className="ticket-detail-id">{ticket.displayId}</span>
            {ticketType && (
              <>
                <i className="bi bi-chevron-right" style={{ fontSize: '0.5rem' }} />
                <span style={{ color: typeColor, fontWeight: 500 }}>
                  {ticketType.icon && (
                    <i
                      className={getTicketTypeIconClass(ticketType.icon)}
                      style={{ fontSize: '0.65rem', marginRight: 3 }}
                    />
                  )}
                  {ticketType.name}
                </span>
              </>
            )}
            {teamData?.team?.name && (
              <>
                <i className="bi bi-chevron-right" style={{ fontSize: '0.5rem' }} />
                <span>{teamData.team.name}</span>
              </>
            )}

            {ticket.archived && (
              <Badge bg="warning" text="dark" style={{ fontSize: '0.65rem', marginLeft: 6 }}>
                <i className="bi bi-archive me-1" />
                {t('archive.archived')}
              </Badge>
            )}

            <div className="ms-auto d-flex align-items-center gap-1">
              {saving && <Spinner animation="border" size="sm" />}
              <button
                type="button"
                className="ticket-share-btn"
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
          </div>

          {/* Line 2: Title (click to edit) */}
          <div style={{ marginTop: 6 }}>
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
                className="fw-semibold"
                style={{ fontSize: '1.2rem', border: 'none', padding: 0, boxShadow: 'none' }}
                disabled={saving}
              />
            ) : (
              <h5
                className="mb-0 fw-semibold"
                style={{ cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1.3, color: '#111827' }}
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
        <div className="ticket-detail-left-col">
          {/* Description */}
          <div className="ticket-detail-section">
            <div className="ticket-section-heading">
              <i className="bi bi-text-left me-2" />
              {t('tickets.description')}
            </div>
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
          <div className="ticket-detail-section">
            <div className="ticket-section-heading">
              <i className="bi bi-paperclip me-2" />
              {t('tickets.attachments')}
            </div>
            <AttachmentsSection ticketId={ticket.id} />
          </div>

          {/* Activity / Comments */}
          <div className="ticket-detail-section">
            <div className="ticket-section-heading">
              <i className="bi bi-chat-dots me-2" />
              {t('tickets.activity')}
              {ticket.commentCount > 0 && (
                <span
                  className="ms-1"
                  style={{
                    fontWeight: 500,
                    fontSize: '0.72rem',
                    background: '#e5e7eb',
                    borderRadius: '10px',
                    padding: '1px 7px',
                    color: '#6b7280',
                  }}
                >
                  {ticket.commentCount}
                </span>
              )}
            </div>
            <CommentSection ticketId={ticket.id} />
          </div>
        </div>

        {/* Right column: sidebar fields + linked tickets (35%) */}
        <div className="ticket-detail-right-col">
          <div className="ticket-detail-sidebar">{renderSidebar()}</div>

          {/* Linked Tickets */}
          <div className="mt-3">
            <LinkedTicketsSection
              ticketId={ticket.id}
              ticketDisplayId={ticket.displayId}
              ticketTitle={ticket.title}
              links={links}
              onRefresh={reloadTicket}
              onTicketClick={(linkedId) => {
                onHide();
                setTimeout(() => {
                  const event = new CustomEvent('ops:open-ticket', { detail: { ticketId: linkedId } });
                  window.dispatchEvent(event);
                }, 150);
              }}
            />
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
        onHide={handleClose}
        size="xl"
        fullscreen="lg-down"
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
            {/* Footer: actions left, close right */}
            <Modal.Footer className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-1">
                <button
                  type="button"
                  className="ticket-detail-footer-btn"
                  disabled={archiving}
                  onClick={() => void handleToggleArchive()}
                >
                  <i className={`bi ${ticket.archived ? 'bi-arrow-counterclockwise' : 'bi-archive'}`} />
                  {ticket.archived ? t('archive.unarchive') : t('archive.archive')}
                </button>
                <button
                  type="button"
                  className="ticket-detail-footer-btn ticket-detail-footer-btn--danger"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <i className="bi bi-trash" />
                  {t('common.delete')}
                </button>
                <button type="button" className="ticket-detail-footer-btn" onClick={handleOpenHistory}>
                  <i className="bi bi-clock-history" />
                  {t('tickets.history')}
                </button>
                {teams.length > 1 && (
                  <button type="button" className="ticket-detail-footer-btn" onClick={() => setShowMoveModal(true)}>
                    <i className="bi bi-arrow-right-square" />
                    {t('moveToBoard.button')}
                  </button>
                )}
              </div>
              <button type="button" className="ticket-detail-footer-btn" onClick={handleClose}>
                {t('common.close')}
              </button>
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

      {/* Move to board modal */}
      {ticket && (
        <MoveTicketModal
          show={showMoveModal}
          onHide={() => setShowMoveModal(false)}
          onMoved={handleTicketMoved}
          ticket={ticket}
          currentTeamName={teams.find((t) => t.id === ticket.teamId)?.name ?? teamData?.team?.name ?? ''}
          availableTeams={teams.filter((t) => t.id !== ticket.teamId)}
        />
      )}

      {/* History overlay modal */}
      <Modal show={showHistory} onHide={() => setShowHistory(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>{t('tickets.ticketHistory')}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {loadingHistory && (
            <div className="d-flex justify-content-center py-4">
              <Spinner animation="border" />
            </div>
          )}
          {!loadingHistory && auditEntries.length === 0 && (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-clock-history d-block mb-2" style={{ fontSize: '2rem' }} />
              {t('tickets.noHistoryYet')}
            </div>
          )}
          {!loadingHistory && auditEntries.length > 0 && (
            <div className="d-flex flex-column gap-3">
              {auditEntries.map((entry) => {
                const { icon, color } = getAuditIcon(entry.action);
                const actionKey = `tickets.historyAction.${entry.action}` as const;
                const actionLabel = t(actionKey, entry.action);

                // Build change descriptions
                const changeDescriptions: string[] = [];
                if (entry.changes && typeof entry.changes === 'object') {
                  // changes can be Record<string, { from, to }> or AuditChange[]
                  const changesObj = Array.isArray(entry.changes)
                    ? entry.changes
                    : Object.entries(entry.changes).map(([field, val]) => ({
                        field,
                        from: (val as { from?: unknown })?.from,
                        to: (val as { to?: unknown })?.to,
                      }));

                  for (const change of changesObj) {
                    const fieldName = String(change.field);
                    const fromVal = change.from;
                    const toVal = change.to;

                    if (fromVal != null && toVal != null) {
                      changeDescriptions.push(
                        t('tickets.historyFieldChange', {
                          field: fieldName,
                          from: String(fromVal),
                          to: String(toVal),
                        })
                      );
                    } else if (toVal != null) {
                      changeDescriptions.push(t('tickets.historyFieldSet', { field: fieldName, to: String(toVal) }));
                    } else if (fromVal != null) {
                      changeDescriptions.push(t('tickets.historyFieldCleared', { field: fieldName }));
                    }
                  }
                }

                return (
                  <div key={entry.id} className="d-flex align-items-start gap-3">
                    <div
                      className="d-flex align-items-center justify-content-center flex-shrink-0"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        backgroundColor: `${color}15`,
                        color,
                      }}
                    >
                      <i className={`bi ${icon}`} style={{ fontSize: '0.9rem' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.85rem' }}>
                        <span className="fw-semibold">{actionLabel}</span>
                        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                          {relativeTimeShort(entry.timestamp)}
                        </span>
                      </div>
                      {changeDescriptions.length > 0 && (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                          {changeDescriptions.map((desc, i) => (
                            <div key={i}>{desc}</div>
                          ))}
                        </div>
                      )}
                      {entry.userName && (
                        <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                          <i className="bi bi-person me-1" />
                          {entry.userName}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
