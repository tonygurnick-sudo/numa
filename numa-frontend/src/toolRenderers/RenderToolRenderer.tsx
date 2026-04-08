/**
 * Renderer for the render sub-tool of numa_tool.
 *
 * Displays HTML content in a sandboxed iframe (or SVG directly), or images inline.
 * For large content, fetches the full payload from S3 (the backend syncs
 * immediately so it's available during streaming).
 *
 * Injects a `sendPrompt(text)` global into HTML iframes so rendered content
 * can send messages back to the chat via postMessage.
 */
import { useCallback, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useAuth } from '../Providers/AuthProvider';
import { getRenderPayload, useS3FileResult, type RenderPayload, type ToolResultLike } from './helpers';

interface Props {
  result: ToolResultLike;
  conversationId?: string;
  sub?: string;
  onSendPrompt?: (text: string) => void;
}

/**
 * Script injected into HTML iframes to provide sendPrompt() and openLink().
 * Posts structured messages to the parent window.
 */
const IFRAME_BRIDGE_SCRIPT = `
<script>
(function() {
  window.sendPrompt = function(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    window.parent.postMessage({ type: 'numa-render-send-prompt', text: text.trim() }, '*');
  };
  window.openLink = function(url) {
    if (typeof url !== 'string') return;
    window.parent.postMessage({ type: 'numa-render-open-link', url: url }, '*');
  };
  document.addEventListener('click', function(e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (a && a.href && !a.href.startsWith('javascript:')) {
      e.preventDefault();
      window.openLink(a.href);
    }
  });
})();
</script>`;

/**
 * Inject the bridge script at the end of HTML content so sendPrompt() is available.
 */
function injectBridge(html: string): string {
  // Insert before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', IFRAME_BRIDGE_SCRIPT + '</body>');
  }
  return html + IFRAME_BRIDGE_SCRIPT;
}

/**
 * Check if content is a standalone SVG (starts with <svg, no scripts).
 * SVGs without scripts can be rendered directly via sanitized dangerouslySetInnerHTML
 * for crisper rendering without iframe overhead.
 */
function isSafeSvg(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('<svg')) return false;
  // Reject SVGs with script tags or event handlers
  if (/<script/i.test(trimmed)) return false;
  if (/\bon\w+\s*=/i.test(trimmed)) return false;
  return true;
}

export const RenderToolRenderer = ({ result, conversationId, sub, onSendPrompt }: Props) => {
  const { getCredentials } = useAuth();
  const payload = getRenderPayload(result);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for postMessage events from the iframe
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      // Verify the message came from one of our iframes
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      if (event.data.type === 'numa-render-send-prompt' && typeof event.data.text === 'string') {
        onSendPrompt?.(event.data.text);
      } else if (event.data.type === 'numa-render-open-link' && typeof event.data.url === 'string') {
        window.open(event.data.url, '_blank', 'noopener,noreferrer');
      }
    },
    [onSendPrompt]
  );

  useEffect(() => {
    if (!onSendPrompt) return;
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage, onSendPrompt]);

  // If the payload has a file_path (large content saved to S3), fetch it
  const { fileData, loading } = useS3FileResult(payload?.file_path, conversationId, sub, getCredentials);

  // Use S3 data if available, otherwise use inline payload
  const renderData: RenderPayload | null = fileData ? (fileData as RenderPayload) : payload?.content ? payload : null;

  if (loading) {
    return (
      <div className="render-tool-container">
        <div className="render-tool-loading">
          <div className="spinner-border spinner-border-sm" role="status" />
        </div>
      </div>
    );
  }

  if (!renderData?.content) return null;

  // SVG direct rendering -- no iframe needed for script-free SVGs
  if (renderData.render_type === 'html' && isSafeSvg(renderData.content)) {
    const sanitized = DOMPurify.sanitize(renderData.content, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
    });
    return (
      <div className="render-tool-container">
        {renderData.title && <div className="render-tool-title">{renderData.title}</div>}
        <div className="render-tool-svg" dangerouslySetInnerHTML={{ __html: sanitized }} />
      </div>
    );
  }

  return (
    <div className="render-tool-container">
      {renderData.title && <div className="render-tool-title">{renderData.title}</div>}
      {renderData.render_type === 'html' ? (
        <iframe
          ref={iframeRef}
          srcDoc={injectBridge(renderData.content)}
          sandbox="allow-scripts"
          className="render-tool-iframe"
          style={{ height: renderData.height || 400 }}
          title={renderData.title || 'Rendered content'}
        />
      ) : (
        <img
          src={
            renderData.content.startsWith('data:')
              ? renderData.content
              : `data:${renderData.mime_type || 'image/png'};base64,${renderData.content}`
          }
          alt={renderData.title || 'Rendered image'}
          className="render-tool-image"
        />
      )}
    </div>
  );
};
