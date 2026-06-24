import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useAlert } from '../../../Providers/ConfirmContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import { getAssignableWorkUnits } from '../opsWorkFilters';
import type {
  Ticket,
  TicketLink,
  TicketType,
  FieldDefinition,
  FieldOverride,
  Customer,
  Supplier,
  AuditEntry,
  AuditAction,
  WorkZone,
  WorkStage,
  RecurrenceConfig,
  RecurrenceRule,
} from '../../../types/ops';
import { CommentSection } from '../Shared/CommentSection';
import { LinkedTicketsSection } from '../Shared/LinkedTicketsSection';
import { AttachmentsSection } from '../Shared/AttachmentsSection';
import { RichTextEditor, LARGE_PASTED_IMAGE_BYTES } from '../Shared/RichTextEditor';
import type { RichTextEditorHandle } from '../Shared/RichTextEditor';
import { uploadAttachmentToTicket } from '../Shared/attachmentUploader';
import { DynamicField } from '../Shared/DynamicField';
import { ConfirmModal } from './ConfirmModal';
import { MoveTicketModal } from './MoveTicketModal';
import { RecurrencePicker } from './RecurrencePicker';
import { summarizeRecurrence } from './recurrenceHelpers';
import { useToast } from '../../../Providers/ToastContext';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { resolveBoardMembers } from '../Shared/boardMembers';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { SidebarDropdown } from '../Shared/SidebarDropdown';
import type { DropdownOption } from '../Shared/SidebarDropdown';
import {
  getFieldOptionColor,
  isCanonicalPriority,
  resolveBoardFieldList,
  resolveFieldOptions,
} from '../Shared/fieldResolution';
import {
  formatAuditFieldLabel,
  formatAuditValue,
  shouldIgnoreAuditField,
  expandCustomFieldChanges,
  type AuditLookups,
} from '../Shared/auditFormatters';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TicketDetailModalProps {
  show: boolean;
  ticketId: string | null;
  onHide: () => void;
  onDeleted?: () => void;
  boardIdOverride?: string | null;
}

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
  boardIdOverride = null,
}: TicketDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const { showToast } = useToast();
  const showAlert = useAlert();
  const [restoring, setRestoring] = useState(false);
  const { config, boardData, boards, workUnits, refreshTickets, refreshCrmData } = useOps();

  // ── Recurrence state ────────────────────────────────────────────────────
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);

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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState(false);

  // ── CRM lists for selector dropdowns ───────────────────────────────────

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // ── Move to board ──────────────────────────────────────────────────────
  const [showMoveModal, setShowMoveModal] = useState(false);

  // ── History panel ────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Lookups for resolving raw IDs in audit entries to human-readable names.
  const auditLookups: AuditLookups = useMemo(
    () => ({
      config,
      customers,
      suppliers,
      workUnits,
      zones: ticketTeamData?.zones ?? boardData?.zones ?? [],
      stages: ticketTeamData?.stages ?? boardData?.stages ?? [],
      boards,
    }),
    [config, customers, suppliers, workUnits, ticketTeamData, boardData, boards]
  );

  // ── Share / copy link feedback ────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ── Attachments refresh trigger (bumped after a paste-uploaded image) ───
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);

  // ── Ref for title input auto-focus ──────────────────────────────────────
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionEditorRef = useRef<RichTextEditorHandle>(null);

  // Serialises inline saves so back-to-back edits don't race the optimistic
  // version lock (BUG-131). ticketRef holds the freshest version+fields,
  // saveQueueRef chains PUTs, and handleUpdate accepts a factory so payloads
  // that depend on prior state are computed after the previous save lands.
  const ticketRef = useRef<Ticket | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveErrorRef = useRef(false);
  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);

  // ── Recurrence handlers ─────────────────────────────────────────────────
  const handleRecurrenceSave = useCallback(
    async (config: RecurrenceConfig): Promise<void> => {
      if (!ticket) return;
      const updated = recurrence
        ? await OpsService.updateTicketRecurrence(numaPut, ticket.id, { config })
        : await OpsService.createTicketRecurrence(numaPost, ticket.id, { config });
      setRecurrence(updated);
      void refreshTickets?.();
    },
    [ticket, recurrence, numaPost, numaPut, refreshTickets]
  );

  const handleRecurrenceRemove = useCallback(async (): Promise<void> => {
    if (!ticket) return;
    await OpsService.deleteTicketRecurrence(numaDelete, ticket.id);
    setRecurrence(null);
    void refreshTickets?.();
  }, [ticket, numaDelete, refreshTickets]);

  // ── Close handler — always flush description before closing ─────────────
  const handleClose = useCallback(() => {
    descriptionEditorRef.current?.flush();
    onHide();
  }, [onHide]);

  // ── Derived data ────────────────────────────────────────────────────────
  const ticketType: TicketType | undefined = ticket
    ? config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId)
    : undefined;

  const team = boardData?.board ?? null;
  const effectiveTeamId = boardIdOverride ?? team?.id ?? null;

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
      setRecurrence(response.recurrence ?? null);

      // Load the ticket's actual team data so the stage dropdown is always accurate
      const ticketTeam = response.ticket.boardId;
      if (ticketTeam) {
        OpsService.getBoard(numaGet, ticketTeam)
          .then((teamResp) => setTicketTeamData({ zones: teamResp.zones, stages: teamResp.stages }))
          .catch(() => {
            /* fall back to context boardData */
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
      setRecurrence(null);
      setShowRecurrencePicker(false);
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
    async (payload: Record<string, unknown> | ((current: Ticket) => Record<string, unknown>)) => {
      if (!ticketId) return;
      const task = saveQueueRef.current.then(async () => {
        const current = ticketRef.current;
        if (!current) return;
        const resolvedPayload = typeof payload === 'function' ? payload(current) : payload;
        setSaving(true);
        try {
          const updated = await OpsService.updateTicket(numaPut, ticketId, {
            ...resolvedPayload,
            boardId: current.boardId,
            version: current.version,
          });
          ticketRef.current = updated;
          setTicket(updated);
          setLastSavedAt(new Date());
          setSaveError(false);
          saveErrorRef.current = false;
          void refreshTickets();
          const crmImpactingKeys = ['customerId', 'supplierId', 'statusType', 'stageId'] as const;
          if (crmImpactingKeys.some((key) => Object.prototype.hasOwnProperty.call(resolvedPayload, key))) {
            refreshCrmData();
          }
        } catch (err: unknown) {
          setSaveError(true);
          saveErrorRef.current = true;
          const isConflict = err instanceof Error && (err.message.includes('409') || err.message.includes('conflict'));
          if (isConflict) {
            await showAlert({ message: t('tickets.conflictMessage'), variant: 'warning' });
            void loadTicket();
          } else {
            console.error('[TicketDetailModal] Update failed', err);
          }
        } finally {
          setSaving(false);
        }
      });
      saveQueueRef.current = task.catch(() => undefined);
      await task;
    },
    [ticketId, numaPut, refreshTickets, refreshCrmData, loadTicket, showAlert, t]
  );

  // Force-flush any pending inline edits, drain the save queue, then report
  // the outcome via toast + footer indicator. Drives the indicator into
  // "Saving..." → "Saved HH:MM" even when nothing was actually pending, so
  // clicking Save always gives visible confirmation.
  const handleManualSave = useCallback(async () => {
    if (!ticketId) return;
    saveErrorRef.current = false;
    setSaving(true);
    const start = Date.now();
    const minShowMs = 1000;
    try {
      descriptionEditorRef.current?.flush();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await saveQueueRef.current;
      // Silent server roundtrip — verifies connectivity and that the ticket
      // is reachable, without overwriting local state if another user has
      // edited since (response is intentionally discarded).
      try {
        await OpsService.getTicket(numaGet, ticketId, effectiveTeamId ?? undefined);
      } catch (err) {
        saveErrorRef.current = true;
        console.error('[TicketDetailModal] Save verification failed', err);
      }
      const remaining = minShowMs - (Date.now() - start);
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      if (saveErrorRef.current) {
        showToast({ message: t('tickets.saveFailed'), variant: 'error' });
      } else {
        setLastSavedAt(new Date());
        setSaveError(false);
      }
    } finally {
      setSaving(false);
    }
  }, [ticketId, numaGet, effectiveTeamId, showToast, t]);

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

  // ── Restore handler (soft-deleted tickets) ───────────────────────────

  const handleRestore = async () => {
    if (!ticket || !ticketId || !team?.id) return;
    setRestoring(true);
    try {
      const updated = await OpsService.restoreTicket(numaPost, ticketId, team.id);
      setTicket(updated);
      void refreshTickets();
      refreshCrmData();
    } catch (err) {
      console.error('[TicketDetailModal] Restore failed', err);
      showToast({ message: t('errors.restoreFailed'), variant: 'error' });
    } finally {
      setRestoring(false);
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
      await handleUpdate((current) => ({
        fields: { ...(current.fields ?? {}), [fieldId]: value },
      }));
    },
    [handleUpdate]
  );

  // ── Get ticket type fields with overrides ─────────────────────────────

  const getVisibleFields = useCallback((): {
    field: FieldDefinition;
    override: FieldOverride | undefined;
  }[] => {
    if (!ticketType || !config) return [];
    const fieldOverrides = team?.fieldOverrides ?? {};
    const hasWorkUnits = team?.workUnitSeries?.enabled === true;

    // Fields rendered outside the right sidebar (title input in header,
    // description in the center panel, watchers not implemented). Everything
    // else — including system fields like Priority, Assignee, Reporter —
    // goes through the ordered sidebar loop so Board Settings reordering
    // actually changes the modal layout.
    const renderedElsewhere = new Set(['field-name', 'field-description', 'field-watchers']);
    // Sprint only renders when the board has work units enabled.
    const hiddenWhenNoWorkUnits = new Set(hasWorkUnits ? [] : ['field-work-unit-id']);

    // The board owns its effective list — falls back to template defaults
    // when the board has never touched this ticket type. resolveBoardFieldList
    // handles both the post-FEAT-171 complete-snapshot shape and the legacy
    // "extras on top of defaults" shape transparently. The list IS the order:
    // we no longer consult `fieldOverrides[].order`, since the editor and the
    // sidebar would otherwise drift apart on legacy boards where the old
    // reorder handler wrote `.order` values that the new editor doesn't.
    const ids = resolveBoardFieldList(ticketType, team?.addedFields);
    return ids
      .map((fieldId) => {
        if (renderedElsewhere.has(fieldId)) return null;
        if (hiddenWhenNoWorkUnits.has(fieldId)) return null;
        const field = config.fields.find((f) => f.id === fieldId);
        if (!field) return null;
        const override = fieldOverrides[fieldId];
        if (override?.visible === false) return null;
        return { field, override };
      })
      .filter((item): item is { field: FieldDefinition; override: FieldOverride | undefined } => item !== null);
  }, [ticketType, config, team]);

  // ── Pasted-image-too-large -> auto-attach ─────────────────────────────
  const handleLargeImagePaste = useCallback(
    (file: File) => {
      if (!ticket) return;
      const targetTicketId = ticket.id;
      void (async () => {
        try {
          await uploadAttachmentToTicket(numaPost, targetTicketId, file);
          setAttachmentsRefreshKey((k) => k + 1);
          showToast({ message: t('tickets.largeImagePastedAttached'), variant: 'info' });
        } catch (err) {
          showToast({
            message: err instanceof Error ? err.message : t('errors.uploadFailed', 'Upload failed'),
            variant: 'error',
          });
        }
      })();
    },
    [numaPost, ticket, showToast, t]
  );

  // ── Description image button -> inline (small) or attach (large) ──────
  // Small images embed inline as base64 so the description stays self-contained
  // (no expiring S3 URLs). Oversized images would blow the 400KB DynamoDB item
  // limit, so they get routed to attachments and we skip the inline embed by
  // returning an empty string.
  const handleDescriptionImageUpload = useCallback(
    async (file: File): Promise<string> => {
      if (!ticket) return '';
      if (file.size > LARGE_PASTED_IMAGE_BYTES) {
        await uploadAttachmentToTicket(numaPost, ticket.id, file);
        setAttachmentsRefreshKey((k) => k + 1);
        showToast({ message: t('tickets.largeImagePastedAttached'), variant: 'info' });
        return '';
      }
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
        reader.readAsDataURL(file);
      });
    },
    [numaPost, ticket, showToast, t]
  );

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
    const ticketTeamId = ticket.boardId;
    // Scope the Assignee picker to the ticket's board membership. Look up the
    // ticket's own board from the summaries list — `team` (boardData?.board) may
    // be a different board when the modal is opened from cross-team views like
    // All Tickets.
    const ticketBoard = boards.find((b) => b.id === ticketTeamId) ?? team;
    const boardMembers = resolveBoardMembers(ticketBoard, staff);
    const assigneeInBoard = !ticket.assigneeId || boardMembers.some((m) => m.id === ticket.assigneeId);
    const orphanAssignee =
      !assigneeInBoard && ticket.assigneeId ? (staff.find((s) => s.id === ticket.assigneeId) ?? null) : null;
    const projects = config.projects.filter(
      (p) => !p.boardIds?.length || p.boardIds.includes(ticketTeamId) || p.id === ticket.projectId
    );
    const allZones = ticketTeamData?.zones ?? boardData?.zones ?? [];
    const allStages = ticketTeamData?.stages ?? boardData?.stages ?? [];
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

        {/* ── Details body — always visible ────────────────────────────── */}
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

          {/* Every field renders in the order set in Board Settings →
                Tickets & Fields. System fields get their rich, dedicated UI;
                anything else falls through to DynamicField. The label always
                comes from the field's own `name` (with override.label taking
                precedence) so the sidebar matches Board Settings → Tickets &
                Fields exactly — no separate hardcoded labels. */}
          {getVisibleFields().map(({ field, override }) => {
            const label = override?.label?.trim() || field.name;
            switch (field.id) {
              case 'field-priority': {
                const boardFieldOverrides = team?.fieldOverrides ?? {};
                const priorityOptions = resolveFieldOptions(config?.fields, boardFieldOverrides, 'field-priority');
                const customPriority = (ticket.fields ?? {})['field-priority'];
                const displayPriority =
                  typeof customPriority === 'string' && !isCanonicalPriority(customPriority)
                    ? customPriority
                    : ticket.priority;
                const handlePriorityChange = (val: string) => {
                  if (isCanonicalPriority(val)) {
                    const nextFields = { ...(ticket.fields ?? {}) };
                    if ('field-priority' in nextFields) delete nextFields['field-priority'];
                    void handleUpdate({ priority: val, fields: nextFields });
                  } else {
                    const nextFields = { ...(ticket.fields ?? {}), 'field-priority': val };
                    void handleUpdate({ fields: nextFields });
                  }
                };
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <SidebarDropdown
                      value={displayPriority}
                      onChange={handlePriorityChange}
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
                      renderValue={(opt) => (
                        <>
                          {isCanonicalPriority(displayPriority) ? (
                            <PriorityIndicator priority={displayPriority} />
                          ) : (
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                backgroundColor: getFieldOptionColor('field-priority', displayPriority),
                                display: 'inline-block',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <span>{opt?.label ?? displayPriority}</span>
                        </>
                      )}
                    />
                  </div>
                );
              }
              case 'field-assignee':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <SidebarDropdown
                      value={ticket.assigneeId ?? ''}
                      onChange={(val) => void handleUpdate({ assigneeId: val || null })}
                      options={[
                        { value: '', label: t('fields.unassigned') },
                        ...(orphanAssignee
                          ? [
                              {
                                value: orphanAssignee.id,
                                label: `* ${orphanAssignee.name || orphanAssignee.email}`,
                                icon: <StaffAvatar staff={orphanAssignee} size={22} />,
                              } as DropdownOption,
                            ]
                          : []),
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
                        const assignee = ticket.assigneeId ? staff.find((s) => s.id === ticket.assigneeId) : undefined;
                        return (
                          <>
                            <StaffAvatar staff={assignee} name={ticket.assigneeName} size={28} />
                            <span className={!ticket.assigneeId ? 'sidebar-dropdown-placeholder' : ''}>
                              {assignee?.name || assignee?.email || ticket.assigneeName || t('fields.unassigned')}
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
                              {reporter?.name || reporter?.email || ticket.reporterName || t('fields.unassigned')}
                            </span>
                          </>
                        );
                      }}
                    />
                  </div>
                );
              case 'field-work-unit-id':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <SidebarDropdown
                      value={ticket.workUnitId ?? ''}
                      onChange={(val) => void handleUpdate({ workUnitId: val || null })}
                      options={[
                        { value: '', label: t('common.none') },
                        ...getAssignableWorkUnits(workUnits, ticket.workUnitId).map(
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
                );
              case 'field-due-date':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <Form.Control
                      type="date"
                      size="sm"
                      value={toDateInputValue(ticket.dueDate)}
                      onChange={(e) => void handleUpdate({ dueDate: e.target.value || null })}
                    />
                  </div>
                );
              case 'field-project':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <div className="d-flex align-items-center gap-1">
                      <div style={{ flex: 1 }}>
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
                                  icon: (
                                    <i
                                      className="bi bi-folder"
                                      style={{ fontSize: '0.78rem', color: p.color || '#6d28d9' }}
                                    />
                                  ),
                                  action: (
                                    <button
                                      type="button"
                                      title={t('projects.openProject', 'Open project')}
                                      onClick={() => window.open(`/ops?project=${p.id}`, '_blank')}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#9ca3af',
                                        cursor: 'pointer',
                                        padding: '2px 4px',
                                        fontSize: '0.72rem',
                                        lineHeight: 1,
                                      }}
                                    >
                                      <i className="bi bi-box-arrow-up-right" />
                                    </button>
                                  ),
                                })
                              ),
                          ]}
                          renderValue={(opt) => {
                            if (!opt?.value)
                              return <span className="sidebar-dropdown-placeholder">{t('common.none')}</span>;
                            const proj = projects.find((p) => p.id === opt.value);
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
                      {ticket.projectId && (
                        <button
                          type="button"
                          title={t('projects.openProject', 'Open project')}
                          onClick={() => window.open(`/ops?project=${ticket.projectId}`, '_blank')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#9ca3af',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: '0.78rem',
                            flexShrink: 0,
                          }}
                        >
                          <i className="bi bi-box-arrow-up-right" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              case 'field-client':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
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
                                  icon: (
                                    <i className="bi bi-building" style={{ fontSize: '0.78rem', color: '#1d4ed8' }} />
                                  ),
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
                );
              case 'field-supplier':
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
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
                );
              case 'field-labels':
                return (
                  <div
                    key={field.id}
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
                    <div className="ticket-sidebar-field-label">{label}</div>
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
                );
              default:
                return (
                  <div key={field.id} className="ticket-sidebar-field">
                    <div className="ticket-sidebar-field-label">{label}</div>
                    <DynamicField
                      field={field}
                      value={ticket.fields?.[field.id] ?? field.defaultValue ?? null}
                      onChange={(value) => void handleCustomFieldChange(field.id, value)}
                      compact
                      hideLabel
                      fieldOverride={override}
                      ticketValues={ticket.fields ?? {}}
                      staff={config.staff}
                    />
                  </div>
                );
            }
          })}

          {/* Repeats — opens RecurrencePicker. Inline summary or "Doesn't repeat". */}
          <div className="ticket-sidebar-field">
            <div className="ticket-sidebar-field-label">{t('recurrence.rowLabel')}</div>
            <button
              type="button"
              className="btn btn-sm btn-link text-decoration-none p-0 text-start"
              style={{ fontSize: '0.85rem' }}
              onClick={() => setShowRecurrencePicker(true)}
            >
              {recurrence ? (
                <span>
                  <i className="bi bi-arrow-repeat me-1" />
                  {summarizeRecurrence(recurrence.config, t)}
                  {!recurrence.enabled && (
                    <Badge bg="secondary" className="ms-2">
                      {t('recurrence.rowDisabled')}
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="text-muted">{t('recurrence.rowDoesNotRepeat')}</span>
              )}
            </button>
          </div>
        </div>
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
            {(() => {
              // For cross-board deep-links the ticket lives on a different
              // board than the one currently open in the workspace. Always
              // show the ticket's own board name in the breadcrumb so the
              // header isn't lying about where the ticket lives.
              const ticketBoardName = boards.find((b) => b.id === ticket.boardId)?.name ?? boardData?.board?.name;
              return ticketBoardName ? (
                <>
                  <i className="bi bi-chevron-right" style={{ fontSize: '0.5rem' }} />
                  <span>{ticketBoardName}</span>
                </>
              ) : null;
            })()}

            {ticket.statusType === 'deleted' && (
              <Badge bg="danger" style={{ fontSize: '0.65rem', marginLeft: 6 }}>
                <i className="bi bi-trash me-1" />
                {t('deleted.deleted')}
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
          {/* Description \u2014 the editor is self-evidently the description, so no
              section heading here (keeps the toolbar flush to the top). */}
          <div className="ticket-detail-section">
            <RichTextEditor
              ref={descriptionEditorRef}
              value={ticket.description ?? ''}
              onSave={(html) => {
                if (html !== ticket.description) {
                  void handleUpdate({ description: html });
                }
              }}
              onLargeImagePaste={handleLargeImagePaste}
              onImageUpload={handleDescriptionImageUpload}
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
            <AttachmentsSection ticketId={ticket.id} refreshKey={attachmentsRefreshKey} />
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
                {ticket.statusType === 'deleted' ? (
                  <button
                    type="button"
                    className="ticket-detail-footer-btn"
                    disabled={restoring}
                    onClick={() => void handleRestore()}
                  >
                    <i className="bi bi-arrow-counterclockwise" />
                    {t('deleted.restore')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ticket-detail-footer-btn ticket-detail-footer-btn--danger"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <i className="bi bi-trash" />
                    {t('common.delete')}
                  </button>
                )}
                <button type="button" className="ticket-detail-footer-btn" onClick={handleOpenHistory}>
                  <i className="bi bi-clock-history" />
                  {t('tickets.history')}
                </button>
                {boards.length > 1 && (
                  <button type="button" className="ticket-detail-footer-btn" onClick={() => setShowMoveModal(true)}>
                    <i className="bi bi-arrow-right-square" />
                    {t('moveToBoard.button')}
                  </button>
                )}
              </div>
              <div className="d-flex align-items-center gap-2">
                <small
                  className={saveError ? 'text-danger' : 'text-muted'}
                  style={{ fontSize: '0.75rem', minWidth: 90, textAlign: 'right' }}
                >
                  {saving
                    ? t('common.saving')
                    : saveError
                      ? t('tickets.saveFailed')
                      : lastSavedAt
                        ? t('tickets.savedAt', {
                            time: lastSavedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
                          })
                        : ''}
                </small>
                <button
                  type="button"
                  className="ticket-detail-footer-btn ticket-detail-footer-btn--primary"
                  disabled={saving}
                  onClick={() => void handleManualSave()}
                >
                  <i className="bi bi-check2" />
                  {t('common.save')}
                </button>
                <button type="button" className="ticket-detail-footer-btn" onClick={handleClose}>
                  {t('common.close')}
                </button>
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

      {/* Recurrence picker */}
      {ticket && (
        <RecurrencePicker
          show={showRecurrencePicker}
          onHide={() => setShowRecurrencePicker(false)}
          initial={recurrence}
          onSave={handleRecurrenceSave}
          onRemove={recurrence ? handleRecurrenceRemove : undefined}
        />
      )}

      {/* Move to board modal */}
      {ticket && (
        <MoveTicketModal
          show={showMoveModal}
          onHide={() => setShowMoveModal(false)}
          onMoved={handleTicketMoved}
          ticket={ticket}
          currentBoardName={boards.find((t) => t.id === ticket.boardId)?.name ?? boardData?.board?.name ?? ''}
          availableBoards={boards.filter((t) => t.id !== ticket.boardId)}
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

                // Build change descriptions with ID->name resolution
                const changeDescriptions: string[] = [];
                if (entry.changes && typeof entry.changes === 'object') {
                  // changes can be Record<string, { from, to }> or AuditChange[]
                  const rawChanges = Array.isArray(entry.changes)
                    ? entry.changes
                    : Object.entries(entry.changes).map(([field, val]) => ({
                        field,
                        from: (val as { from?: unknown })?.from,
                        to: (val as { to?: unknown })?.to,
                      }));

                  // Expand the custom `fields` blob into per-field rows so each
                  // custom field shows up with its own label.
                  const expandedChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
                  for (const change of rawChanges) {
                    if (change.field === 'fields') {
                      expandedChanges.push(...expandCustomFieldChanges(change.from, change.to, config?.fields));
                    } else if (!shouldIgnoreAuditField(change.field)) {
                      expandedChanges.push(change);
                    }
                  }

                  for (const change of expandedChanges) {
                    const fieldLabel = formatAuditFieldLabel(change.field, t);
                    const fromVal = formatAuditValue(change.field, change.from, auditLookups, t);
                    const toVal = formatAuditValue(change.field, change.to, auditLookups, t);

                    if (fromVal && toVal) {
                      changeDescriptions.push(
                        t('tickets.historyFieldChange', { field: fieldLabel, from: fromVal, to: toVal })
                      );
                    } else if (toVal) {
                      changeDescriptions.push(t('tickets.historyFieldSet', { field: fieldLabel, to: toVal }));
                    } else if (fromVal) {
                      changeDescriptions.push(t('tickets.historyFieldCleared', { field: fieldLabel }));
                    }
                  }
                }

                const displayUserName =
                  entry.userName ||
                  (entry.userId
                    ? (config?.staff?.find((s) => s.id === entry.userId)?.name ??
                      config?.staff?.find((s) => s.id === entry.userId)?.email)
                    : null);

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
                      {displayUserName && (
                        <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                          <i className="bi bi-person me-1" />
                          {displayUserName}
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
