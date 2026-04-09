/**
 * Inline renderer for web_search tool results in workspace chat.
 *
 * Handles two result shapes:
 * - Search results: compact list of clickable URLs with titles
 * - Fetch URL results: clickable file reference that opens in the side panel
 */

import {
  WorkspaceChatInlineFileReference,
  type FileReference,
} from '../Components/WorkspaceChat/WorkspaceChatInlineFileReference';
import { getWebSearchPayload } from './helpers';
import type { ToolResultLike } from './helpers';
import { useTranslation } from 'react-i18next';

interface WebSearchInlineRendererProps {
  result: ToolResultLike;
  onOpenFilePreview?: (ref: FileReference) => void;
  conversationId?: string;
  userSub?: string;
}

export const WebSearchInlineRenderer = ({
  result,
  onOpenFilePreview,
  conversationId,
  userSub,
}: WebSearchInlineRendererProps) => {
  const payload = getWebSearchPayload(result);
  if (!payload) return null;

  const { results = [], url: fetchedUrl, title: fetchedTitle, status, file_path } = payload;
  const isFetchUrl = !!(fetchedUrl && (file_path || payload.content));

  if (isFetchUrl) {
    return (
      <FetchUrlResult
        url={fetchedUrl!}
        title={fetchedTitle}
        filePath={file_path}
        hasError={status === 'error'}
        onOpenFilePreview={onOpenFilePreview}
        conversationId={conversationId}
        userSub={userSub}
      />
    );
  }

  if (results.length > 0) {
    return <SearchResults results={results} />;
  }

  return null;
};

// ── Search Results ────────────────────────────────────────────────────────────

const SearchResults = ({ results }: { results: Array<{ url: string; title?: string; snippet?: string }> }) => {
  const { t } = useTranslation('common');

  return (
    <div className="ws-inline-search-results">
      <div className="ws-inline-results-header">
        <i className="bi bi-globe2" />
        <span>
          {t('toolRenderers.webSearch.sourcesFound', {
            count: results.length,
            defaultValue: '{{count}} sources found',
          })}
        </span>
      </div>
      <div className="ws-inline-results-list">
        {results.map((r, idx) => (
          <a key={idx} href={r.url} target="_blank" rel="noopener noreferrer" className="ws-inline-result-item">
            <span className="ws-inline-result-title">{r.title || r.url}</span>
            <span className="ws-inline-result-url">{r.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
};

// ── Fetch URL Result ──────────────────────────────────────────────────────────

const WORKSPACE_S3_PREFIX = 'numa-chat/workspace';

const FetchUrlResult = ({
  url,
  title,
  filePath,
  hasError,
  onOpenFilePreview,
  conversationId,
  userSub,
}: {
  url: string;
  title?: string;
  filePath?: string;
  hasError: boolean;
  onOpenFilePreview?: (ref: FileReference) => void;
  conversationId?: string;
  userSub?: string;
}) => {
  // Strip /workdir/ prefix and build full S3 key
  const relativePath = filePath?.replace(/^\/workdir\//, '') || '';
  const s3Key =
    relativePath && userSub && conversationId
      ? `${WORKSPACE_S3_PREFIX}/${userSub}/conversations/${conversationId}/${relativePath}`
      : relativePath;
  const filename = relativePath ? relativePath.split('/').pop() || 'page.md' : `${new URL(url).hostname}.md`;

  if (hasError) {
    return null;
  }

  return (
    <div className="ws-inline-fetch-result">
      <a href={url} target="_blank" rel="noopener noreferrer" className="ws-inline-fetch-link">
        <i className="bi bi-globe2" />
        <span>{title || url}</span>
        <i className="bi bi-box-arrow-up-right" />
      </a>
      {onOpenFilePreview && s3Key && (
        <WorkspaceChatInlineFileReference
          fileRef={{
            filename,
            fullPath: s3Key,
            relativePath: relativePath,
            extension: 'md',
          }}
          onOpenPreview={onOpenFilePreview}
        />
      )}
    </div>
  );
};
