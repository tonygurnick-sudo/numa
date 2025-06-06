// utils/bedrockModelConfig.js

/**
 * Bedrock Model Config Utility
 *
 * This utility defines which Bedrock model IDs are available per AWS region.
 * It helps ensure we use region-specific models (e.g. for data sovereignty in ap-southeast-2)
 * and allows easy switching between models depending on task complexity.
 *
 * MODEL_TYPES:
 * - DEFAULT: Our go to full-feature model for complex tasks like numa chat streaming (e.g., Claude 3.5 Sonnet).
 * - CLAUDE_HAIKU: Lightweight Claude model for faster or cheaper tasks like image descriptions or metadata extraction (e.g., Claude 3 Haiku).
 */

const REGIONS = { US_EAST_1: 'us-east-1', AP_SOUTHEAST_2: 'ap-southeast-2' };
const MODEL_TYPES = { DEFAULT: 'default', CLAUDE_HAIKU: 'claude_haiku' };
const MODEL_MAP = {
  [REGIONS.US_EAST_1]: {
    [MODEL_TYPES.DEFAULT]: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0', // "us.anthr..." means cross region inference for us region
    [MODEL_TYPES.CLAUDE_HAIKU]: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
  [REGIONS.AP_SOUTHEAST_2]: {
    [MODEL_TYPES.DEFAULT]: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    [MODEL_TYPES.CLAUDE_HAIKU]: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
};

function getModelId(region, type = MODEL_TYPES.DEFAULT) {
  const modelId = MODEL_MAP[region]?.[type];
  if (!modelId) {
    throw new Error(`No model configured for region "${region}" and type "${type}"`);
  }
  return modelId;
}

export { REGIONS, MODEL_TYPES, getModelId };
