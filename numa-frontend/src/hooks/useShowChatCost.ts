/**
 * useShowChatCost
 *
 * Local toggle for displaying per-message cost and chat running total.
 * Gated above this hook by the DEVELOPER_MODE client config flag —
 * this hook only stores the user preference; callers must check
 * `getFlag('DEVELOPER_MODE')` before rendering anything.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'numa.showCostInfo';
const CHANGE_EVENT = 'numa:showCostInfoChange';

function readInitial(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useShowChatCost(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(readInitial);

  // Sync between hook instances:
  // - `storage` event covers cross-tab updates
  // - custom event covers same-tab updates (storage events do NOT fire
  //   in the tab that wrote the value)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue === 'true');
    };
    const onCustom = (e: Event) => {
      setEnabled((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, onCustom);
    };
  }, []);

  const update = useCallback((value: boolean) => {
    setEnabled(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent<boolean>(CHANGE_EVENT, { detail: value }));
  }, []);

  return [enabled, update];
}
