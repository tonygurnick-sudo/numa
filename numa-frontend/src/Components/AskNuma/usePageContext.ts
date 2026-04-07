import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { toBlob } from 'html-to-image';

export interface PageContextResult {
  textPrefix: string;
  screenshotBlob: Blob | null;
  htmlContent: string | null;
}

const MAX_HTML_SIZE = 100 * 1024; // 100KB cap for HTML content

/**
 * Hook for capturing rich page context (route info, screenshot, HTML).
 * Used by the Ask Numa popup to attach context to the user's first message.
 */
export function usePageContext() {
  const [isCapturing, setIsCapturing] = useState(false);
  const location = useLocation();

  const captureContext = useCallback(async (): Promise<PageContextResult> => {
    setIsCapturing(true);
    try {
      // Tier 1: Text prefix (route + current page name + breadcrumbs)
      const { currentPageName, breadcrumbPath } = getNavigationInfo();
      const pageName = currentPageName || location.pathname;
      let contextLine = `The user is currently viewing the "${pageName}" page (${location.pathname})`;
      if (breadcrumbPath) {
        contextLine += ` | Navigation path: ${breadcrumbPath}`;
      }
      contextLine += '. A screenshot and HTML snapshot of the page are attached as files.';
      const textPrefix = `[Page context: ${contextLine}]\n\n`;

      // Find the main content element (excludes sidebar/nav)
      const mainElement =
        document.querySelector<HTMLElement>('.app-layout-content') ||
        document.querySelector<HTMLElement>('.app-layout-mobile-content');

      let screenshotBlob: Blob | null = null;
      let htmlContent: string | null = null;

      if (mainElement) {
        // Tier 2: Screenshot via html-to-image
        try {
          screenshotBlob = await toBlob(mainElement, {
            quality: 0.8,
            pixelRatio: 1,
            skipFonts: true,
            // Replace cross-origin images with a transparent pixel to avoid CORS errors
            imagePlaceholder:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            // Also filter out cross-origin image nodes entirely
            filter: (node: HTMLElement) => {
              if (node instanceof HTMLImageElement) {
                const src = node.src || '';
                if (src.startsWith('data:') || src.startsWith('blob:') || !src) return true;
                try {
                  return new URL(src).origin === window.location.origin;
                } catch {
                  return true;
                }
              }
              return true;
            },
          });
        } catch (err) {
          console.warn('[AskNuma] Screenshot capture failed:', err);
        }

        // Tier 3: HTML content
        try {
          let html = mainElement.innerHTML;
          if (html.length > MAX_HTML_SIZE) {
            html = html.slice(0, MAX_HTML_SIZE) + '\n<!-- truncated -->';
          }
          htmlContent = html;
        } catch (err) {
          console.warn('[AskNuma] HTML capture failed:', err);
        }
      }

      return { textPrefix, screenshotBlob, htmlContent };
    } finally {
      setIsCapturing(false);
    }
  }, [location.pathname]);

  return { captureContext, isCapturing };
}

function getNavigationInfo(): { currentPageName: string | null; breadcrumbPath: string | null } {
  try {
    const stack = JSON.parse(sessionStorage.getItem('navigation_stack') || '[]') as Array<{
      path: string;
      label: string;
    }>;
    if (stack.length === 0) return { currentPageName: null, breadcrumbPath: null };
    // Last entry in the navigation stack is the current page
    const currentPageName = stack[stack.length - 1].label || null;
    const breadcrumbPath = stack.map((entry) => entry.label).join(' > ');
    return { currentPageName, breadcrumbPath };
  } catch {
    return { currentPageName: null, breadcrumbPath: null };
  }
}
