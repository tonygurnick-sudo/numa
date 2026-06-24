import type { Ticket, WorkUnit } from '../../types/ops';

/**
 * Old-work / completed-work filtering helpers (BUG-369).
 *
 * "Old work" is derived from status + sprint state + the legacy archive flag:
 *   - past-sprint work  = ticket sits on a sprint (work unit) that has closed
 *   - terminal work     = ticket is itself completed/ended
 *   - legacy archived   = ticket carries the old `archived` flag (pre-rework
 *                         data). In Ian's prototype "archive" just meant
 *                         completed/filed, so we treat it as old work.
 *
 * Active views (board, backlog) hide old work by default so they stay focused
 * on live work. The All Tickets view hides old work unless the user opts in via
 * the "show completed/old work" toggle.
 */

/** Work unit IDs for sprints that have been completed (closed). */
export const getCompletedWorkUnitIds = (workUnits: WorkUnit[]): Set<string> =>
  new Set(workUnits.filter((wu) => wu.status === 'completed').map((wu) => wu.id));

/** A ticket belongs to a closed (past) sprint. */
export const isPastSprintWork = (ticket: Pick<Ticket, 'workUnitId'>, completedWorkUnitIds: Set<string>): boolean =>
  !!ticket.workUnitId && completedWorkUnitIds.has(ticket.workUnitId);

/** A ticket is in a terminal (done) state. */
export const isTerminalTicket = (ticket: Pick<Ticket, 'statusType'>): boolean =>
  ticket.statusType === 'completed' || ticket.statusType === 'ended';

/** Carries the legacy `archived` flag (pre-rework data) — treated as old work. */
export const isLegacyArchived = (ticket: Pick<Ticket, 'archived'>): boolean => ticket.archived === true;

/**
 * Hidden from the active board: past-sprint work or legacy-archived work. (The
 * board still shows terminal tickets in the active sprint's Done column, so
 * terminal alone is not enough here.)
 */
export const isHiddenFromBoard = (
  ticket: Pick<Ticket, 'workUnitId' | 'archived'>,
  completedWorkUnitIds: Set<string>
): boolean => isPastSprintWork(ticket, completedWorkUnitIds) || isLegacyArchived(ticket);

/**
 * "Old / completed work" as surfaced by the All Tickets toggle and excluded
 * from the backlog: a closed sprint, a terminal status, or legacy archived.
 */
export const isOldOrCompletedWork = (
  ticket: Pick<Ticket, 'workUnitId' | 'statusType' | 'archived'>,
  completedWorkUnitIds: Set<string>
): boolean => isPastSprintWork(ticket, completedWorkUnitIds) || isTerminalTicket(ticket) || isLegacyArchived(ticket);

/**
 * Work units a ticket can be assigned to: the active sprint plus future
 * (planning) sprints, sorted (active first, then planning by order). Completed
 * sprints are not assignable — you don't drop new work into a closed sprint.
 *
 * If the ticket already sits on a closed sprint, that one is appended so its
 * badge still renders, but no other closed sprints are offered. (BUG-369)
 */
export const getAssignableWorkUnits = (workUnits: WorkUnit[], currentWorkUnitId?: string | null): WorkUnit[] => {
  const assignable = workUnits
    .filter((wu) => wu.status === 'active' || wu.status === 'planning')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  if (currentWorkUnitId && !assignable.some((wu) => wu.id === currentWorkUnitId)) {
    const current = workUnits.find((wu) => wu.id === currentWorkUnitId);
    if (current) assignable.push(current);
  }
  return assignable;
};
