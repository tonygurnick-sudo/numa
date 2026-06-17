/**
 * Map a canonical vCon to the analytics CallRow shape (the source for the
 * dashboard + call logs in v1). Pure + dependency-free for unit testing.
 */
import type { CallRow } from './aggregate';

function epochMs(iso: unknown): number | undefined {
  if (typeof iso !== 'string' || !iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}
function dateBucket(iso: unknown, tz: string): string | undefined {
  const ms = epochMs(iso);
  if (ms === undefined) return undefined;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(ms)
    );
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
function s3Part(url: unknown, which: 'bucket' | 'key'): string | undefined {
  if (typeof url !== 'string' || !url.startsWith('s3://')) return undefined;
  const rest = url.slice('s3://'.length);
  const slash = rest.indexOf('/');
  if (which === 'bucket') return slash >= 0 ? rest.slice(0, slash) : rest;
  return slash >= 0 ? rest.slice(slash + 1) : undefined;
}

export interface VconCallRow extends CallRow {
  recordingKey?: string;
  recordingBucket?: string;
  transcriptKey?: string;
  summary?: string;
  vconUuid?: string;
}

export function vconToRow(vcon: Record<string, unknown>, tz: string): VconCallRow | null {
  const meta = (vcon.meta as Record<string, unknown> | undefined) ?? {};
  const contactId = typeof meta.numa_contact_id === 'string' ? meta.numa_contact_id : '';
  if (!contactId) return null;

  const dialog = (vcon.dialog as Array<Record<string, unknown>> | undefined) ?? [];
  const recording = dialog.find((d) => d?.type === 'recording');
  const transcript = dialog.find((d) => d?.type === 'transcript');
  const parties = (vcon.parties as Array<Record<string, unknown>> | undefined) ?? [];
  const sdr = parties[0] ?? {};
  const sdrMeta = (sdr.meta as Record<string, unknown> | undefined) ?? {};
  const prospect = parties[1] ?? {};
  const prospectMeta = (prospect.meta as Record<string, unknown> | undefined) ?? {};
  const analysis = (vcon.analysis as Array<Record<string, unknown>> | undefined) ?? [];
  const aBody = (type: string): unknown => analysis.find((a) => a?.type === type)?.body;
  const attachments = (vcon.attachments as Array<Record<string, unknown>> | undefined) ?? [];
  const disposition = attachments.find((a) => a?.type === 'sdr_disposition')?.body as
    | Record<string, unknown>
    | undefined;
  const quality = aBody('call_quality') as Record<string, unknown> | undefined;

  // Fall back to the vCon's created_at when the recording start is missing (e.g. a
  // zero-duration voicemail) — otherwise the call has no start time and the analytics
  // date filter drops it entirely.
  const callStart = (recording?.start as string | undefined) || (vcon.created_at as string | undefined);
  const startMs = epochMs(callStart);
  const dur = typeof recording?.duration === 'number' ? (recording.duration as number) : undefined;

  return {
    contactId,
    // Numa Voice is an outbound dialer; vCon calls are outbound.
    direction: 'outbound',
    durationSeconds: dur,
    disposition: disposition?.outcome as string | undefined,
    rating: typeof quality?.rating === 'number' ? (quality.rating as number) : undefined,
    wasAnswered: (dur ?? 0) > 0,
    agentUsername: (sdrMeta.connect_agent_id as string | undefined) || (sdr.mailto as string | undefined),
    company: prospectMeta.company_name as string | undefined,
    prospectPhone: prospect.tel as string | undefined,
    startMs,
    gsi1pk: dateBucket(callStart, tz),
    recordingKey: s3Part(recording?.url, 'key'),
    recordingBucket: s3Part(recording?.url, 'bucket'),
    transcriptKey: s3Part(transcript?.url, 'key'),
    summary: typeof aBody('summary') === 'string' ? (aBody('summary') as string) : undefined,
    vconUuid: vcon.uuid as string | undefined,
  };
}
