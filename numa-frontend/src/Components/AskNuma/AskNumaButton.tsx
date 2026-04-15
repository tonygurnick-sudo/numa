import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { getFlag } from '../../utils/featureFlags';
import { AskNumaPopup } from './AskNumaPopup';

/**
 * Floating "Ask Numa" button that appears on all pages except /chat.
 * Opens a lightweight chat popup for starting new conversations from anywhere.
 */
export function AskNumaButton() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { t } = useTranslation('chat');

  // Hide on chat page (already has full chat) and when feature flag is off
  const isChatPage = location.pathname.startsWith('/chat');
  const hasChatFeature = getFlag('NUMA_WORKSPACE_CHAT');

  // Close popup on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    },
    [isOpen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close popup on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  if (isChatPage || !hasChatFeature) {
    return null;
  }

  return (
    <>
      {isOpen && (
        <>
          <div className="ask-numa-overlay" onClick={() => setIsOpen(false)} />
          <AskNumaPopup onClose={() => setIsOpen(false)} />
        </>
      )}
      <button
        className={`ask-numa-fab ${isOpen ? 'ask-numa-fab--active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={t('askNuma.buttonLabel')}
      >
        <span className="ask-numa-fab-icon">
          <Sparkles size={18} />
        </span>
        <span className="ask-numa-fab-label">{t('askNuma.buttonLabel')}</span>
      </button>
    </>
  );
}

export default AskNumaButton;
