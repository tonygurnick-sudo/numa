// Shared helper functions and types for tool renderers
import { useState, useEffect, useCallback } from 'react';
import i18n from '../i18n';

export type ToolResultLike = {
  name?: string;
  toolName?: string;
  status?: string;
  toolUseId?: string;
  content?: Array<{ json?: unknown; text?: string; [key: string]: unknown }> | unknown;
  attempt?: number;
  maxAttempts?: number;
  retryReason?: string;
  isRetrying?: boolean;
  [key: string]: unknown;
};

export interface EnhancedIntegrationStatus {
  displayStatus: 'executing' | 'retrying' | 'success' | 'failed' | 'denied';
  message: string;
  attempt?: number;
  maxAttempts?: number;
  retryReason?: string;
  isRetrying: boolean;
}

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

export function getEnhancedIntegrationStatus(result: ToolResultLike): EnhancedIntegrationStatus {
  const rawName = result?.name ?? result?.toolName ?? 'tool';
  const status = result?.status ?? 'completed';
  const friendlyLabel = String(rawName);

  // Check for retry indicators in content or metadata
  const contentBlock = Array.isArray(result?.content) ? result.content[0] : undefined;
  const textContent = (contentBlock as { text?: string } | undefined)?.text ?? '';

  // Detect retry patterns from backend logs/messages
  const isRetryingFromContent =
    textContent.includes('Auto-retrying') ||
    textContent.includes('sub-agent') ||
    textContent.includes('backup') ||
    textContent.includes('validation error');

  const isRetrying = result?.isRetrying || isRetryingFromContent;
  const attempt = result?.attempt || 1;
  const maxAttempts = result?.maxAttempts || 2;
  const retryReason =
    result?.retryReason ||
    (textContent.includes('required properties')
      ? 'Missing required fields'
      : textContent.includes('validation')
        ? 'Validation error'
        : undefined);

  // Check for denied status
  const nestedJsonStatus = (contentBlock as { json?: { status?: string } } | undefined)?.json?.status;
  const hasDeniedInText = textContent.includes("'status': 'denied'") || textContent.includes('"status": "denied"');

  if (status === 'denied' || nestedJsonStatus === 'denied' || hasDeniedInText) {
    return {
      displayStatus: 'denied',
      message: i18n.t('common:toolSummaries.integrations.denied', { label: friendlyLabel }),
      isRetrying: false,
    };
  }

  // Check for retry state
  if (isRetrying && status !== 'completed') {
    return {
      displayStatus: 'retrying',
      message: i18n.t('common:toolSummaries.integrations.retrying', {
        label: friendlyLabel,
        attempt,
        maxAttempts,
        reason: retryReason || 'validation issue',
      }),
      attempt,
      maxAttempts,
      retryReason,
      isRetrying: true,
    };
  }

  // Check for success after potential retry
  if (status === 'success' || status === 'completed') {
    const hadRetry = attempt > 1 || textContent.includes('sub-agent');
    return {
      displayStatus: 'success',
      message: hadRetry
        ? i18n.t('common:toolSummaries.integrations.successAfterRetry', { label: friendlyLabel })
        : i18n.t('common:toolSummaries.integrations.success', { label: friendlyLabel }),
      isRetrying: false,
    };
  }

  // Fallback status
  return {
    displayStatus: 'failed',
    message: i18n.t('common:toolSummaries.integrations.status', {
      label: friendlyLabel,
      status: status || i18n.t('common:toolSummaries.statusFallback'),
    }),
    isRetrying: false,
  };
}

export function getIntegrationsSummary(result: ToolResultLike): string {
  const payload = getIntegrationsPayload(result);

  if (payload?.type === 'integrations-file-download') {
    const fileCount = payload.files?.length || 0;
    const integration = payload.integration || i18n.t('common:toolSummaries.integrations.integrationFallback');
    return i18n.t('common:toolSummaries.integrations.downloaded', { count: fileCount, integration });
  }

  // Use enhanced status detection
  const enhancedStatus = getEnhancedIntegrationStatus(result);
  return enhancedStatus.message;
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
  // fetch_url operation fields
  content?: string;
  content_type?: string;
  title?: string;
  url?: string;
  status?: string;
  file_path?: string;
  preview?: string;
  hint?: string;
}

export function getWebSearchPayload(result: ToolResultLike): WebSearchPayload | null {
  // Handle both formats: {content: [...]} (MCP) and raw array [...] (history tool_card)
  const contentOrResult = Array.isArray(result) ? result : result?.content;
  const blocks = Array.isArray(contentOrResult)
    ? (contentOrResult as Array<{ json?: unknown; text?: string }>)
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
  if (!payload) return i18n.t('common:toolSummaries.webSearch.default');
  const { summarised_content = '', results = [], results_count = 0, error = '', content, title, url } = payload;
  const hasError = !!(error && String(error).trim());
  const hasSummary = !!(summarised_content && String(summarised_content).trim());
  // fetch_url operation -- page fetched with content returned
  if (content && url) {
    return i18n.t('common:toolSummaries.webSearch.pageFetched', {
      title: title || url,
      defaultValue: 'Fetched: {{title}}',
    });
  }
  if (hasError) return i18n.t('common:toolSummaries.webSearch.failed');
  if (hasSummary) return i18n.t('common:toolSummaries.webSearch.sourcesFound', { count: results_count });
  return i18n.t('common:toolSummaries.webSearch.referencesFound', {
    count: (results && results.length) || results_count || 0,
  });
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
  if (!payload) return i18n.t('common:toolSummaries.knowledgeBase.default');
  const { summarised_content = '', knowledgeText = [], provider = 'unknown', results_count = 0 } = payload;
  const hasSummary = !!(summarised_content && String(summarised_content).trim());
  return hasSummary
    ? i18n.t('common:toolSummaries.knowledgeBase.sourcesFound', { count: results_count, provider })
    : i18n.t('common:toolSummaries.knowledgeBase.entriesFound', {
        count: results_count || (Array.isArray(knowledgeText) ? knowledgeText.length : 0),
        provider,
      });
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
    return i18n.t('common:toolSummaries.fallback.denied', { label: friendlyLabel });
  }
  if (status === 'success' || status === 'completed') {
    return i18n.t('common:toolSummaries.fallback.success', { label: friendlyLabel });
  }
  return i18n.t('common:toolSummaries.fallback.status', {
    label: friendlyLabel,
    status: status || i18n.t('common:toolSummaries.statusFallback'),
  });
}

// -------- Data analysis --------
export function getDataAnalysisSummary(result: ToolResultLike): string {
  const rawName = result?.name ?? result?.toolName ?? 'data_analysis';
  const status = result?.status ?? 'completed';
  if (status === 'error' || status === 'failed') {
    return i18n.t('common:toolSummaries.dataAnalysis.failed', { label: rawName });
  }
  return i18n.t('common:toolSummaries.dataAnalysis.ready');
}
export type { IntegrationDownloadFile as IntegrationFile };

// -------- Render tool --------
export interface RenderPayload {
  render_type: 'html' | 'image';
  content: string;
  title?: string;
  height?: number;
  mime_type?: string;
  file_path?: string;
}

export function getRenderPayload(result: ToolResultLike): RenderPayload | null {
  // Result may be the content array directly (from tool_card segments)
  // or an object with a .content property (ToolResultLike wrapper)
  const contentOrResult = Array.isArray(result) ? result : result?.content;
  const blocks = Array.isArray(contentOrResult) ? (contentOrResult as Array<{ text?: string }>) : undefined;
  if (!blocks?.length) return null;
  const text = blocks.map((b) => b?.text ?? '').join('');
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.render_type && (parsed.content || parsed.file_path)) {
      return parsed as RenderPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// -------- Shared S3 file result helpers --------
/**
 * One-shot fetch of a JSON file from S3 by its /workdir/ path. Same key
 * construction as useS3FileResult — kept separate so non-hook callers
 * (like the export flow) can await the result.
 */
export async function fetchS3WorkspaceJson<T = unknown>(
  filePath: string,
  conversationId: string,
  sub: string,
  getCredentials: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string }>,
  options?: { maxRetries?: number; retryDelayMs?: number }
): Promise<T | null> {
  const relativePath = filePath.replace(/^\/workdir\//, '');
  const bucket = window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME');
  const region = window.sessionStorage.getItem('REGION');
  if (!bucket || !region) return null;

  const s3Key = `numa-chat/workspace/${sub}/conversations/${conversationId}/${relativePath}`;
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const credentials = await getCredentials();
  const client = new S3Client({ region, credentials });

  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
      const text = await resp.Body?.transformToString();
      if (text) return JSON.parse(text) as T;
    } catch {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  return null;
}

/**
 * Fetch a file from S3 by its /workdir/ path.
 *
 * The workspace agent syncs files to S3 immediately for large tool results,
 * so the frontend can render them during streaming. This hook constructs the
 * S3 key from the relative path and fetches with retries.
 */
export function useS3FileResult(
  filePath: string | undefined,
  conversationId: string | undefined,
  sub: string | undefined,
  getCredentials: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string }>
): { fileData: unknown; loading: boolean } {
  const [fileData, setFileData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const stableGetCredentials = useCallback(getCredentials, [getCredentials]);

  useEffect(() => {
    if (!filePath || !conversationId || !sub) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const data = await fetchS3WorkspaceJson(filePath, conversationId, sub, stableGetCredentials);
      if (cancelled) return;
      if (data) setFileData(data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, conversationId, sub, stableGetCredentials]);

  return { fileData, loading };
}
