import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core';

/**
 * Custom collision detection shared by every Ops kanban surface (the work board,
 * the CRM Customers board, and the Suppliers board). It prioritises the column
 * (stage droppable, id `stage-…`) the pointer is physically inside, then finds
 * the closest sortable item within that column.
 *
 * Plain `closestCenter` measures center-to-center distance across ALL droppables,
 * so a card in the *original* column at a similar vertical position can beat every
 * target in the adjacent column — making it feel like the card drops in the wrong
 * column (the bug the CRM/Suppliers boards had before adopting this).
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  // 1. Find column droppables the pointer is inside (ids start with "stage-")
  const pointerCollisions = pointerWithin(args);
  const overColumn = pointerCollisions.find((c) => String(c.id).startsWith('stage-'));

  if (overColumn) {
    // 2. Narrow candidates to ITEMS inside the hovered column. We intentionally
    // exclude the column droppable itself from `closestCenter` here: the column's
    // rect spans the full column height, so its center can beat every individual
    // item center when the pointer is mid-column, causing the over target to
    // collapse to the column. Falling back to the column only when there are no
    // item candidates keeps empty columns droppable.
    const columnId = overColumn.id as string;
    const columnContainer = args.droppableContainers.find((c) => c.id === columnId);
    const columnRect = columnContainer?.rect.current;

    const filtered = args.droppableContainers.filter((container) => {
      const id = String(container.id);
      if (id.startsWith('stage-')) return false;
      if (!columnRect) return false;
      const rect = container.rect.current;
      if (!rect) return false;
      const itemCenterX = rect.left + rect.width / 2;
      return itemCenterX >= columnRect.left && itemCenterX <= columnRect.left + columnRect.width;
    });

    const result = closestCenter({ ...args, droppableContainers: filtered });
    return result.length > 0 ? result : [overColumn];
  }

  // 3. Pointer isn't inside any column — fall back to closestCenter globally
  return closestCenter(args);
};
