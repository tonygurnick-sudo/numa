/**
 * Shared write-op approval gate for all action handlers. Replaces per-command
 * `if (!yes && requiresLocalApproval(...)) confirm(...)` blocks with a unified
 * path that handles both workspace (SSE emit + Lambda-side DDB polling) and
 * laptop (TTY confirm prompt) modes.
 */
import { randomUUID } from 'node:crypto';

import {
  workspaceHitlContext,
  emitWorkspaceApproval,
  type EmitApprovalInput,
} from '../../context/workspace-approval.js';
import { confirm, type ConfirmOptions } from '../../output/confirm.js';

export interface GateWriteOpInput {
  /** Whether the op needs approval (false = safe read op, skip gate entirely). */
  requiresApproval: boolean;
  /** User's --yes flag (skips TTY confirm in laptop mode). */
  yes: boolean;
  /** TTY confirm options (only used in laptop mode when !yes). */
  confirmOpts: ConfirmOptions;
  /** Approval event payload (only used in workspace mode). */
  emit: Omit<EmitApprovalInput, 'requestId'>;
}

export interface GateResult {
  requestId?: string;
  autoApproved: boolean;
}

export async function gateWriteOp(args: GateWriteOpInput): Promise<GateResult> {
  if (!args.requiresApproval) return { autoApproved: true };

  const ws = workspaceHitlContext();
  if (ws) {
    const requestId = randomUUID();
    try {
      await emitWorkspaceApproval(ws, { ...args.emit, requestId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`numa: approval emit failed — ${msg}\n`);
      process.exit(1);
    }
    return { requestId, autoApproved: false };
  }

  // Laptop terminal mode — existing TTY confirm path.
  if (!args.yes) {
    const ok = await confirm(args.confirmOpts);
    if (!ok) {
      process.stderr.write('numa: cancelled.\n');
      process.exit(0);
    }
  }
  return { autoApproved: true };
}
