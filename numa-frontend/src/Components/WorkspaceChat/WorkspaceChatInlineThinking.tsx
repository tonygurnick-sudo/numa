/**
 * WorkspaceChatInlineThinking - Inline thinking indicator
 *
 * Shows a small spinner with "Thinking..." text inline where response content
 * would appear. This replaces the top-level thinking indicator (with Numa's name)
 * to provide a cleaner, more focused UX.
 *
 * The component disappears when text or tool content starts streaming.
 */
import { Spinner } from 'react-bootstrap';

interface Props {
  /** Whether thinking is actively streaming */
  isStreaming: boolean;
}

export function WorkspaceChatInlineThinking({ isStreaming }: Props) {
  // Don't render if not actively streaming
  if (!isStreaming) return null;

  return (
    <div className="workspace-chat-inline-thinking">
      <Spinner animation="border" size="sm" className="inline-thinking-spinner" />
      <span className="inline-thinking-text">Thinking...</span>
    </div>
  );
}

export default WorkspaceChatInlineThinking;
