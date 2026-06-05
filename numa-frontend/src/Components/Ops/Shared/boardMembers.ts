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
 * - Board owners (`accessControl.owners`) and the original `createdBy` are
 *   always included, even under `'specific'` mode — owners are members by
 *   definition, so adding an owner must surface them in the avatar row.
 *
 * The returned list is deduplicated (Set-backed) and order-stable per the
 * member → owner → createdBy precedence.
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
  for (const ownerId of board.accessControl?.owners ?? []) memberIdSet.add(ownerId);
  if (board.createdBy) memberIdSet.add(board.createdBy);
  return [...memberIdSet].map((id) => staff.find((s) => s.id === id)).filter((s): s is StaffProfile => Boolean(s));
}
