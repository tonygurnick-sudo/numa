import { useMemo } from 'react';
import type { WorkspaceChatMessage, WorkspaceChatModelId } from '../../../types/workspaceChatTypes';
import {
  CHAT_HEALTH_ORANGE_RATIO,
  CHAT_HEALTH_RED,
  COMPACTION_WEAR_FIRST,
  CONTEXT_PRE_COMPACT_PULSE,
  DEFAULT_MODEL_CONTEXT,
  MAX_OUTPUT_TOKENS_RESERVE,
  MODEL_CONTEXT_LIMITS,
} from './constants';

export type AlarmBand = 'hidden' | 'amber' | 'red';

export interface ChatHealthState {
  /** 0..1 — fill ratio against the effective (adaptive) context limit */
  contextPct: number;
  /** Raw tokens used in the most recent turn's context window */
  tokensUsed: number;
  /** Effective compaction threshold (adapts up if compactions reveal higher real values) */
  effectiveContextLimit: number;
  /** The model's hard window — shown in tooltip for power users */
  modelContextLimit: number;
  /** Donut should pulse softly (>= 90% of effective limit) */
  prePulse: boolean;
  /** 0..1 — worst-of wear across all signals; drives the top bar and alarm */
  wearRatio: number;
  /** Chat-health alarm band */
  alarmBand: AlarmBand;
  /** Counts feeding the alarm */
  userMessages: number;
  compactions: number;
  toolTurns: number;
}

/**
 * Derives chat health from the current message list and model selection.
 * Pure derivation - no side effects, recomputes only when messages/model change.
 *
 * The SDK reports `inputTokens` per result event = total context size for that
 * turn. So the most recent assistant message with usage data is the freshest
 * absolute reading. We don't need to sum across turns.
 */
export function useChatHealth(
  messages: WorkspaceChatMessage[] | undefined,
  modelId: WorkspaceChatModelId | undefined
): ChatHealthState {
  return useMemo(() => {
    const safeMessages = messages ?? [];

    const modelContextLimit = (modelId && MODEL_CONTEXT_LIMITS[modelId]) || DEFAULT_MODEL_CONTEXT;
    // Usable input budget = model window minus the output headroom the agent
    // reserves. A turn physically can't take more input than this, and the SDK
    // auto-compacts at/around it — so this, not the raw window, is what "fills
    // up" means for the donut.
    const usableContextLimit = Math.max(1, modelContextLimit - MAX_OUTPUT_TOKENS_RESERVE);

    let userMessages = 0;
    let compactions = 0;
    let maxPreTokens = 0;
    let lastTurnInput = 0;
    let lastTurnOutput = 0;
    let lastTurnCacheRead = 0;
    let lastTurnCacheCreation = 0;
    let lastTurnHasUsage = false;
    // The SDK's num_turns is the count of agentic iterations *within* a single
    // user turn — it resets per assistant message. Sum across messages to get
    // cumulative tool-loop work, which is what the alarm threshold expects.
    let totalToolTurns = 0;

    for (const msg of safeMessages) {
      if (msg.role === 'user') userMessages += 1;

      if (msg.segments) {
        for (const seg of msg.segments) {
          if (seg.kind === 'compaction' && seg.status === 'complete') {
            compactions += 1;
            if (typeof seg.preTokens === 'number' && seg.preTokens > maxPreTokens) {
              maxPreTokens = seg.preTokens;
            }
          }
        }
      }

      // Prefer snapshot fields (single API call) over cumulative (whole loop).
      // The SDK's ResultMessage usage is cumulative across sub-turns and can
      // exceed the model's hard window; donut needs the per-call snapshot.
      if (msg.role === 'assistant') {
        // A real per-call snapshot exists if the (uncached) input OR the cache-read is
        // non-zero. Both paths populate these now: Anthropic from message_start, the Numa
        // Standard Model from message_delta (its message_start usage is 0 — OpenAI-style
        // upstreams only report usage at stream end). Checking input alone would miss a
        // fully-cached turn (input 0, large cache_read) and wrongly fall back to the SDK's
        // cumulative usage — summed across every agentic sub-turn — which overcounts context.
        const hasSnapshot =
          (typeof msg.snapshotInputTokens === 'number' && msg.snapshotInputTokens > 0) ||
          (typeof msg.snapshotCacheReadTokens === 'number' && msg.snapshotCacheReadTokens > 0);
        const hasCumulative = typeof msg.inputTokens === 'number';
        if (hasSnapshot) {
          lastTurnInput = msg.snapshotInputTokens ?? 0;
          lastTurnOutput = msg.snapshotOutputTokens ?? 0;
          lastTurnCacheRead = msg.snapshotCacheReadTokens ?? 0;
          lastTurnCacheCreation = msg.snapshotCacheCreationTokens ?? 0;
          lastTurnHasUsage = true;
        } else if (hasCumulative) {
          lastTurnInput = msg.inputTokens ?? 0;
          lastTurnOutput = msg.outputTokens ?? 0;
          lastTurnCacheRead = msg.cacheReadTokens ?? 0;
          lastTurnCacheCreation = msg.cacheCreationTokens ?? 0;
          lastTurnHasUsage = true;
        }
      }

      if (msg.role === 'assistant' && typeof msg.numTurns === 'number') {
        totalToolTurns += msg.numTurns;
      }
    }

    // 100% = the usable input budget (window − reserved output). Adapts upward
    // only if we actually observe a compaction at higher preTokens than that.
    const effectiveContextLimit = Math.max(usableContextLimit, maxPreTokens);

    // Total context size = input + cache_read + cache_creation + output.
    // Prompt caching splits the model's input across input_tokens (the
    // uncached delta) and cache_read_input_tokens (the cached bulk). Ignoring
    // cache reads collapses the donut to ~1% once the cache is warm.
    const tokensUsed = lastTurnHasUsage
      ? lastTurnInput + lastTurnOutput + lastTurnCacheRead + lastTurnCacheCreation
      : 0;
    const contextPct = effectiveContextLimit > 0 ? Math.min(1, tokensUsed / effectiveContextLimit) : 0;

    const prePulse = contextPct >= CONTEXT_PRE_COMPACT_PULSE;

    // Per-signal wear ratios (0..1) — the worst one is the chat's health.
    // Context fill is the primary signal: it ties health to the real window
    // and recovers when a compaction empties it. Its red point aligns with
    // the pre-compact pulse (95% of the usable budget). Message and tool-turn
    // counts are cost tripwires — a chat can be cheap on context but
    // expensive to keep re-reading. Compactions wear non-linearly: the first
    // jumps straight to the orange line, the second pins red.
    const contextWear = contextPct / CONTEXT_PRE_COMPACT_PULSE;
    const messageWear = userMessages / CHAT_HEALTH_RED.userMessages;
    const toolTurnWear = totalToolTurns / CHAT_HEALTH_RED.toolTurns;
    const compactionWear =
      compactions === 0 ? 0 : Math.min(1, COMPACTION_WEAR_FIRST + (compactions - 1) * (1 - COMPACTION_WEAR_FIRST));

    const wearRatio = Math.min(1, Math.max(contextWear, messageWear, toolTurnWear, compactionWear));

    const alarmBand: AlarmBand = wearRatio >= 1 ? 'red' : wearRatio >= CHAT_HEALTH_ORANGE_RATIO ? 'amber' : 'hidden';

    return {
      contextPct,
      tokensUsed,
      effectiveContextLimit,
      modelContextLimit,
      prePulse,
      wearRatio,
      alarmBand,
      userMessages,
      compactions,
      toolTurns: totalToolTurns,
    };
  }, [messages, modelId]);
}
