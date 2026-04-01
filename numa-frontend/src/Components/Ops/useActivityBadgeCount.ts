import { useMemo } from 'react';
import { useOps } from './OpsContext';

/** Hook to expose recent activity count without rendering the sidebar */
export const useActivityBadgeCount = (): number => {
  const { tickets } = useOps();
  return useMemo(() => {
    if (!tickets || tickets.length === 0) return 0;
    const oneHourAgo = Date.now() - 3600000;
    return tickets.filter((t) => new Date(t.updatedAt).getTime() > oneHourAgo).length;
  }, [tickets]);
};
