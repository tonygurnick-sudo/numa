import { useState, useCallback, useRef } from 'react';

interface UseFileSelectionResult {
  selectedIds: Set<string>;
  toggleSelect: (id: string, shiftKey?: boolean) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  /** Pass the full ordered list of IDs so shift-click range works */
  setOrderedIds: (ids: string[]) => void;
}

/**
 * Multi-select state hook for file/folder selection.
 * Supports shift-click range selection.
 */
export const useFileSelection = (): UseFileSelectionResult => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const orderedIdsRef = useRef<string[]>([]);

  const setOrderedIds = useCallback((ids: string[]) => {
    orderedIdsRef.current = ids;
  }, []);

  const toggleSelect = useCallback((id: string, shiftKey = false) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (shiftKey && lastSelectedRef.current && orderedIdsRef.current.length > 0) {
        // Range select between last selected and current
        const ids = orderedIdsRef.current;
        const startIdx = ids.indexOf(lastSelectedRef.current);
        const endIdx = ids.indexOf(id);

        if (startIdx !== -1 && endIdx !== -1) {
          const low = Math.min(startIdx, endIdx);
          const high = Math.max(startIdx, endIdx);
          for (let i = low; i <= high; i++) {
            next.add(ids[i]);
          }
          lastSelectedRef.current = id;
          return next;
        }
      }

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      lastSelectedRef.current = id;
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    isSelected,
    setOrderedIds,
  };
};
