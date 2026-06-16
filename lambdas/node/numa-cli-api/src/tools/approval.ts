/**
 * Centralised approval orchestrator for CLI-driven write operations.
 *
 * Port of the DDB approval flow from `lambdas/python/workspace-chat-tools/
 * tools/approval.py`. The CLI emits the SSE event to the frontend (via the
 * workspace agent's /internal/emit-approval endpoint); this module creates
 * the DDB record and polls until the user approves, denies, or times out.
 *
 * After Phase 6 (MCP removal), this is the ONLY place approval orchestration
 * lives — single point for policy, audit, batch approvals, etc.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';

const TABLE = process.env['INTEGRATIONS_APPROVAL_TABLE_NAME'] ?? '';
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_S = 180;
// Unattended fast-fail (BUG-140): the frontend writes `seen_at` on the
// approval record the moment the card renders (proxy `ack` action). No ack
// within this grace window means nobody is viewing the conversation — fail
// fast instead of burning the full 180s per call (the approval cascade that
// hung away-from-chat runs for 10-20 minutes). Keep in sync with
// APPROVAL_UNATTENDED_GRACE_SECONDS in
// `lambdas/python/workspace-chat-tools/tools/approval.py`.
const UNATTENDED_GRACE_S = 25;

let _ddb: DynamoDBClient | undefined;
function ddb(): DynamoDBClient {
  if (!_ddb) _ddb = new DynamoDBClient({});
  return _ddb;
}

export interface CreateApprovalArgs {
  userSub: string;
  actionKey: string;
  description: string;
  propsPreview: Record<string, unknown>;
  approvalId: string;
}

export async function createApprovalRequest(args: CreateApprovalArgs): Promise<string> {
  if (!TABLE) throw new Error('INTEGRATIONS_APPROVAL_TABLE_NAME not configured');

  const now = Math.floor(Date.now() / 1000);
  try {
    await ddb().send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          approval_id: { S: args.approvalId },
          user_sub: { S: args.userSub },
          action_key: { S: args.actionKey },
          description: { S: args.description },
          props_preview: { S: JSON.stringify(args.propsPreview) },
          status: { S: 'pending' },
          created_at: { N: String(now) },
          ttl: { N: String(now + 86400) },
        },
        ConditionExpression: 'attribute_not_exists(approval_id)',
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Idempotent — row already exists (CLI retry or race). Treat as success.
      return args.approvalId;
    }
    throw err;
  }
  return args.approvalId;
}

export type ApprovalDecision = 'approved' | 'denied' | 'unattended' | 'timeout';

export interface PollResult {
  decision: ApprovalDecision;
  denyReason: string;
}

async function getRow(approvalId: string): Promise<Record<string, { S?: string; N?: string }> | undefined> {
  const res = await ddb().send(new GetItemCommand({ TableName: TABLE, Key: { approval_id: { S: approvalId } } }));
  return res.Item as Record<string, { S?: string; N?: string }> | undefined;
}

/**
 * Poll DDB until the approval row transitions to `approved` or `denied`,
 * or the 180s window elapses. Deadline is anchored to the DDB `created_at`
 * field (not the start of polling) so the budget accounts for time burned
 * between row creation and the first poll (matches Python smart-deadline).
 *
 * Fast-fails with `unattended` when no client has acknowledged rendering the
 * approval card (`seen_at`) within the grace window — a decision always wins
 * over the unattended check, even at the boundary.
 */
export async function pollApproval(approvalId: string): Promise<PollResult> {
  const initial = await getRow(approvalId);
  const createdAt = initial?.created_at?.N ? Number(initial.created_at.N) : Math.floor(Date.now() / 1000);
  const deadlineMs = (createdAt + TIMEOUT_S) * 1000;
  const unattendedAfterMs = (createdAt + UNATTENDED_GRACE_S) * 1000;

  const initialStatus = initial?.status?.S ?? 'pending';
  if (initialStatus === 'approved' || initialStatus === 'denied') {
    return { decision: initialStatus, denyReason: initial?.deny_reason?.S ?? '' };
  }

  while (Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const row = await getRow(approvalId);
    const status = row?.status?.S ?? 'pending';
    if (status === 'approved' || status === 'denied') {
      return { decision: status, denyReason: row?.deny_reason?.S ?? '' };
    }
    if (!row?.seen_at?.N && Date.now() >= unattendedAfterMs) {
      return { decision: 'unattended', denyReason: '' };
    }
  }
  return { decision: 'timeout', denyReason: '' };
}
