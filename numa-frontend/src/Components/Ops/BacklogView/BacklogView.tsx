import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useOps } from '../OpsContext';
import { TicketDetailModal } from '../Modals/TicketDetailModal';
import type { WorkUnit, Ticket } from '../../../types/ops';

/**
 * BacklogView — shows backlog-zone tickets grouped by work unit in an
 * accordion layout. Filter pills at the top let the user scope to a
 * specific group (unassigned backlog, or a planning sprint).
 *
 * Sprint management actions (create, start, complete) have been moved
 * to ZoneSprintStrip in the header. This component only handles
 * display and group navigation.
 */
const BacklogView = () => {
  const { t } = useTranslation('ops');
  const { teamData, workUnits, tickets } = useOps();

  const [filter, setFilter] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Modal state ──────────────────────────────────────────────
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const zones = teamData?.zones ?? [];

  // ── Backlog zone IDs ─────────────────────────────────────────
  const backlogZoneIds = useMemo(
    () => new Set(zones.filter((z) => z.zoneType === 'backlog').map((z) => z.id)),
    [zones],
  );

  // ── Tickets in backlog zones only (exclude archived) ────────
  const backlogTickets = useMemo(
    () => tickets.filter((tk) => backlogZoneIds.has(tk.zoneId) && !tk.archived),
    [tickets, backlogZoneIds],
  );

  // ── Planning work units (shown as accordion groups) ──────────
  const planningUnits = useMemo(
    () => workUnits.filter((wu) => wu.status === 'planning').sort((a, b) => a.order - b.order),
    [workUnits],
  );

  // ── Build groups ─────────────────────────────────────────────
  type TicketGroup = {
    id: string;
    label: string;
    sublabel?: string;
    tickets: Ticket[];
    workUnit?: WorkUnit;
  };

  // ── Backlog stages (ordered) ────────────────────────────────
  const backlogStages = useMemo(() => {
    if (!teamData) return [];
    return teamData.stages.filter((s) => backlogZoneIds.has(s.zoneId)).sort((a, b) => a.order - b.order);
  }, [teamData, backlogZoneIds]);

  const groups = useMemo<TicketGroup[]>(() => {
    const result: TicketGroup[] = [];

    // Unassigned backlog tickets grouped by stage
    const unassigned = backlogTickets.filter((tk) => !tk.workUnitId);
    if (backlogStages.length > 1) {
      // Multiple stages — group by stage
      for (const stage of backlogStages) {
        const stageTickets = unassigned.filter((tk) => tk.stageId === stage.id);
        result.push({
          id: `stage-${stage.id}`,
          label: stage.name,
          tickets: stageTickets,
        });
      }
      // Tickets without a matching stage (safety net)
      const stageIds = new Set(backlogStages.map((s) => s.id));
      const orphans = unassigned.filter((tk) => !stageIds.has(tk.stageId));
      if (orphans.length > 0) {
        result.push({
          id: 'backlog-other',
          label: t('sprints.backlog'),
          tickets: orphans,
        });
      }
    } else {
      // Single or no stages — single backlog group
      result.push({
        id: 'backlog',
        label: t('sprints.backlog'),
        tickets: unassigned,
      });
    }

    // Planning sprint groups
    for (const wu of planningUnits) {
      const wuTickets = backlogTickets.filter((tk) => tk.workUnitId === wu.id);
      result.push({
        id: wu.id,
        label: wu.name,
        sublabel: t('sprints.planning'),
        tickets: wuTickets,
        workUnit: wu,
      });
    }

    return result;
  }, [backlogTickets, backlogStages, planningUnits, t]);

  // ── Filtered groups ──────────────────────────────────────────
  const visibleGroups = useMemo(() => {
    if (filter === null) return groups;
    return groups.filter((g) => g.id === filter);
  }, [groups, filter]);

  // ── Toggle collapse ──────────────────────────────────────────
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // ── Priority badge color ─────────────────────────────────────
  const priorityColor = (p: string) => {
    switch (p) {
      case 'highest':
        return 'bg-danger text-white';
      case 'high':
        return 'bg-warning text-dark';
      case 'low':
        return 'bg-info text-dark';
      case 'lowest':
        return 'bg-light text-muted';
      default:
        return 'bg-light text-muted';
    }
  };

  return (
    <>
      <div className="p-3">
        {/* ── Filter pills (group navigation within the backlog) ─── */}
        <div className="d-flex align-items-center gap-2 mb-3" style={{ overflowX: 'auto' }}>
          <button
            type="button"
            className={`btn btn-sm flex-shrink-0 ${filter === null ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setFilter(null)}
          >
            {t('sprints.all')} [{backlogTickets.length}]
          </button>

          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`btn btn-sm flex-shrink-0 ${filter === group.id ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setFilter(group.id)}
            >
              {group.label} [{group.tickets.length}]
            </button>
          ))}
        </div>

        {/* ── Accordion groups ────────────────────────────────────── */}
        {visibleGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.id);

          return (
            <div key={group.id} className="rounded mb-3" style={{ backgroundColor: '#f1f3f5' }}>
              {/* Group header */}
              <button
                type="button"
                className="btn btn-sm btn-link text-decoration-none text-muted w-100 d-flex align-items-center justify-content-between px-3 py-2"
                onClick={() => toggleGroup(group.id)}
              >
                <span className="d-flex align-items-center gap-2">
                  <i className={`bi bi-chevron-${isCollapsed ? 'right' : 'down'}`} />
                  <span className="fw-semibold text-dark">{group.label}</span>
                  {group.sublabel && <span className="badge bg-info bg-opacity-25 text-info">{group.sublabel}</span>}
                </span>
                <span className="badge bg-secondary rounded-pill">{group.tickets.length}</span>
              </button>

              {/* Group content */}
              {!isCollapsed && (
                <div className="px-3 pb-3">
                  {group.tickets.length === 0 ? (
                    <div className="text-muted small py-2">{t('backlogView.noTickets')}</div>
                  ) : (
                    <div className="d-flex flex-column gap-1">
                      {group.tickets
                        .sort((a, b) => a.order - b.order)
                        .map((ticket) => (
                          <button
                            key={ticket.id}
                            type="button"
                            className="btn btn-light text-start d-flex align-items-center gap-2 py-2 px-3 rounded"
                            onClick={() => {
                              setDetailTicketId(ticket.id);
                              setShowDetail(true);
                            }}
                          >
                            <small className="text-muted flex-shrink-0">{ticket.displayId}</small>
                            <span className="text-truncate">{ticket.title}</span>
                            {ticket.priority && (
                              <span className={`ms-auto badge ${priorityColor(ticket.priority)} small flex-shrink-0`}>
                                {ticket.priority}
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {backlogTickets.length === 0 && (
          <div className="d-flex flex-column align-items-center justify-content-center text-muted py-5">
            <i className="bi bi-card-list fs-1 mb-2" />
            <span>{t('backlogView.empty')}</span>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────── */}
      <TicketDetailModal
        show={showDetail}
        ticketId={detailTicketId}
        onHide={() => {
          setShowDetail(false);
          setDetailTicketId(null);
        }}
      />
    </>
  );
};

export default BacklogView;
