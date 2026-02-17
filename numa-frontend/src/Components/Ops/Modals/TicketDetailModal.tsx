import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import Tab from 'react-bootstrap/Tab';
import Nav from 'react-bootstrap/Nav';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useOps } from '../OpsContext';
import * as OpsService from '../../../Services/OpsService';
import type { Ticket, TicketLink, TicketPriority, TicketType, FieldDefinition } from '../../../types/ops';
import { CommentSection } from '../Shared/CommentSection';
import { LinkedTicketsSection } from '../Shared/LinkedTicketsSection';
import { DynamicField } from '../Shared/DynamicField';
import { ConfirmModal } from './ConfirmModal';
import { getContrastTextColor } from '../Shared/colorUtils';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TicketDetailModalProps {
  show: boolean;
  ticketId: string | null;
  onHide: () => void;
  onDeleted?: () => void;
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
export function TicketDetailModal({ show, ticketId, onHide, onDeleted }: TicketDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { numaGet, numaPut, numaDelete } = useNumaRequest();
  const [archiving, setArchiving] = useState(false);
  const { config, teamData, workUnits, refreshTickets } = useOps();

  // ── Core state ──────────────────────────────────────────────────────────
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('description');

  // ── Inline editing state ────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Ref for title input auto-focus ──────────────────────────────────────
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // ── Derived data ────────────────────────────────────────────────────────
  const ticketType: TicketType | undefined = ticket
    ? config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId)
    : undefined;

  const team = teamData?.team ?? null;

  // ── Load ticket ─────────────────────────────────────────────────────────

  const loadTicket = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await OpsService.getTicket(numaGet, ticketId, team?.id);
      setTicket(response.ticket);
      setLinks(response.links ?? []);
    } catch (err) {
      console.error('[TicketDetailModal] Failed to load ticket', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [numaGet, ticketId, team?.id]);

  useEffect(() => {
    if (show && ticketId) {
      void loadTicket();
      // Reset editing states when opening
      setEditingTitle(false);
      setEditingDescription(false);
      setEditingTags(false);
      setEditingDueDate(false);
      setActiveTab('description');
    }
    if (!show) {
      setTicket(null);
      setLinks([]);
      setError(null);
    }
  }, [show, ticketId, loadTicket]);

  // ── Auto-focus title input ──────────────────────────────────────────────

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingDescription && descriptionRef.current) {
      descriptionRef.current.focus();
    }
  }, [editingDescription]);

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
    [ticket, ticketId, numaPut, refreshTickets, loadTicket, t],
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

  // ── Description editing handlers ────────────────────────────────────────

  const startEditDescription = () => {
    if (!ticket) return;
    setDescriptionDraft(ticket.description);
    setEditingDescription(true);
  };

  const saveDescription = async () => {
    if (descriptionDraft === ticket?.description) {
      setEditingDescription(false);
      return;
    }
    await handleUpdate({ description: descriptionDraft });
    setEditingDescription(false);
  };

  const cancelDescription = () => {
    setEditingDescription(false);
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

  // ── Due date editing handlers ─────────────────────────────────────────

  const startEditDueDate = () => {
    if (!ticket) return;
    setDueDateDraft(toDateInputValue(ticket.dueDate));
    setEditingDueDate(true);
  };

  const saveDueDate = async () => {
    const value = dueDateDraft || null;
    await handleUpdate({ dueDate: value });
    setEditingDueDate(false);
  };

  const cancelDueDate = () => {
    setEditingDueDate(false);
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
      const updatedFields = { ...(ticket.fields ?? ticket.customFields ?? {}), [fieldId]: value };
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
    return ticketType.defaultFields
      .map((fieldId) => {
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

  // ── Render: Sidebar field row ─────────────────────────────────────────

  const renderSidebarRow = (label: string, value: React.ReactNode, onClickEdit?: () => void) => (
    <div
      className="d-flex align-items-start justify-content-between py-2 border-bottom"
      style={{ fontSize: '0.875rem' }}
    >
      <span className="text-muted fw-semibold me-2" style={{ minWidth: 90, flexShrink: 0 }}>
        {label}
      </span>
      <span
        className="text-end flex-grow-1"
        style={{ cursor: onClickEdit ? 'pointer' : 'default', minWidth: 0 }}
        onClick={onClickEdit}
        role={onClickEdit ? 'button' : undefined}
        tabIndex={onClickEdit ? 0 : undefined}
        onKeyDown={
          onClickEdit
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') onClickEdit();
              }
            : undefined
        }
      >
        {value}
      </span>
    </div>
  );

  // ── Render: Lifecycle dates ───────────────────────────────────────────

  const renderLifecycleDates = () => {
    if (!ticket) return null;
    const dates = [
      { label: t('tickets.created'), value: ticket.createdAt },
      { label: t('tickets.started'), value: ticket.startedAt },
      { label: t('tickets.scoped'), value: ticket.scopedAt },
      { label: t('tickets.completed'), value: ticket.completedAt },
      { label: t('tickets.ended'), value: ticket.endedAt },
    ];

    return (
      <div className="d-flex flex-wrap gap-3 px-3 py-2 border-top bg-light" style={{ fontSize: '0.8rem' }}>
        {dates.map(({ label, value }) => (
          <div key={label} className="d-flex gap-1">
            <span className="text-muted fw-semibold">{label}:</span>
            <span>{formatDate(value)}</span>
          </div>
        ))}
      </div>
    );
  };

  // ── Render: History tab ───────────────────────────────────────────────

  const renderHistory = () => {
    if (!ticket) return null;

    // For now, show the ticket lifecycle dates as a timeline
    const events: { label: string; date: string | null | undefined; icon: string }[] = [
      { label: t('tickets.created'), date: ticket.createdAt, icon: 'bi-plus-circle' },
      { label: t('tickets.scoped'), date: ticket.scopedAt, icon: 'bi-bullseye' },
      { label: t('tickets.started'), date: ticket.startedAt, icon: 'bi-play-circle' },
      { label: t('tickets.completed'), date: ticket.completedAt, icon: 'bi-check-circle' },
      { label: t('tickets.ended'), date: ticket.endedAt, icon: 'bi-stop-circle' },
    ];

    return (
      <div className="py-2">
        {events.map(({ label, date, icon }) => (
          <div key={label} className="d-flex align-items-center gap-2 mb-2">
            <i className={`bi ${icon} text-muted`} />
            <span className="fw-semibold small">{label}</span>
            <span className="text-muted small ms-auto">{date ? formatDate(date) : '\u2014'}</span>
          </div>
        ))}

        {/* Show created by info */}
        <div className="mt-3 pt-2 border-top">
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-person text-muted" />
            <span className="small">
              <span className="fw-semibold">{ticket.createdByName}</span>
              <span className="text-muted ms-2">{relativeTimeShort(ticket.createdAt)}</span>
            </span>
          </div>
        </div>
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

    return (
      <div style={{ fontSize: '0.875rem' }}>
        {/* Status (stage selector grouped by zone) */}
        {renderSidebarRow(
          t('tickets.status'),
          <Form.Select
            size="sm"
            value={ticket.stageId}
            onChange={(e) => {
              const newStageId = e.target.value;
              const stage = allStages.find((s) => s.id === newStageId);
              void handleUpdate({ stageId: newStageId, zoneId: stage?.zoneId });
            }}
            style={{ fontSize: '0.85rem' }}
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
          </Form.Select>,
        )}

        {/* Priority */}
        {renderSidebarRow(
          t('tickets.priority'),
          <Form.Select
            size="sm"
            value={ticket.priority}
            onChange={(e) => void handleUpdate({ priority: e.target.value as TicketPriority })}
            style={{ fontSize: '0.85rem' }}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </Form.Select>,
        )}

        {/* Assignee */}
        {renderSidebarRow(
          t('tickets.assignee'),
          <Form.Select
            size="sm"
            value={ticket.assigneeId ?? ''}
            onChange={(e) => void handleUpdate({ assigneeId: e.target.value || null })}
            style={{ fontSize: '0.85rem' }}
          >
            <option value="">{t('fields.unassigned')}</option>
            {staff
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Form.Select>,
        )}

        {/* Created by (read-only) */}
        {renderSidebarRow(t('tickets.createdBy'), <span>{ticket.createdByName}</span>)}

        {/* Due Date */}
        {renderSidebarRow(
          t('tickets.dueDate'),
          editingDueDate ? (
            <div className="d-flex gap-1 align-items-center">
              <Form.Control
                type="date"
                size="sm"
                value={dueDateDraft}
                onChange={(e) => setDueDateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveDueDate();
                  if (e.key === 'Escape') cancelDueDate();
                }}
                style={{ fontSize: '0.85rem' }}
                autoFocus
              />
              <Button variant="link" size="sm" className="p-0" onClick={() => void saveDueDate()}>
                <i className="bi bi-check text-success" />
              </Button>
              <Button variant="link" size="sm" className="p-0" onClick={cancelDueDate}>
                <i className="bi bi-x text-danger" />
              </Button>
            </div>
          ) : (
            <span className="text-decoration-underline-hover">
              {ticket.dueDate ? new Date(ticket.dueDate).toLocaleDateString() : t('common.none')}
            </span>
          ),
          editingDueDate ? undefined : startEditDueDate,
        )}

        {/* Project */}
        {renderSidebarRow(
          t('tickets.project'),
          <Form.Select
            size="sm"
            value={ticket.projectId ?? ''}
            onChange={(e) => void handleUpdate({ projectId: e.target.value || null })}
            style={{ fontSize: '0.85rem' }}
          >
            <option value="">{t('common.none')}</option>
            {projects
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Form.Select>,
        )}

        {/* Customer (read-only) */}
        {ticket.customerName && renderSidebarRow(t('tickets.customer'), <span>{ticket.customerName}</span>)}

        {/* Supplier (read-only) */}
        {ticket.supplierName && renderSidebarRow(t('tickets.supplier'), <span>{ticket.supplierName}</span>)}

        {/* Work Unit (sprint) */}
        {hasWorkUnits &&
          renderSidebarRow(
            t('tickets.workUnit'),
            <Form.Select
              size="sm"
              value={ticket.workUnitId ?? ''}
              onChange={(e) => void handleUpdate({ workUnitId: e.target.value || null })}
              style={{ fontSize: '0.85rem' }}
            >
              <option value="">{t('common.none')}</option>
              {workUnits.map((wu) => (
                <option key={wu.id} value={wu.id}>
                  {wu.name}
                </option>
              ))}
            </Form.Select>,
          )}

        {/* Tags */}
        {renderSidebarRow(
          t('tickets.tags'),
          editingTags ? (
            <div>
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
            </div>
          ) : (
            <div className="d-flex flex-wrap gap-1 justify-content-end">
              {ticket.tags.length > 0 ? (
                ticket.tags.map((tag) => (
                  <Badge key={tag} bg="light" text="dark" className="border" style={{ fontSize: '0.75rem' }}>
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-muted">{t('common.none')}</span>
              )}
            </div>
          ),
          editingTags ? undefined : startEditTags,
        )}

        {/* Custom / Dynamic Fields */}
        {getVisibleFields().length > 0 && (
          <div className="mt-3 pt-2 border-top">
            <div className="text-muted fw-semibold small mb-2">{t('fields.dynamicFields')}</div>
            {getVisibleFields().map(({ field, override }) => (
              <DynamicField
                key={field.id}
                field={field}
                value={(ticket.fields ?? ticket.customFields)?.[field.id] ?? field.defaultValue ?? null}
                onChange={(value) => void handleCustomFieldChange(field.id, value)}
                compact
                fieldOverride={override}
                staff={config.staff}
              />
            ))}
          </div>
        )}

        {/* Archive / Unarchive + Delete */}
        <div className="mt-4 pt-3 border-top d-flex flex-column gap-2">
          <Button
            variant={ticket.archived ? 'outline-success' : 'outline-warning'}
            size="sm"
            className="w-100"
            disabled={archiving}
            onClick={() => void handleToggleArchive()}
          >
            <i className={`bi ${ticket.archived ? 'bi-arrow-counterclockwise' : 'bi-archive'} me-1`} />
            {ticket.archived ? t('archive.unarchive') : t('archive.archive')}
          </Button>
          <Button variant="outline-danger" size="sm" className="w-100" onClick={() => setShowDeleteConfirm(true)}>
            <i className="bi bi-trash me-1" />
            {t('common.delete')}
          </Button>
        </div>
      </div>
    );
  };

  // ── Render: Header ────────────────────────────────────────────────────

  const renderHeader = () => {
    if (!ticket) return null;

    const typeColor = ticketType?.color ?? '#6c757d';
    const typeTextColor = getContrastTextColor(typeColor);

    return (
      <Modal.Header closeButton className="align-items-start">
        <div className="d-flex align-items-center gap-2 flex-grow-1 me-2" style={{ minWidth: 0 }}>
          {/* Display ID badge colored by ticket type */}
          <Badge
            pill
            style={{
              backgroundColor: typeColor,
              color: typeTextColor,
              fontSize: '0.8rem',
              flexShrink: 0,
            }}
          >
            {ticketType?.icon && <i className={`${getTicketTypeIconClass(ticketType.icon)} me-1`} />}
            {ticket.displayId}
          </Badge>

          {/* Archived badge */}
          {ticket.archived && (
            <Badge bg="warning" text="dark" className="flex-shrink-0">
              <i className="bi bi-archive me-1" />
              {t('archive.archived')}
            </Badge>
          )}

          {/* Title: inline-editable */}
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
              className="fw-bold"
              style={{ fontSize: '1.1rem' }}
              disabled={saving}
            />
          ) : (
            <h5
              className="mb-0 fw-bold text-truncate"
              style={{ cursor: 'pointer', flexGrow: 1, minWidth: 0 }}
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

          {saving && <Spinner animation="border" size="sm" className="ms-2 flex-shrink-0" />}
        </div>
      </Modal.Header>
    );
  };

  // ── Render: Main body ─────────────────────────────────────────────────

  const renderBody = () => {
    if (!ticket || !config) return null;

    return (
      <div className="d-flex" style={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
        {/* Left column: tabbed content (~65%) */}
        <div className="flex-grow-1 pe-3 border-end" style={{ flex: '0 0 65%', maxWidth: '65%', overflowY: 'auto' }}>
          <Tab.Container activeKey={activeTab} onSelect={(k) => setActiveTab(k ?? 'description')}>
            <Nav variant="tabs" className="mb-3">
              <Nav.Item>
                <Nav.Link eventKey="description">{t('tickets.description')}</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="comments">
                  {t('tickets.comments')}
                  {ticket.commentCount > 0 && (
                    <Badge bg="secondary" className="ms-1" style={{ fontSize: '0.7rem' }}>
                      {ticket.commentCount}
                    </Badge>
                  )}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="links">
                  {t('tickets.links')}
                  {ticket.linkCount > 0 && (
                    <Badge bg="secondary" className="ms-1" style={{ fontSize: '0.7rem' }}>
                      {ticket.linkCount}
                    </Badge>
                  )}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="history">{t('tickets.history')}</Nav.Link>
              </Nav.Item>
            </Nav>

            <Tab.Content>
              {/* Description Tab */}
              <Tab.Pane eventKey="description">
                {editingDescription ? (
                  <div>
                    <Form.Control
                      as="textarea"
                      ref={descriptionRef}
                      rows={10}
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveDescription();
                        if (e.key === 'Escape') cancelDescription();
                      }}
                      style={{ fontSize: '0.9rem', resize: 'vertical' }}
                      disabled={saving}
                    />
                    <div className="d-flex gap-2 mt-2">
                      <Button size="sm" variant="primary" onClick={() => void saveDescription()} disabled={saving}>
                        {t('common.save')}
                      </Button>
                      <Button size="sm" variant="outline-secondary" onClick={cancelDescription}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="p-2 rounded"
                    style={{
                      cursor: 'pointer',
                      minHeight: 100,
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.9rem',
                      backgroundColor: '#f8f9fa',
                    }}
                    onClick={startEditDescription}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') startEditDescription();
                    }}
                  >
                    {ticket.description || <span className="text-muted">{t('common.description')}</span>}
                  </div>
                )}
              </Tab.Pane>

              {/* Comments Tab */}
              <Tab.Pane eventKey="comments">
                <CommentSection ticketId={ticket.id} />
              </Tab.Pane>

              {/* Links Tab */}
              <Tab.Pane eventKey="links">
                <LinkedTicketsSection ticketId={ticket.id} links={links} onRefresh={reloadTicket} />
              </Tab.Pane>

              {/* History Tab */}
              <Tab.Pane eventKey="history">{renderHistory()}</Tab.Pane>
            </Tab.Content>
          </Tab.Container>
        </div>

        {/* Right column: sidebar fields (~35%) */}
        <div className="ps-3" style={{ flex: '0 0 35%', maxWidth: '35%', overflowY: 'auto' }}>
          {renderSidebar()}
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
        scrollable
        dialogClassName="ticket-detail-modal"
        contentClassName="d-flex flex-column"
        style={{ maxHeight: '90vh' }}
      >
        {loading && renderLoading()}
        {!loading && error && renderError()}
        {!loading && !error && ticket && (
          <>
            {renderHeader()}
            <Modal.Body className="d-flex flex-column" style={{ overflow: 'hidden', flex: 1 }}>
              {renderBody()}
            </Modal.Body>
            {renderLifecycleDates()}
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

      {/* Inline style for the modal height override */}
      <style>{`
        .ticket-detail-modal {
          max-height: 90vh;
        }
        .ticket-detail-modal .modal-content {
          max-height: 90vh;
        }
      `}</style>
    </>
  );
}
