/**
 * numa-voice-call-ingest — builds the per-call analytics read-model.
 *
 * Region-pinned to the Connect region (ap-southeast-2): the DynamoDB table, the
 * recordings, and Connect all live there. Two event sources upsert ONE item per
 * Connect contactId:
 *   1. Amazon Connect contact events (EventBridge, source "aws.connect") →
 *      operational fields (queue/agent/timestamps/disconnect, missed/abandoned).
 *   2. vCon writes (S3 ObjectCreated on voice/vcons/{uuid}.json in the DATA
 *      bucket) → enrichment from the canonical record.
 *
 * The table is the materialised read-model the numa-voice-analytics API serves —
 * the API never re-scans S3 to render a list.
 */
import type { EventBridgeEvent, S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { withPRM } from '../../../lib/prm-node/prm';
import { mapContactEvent, mapVconRecord, type MappedAttrs } from './mappers';

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const CALLS_TABLE = process.env.VOICE_CALLS_TABLE || '';
const TENANT_TZ = process.env.TENANT_TZ || 'Pacific/Auckland';
// The DATA bucket lives in the CLIENT region; the vCon S3 notification is wired
// from that bucket, so reads use a client-region S3 client.
const CLIENT_REGION = process.env.CLIENT_REGION || REGION;

const ddb = DynamoDBDocumentClient.from(withPRM(DynamoDBClient, { region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = withPRM(S3Client, { region: CLIENT_REGION });

/** Upsert a partial call record by contactId (PK) + sk "CALL". */
async function upsert({ contactId, attrs }: MappedAttrs): Promise<void> {
  if (!CALLS_TABLE) {
    console.warn('VOICE_CALLS_TABLE not configured; skipping upsert', { contactId });
    return;
  }
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'contactId' || k === 'sk') continue; // the key
    const nk = `#k${i}`;
    const vk = `:v${i}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
    i += 1;
  }
  if (sets.length === 0) return;
  await ddb.send(
    new UpdateCommand({
      TableName: CALLS_TABLE,
      Key: { contactId, sk: 'CALL' },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

async function readVcon(bucket: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as Record<string, unknown>) : null;
  } catch (err) {
    console.warn('voice-call-ingest: failed to read vCon', { bucket, key, err: String(err) });
    return null;
  }
}

function decodeKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

export const handler = async (
  event: S3Event | EventBridgeEvent<string, Record<string, unknown>>
): Promise<{ upserted: number }> => {
  let upserted = 0;

  // S3 ObjectCreated on voice/vcons/{uuid}.json → enrich from the vCon.
  if ('Records' in event && Array.isArray(event.Records)) {
    for (const record of event.Records) {
      const s3rec = (record as { s3?: { bucket?: { name?: string }; object?: { key?: string } } }).s3;
      const bucket = s3rec?.bucket?.name;
      const rawKey = s3rec?.object?.key;
      if (!bucket || !rawKey) continue;
      const key = decodeKey(rawKey);
      // Only the canonical vCon objects, not the index pointers.
      if (!/\/vcons\/[^/]+\.json$/.test(key) || key.includes('/vcons/index/')) continue;
      const vcon = await readVcon(bucket, key);
      if (!vcon) continue;
      const mapped = mapVconRecord(vcon, TENANT_TZ);
      if (mapped) {
        await upsert(mapped);
        upserted += 1;
      }
    }
    return { upserted };
  }

  // EventBridge Amazon Connect contact event.
  if ('source' in event && event.source === 'aws.connect') {
    const detail = (event.detail as Record<string, unknown>) ?? {};
    const mapped = mapContactEvent(detail, TENANT_TZ);
    if (mapped) {
      await upsert(mapped);
      upserted += 1;
    }
    return { upserted };
  }

  console.warn('voice-call-ingest: unrecognised event shape');
  return { upserted };
};
