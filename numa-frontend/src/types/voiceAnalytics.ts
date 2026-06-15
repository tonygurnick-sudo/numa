/** Response types for the numa-voice-analytics API (/api/voice/analytics/*, /api/voice/calls). */

export interface AnalyticsSummary {
  range: { from: string; to: string };
  outbound: { count: number; connectRate: number; avgDurationSec: number };
  inbound: { count: number; answerRate: number; missed: number };
  timing: { avgTalkSec: number; avgQueueSec: number | null; avgHoldSec: number | null; avgWrapSec: number | null };
  missedDistribution: { afterHours: number; duringHours: number; abandoned: number };
  dispositions: Array<{ disposition: string; count: number }>;
  agents: Array<{ agent: string; contacts: number; avgTalkSec: number; answered: number }>;
  totalCalls: number;
}

export interface TimeseriesPoint {
  date: string;
  inbound: number;
  outbound: number;
}
export interface Timeseries {
  interval: string;
  points: TimeseriesPoint[];
}

export interface CallLogRow {
  contactId: string;
  direction?: string;
  agent?: string;
  company?: string;
  number?: string;
  durationSec?: number;
  disposition?: string;
  rating?: number;
  missed?: boolean;
  startedAt?: string;
}
export interface CallLogList {
  items: CallLogRow[];
  total: number;
}

export interface CallDetail extends CallLogRow {
  summary?: string;
  insights?: { summary?: unknown; objections?: unknown; nextSteps?: unknown };
  recordingUrl?: string;
  transcript?: { transcript?: string; utterances?: unknown[]; available?: boolean } | Record<string, unknown>;
  /** Credits charged for this call + its USD consumption cost (from the credit ledger). */
  cost?: { credits: number; usd: number };
  /**
   * Per-call sentiment from the post-call LLM (analysis[type:sentiment] in the vCon) —
   * no Contact Lens / extra spend. `prospect` is the prospect's own read; `trajectory`
   * is how it moved across the call.
   */
  sentiment?: {
    overall?: 'positive' | 'neutral' | 'negative' | 'mixed';
    prospect?: 'positive' | 'neutral' | 'negative' | 'mixed';
    trajectory?: 'improving' | 'steady' | 'declining';
    rationale?: string;
  };
}

export interface LiveStats {
  contactsInQueue: number;
  oldestContactAgeSec: number;
  agentsOnline: number;
  agentsAvailable: number;
  agentsOnCall: number;
}

/** Time range selector value. */
export type AnalyticsRange = '24h' | '7d' | '30d' | 'mtd';
