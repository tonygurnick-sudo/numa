import { useTranslation } from 'react-i18next';
import { AskNumaPopup } from '../AskNuma/AskNumaPopup';
import { useSupportEnvironmentContext } from './useSupportEnvironmentContext';

/** Workspace agent type registered on the backend for support conversations. */
export const SUPPORT_AGENT_TYPE = 'numa-chat-support';

/** Per-client system KB the support agent is restricted to (seeded by seed-default-kb). */
export const SUPPORT_KB_ID = 'numa-support';

interface SupportNumaPopupProps {
  onClose: () => void;
}

/**
 * Support popup (FEAT-204) — the Support nav tab opens this instead of the
 * static support page. A parameterized Ask Numa popup that starts a
 * conversation with the dedicated `numa-chat-support` agent type and attaches
 * an environment report (client, feature flags, admin settings) alongside the
 * standard page-context capture (screenshot + HTML).
 */
export function SupportNumaPopup({ onClose }: SupportNumaPopupProps) {
  const { t } = useTranslation('support');
  const buildEnvironmentContext = useSupportEnvironmentContext();

  return (
    <AskNumaPopup
      onClose={onClose}
      title={t('popup.title')}
      placeholder={t('popup.placeholder')}
      greeting={t('popup.greeting')}
      conversationNamePrefix={t('popup.conversationPrefix')}
      agentType={SUPPORT_AGENT_TYPE}
      agentTitle={t('popup.title')}
      buildExtraContextFiles={buildEnvironmentContext}
    />
  );
}

export default SupportNumaPopup;
