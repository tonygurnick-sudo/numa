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

// Donut pulses near the SDK's typical auto-compact zone (~95% of the model's
// context window). 100% of the donut = the model's actual hard window
// (resolved per-model in the hook), so the pulse reliably signals imminent
// automatic compaction.
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
