import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Ticket } from '../../../types/ops';
import { useOps } from '../OpsContext';
import { getTicketTypeIconClass } from '../../../constants/opsConstants';
import { PriorityIndicator } from '../Shared/PriorityIndicator';
import { StaffAvatar } from '../Shared/StaffAvatar';
import { formatDueDate, formatRelativeDate } from '../Shared/ticketUtils';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip HTML tags and return plain text (safe — uses DOMParser, no script execution). */
function stripHtml(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent?.trim() ?? '';
  } catch {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TicketCardProps {
  ticket: Ticket;
  onClick: (ticket: Ticket) => void;
  onContextMenu: (e: React.MouseEvent, ticket: Ticket) => void;
  onAssign?: (ticketId: string, assigneeId: string | null, version: number) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TicketCard({ ticket, onClick, onContextMenu, onAssign }: TicketCardProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const { config, workUnits } = useOps();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id });

  const style: React.CSSProperties = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: transition ?? undefined,
      opacity: isDragging ? 0.4 : 1,
    }),
    [transform, transition, isDragging]
  );

  const ticketType = config?.ticketTypes.find((tt) => tt.id === ticket.ticketTypeId);
  const workUnit = ticket.workUnitId ? workUnits.find((wu) => wu.id === ticket.workUnitId) : null;
  const dueDateInfo = useMemo(() => formatDueDate(ticket.dueDate), [ticket.dueDate]);

  const typeColor = ticketType?.color ?? '#6c757d';

  const assigneeStaff = useMemo(
    () => (ticket.assigneeId ? config?.staff?.find((s) => s.id === ticket.assigneeId) : undefined),
    [ticket.assigneeId, config?.staff]
  );

  // ── Inline hover preview state ──────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const computePreviewPosition = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return { top: 0, left: 0 };

    const PREVIEW_WIDTH = 320;
    const PREVIEW_MAX_HEIGHT = 300;
    const GAP = 8;

    // Prefer right side; fall back to left if not enough space
    const spaceRight = window.innerWidth - rect.right;
    let left: number;
    if (spaceRight >= PREVIEW_WIDTH + GAP) {
      left = rect.right + GAP;
    } else {
      left = rect.left - PREVIEW_WIDTH - GAP;
    }
    // Clamp left to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - PREVIEW_WIDTH - 8));

    // Vertically align to card top; clamp to viewport
    let top = rect.top;
    if (top + PREVIEW_MAX_HEIGHT > window.innerHeight - 8) {
      top = window.innerHeight - PREVIEW_MAX_HEIGHT - 8;
    }
    top = Math.max(8, top);

    return { top, left };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (isDragging) return;
    hoverTimerRef.current = setTimeout(() => {
      setPreviewPos(computePreviewPosition());
      setShowPreview(true);
    }, 500);
  }, [isDragging, computePreviewPosition]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShowPreview(false);
  }, []);

  // Clean up timer on unmount or when dragging starts
  useEffect(() => {
    if (isDragging) {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setShowPreview(false);
    }
  }, [isDragging]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Derive preview data
  const descriptionPlain = useMemo(() => stripHtml(ticket.description), [ticket.description]);

  const projectName = useMemo(() => {
    if (!ticket.projectId || !config?.projects) return null;
    return config.projects.find((p) => p.id === ticket.projectId)?.name ?? null;
  }, [ticket.projectId, config?.projects]);

  const customFieldEntries = useMemo(() => {
    if (!ticket.fields || !config?.fields) return [];
    return Object.entries(ticket.fields)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([fieldId, value]) => {
        const def = config.fields.find((f) => f.id === fieldId);
        return { label: def?.name ?? fieldId, value: String(value) };
      })
      .slice(0, 4);
  }, [ticket.fields, config?.fields]);

  const linkedSummaryParts = useMemo(() => {
    const parts: string[] = [];
    if (ticket.linkCount > 0) parts.push(t('preview.linked', { count: ticket.linkCount }));
    if (ticket.isBlocking) parts.push(t('preview.blocking', { count: 1 }));
    if (ticket.hasUnresolvedDependencies) parts.push(t('preview.depends', { count: 1 }));
    return parts.join(', ');
  }, [ticket.linkCount, ticket.isBlocking, ticket.hasUnresolvedDependencies, t]);

  const setCardRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      cardRef.current = node as HTMLDivElement | null;
    },
    [setNodeRef]
  );

  const handleClick = useCallback(() => {
    onClick(ticket);
  }, [onClick, ticket]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onContextMenu(e, ticket);
    },
    [onContextMenu, ticket]
  );

  // ── Avatar assign picker state ──────────────────────────────────────────
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const avatarRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAssignPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAssignPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAssignPicker]);

  const handleAvatarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onAssign) return;
      // Compute position from the avatar element
      const rect = avatarRef.current?.getBoundingClientRect();
      if (rect) {
        const PICKER_HEIGHT = 240;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openBelow = spaceBelow >= PICKER_HEIGHT;
        setPickerPos({
          top: openBelow ? rect.bottom + 4 : rect.top - PICKER_HEIGHT - 4,
          left: Math.max(8, rect.right - 200),
        });
      }
      setShowAssignPicker((prev) => !prev);
    },
    [onAssign]
  );

  const handlePickAssignee = useCallback(
    (assigneeId: string | null) => {
      setShowAssignPicker(false);
      onAssign?.(ticket.id, assigneeId, ticket.version);
    },
    [onAssign, ticket.id, ticket.version]
  );

  const activeStaff = useMemo(() => config?.staff?.filter((s) => s.isActive) ?? [], [config?.staff]);

  return (
    <div
      ref={setCardRef}
      style={style}
      className="ticket-card"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...attributes}
      {...listeners}
    >
      {/* ── Hover action buttons ─────────────────────────────────── */}
      <div className="ticket-card-actions">
        <button
          className="ticket-card-action-btn"
          title={t('common.edit')}
          onClick={(e) => {
            e.stopPropagation();
            onClick(ticket);
          }}
        >
          <i className="bi bi-pencil" />
        </button>
        <button
          className="ticket-card-action-btn ticket-card-action-danger"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e, ticket);
          }}
        >
          <i className="bi bi-trash" />
        </button>
      </div>

      {/* ── Top: type badge + meta counts ──────────────────────────── */}
      <div className="ticket-card-top">
        <span
          className="ticket-type-badge"
          style={{
            backgroundColor: `${typeColor}18`,
            color: typeColor,
            border: `1px solid ${typeColor}35`,
          }}
        >
          {ticketType?.icon && (
            <i className={`${getTicketTypeIconClass(ticketType.icon)} me-1`} style={{ fontSize: '0.65rem' }} />
          )}
          {ticketType?.name ?? '—'}
        </span>

        {(ticket.linkCount > 0 || ticket.commentCount > 0 || ticket.hasUnresolvedDependencies || ticket.isBlocking) && (
          <div className="d-flex align-items-center gap-2 ms-auto">
            {ticket.linkCount > 0 && (
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{`${ticket.linkCount} link${ticket.linkCount !== 1 ? 's' : ''}`}</Tooltip>}
              >
                <span className="ticket-meta-chip">
                  <i className="bi bi-link-45deg" /> {ticket.linkCount}
                </span>
              </OverlayTrigger>
            )}
            {ticket.hasUnresolvedDependencies && (
              <OverlayTrigger placement="top" overlay={<Tooltip>{t('linkedTickets.depends')}</Tooltip>}>
                <span
                  style={{
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    lineHeight: 1.4,
                  }}
                >
                  <i className="bi bi-clock me-1" style={{ fontSize: '0.55rem' }} />
                  {t('linkedTickets.depends')}
                </span>
              </OverlayTrigger>
            )}
            {ticket.isBlocking && (
              <OverlayTrigger placement="top" overlay={<Tooltip>{t('linkedTickets.blocking')}</Tooltip>}>
                <span
                  style={{
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    lineHeight: 1.4,
                  }}
                >
                  <i className="bi bi-ban me-1" style={{ fontSize: '0.55rem' }} />
                  {t('linkedTickets.blocking')}
                </span>
              </OverlayTrigger>
            )}
            {ticket.commentCount > 0 && (
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{`${ticket.commentCount} comment${ticket.commentCount !== 1 ? 's' : ''}`}</Tooltip>}
              >
                <span className="ticket-meta-chip">
                  <i className="bi bi-chat" /> {ticket.commentCount}
                </span>
              </OverlayTrigger>
            )}
          </div>
        )}
      </div>

      {/* ── Context badges (customer / supplier / sprint) ───────────── */}
      {(ticket.customerName || ticket.supplierName || workUnit) && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.customerName && (
            <span className="ticket-badge ticket-badge-customer">
              <i className="bi bi-building me-1" />
              {ticket.customerName}
            </span>
          )}
          {ticket.supplierName && (
            <span className="ticket-badge ticket-badge-supplier">
              <i className="bi bi-truck me-1" />
              {ticket.supplierName}
            </span>
          )}
          {workUnit && (
            <span className="ticket-badge ticket-badge-sprint">
              <i className="bi bi-circle-fill me-1" style={{ fontSize: '0.28rem', verticalAlign: 'middle' }} />
              {workUnit.name}
            </span>
          )}
        </div>
      )}

      {/* ── Title ──────────────────────────────────────────────────── */}
      <p className="ticket-title">{ticket.title}</p>

      {/* ── Tags (max 2 + overflow count) ──────────────────────────── */}
      {ticket.tags && ticket.tags.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {ticket.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="ticket-tag">
              {tag}
            </span>
          ))}
          {ticket.tags.length > 2 && <span className="ticket-tag ticket-tag-overflow">+{ticket.tags.length - 2}</span>}
        </div>
      )}

      {/* ── Footer: ID · effort · due date | priority · avatar ─────── */}
      <div className="ticket-card-footer">
        <div className="d-flex align-items-center gap-2">
          <span className="ticket-id">{ticket.displayId}</span>

          {ticket.effortPoints != null && (
            <span className="ticket-effort-pill">
              <i className="bi bi-bar-chart-fill" style={{ fontSize: '0.58rem' }} /> {ticket.effortPoints}
            </span>
          )}

          {dueDateInfo && (
            <span className={`ticket-due-date ${dueDateInfo.className}`}>
              <i className="bi bi-calendar3 me-1" style={{ fontSize: '0.58rem' }} />
              {dueDateInfo.text}
            </span>
          )}
        </div>

        <div className="d-flex align-items-center gap-1">
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                {ticket.priority ? ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1) : 'Priority'}
              </Tooltip>
            }
          >
            <div style={{ display: 'inline-block' }}>
              <PriorityIndicator priority={ticket.priority} />
            </div>
          </OverlayTrigger>

          <span
            ref={avatarRef}
            role="button"
            tabIndex={0}
            title={
              assigneeStaff ? assigneeStaff.name || assigneeStaff.email : (ticket.assigneeName ?? t('card.unassigned'))
            }
            style={{ cursor: onAssign ? 'pointer' : 'default' }}
            onClick={handleAvatarClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleAvatarClick(e as unknown as React.MouseEvent);
            }}
          >
            {assigneeStaff || ticket.assigneeName ? (
              <StaffAvatar staff={assigneeStaff} name={!assigneeStaff ? ticket.assigneeName : undefined} size={22} />
            ) : (
              <div className="ticket-avatar ticket-avatar-empty">
                <i className="bi bi-person" style={{ fontSize: '0.72rem' }} />
              </div>
            )}
          </span>
        </div>

        {/* ── Assignee quick-pick dropdown (portal) ──────────────── */}
        {showAssignPicker &&
          createPortal(
            <div
              ref={pickerRef}
              className="bg-white border rounded shadow-sm"
              style={{
                position: 'fixed',
                top: pickerPos.top,
                left: pickerPos.left,
                width: 200,
                maxHeight: 240,
                overflowY: 'auto',
                zIndex: 9999,
                fontSize: '0.82rem',
              }}
            >
              <div
                role="menuitem"
                tabIndex={0}
                className="px-2 py-1 text-muted"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePickAssignee(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    handlePickAssignee(null);
                  }
                }}
              >
                {t('fields.unassigned')}
              </div>
              {activeStaff.map((s) => (
                <div
                  key={s.id}
                  role="menuitem"
                  tabIndex={0}
                  className="d-flex align-items-center gap-2 px-2 py-1"
                  style={{
                    cursor: 'pointer',
                    backgroundColor: s.id === ticket.assigneeId ? '#eef2ff' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor =
                      s.id === ticket.assigneeId ? '#eef2ff' : '#f8f9fa';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor =
                      s.id === ticket.assigneeId ? '#eef2ff' : 'transparent';
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePickAssignee(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      handlePickAssignee(s.id);
                    }
                  }}
                >
                  <StaffAvatar staff={s} size={20} />
                  <span className="text-truncate">{s.name || s.email}</span>
                </div>
              ))}
            </div>,
            document.body
          )}
      </div>

      {/* ── Inline hover preview (portal) ─────────────────────────── */}
      {showPreview &&
        !isDragging &&
        createPortal(
          <div className="ops-ticket-preview" style={{ top: previewPos.top, left: previewPos.left }}>
            <div className="ops-ticket-preview-title">{ticket.title}</div>

            {descriptionPlain ? (
              <div className="ops-ticket-preview-desc">{descriptionPlain}</div>
            ) : (
              <div className="ops-ticket-preview-desc" style={{ fontStyle: 'italic' }}>
                {t('preview.noDescription')}
              </div>
            )}

            <hr className="ops-ticket-preview-separator" />

            <div className="ops-ticket-preview-meta">
              {/* Priority + Assignee row */}
              <div className="ops-ticket-preview-meta-row">
                <i className="bi bi-flag" />
                <span>
                  {ticket.priority ? ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1) : 'None'}
                </span>
                <span className="text-muted mx-1">|</span>
                <i className="bi bi-person" />
                <span>{assigneeStaff?.name || ticket.assigneeName || t('card.unassigned')}</span>
              </div>

              {/* Customer */}
              {ticket.customerName && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-building" />
                  <span>{ticket.customerName}</span>
                </div>
              )}

              {/* Effort points */}
              {ticket.effortPoints != null && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-bar-chart-fill" />
                  <span>
                    {ticket.effortPoints} {t('preview.effortPoints', { defaultValue: 'points' })}
                  </span>
                </div>
              )}

              {/* Tags */}
              {ticket.tags && ticket.tags.length > 0 && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-tags" />
                  <span>
                    {ticket.tags.slice(0, 4).join(', ')}
                    {ticket.tags.length > 4 ? ` +${ticket.tags.length - 4}` : ''}
                  </span>
                </div>
              )}

              {/* Comments */}
              {ticket.commentCount > 0 && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-chat" />
                  <span>
                    {ticket.commentCount === 1
                      ? t('preview.comment', { count: 1 })
                      : t('preview.comments', { count: ticket.commentCount })}
                  </span>
                </div>
              )}

              {/* Linked tickets */}
              {linkedSummaryParts && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-link-45deg" />
                  <span>{linkedSummaryParts}</span>
                </div>
              )}

              {/* Project */}
              {projectName && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-folder" />
                  <span>{t('preview.project', { name: projectName })}</span>
                </div>
              )}

              {/* Last updated */}
              {ticket.updatedAt && (
                <div className="ops-ticket-preview-meta-row">
                  <i className="bi bi-clock-history" />
                  <span>{t('preview.lastUpdated', { date: formatRelativeDate(ticket.updatedAt) })}</span>
                </div>
              )}
            </div>

            {/* Custom fields */}
            {customFieldEntries.length > 0 && (
              <div className="ops-ticket-preview-fields">
                {customFieldEntries.map((f) => (
                  <span key={f.label} className="ops-ticket-preview-field">
                    {f.label}: {f.value}
                  </span>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
