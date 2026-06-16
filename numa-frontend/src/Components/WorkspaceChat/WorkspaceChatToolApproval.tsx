/**
 * WorkspaceChatToolApproval - Inline approval card for integration tool actions.
 *
 * Shown when the agent wants to execute a Pipedream integration action
 * that requires user approval (e.g., run_action, proxy_request).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ackToolApproval, approveToolAction } from '../../Services/workspaceChatAgentService';
import type { WorkspaceChatToolApprovalSegment } from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatToolApprovalSegment;
  conversationId: string;
}

export function WorkspaceChatToolApproval({ segment, conversationId }: Props) {
  const { t } = useTranslation('integrations');
  const [submitting, setSubmitting] = useState(false);
  const [localDecision, setLocalDecision] = useState<string | undefined>(segment.decision);
  const [error, setError] = useState<string | null>(null);

  const handleDecision = async (decision: 'approved' | 'denied') => {
    setSubmitting(true);
    setError(null);
    try {
      await approveToolAction(segment.requestId, decision, conversationId);
      setLocalDecision(decision);
    } catch (err) {
      console.error('Approval failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit decision');
    } finally {
      setSubmitting(false);
    }
  };

  const decided = localDecision || segment.decision || (segment.autoApproved ? 'approved' : undefined);

  // Acknowledge that the card rendered (writes seen_at via the proxy) so the
  // backend grants the full approval window instead of fast-failing the
  // approval as "unattended" (BUG-140). Fire-and-forget.
  const ackSentRef = useRef(false);
  useEffect(() => {
    if (decided || ackSentRef.current || !segment.requestId || !conversationId) return;
    ackSentRef.current = true;
    ackToolApproval(segment.requestId, conversationId).catch((err) => {
      console.warn('[WorkspaceChat] Approval ack failed:', err);
    });
  }, [decided, segment.requestId, conversationId]);

  // Format action key for display (e.g., "google_drive-find-file" -> "Find File")
  const actionLabel =
    segment.actionKey
      .split('-')
      .slice(1) // Remove app prefix
      .join(' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || segment.actionKey;

  return (
    <div className="workspace-chat-tool-approval card border-warning mb-2 mt-2">
      <div className="card-body p-3">
        <div className="d-flex align-items-center mb-2">
          <i className="bi bi-shield-lock text-warning me-2" />
          <h6 className="card-title mb-0">{t('approval.title')}</h6>
        </div>
        <p className="mb-1 fw-semibold">{actionLabel}</p>
        {segment.description && (
          <p className="text-muted small mb-2" style={{ whiteSpace: 'pre-line' }}>
            {segment.description.replace(/\\n/g, '\n')}
          </p>
        )}
        {segment.propsPreview && (
          <details className="mb-2">
            <summary className="small text-muted">{t('approval.viewDetails')}</summary>
            <pre
              className="small bg-light p-2 rounded mt-1 mb-0"
              style={{ maxHeight: '150px', overflow: 'auto', fontSize: '0.75rem' }}
            >
              {typeof segment.propsPreview === 'string'
                ? segment.propsPreview
                : JSON.stringify(segment.propsPreview, null, 2)}
            </pre>
          </details>
        )}
        {error && <div className="text-danger small mb-2">{error}</div>}
        {decided ? (
          <span className={`badge ${decided === 'approved' ? 'bg-success' : 'bg-danger'}`}>
            {segment.autoApproved
              ? t('approval.autoApproved')
              : decided === 'approved'
                ? t('approval.approved')
                : t('approval.denied')}
          </span>
        ) : (
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-success" onClick={() => handleDecision('approved')} disabled={submitting}>
              {submitting ? (
                <span className="spinner-border spinner-border-sm me-1" />
              ) : (
                <i className="bi bi-check-lg me-1" />
              )}
              {t('approval.approve')}
            </button>
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => handleDecision('denied')}
              disabled={submitting}
            >
              <i className="bi bi-x-lg me-1" />
              {t('approval.deny')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
