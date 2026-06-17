import { useTranslation } from 'react-i18next';
import { AskNumaPopup } from '../AskNuma/AskNumaPopup';
import { useSupportEnvironmentContext } from './useSupportEnvironmentContext';

/** Workspace agent type registered on the backend for support conversations. */
export const SUPPORT_AGENT_TYPE = 'numa-chat-support';

/** Per-client system KB the support agent is restricted to (seeded by seed-default-kb). */
export const SUPPORT_KB_ID = 'numa-support';

interface SupportNumaPopupProps {
  onClose: () => void;
  /** Collapsed state of the nav sidebar — picks the matching left offset. */
  sidebarCollapsed?: boolean;
}

/**
 * Support popup (FEAT-204) — the Support nav tab opens this instead of the
 * static support page. A parameterized Ask Numa popup that starts a
 * conversation with the dedicated `numa-chat-support` agent type and attaches
 * an environment report (client, feature flags, admin settings) alongside the
 * standard page-context capture (screenshot + HTML).
 *
 * Anchored bottom-left next to the nav sidebar (where the Support tab lives)
 * rather than the Ask Numa FAB's bottom-right corner, so the popup opens
 * beside the control that triggered it.
 */
export function SupportNumaPopup({ onClose, sidebarCollapsed }: SupportNumaPopupProps) {
  const { t } = useTranslation('support');
  const buildEnvironmentContext = useSupportEnvironmentContext();

  return (
    <AskNumaPopup
      onClose={onClose}
      className={`ask-numa-popup--nav-left${sidebarCollapsed ? ' ask-numa-popup--nav-collapsed' : ''}`}
      title={t('popup.title')}
      placeholder={t('popup.placeholder')}
      greeting={t('popup.greeting')}
      conversationNamePrefix={t('popup.conversationPrefix')}
      agentType={SUPPORT_AGENT_TYPE}
      agentTitle={t('popup.title')}
      buildExtraContextFiles={buildEnvironmentContext}
      // Open the support conversation in a new tab so the user keeps the page
      // they were working on, and keep the page-context capture out of their
      // visible message (it still travels to the agent via the attached files).
      openInNewTab
      hidePageContextPrefix
    />
  );
}

export default SupportNumaPopup;
