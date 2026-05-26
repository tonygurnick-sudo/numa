import React from 'react';
import { Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type Variant = 'icon' | 'primary';

export interface OpenInChatButtonProps {
  conversationId?: string | null;
  /** 'icon' = compact icon-only button for tables; 'primary' = full button with label. */
  variant?: Variant;
  /** Override the button label (only used when variant='primary'). */
  label?: string;
  /** Stop click bubbling so it doesn't trigger row-expand handlers. Default true. */
  stopPropagation?: boolean;
  className?: string;
}

export const OpenInChatButton: React.FC<OpenInChatButtonProps> = ({
  conversationId,
  variant = 'icon',
  label,
  stopPropagation = true,
  className,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('agents');

  if (!conversationId) return null;

  const tooltip = t('scheduling.details.runHistory.openInChat');
  const fullLabel = label ?? t('scheduling.details.runHistory.continueInChat');

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    // Mirrors the deep-link pattern used by ChatHistoryPage / ChatArtifactsTab
    // so useConversationManager honours the selection unconditionally.
    sessionStorage.setItem('currentConversationId-v2', conversationId);
    sessionStorage.setItem('isWorkspaceConversation-v2', 'true');
    sessionStorage.setItem('pendingConversationSelect-v2', '1');
    navigate('/chat');
  };

  if (variant === 'icon') {
    return (
      <Button
        variant="link"
        size="sm"
        className={`p-1 text-decoration-none ${className ?? ''}`}
        onClick={handleClick}
        title={tooltip}
        aria-label={tooltip}
      >
        <i className="bi bi-chat-dots" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button variant="primary" size="sm" className={className} onClick={handleClick}>
      <i className="bi bi-chat-dots me-1" aria-hidden="true" />
      {fullLabel}
    </Button>
  );
};

export default OpenInChatButton;
