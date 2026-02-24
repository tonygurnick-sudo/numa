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
 * - FALLBACK: Model used when DEFAULT model hits quota limits. Uses cross-region inference to avoid regional quota limitations.
 */

const REGIONS = { US_EAST_1: 'us-east-1', AP_SOUTHEAST_2: 'ap-southeast-2' };
const MODEL_TYPES = {
  DEFAULT: 'default',
  CLAUDE_HAIKU: 'claude_haiku',
  FALLBACK: 'fallback',
};
const MODEL_MAP = {
  [REGIONS.US_EAST_1]: {
    [MODEL_TYPES.DEFAULT]: 'us.anthropic.claude-sonnet-4-6',
    [MODEL_TYPES.CLAUDE_HAIKU]: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    [MODEL_TYPES.FALLBACK]: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  [REGIONS.AP_SOUTHEAST_2]: {
    [MODEL_TYPES.DEFAULT]: 'au.anthropic.claude-sonnet-4-6',
    [MODEL_TYPES.CLAUDE_HAIKU]: 'au.anthropic.claude-haiku-4-5-20251001-v1:0',
    [MODEL_TYPES.FALLBACK]: 'au.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
};

/**
 * Get the model ID for the specified region and model type
 */
function getModelId(region, type = MODEL_TYPES.DEFAULT) {
  const modelId = MODEL_MAP[region]?.[type];
  if (!modelId) {
    throw new Error(`No model configured for region "${region}" and type "${type}"`);
  }
  return modelId;
}

/**
 * Check if the client is currently in fallback mode due to a previous quota limit
 * @param {string} clientName - The client name
 * @returns {boolean} - Whether the client is in fallback mode
 */
function isInFallbackMode(clientName) {
  const fallbackKey = `${clientName}_model_fallback`;
  const fallbackUntil = localStorage.getItem(fallbackKey);
  return fallbackUntil && Number(fallbackUntil) > Date.now();
}

/**
 * Set the client to use fallback model for a period of time
 * @param {string} clientName - The client name
 * @param {number} durationMs - How long to use fallback in ms (default: 1 hour)
 */
function setFallbackMode(clientName, durationMs = 60 * 60 * 1000) {
  const fallbackKey = `${clientName}_model_fallback`;
  const fallbackExpiry = Date.now() + durationMs;
  localStorage.setItem(fallbackKey, fallbackExpiry.toString());
  console.log(`Set fallback mode for client ${clientName} until ${new Date(fallbackExpiry).toISOString()}`);
}

/**
 * Check if an error is related to quota or rate limits
 * @param {Object} error - The error object to check
 * @param {string} error.name - The error name
 * @param {Object} error.$metadata - The error metadata from AWS SDK
 * @returns {boolean} - Whether the error is quota/rate limit related
 */
function isQuotaLimitError({ name, $metadata = {} }) {
  return name === 'ThrottlingException' || $metadata.httpStatusCode === 429;
}

export { REGIONS, MODEL_TYPES, getModelId, isInFallbackMode, setFallbackMode, isQuotaLimitError };
