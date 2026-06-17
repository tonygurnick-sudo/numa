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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { useAuth } from '../Providers/AuthProvider';
import { getRenderPayload, useS3WorkspaceRawFile, type RenderPayload, type ToolResultLike } from './helpers';

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
  // Report content height so the parent can auto-size the iframe to fit (up to
  // a cap, beyond which it scrolls) instead of using a fixed height.
  function postHeight() {
    var h = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    if (h > 0) window.parent.postMessage({ type: 'numa-render-height', height: h }, '*');
  }
  window.addEventListener('load', postHeight);
  setTimeout(postHeight, 50);
  if (window.ResizeObserver && document.body) {
    new ResizeObserver(postHeight).observe(document.body);
  }
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

/**
 * Default max height (px) for a rendered iframe. The iframe auto-sizes to its
 * content up to this; taller content scrolls inside the box. The agent can
 * raise the cap with `--height` (e.g. a big dashboard); it never forces a fixed
 * height shorter than the content.
 */
const DEFAULT_MAX_RENDER_HEIGHT = 600;

export const RenderToolRenderer = ({ result, conversationId, sub, onSendPrompt }: Props) => {
  const { getCredentials } = useAuth();
  const { t } = useTranslation('chat');
  const payload = getRenderPayload(result);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Content height reported by the iframe bridge (null until first measured).
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

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
      } else if (event.data.type === 'numa-render-height' && typeof event.data.height === 'number') {
        setMeasuredHeight(event.data.height);
      }
    },
    [onSendPrompt]
  );

  // Always listen (height auto-sizing needs it even without onSendPrompt).
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Reconstructed-on-reload renders carry only a `file_path` (no inline
  // content): the live path always inlines `content`, but the trace replay
  // (parseNumaRenderCommand) can't, so we re-fetch the raw file here. Inline
  // content (live path + `--content` reloads) needs no fetch.
  const needsRawFetch = !!payload && !payload.content && !!payload.file_path;
  const {
    content: rawContent,
    loading,
    failed,
  } = useS3WorkspaceRawFile(
    needsRawFetch ? payload?.file_path : undefined,
    conversationId,
    sub,
    getCredentials,
    payload?.render_type
  );

  const renderData: RenderPayload | null = payload?.content
    ? payload
    : rawContent
      ? { ...(payload as RenderPayload), content: rawContent }
      : null;

  if (needsRawFetch && loading) {
    return (
      <div className="render-tool-container">
        <div className="render-tool-loading">
          <div className="spinner-border spinner-border-sm" role="status" />
        </div>
      </div>
    );
  }

  // The file was never S3-synced (e.g. a /workdir/tmp/ path) or has expired —
  // show a graceful placeholder rather than silently rendering nothing.
  if (needsRawFetch && failed) {
    return (
      <div className="render-tool-container">
        {payload?.title && <div className="render-tool-title">{payload.title}</div>}
        <div className="render-tool-unavailable text-muted small fst-italic">{t('render.unavailable')}</div>
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
          // Auto-fit to content up to the cap (renderData.height lets the agent
          // raise it); taller content scrolls inside the iframe. Before the
          // first measurement, fall back to a sensible default.
          style={{
            height: (() => {
              const cap = renderData.height || DEFAULT_MAX_RENDER_HEIGHT;
              return measuredHeight != null ? Math.min(measuredHeight, cap) : Math.min(renderData.height || 400, cap);
            })(),
          }}
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
