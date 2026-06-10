import type { WorkspaceChatModelId } from '../../../types/workspaceChatTypes';

export const MODEL_CONTEXT_LIMITS: Partial<Record<WorkspaceChatModelId, number>> = {
  'anthropic.claude-sonnet-4-6': 200_000,
  'anthropic.claude-sonnet-4-6@no-thinking': 200_000,
  'anthropic.claude-sonnet-4-6@medium-thinking': 200_000,
  'anthropic.claude-sonnet-4-6@high-thinking': 200_000,
  'anthropic.claude-opus-4-6-v1': 200_000,
  'anthropic.claude-opus-4-6-v1@no-thinking': 200_000,
  'anthropic.claude-haiku-4-5-20251001-v1:0': 200_000,
  'anthropic.claude-haiku-4-5-20251001-v1:0@no-thinking': 200_000,
};

export const DEFAULT_MODEL_CONTEXT = 200_000;

// The agent reserves output headroom out of the model's context window: a turn
// can't take more *input* than (window − max output tokens), and the SDK's
// auto-compaction fires at/around that input ceiling — not at the raw window.
// So the donut's 100% ("fills up" → summarisation) is (window − this), not the
// full window. Keep in sync with the agent's NUMA_MAX_OUTPUT_TOKENS (default
// 32k): services/numa-workspace-agent/numa_workspace_agent/sdk_config.py:MAX_OUTPUT_TOKENS
export const MAX_OUTPUT_TOKENS_RESERVE = 32_000;

// Donut pulses near the auto-compact zone (~95% of the *usable* input budget,
// i.e. window − reserved output — resolved in the hook). 100% of the donut =
// that usable budget, so the pulse reliably fires before summarisation happens.
export const CONTEXT_PRE_COMPACT_PULSE = 0.95;

// Composite wear signals for chat health. Each signal maps to a 0..1 wear
// ratio against the red values below; the worst signal drives the bar, the
// alarm, and the banner (single scale — there is no separate amber set, the
// orange line is a fraction of red).
export const CHAT_HEALTH_RED = {
  userMessages: 40,
  toolTurns: 120,
} as const;

// Wear ratio at which health flips green -> orange ("chat getting long").
// Red is always 1.0.
export const CHAT_HEALTH_ORANGE_RATIO = 0.75;

// Compactions are irreversible information loss, so they wear non-linearly:
// the first compaction jumps wear straight to the orange line (a compacted
// chat is never "healthy" again), the second pins it at red.
export const COMPACTION_WEAR_FIRST = 0.75;
