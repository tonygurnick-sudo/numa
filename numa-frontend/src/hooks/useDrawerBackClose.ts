import { useEffect, useRef, type MutableRefObject } from 'react';

type UseDrawerBackCloseOptions = {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  stateKey: string;
  /**
   * Optional ref to signal that the next close should NOT trigger history.back().
   * Useful when closing a drawer while intentionally navigating elsewhere.
   */
  skipBackOnCloseRef?: MutableRefObject<boolean>;
};

/**
 * Adds a lightweight history entry when a drawer opens so the mobile back button
 * closes the drawer instead of navigating away.
 */
export const useDrawerBackClose = ({
  isOpen,
  onClose,
  enabled,
  stateKey,
  skipBackOnCloseRef,
}: UseDrawerBackCloseOptions) => {
  const pushedRef = useRef(false);
  const closingFromPopRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const handlePop = (event: PopStateEvent) => {
      const marker = (event.state as Record<string, unknown> | null | undefined)?.['numaDrawerKey'];
      const matchesMarker = marker === stateKey;
      if (!pushedRef.current && !matchesMarker) return;
      if (!isOpen) return;

      // We are returning from the synthetic push; just close the drawer.
      closingFromPopRef.current = true;
      pushedRef.current = false;
      onClose();
    };

    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [enabled, isOpen, onClose, stateKey]);

  useEffect(() => {
    if (!enabled) {
      pushedRef.current = false;
      closingFromPopRef.current = false;
      return;
    }

    if (isOpen) {
      closingFromPopRef.current = false;
      if (!pushedRef.current) {
        const nextState = { ...(window.history.state || {}), numaDrawerKey: stateKey };
        window.history.pushState(nextState, '', window.location.href);
        pushedRef.current = true;
      }
      return;
    }

    // Drawer is closing
    if (!pushedRef.current) return;

    if (skipBackOnCloseRef?.current) {
      skipBackOnCloseRef.current = false;
      closingFromPopRef.current = false;
      pushedRef.current = false;
      const nextState = { ...(window.history.state || {}) };
      delete (nextState as { numaDrawerKey?: string }).numaDrawerKey;
      window.history.replaceState(nextState, '', window.location.href);
      return;
    }

    // If we just responded to a popstate, the back navigation already happened.
    if (closingFromPopRef.current) {
      closingFromPopRef.current = false;
      pushedRef.current = false;
      return;
    }

    pushedRef.current = false;
    window.history.back();
  }, [enabled, isOpen, stateKey, skipBackOnCloseRef]);
};
