/**
 * OpenTraceButton - Dev tool for downloading conversation traces.
 *
 * Temporary feature for development - downloads the raw trace.jsonl
 * as a styled HTML file for easy viewing.
 *
 * Only visible in workspace mode.
 */
import { useState } from 'react';
import { Dropdown, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getWorkspaceChatRawTrace } from '../../Services/workspaceChatAgentService';
import { generateTraceHtml, downloadHtmlFile } from '../../utils/traceHtmlGenerator';

interface OpenTraceButtonProps {
  conversationId: string | null;
}

export function OpenTraceButton({ conversationId }: OpenTraceButtonProps) {
  const { t } = useTranslation('chat');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (mode: 'full' | 'clean' | 'raw') => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const traceContent = await getWorkspaceChatRawTrace(conversationId);

      if (!traceContent) {
        setError('No trace found');
        return;
      }

      if (mode === 'raw') {
        // Download raw NDJSON file as-is
        const blob = new Blob([traceContent], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trace-${conversationId.substring(0, 8)}.ndjson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const html = generateTraceHtml(traceContent, mode, conversationId);
        const filename = `trace-${conversationId.substring(0, 8)}-${mode}.html`;
        downloadHtmlFile(html, filename);
      }
    } catch (err) {
      console.error('Failed to download trace:', err);
      setError(err instanceof Error ? err.message : 'Failed to download');
    } finally {
      setIsLoading(false);
    }
  };

  if (!conversationId) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle
        variant="outline-secondary"
        size="sm"
        disabled={isLoading}
        title={error || t('workspace.trace.downloadTitle')}
        className="d-flex align-items-center"
      >
        {isLoading ? (
          <Spinner animation="border" size="sm" className="me-1" />
        ) : (
          <i className="bi bi-file-earmark-code me-1"></i>
        )}
        {t('workspace.trace.button')}
      </Dropdown.Toggle>

      <Dropdown.Menu>
        <Dropdown.Item onClick={() => handleDownload('clean')} disabled={isLoading}>
          <i className="bi bi-funnel me-2"></i>
          {t('workspace.trace.cleanTrace')}
          <div className="small text-muted">{t('workspace.trace.cleanTraceDesc')}</div>
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => handleDownload('full')} disabled={isLoading}>
          <i className="bi bi-file-earmark-text me-2"></i>
          {t('workspace.trace.fullTrace')}
          <div className="small text-muted">{t('workspace.trace.fullTraceDesc')}</div>
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => handleDownload('raw')} disabled={isLoading}>
          <i className="bi bi-filetype-json me-2"></i>
          {t('workspace.trace.rawTrace')}
          <div className="small text-muted">{t('workspace.trace.rawTraceDesc')}</div>
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

export default OpenTraceButton;
