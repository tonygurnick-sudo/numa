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
  // Default ON when the user has never set a preference (key absent), but keep
  // an explicit OFF sticky: once a dev turns it off it's stored as 'false' and
  // stays off across reloads. The DEVELOPER_MODE gate above this hook means a
  // default of `true` only ever surfaces for users who actually have dev mode.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
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
