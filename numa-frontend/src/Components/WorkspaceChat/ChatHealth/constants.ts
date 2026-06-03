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

// Composite signals for the chat-health alarm. ANY one of these crosses the
// threshold -> band activates. Compaction count is weighted heavily because
// each one is irreversible information loss.
export const CHAT_HEALTH_AMBER = {
  userMessages: 20,
  compactions: 1,
  toolTurns: 30,
} as const;

export const CHAT_HEALTH_RED = {
  userMessages: 40,
  compactions: 2,
  toolTurns: 60,
} as const;
