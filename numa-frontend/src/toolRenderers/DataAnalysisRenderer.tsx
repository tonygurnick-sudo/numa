import { useCallback, useEffect, useMemo, useState } from 'react';
import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import { useAuth } from '../Providers/AuthProvider';
import { getSignedUrlForS3Object } from '../utils/s3Utils';
import type { ToolResultLike } from './helpers';
import { useTranslation } from 'react-i18next';

type OutputItem = {
  content_type?: string;
  location?: string;
  data?: unknown;
  title?: string;
};

type AppOutput = {
  results?: Array<{
    outputs?: OutputItem[];
  }>;
};

type NormalizedOutput = {
  title: string;
  location: string;
  contentType: string;
  content: string | null;
  s3Key: string | null;
};

const tryParseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeOutputs = (payload: unknown, getDefaultTitle: (index: number) => string): NormalizedOutput[] => {
  const normalized = tryParseJson(payload) as AppOutput | unknown;
  const candidate = (normalized as AppOutput)?.results ? normalized : tryParseJson((normalized as AppOutput)?.results);
  const results = (candidate as AppOutput | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return [];

  const outputs = results[0]?.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) return [];

  return outputs.map((output, index) => {
    const location = String(output?.location || '').toLowerCase() || 'inline';
    const contentType = String(output?.content_type || '').toLowerCase();
    const title = (output?.title && String(output.title)) || getDefaultTitle(index + 1);
    const data = output?.data;
    let content: string | null = null;
    let s3Key: string | null = null;

    if (typeof data === 'string') {
      if (location === 's3') {
        s3Key = data;
      } else {
        content = data;
      }
    } else if (data && typeof data === 'object') {
      const dataObj = data as { content?: unknown; key?: unknown };
      if ('content' in dataObj && typeof dataObj.content === 'string') {
        content = dataObj.content;
      }
      if ('key' in dataObj && typeof dataObj.key === 'string') {
        s3Key = dataObj.key;
      }
    }

    return {
      title,
      location,
      contentType,
      content,
      s3Key,
    };
  });
};

export const DataAnalysisRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const { getCredentials } = useAuth();
  const { t } = useTranslation('common');
  const blocks = Array.isArray(result?.content) ? (result.content as Array<{ json?: unknown }>) : [];
  const payload = blocks[0]?.json ?? result;
  const outputs = useMemo(
    () => normalizeOutputs(payload, (index) => t('toolRenderers.dataAnalysis.outputTitle', { index })),
    [payload, t]
  );

  // Memoize filtered arrays to prevent useEffect from re-running on every render
  const markdownOutputs = useMemo(
    () =>
      outputs.filter((output) => {
        if (output.content) return true;
        if (output.s3Key && output.contentType.includes('markdown')) return true;
        return false;
      }),
    [outputs]
  );

  const markdownS3Outputs = useMemo(
    () =>
      markdownOutputs.filter((output) => !output.content && output.s3Key && output.contentType.includes('markdown')),
    [markdownOutputs]
  );

  const [markdownFromS3, setMarkdownFromS3] = useState<Record<string, string>>({});
  const [markdownErrors, setMarkdownErrors] = useState<Record<string, string>>({});
  const bucketName = typeof window !== 'undefined' ? window.sessionStorage.getItem('OUTPUTS_BUCKET_NAME') || '' : '';
  const region = typeof window !== 'undefined' ? window.sessionStorage.getItem('REGION') || 'us-east-1' : 'us-east-1';

  // Compute which S3 keys still need fetching (not already in state or errored)
  const keysToFetch = useMemo(
    () =>
      markdownS3Outputs
        .map((o) => o.s3Key)
        .filter((key): key is string => !!key && !markdownFromS3[key] && !markdownErrors[key]),
    [markdownS3Outputs, markdownFromS3, markdownErrors]
  );

  useEffect(() => {
    // Skip if nothing to fetch
    if (!bucketName || keysToFetch.length === 0) return;

    let isMounted = true;
    const fetchMarkdown = async () => {
      const nextMarkdown: Record<string, string> = {};
      const nextErrors: Record<string, string> = {};

      for (const s3Key of keysToFetch) {
        try {
          const signed = await getSignedUrlForS3Object(s3Key, bucketName, region, getCredentials);
          const response = await fetch(signed);
          if (!response.ok) {
            throw new Error(t('toolRenderers.dataAnalysis.loadFailed', { status: response.status }));
          }
          const text = await response.text();
          if (isMounted) {
            nextMarkdown[s3Key] = text;
          }
        } catch (error) {
          if (isMounted) {
            nextErrors[s3Key] = (error as Error)?.message || t('toolRenderers.dataAnalysis.unableToLoad');
          }
        }
      }

      if (isMounted) {
        if (Object.keys(nextMarkdown).length > 0) {
          setMarkdownFromS3((prev) => ({ ...prev, ...nextMarkdown }));
        }
        if (Object.keys(nextErrors).length > 0) {
          setMarkdownErrors((prev) => ({ ...prev, ...nextErrors }));
        }
      }
    };

    fetchMarkdown();
    return () => {
      isMounted = false;
    };
  }, [bucketName, getCredentials, keysToFetch, region, t]);

  // Allow retrying failed fetches by clearing the error for a specific key
  const retryFetch = useCallback((s3Key: string) => {
    setMarkdownErrors((prev) => {
      const next = { ...prev };
      delete next[s3Key];
      return next;
    });
  }, []);

  if (markdownOutputs.length === 0) return null;

  const renderInlineOutput = (output: NormalizedOutput, index: number) => {
    const resolvedContent = output.content ?? (output.s3Key ? markdownFromS3[output.s3Key] : null);
    if (!resolvedContent) {
      if (output.s3Key && markdownErrors[output.s3Key]) {
        const s3Key = output.s3Key;
        return (
          <div key={`${output.title}-${index}`} className="data-analysis-section mt-3 text-muted small">
            {markdownErrors[s3Key]}{' '}
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-underline"
              onClick={() => retryFetch(s3Key)}
            >
              {t('toolRenderers.dataAnalysis.retry')}
            </button>
          </div>
        );
      }
      return (
        <div key={`${output.title}-${index}`} className="data-analysis-section mt-3 text-muted small">
          {t('toolRenderers.dataAnalysis.loadingOutput')}
        </div>
      );
    }
    return (
      <div key={`${output.title}-${index}`} className="data-analysis-section mt-3">
        <div className="fw-semibold mb-2">{output.title}</div>
        <MarkdownContent content={resolvedContent} />
      </div>
    );
  };

  return <div className="tool-result-data-analysis">{markdownOutputs.map(renderInlineOutput)}</div>;
};
