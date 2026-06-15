/**
 * Numa Voice Analytics API client. Thin wrapper over the numa-voice-analytics
 * Lambda (routed at /api/voice/analytics/* and /api/voice/calls). Pass the authed
 * numaGet from useNumaRequest() so every call carries the bearer token.
 */
import type {
  AnalyticsRange,
  AnalyticsSummary,
  CallDetail,
  CallLogList,
  LiveStats,
  Timeseries,
} from '../types/voiceAnalytics';

type NumaGet = (url: string, params?: unknown, headers?: unknown) => Promise<unknown>;

interface CallsQuery {
  range?: AnalyticsRange;
  agent?: string;
  disposition?: string;
  direction?: string;
  limit?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const VoiceAnalyticsService = {
  getSummary: (numaGet: NumaGet, range: AnalyticsRange = '7d'): Promise<AnalyticsSummary> =>
    numaGet(`/api/voice/analytics/summary${qs({ range })}`) as Promise<AnalyticsSummary>,

  getTimeseries: (numaGet: NumaGet, range: AnalyticsRange = '7d'): Promise<Timeseries> =>
    numaGet(`/api/voice/analytics/timeseries${qs({ range })}`) as Promise<Timeseries>,

  getLive: (numaGet: NumaGet): Promise<LiveStats> => numaGet('/api/voice/analytics/live') as Promise<LiveStats>,

  getCalls: (numaGet: NumaGet, query: CallsQuery = {}): Promise<CallLogList> =>
    numaGet(`/api/voice/calls${qs({ ...query })}`) as Promise<CallLogList>,

  getCallDetail: (numaGet: NumaGet, contactId: string): Promise<CallDetail> =>
    numaGet(`/api/voice/calls/${encodeURIComponent(contactId)}`) as Promise<CallDetail>,
};
