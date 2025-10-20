import { useEffect, useMemo, useState } from 'react';
import type { AgentSummary } from '../types/agents';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { getAgent } from '../Services/AgentsService';

// Module-level caches (simple, in-memory)
const agentCache = new Map<string, AgentSummary>();
const inflight = new Map<string, Promise<AgentSummary | null>>();

export function useAgentById(agentId?: string | null) {
  const { numaGet } = useNumaRequest();
  const normalizedId = (agentId || '').trim();
  const [agent, setAgent] = useState<AgentSummary | null>(() => {
    if (!normalizedId) return null;
    const cached = agentCache.get(normalizedId);
    return cached || null;
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const shouldFetch = useMemo(() => {
    return Boolean(normalizedId && !agentCache.has(normalizedId));
  }, [normalizedId]);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedId) {
      setAgent(null);
      return;
    }

    const cached = agentCache.get(normalizedId);
    if (cached) {
      setAgent(cached);
      return;
    }

    if (!shouldFetch) return;

    let p = inflight.get(normalizedId);
    if (!p) {
      setLoading(true);
      setError(null);
      // Create a safe promise that resolves to null on error to avoid unhandled rejections in some browsers
      p = (async () => {
        try {
          const result = await getAgent(numaGet as never, normalizedId);
          return result ?? null;
        } catch {
          return null;
        }
      })();
      inflight.set(normalizedId, p);
      p.finally(() => inflight.delete(normalizedId));
    }

    p.then((result) => {
      if (cancelled) return;
      if (result?.agentId) {
        agentCache.set(normalizedId, result);
        setAgent(result);
        setError(null);
      } else {
        setAgent(null);
        setError('Agent not found');
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedId, numaGet, shouldFetch]);

  return { agent, loading, error } as const;
}
