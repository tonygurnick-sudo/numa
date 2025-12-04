// Shared helper functions and types for tool renderers

export type ToolResultLike = {
  name?: string;
  toolName?: string;
  status?: string;
  toolUseId?: string;
  content?: Array<{ json?: unknown; text?: string; [key: string]: unknown }> | unknown;
  [key: string]: unknown;
};

// -------- Integrations (file download) --------
export interface IntegrationDownloadFile {
  filename: string;
  filetype: string;
  s3Key: string;
  s3Bucket?: string;
  extractedContentS3Key?: string;
  extractedContentBucket?: string;
  extractionStatusKey?: string;
  extractedTextPreview?: string;
}

export interface IntegrationsFileDownloadPayload {
  type: 'integrations-file-download';
  integration: string;
  tool: string;
  files: IntegrationDownloadFile[];
  note?: string;
  extraction_warnings?: string[];
}

export function getIntegrationsPayload(result: ToolResultLike): IntegrationsFileDownloadPayload | null {
  const blocks = Array.isArray(result?.content) ? (result.content as Array<{ json?: unknown }>) : undefined;
  if (Array.isArray(blocks) && blocks[0]?.json && typeof blocks[0].json === 'object') {
    const json = blocks[0].json as Record<string, unknown>;
    if (json && json['type'] === 'integrations-file-download') {
      return json as unknown as IntegrationsFileDownloadPayload;
    }
  }
  return null;
}

export function getIntegrationsSummary(result: ToolResultLike): string {
  const rawName = result?.name ?? result?.toolName ?? 'tool';
  const status = result?.status ?? 'completed';
  const friendlyLabel = String(rawName);
  const payload = getIntegrationsPayload(result);
  if (payload?.type === 'integrations-file-download') {
    const fileCount = payload.files?.length || 0;
    const integration = payload.integration || 'integration';
    return fileCount === 1
      ? `Downloaded 1 file from ${integration}`
      : `Downloaded ${fileCount} files from ${integration}`;
  }
  // Check for denied status - can be at top level, in content[0].json.status,
  // or as a stringified dict in content[0].text (Python dict format with single quotes)
  const contentBlock = Array.isArray(result?.content) ? result.content[0] : undefined;
  const nestedJsonStatus = (contentBlock as { json?: { status?: string } } | undefined)?.json?.status;
  const textContent = (contentBlock as { text?: string } | undefined)?.text ?? '';
  const hasDeniedInText = textContent.includes("'status': 'denied'") || textContent.includes('"status": "denied"');
  if (status === 'denied' || nestedJsonStatus === 'denied' || hasDeniedInText) {
    return `${friendlyLabel}: Denied - User Confirmation Needed`;
  }
  if (status === 'success' || status === 'completed') return `${friendlyLabel}: Tool call successful`;
  return `${friendlyLabel}: ${status || 'completed'}`;
}

// -------- Web search --------
export type WebSearchReference = string | { url: string; title?: string; snippet?: string };
export interface WebSearchPayload {
  query?: string;
  summarised_content?: string;
  references?: WebSearchReference[];
  results?: Array<{ url: string; title?: string; snippet?: string }>;
  error?: string;
  results_count?: number;
}

export function getWebSearchPayload(result: ToolResultLike): WebSearchPayload | null {
  const blocks = Array.isArray(result?.content)
    ? (result.content as Array<{ json?: unknown; text?: string }>)
    : undefined;
  if (Array.isArray(blocks) && blocks[0]?.json && typeof blocks[0].json === 'object') {
    return blocks[0].json as WebSearchPayload;
  }
  // legacy: attempt to parse concatenated text JSON
  try {
    const textBlob = Array.isArray(blocks) ? blocks.map((c) => c?.text ?? '').join('') : '';
    return textBlob ? (JSON.parse(textBlob) as WebSearchPayload) : null;
  } catch {
    return null;
  }
}

export function getWebSearchSummary(result: ToolResultLike): string {
  const payload = getWebSearchPayload(result);
  if (!payload) return 'Web Search results';
  const { summarised_content = '', results = [], results_count = 0, error = '' } = payload;
  const hasError = !!(error && String(error).trim());
  const hasSummary = !!(summarised_content && String(summarised_content).trim());
  if (hasError) return '⚠️ Search failed';
  if (hasSummary) return `${results_count} sources found`;
  return `${(results && results.length) || results_count || 0} web search references`;
}

// -------- Knowledge base --------
export interface KnowledgeBasePayload {
  summarised_content?: string;
  knowledgeText?: Array<Record<string, unknown>>;
  references?: string[];
  provider?: string;
  query?: string;
  results_count?: number;
}

export function getKnowledgeBasePayload(result: ToolResultLike): KnowledgeBasePayload | null {
  const blocks = Array.isArray(result?.content) ? (result.content as Array<{ json?: unknown }>) : undefined;
  if (Array.isArray(blocks) && blocks[0]?.json && typeof blocks[0].json === 'object') {
    return blocks[0].json as KnowledgeBasePayload;
  }
  return null;
}

export function getKnowledgeBaseSummary(result: ToolResultLike): string {
  const payload = getKnowledgeBasePayload(result);
  if (!payload) return 'Knowledge Base results';
  const { summarised_content = '', knowledgeText = [], provider = 'unknown', results_count = 0 } = payload;
  const hasSummary = !!(summarised_content && String(summarised_content).trim());
  return hasSummary
    ? `${results_count} sources found (${provider})`
    : `${results_count || (Array.isArray(knowledgeText) ? knowledgeText.length : 0)} knowledge entries found (${provider})`;
}

// -------- Generic fallback --------
export function getFallbackSummary(result: ToolResultLike): string {
  const rawName = result?.name ?? result?.toolName ?? 'tool';
  const status = result?.status ?? 'completed';
  const friendlyLabel = String(rawName);
  // Check for denied status - can be at top level, in content[0].json.status,
  // or as a stringified dict in content[0].text (Python dict format with single quotes)
  const contentBlock = Array.isArray(result?.content) ? result.content[0] : undefined;
  const nestedJsonStatus = (contentBlock as { json?: { status?: string } } | undefined)?.json?.status;
  const textContent = (contentBlock as { text?: string } | undefined)?.text ?? '';
  const hasDeniedInText = textContent.includes("'status': 'denied'") || textContent.includes('"status": "denied"');
  if (status === 'denied' || nestedJsonStatus === 'denied' || hasDeniedInText) {
    return `${friendlyLabel}: Denied - User Confirmation Needed`;
  }
  if (status === 'success' || status === 'completed') return `${friendlyLabel}: Tool call successful`;
  return `${friendlyLabel}: ${status || 'completed'}`;
}
export type { IntegrationDownloadFile as IntegrationFile, IntegrationsFileDownloadPayload };
