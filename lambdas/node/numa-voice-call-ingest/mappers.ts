/**
 * Pure mappers for the Numa Voice call analytics read-model.
 *
 * One DynamoDB item per Connect contactId, upserted from TWO sources:
 *   - Amazon Connect contact events (EventBridge) → operational fields
 *     (queue/agent/timestamps/disconnect reason, missed/abandoned).
 *   - the canonical vCon (S3 ObjectCreated on voice/vcons/) → enrichment
 *     (duration, recording, disposition, rating, summary, SDR identity).
 *
 * Kept dependency-free + pure so the field mapping is unit-tested without AWS.
 */

/** Drop undefined/null/'' so an upsert only SETs known fields. */
export function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/** Epoch ms from an ISO timestamp, or undefined. */
export function epochMs(iso: unknown): number | undefined {
  if (typeof iso !== 'string' || !iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** YYYY-MM-DD in the tenant timezone (en-CA renders ISO date order). */
export function dateBucket(iso: unknown, tz: string): string | undefined {
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

/** Zero-padded epoch-ms string for a lexically-sortable GSI sort key. */
export function sortTs(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : String(ms).padStart(15, '0');
}

/** Last path/ARN segment (agentArn → agentId, queueArn → queueId). */
function lastSegment(arn: unknown): string | undefined {
  if (typeof arn !== 'string' || !arn) return undefined;
  const seg = arn.split('/').pop();
  return seg || undefined;
}

export interface MappedAttrs {
  contactId: string;
  attrs: Record<string, unknown>;
}

/**
 * Map an Amazon Connect "Amazon Connect Contact Event" detail to call-record
 * attributes. Returns null when the event isn't a usable per-contact event.
 */
export function mapContactEvent(detail: Record<string, unknown>, tz: string): MappedAttrs | null {
  const contactId = typeof detail.contactId === 'string' ? detail.contactId : '';
  if (!contactId) return null;

  const eventType = String(detail.eventType ?? '');
  const initiationMethod = detail.initiationMethod as string | undefined;
  const agentInfo = (detail.agentInfo as Record<string, unknown> | null) ?? undefined;
  const queueInfo = (detail.queueInfo as Record<string, unknown> | null) ?? undefined;

  const initiationTs = (detail.initiationTimestamp as string | undefined) ?? undefined;
  const connectedToAgentTs = (agentInfo?.connectedToAgentTimestamp as string | undefined) ?? undefined;
  const disconnectTs = (detail.disconnectTimestamp as string | undefined) ?? undefined;
  const startMs = epochMs(initiationTs);

  // OUTBOUND is the SDR dialer path; everything else is treated as inbound.
  const direction = initiationMethod === 'OUTBOUND' ? 'outbound' : 'inbound';
  const wasAnswered = Boolean(connectedToAgentTs);
  // A DISCONNECTED with no agent connection = missed/abandoned.
  const terminal = eventType === 'DISCONNECTED';

  const attrs = clean({
    contactId,
    sk: 'CALL',
    channel: detail.channel,
    initiationMethod,
    direction,
    queueId: lastSegment(queueInfo?.queueArn),
    enqueueTs: queueInfo?.enqueueTimestamp,
    agentId: lastSegment(agentInfo?.agentArn),
    initiationTs,
    connectedToAgentTs,
    disconnectTs,
    disconnectReason: detail.disconnectReason,
    lastEventType: eventType,
    wasAnswered: wasAnswered || undefined,
    missed: terminal && !wasAnswered ? true : undefined,
    // GSI1 (byDate): partition by tenant-local day, sort by start time.
    gsi1pk: dateBucket(initiationTs, tz),
    gsi1sk: sortTs(startMs),
    startMs,
    updatedAt: Date.now(),
  });
  return { contactId, attrs };
}

/** Find an analysis entry of a given type in a vCon. */
function analysisBody(vcon: Record<string, unknown>, type: string): unknown {
  const list = (vcon.analysis as Array<Record<string, unknown>> | undefined) ?? [];
  return list.find((a) => a?.type === type)?.body;
}

/** Find an attachment body of a given type in a vCon. */
function attachmentBody(vcon: Record<string, unknown>, type: string): Record<string, unknown> | undefined {
  const list = (vcon.attachments as Array<Record<string, unknown>> | undefined) ?? [];
  return list.find((a) => a?.type === type)?.body as Record<string, unknown> | undefined;
}

/** s3://bucket/key → key (the object key). */
function s3Key(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.startsWith('s3://')) return undefined;
  const rest = url.slice('s3://'.length);
  const slash = rest.indexOf('/');
  return slash >= 0 ? rest.slice(slash + 1) : undefined;
}
function s3Bucket(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.startsWith('s3://')) return undefined;
  const rest = url.slice('s3://'.length);
  const slash = rest.indexOf('/');
  return slash >= 0 ? rest.slice(0, slash) : rest;
}

/**
 * Map a canonical vCon to call-record enrichment attributes. Returns null when
 * the vCon has no resolvable contactId.
 */
export function mapVconRecord(vcon: Record<string, unknown>, tz: string): MappedAttrs | null {
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

  const disposition = attachmentBody(vcon, 'sdr_disposition');
  const quality = analysisBody(vcon, 'call_quality') as Record<string, unknown> | undefined;

  const agentUsername =
    (sdrMeta.connect_agent_id as string | undefined) || (sdr.mailto as string | undefined) || undefined;
  const callStart = recording?.start as string | undefined;
  const startMs = epochMs(callStart);
  const dispositionOutcome = disposition?.outcome as string | undefined;

  const attrs = clean({
    contactId,
    sk: 'CALL',
    durationSeconds: recording?.duration,
    recordingKey: s3Key(recording?.url),
    recordingBucket: s3Bucket(recording?.url),
    transcriptKey: s3Key(transcript?.url),
    disposition: dispositionOutcome,
    qualified: typeof disposition?.qualified === 'boolean' ? disposition.qualified : undefined,
    rating: quality?.rating,
    summary: analysisBody(vcon, 'summary'),
    agentUsername,
    agentEmail: sdr.mailto,
    agentName: sdr.name,
    prospectPhone: prospect.tel,
    company: prospectMeta.company_name,
    vconUuid: vcon.uuid,
    callStart,
    // GSI2 (byAgent) + GSI3 (byDisposition), set once the vCon is known.
    gsi2pk: agentUsername,
    gsi2sk: sortTs(startMs),
    gsi3pk: dispositionOutcome,
    gsi3sk: sortTs(startMs),
    // Backfill the date bucket from the vCon if the contact event never landed.
    gsi1pk: dateBucket(callStart, tz),
    gsi1sk: sortTs(startMs),
    startMs,
    updatedAt: Date.now(),
  });
  return { contactId, attrs };
}
