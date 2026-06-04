import type { AccessControl, StaffProfile } from '../../../types/ops';

type BoardMembership = {
  accessControl?: AccessControl;
  createdBy?: string;
};

/**
 * Resolve the staff members that belong to a board.
 *
 * - `accessControl.mode === 'specific'` → only the explicitly listed users
 *   (kept regardless of `isActive`, so an admin-pinned member doesn't silently
 *   disappear when deactivated).
 * - Any other mode (`'all'`, `'inherit'`, undefined) → all active staff.
 * - The board's `createdBy` is always included.
 */
export function resolveBoardMembers(
  board: BoardMembership | null | undefined,
  staff: StaffProfile[] | undefined
): StaffProfile[] {
  if (!staff || !board) return [];
  const isAll = board.accessControl?.mode !== 'specific';
  const memberIdSet = new Set<string>(
    isAll ? staff.filter((s) => s.isActive).map((s) => s.id) : (board.accessControl?.users ?? [])
  );
  if (board.createdBy) memberIdSet.add(board.createdBy);
  return [...memberIdSet].map((id) => staff.find((s) => s.id === id)).filter((s): s is StaffProfile => Boolean(s));
}
