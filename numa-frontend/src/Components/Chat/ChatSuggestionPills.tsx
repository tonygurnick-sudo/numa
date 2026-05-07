import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ChatSuggestionPillsProps {
  suggestions: string[];
  onPick: (text: string) => void;
  debugInfo?: {
    lastUsage: { inputTokens: number; outputTokens: number } | null;
    sessionCostUsd: number;
  } | null;
}

const SUGGESTION_TIP_KEY = 'chat-suggestions-tip-dismissed';
const PILL_GAP_PX = 6; // matches gap: 0.375rem at 16px base
const MIN_PILL_WIDTH_PX = 100;

export function ChatSuggestionPills({ suggestions, onPick, debugInfo = null }: ChatSuggestionPillsProps) {
  const { t } = useTranslation('chat');
  const [showTip, setShowTip] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(() => localStorage.getItem(SUGGESTION_TIP_KEY) === 'true');
  const [naturalWidths, setNaturalWidths] = useState<number[]>([]);
  const [maxFit, setMaxFit] = useState<number>(Number.MAX_SAFE_INTEGER);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debugRef = useRef<HTMLSpanElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (suggestions.length > 0 && !tipDismissed) {
      setShowTip(true);
    }
  }, [suggestions, tipDismissed]);

  const handleDismissTip = useCallback(() => {
    localStorage.setItem(SUGGESTION_TIP_KEY, 'true');
    setTipDismissed(true);
    setShowTip(false);
  }, []);

  useEffect(() => {
    if (!showTip) return;
    const timer = setTimeout(handleDismissTip, 8000);
    return () => clearTimeout(timer);
  }, [showTip, handleDismissTip]);

  // Measure each pill's natural width via the hidden ghost row
  useLayoutEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost) {
      setNaturalWidths([]);
      return;
    }
    const items = Array.from(ghost.children) as HTMLElement[];
    setNaturalWidths(items.map((el) => el.getBoundingClientRect().width));
  }, [suggestions]);

  // Decide how many pills fit: pills 1..n-1 at natural width, last pill allowed to truncate to MIN
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || naturalWidths.length === 0) return;

    const measure = () => {
      const containerWidth = container.clientWidth;
      const debugWidth = debugRef.current ? debugRef.current.offsetWidth + PILL_GAP_PX : 0;
      const available = Math.max(0, containerWidth - debugWidth);

      let n = naturalWidths.length;
      while (n > 1) {
        const priorsSum = naturalWidths.slice(0, n - 1).reduce((a, b) => a + b, 0);
        const lastNatural = naturalWidths[n - 1];
        const lastReserved = Math.min(lastNatural, MIN_PILL_WIDTH_PX);
        const required = priorsSum + lastReserved + (n - 1) * PILL_GAP_PX;
        if (required <= available) break;
        n--;
      }
      setMaxFit(Math.max(1, n));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [naturalWidths, debugInfo !== null]);

  if (suggestions.length === 0) return null;

  const visibleSuggestions = suggestions.slice(0, Math.min(suggestions.length, maxFit));

  return (
    <div className="chat-suggestion-pills-wrapper" aria-live="polite">
      <div ref={ghostRef} className="chat-suggestion-pills-ghost" aria-hidden="true">
        {suggestions.map((text, i) => (
          <span key={i} className="chat-suggestion-pill chat-suggestion-pill--ghost">
            <span className="chat-suggestion-pill__text">{text}</span>
          </span>
        ))}
      </div>

      {showTip && (
        <div className="chat-suggestion-tip">
          <span className="chat-suggestion-tip__text">{t('suggestions.tipMessage')}</span>
          <button
            type="button"
            className="chat-suggestion-tip__dismiss"
            onClick={handleDismissTip}
            aria-label={t('suggestions.tipDismiss')}
          >
            {t('suggestions.tipDismiss')}
          </button>
        </div>
      )}

      <div ref={containerRef} className="chat-suggestion-pills" role="group" aria-label={t('suggestions.ariaLabel')}>
        {debugInfo && (
          <span
            ref={debugRef}
            className="chat-suggestion-debug text-muted font-monospace"
            title={
              debugInfo.lastUsage
                ? `last call: ${debugInfo.lastUsage.inputTokens.toLocaleString()} in / ${debugInfo.lastUsage.outputTokens.toLocaleString()} out`
                : undefined
            }
          >
            ${debugInfo.sessionCostUsd.toFixed(4)}
          </span>
        )}
        {visibleSuggestions.map((text, i) => (
          <button key={i} type="button" className="chat-suggestion-pill" onClick={() => onPick(text)} title={text}>
            <span className="chat-suggestion-pill__text">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
