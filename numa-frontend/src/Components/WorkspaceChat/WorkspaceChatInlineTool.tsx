/**
 * WorkspaceChatInlineTool - Minimal tool indicator with icons
 *
 * Displays tool activities as single lines with status indicators.
 * - Important tools show specific icons (web search, KB, file creation)
 * - Default tools show generic tools icon (bi-tools)
 * - Running tools show a spinner next to the icon
 * - Transient tools (file searches) are removed when text starts streaming
 *
 * Integration tools with human-in-the-loop approval render an expandable
 * glass panel below the tool indicator when approval data is present.
 */
import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Spinner, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatInlineToolSegment } from '@/types/workspaceChatTypes';
import { ackToolApproval, approveToolAction } from '../../Services/workspaceChatAgentService';
import { ConnectorsService } from '../../Services/ConnectorsService';
import { registerPendingApproval, resolvePendingApproval } from '../../hooks/useBrowserNotification';

// If you change this, also update APPROVAL_TIMEOUT_SECONDS in
// `lambdas/python/workspace-chat-tools/tools/approval.py`. Three copies
// (frontend, lambda, agent service) — must stay in sync.
const APPROVAL_TIMEOUT_SECONDS = 180;

/** Circular countdown timer SVG for the approval panel */
function ApprovalCountdown({ secondsLeft }: { secondsLeft: number }) {
  const size = 36;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = secondsLeft / APPROVAL_TIMEOUT_SECONDS;
  const dashOffset = circumference * (1 - progress);

  const strokeColor = secondsLeft > 30 ? 'var(--brand-primary, #6366f1)' : secondsLeft > 15 ? '#f59e0b' : '#ef4444';

  const isPulsing = secondsLeft <= 10;

  return (
    <div className={`approval-countdown${isPulsing ? ' pulse' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }}
        />
      </svg>
      <span className="approval-countdown-text" style={{ color: strokeColor }}>
        {secondsLeft}
      </span>
    </div>
  );
}

interface Props {
  segment: WorkspaceChatInlineToolSegment;
  conversationId?: string;
}

/** Check if an action key belongs to a numa_tool write operation */
function isNumaToolAction(actionKey: string): boolean {
  return actionKey.startsWith('numa_');
}

/** Extract source label from action key. For numa_tool: "Agents" / "Memories". For integrations: "Google Drive" etc. */
function formatSourceName(actionKey: string): string {
  if (isNumaToolAction(actionKey)) {
    const parts = actionKey.split('_');
    if (parts.length >= 2) {
      const source = parts[1];
      return source.charAt(0).toUpperCase() + source.slice(1);
    }
    return actionKey;
  }
  const slug = actionKey.split('-')[0] || actionKey;
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Extract operation label from action key. For numa_tool: "Create" / "Update". For integrations: "Get Current User" etc. */
function formatOperationName(actionKey: string): string {
  if (isNumaToolAction(actionKey)) {
    const parts = actionKey.split('_');
    if (parts.length >= 3) {
      const op = parts.slice(2).join(' ');
      return op.charAt(0).toUpperCase() + op.slice(1);
    }
    return actionKey;
  }
  const parts = actionKey.split('-').slice(1);
  if (parts.length === 0) return actionKey;
  return parts.join(' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Single inline tool indicator showing status and display text.
 * When approval data is present, renders an expandable approval panel below.
 */
function WorkspaceChatInlineTool({ segment, conversationId }: Props) {
  const { t } = useTranslation('integrations');
  const { displayText, isComplete, isError, iconName, iconImage, approval, approvalOnly, credentialRequest } = segment;
  const [credValues, setCredValues] = useState<Record<string, string>>(() => credentialRequest?.values ?? {});
  const [credSubmitting, setCredSubmitting] = useState(false);
  const [credSubmitted, setCredSubmitted] = useState<boolean>(credentialRequest?.status === 'submitted');
  const [credError, setCredError] = useState<string | null>(null);

  useEffect(() => {
    if (credentialRequest) {
      setCredValues(credentialRequest.values ?? Object.fromEntries(credentialRequest.fields.map((f) => [f.key, ''])));
      setCredSubmitted(credentialRequest.status === 'submitted');
      setCredError(credentialRequest.error ?? null);
    }
  }, [credentialRequest]);

  const credCanSubmit = credentialRequest
    ? credentialRequest.fields.every((f) => !f.required || (credValues[f.key] ?? '').trim().length > 0)
    : false;

  const handleCredSubmit = useCallback(async () => {
    if (!credentialRequest) return;
    const payload: Record<string, string> = {};
    for (const f of credentialRequest.fields) {
      const v = (credValues[f.key] ?? '').trim();
      if (v) payload[f.key] = v;
    }
    if (Object.keys(payload).length === 0) return;
    setCredSubmitting(true);
    setCredError(null);
    try {
      await ConnectorsService.saveCredentials(credentialRequest.connectorId, payload);
      setCredSubmitted(true);
    } catch (err) {
      setCredError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setCredSubmitting(false);
    }
  }, [credentialRequest, credValues]);
  const [submitting, setSubmitting] = useState(false);
  const [localDecision, setLocalDecision] = useState<string | undefined>(undefined);
  const [denyReason, setDenyReason] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(() => {
    // Sync with backend timer: if the approval event includes a created_at
    // timestamp, calculate how much time has already elapsed so the frontend
    // countdown matches the backend's remaining approval window.
    if (approval?.createdAt) {
      const elapsed = Math.floor(Date.now() / 1000) - approval.createdAt;
      return Math.max(0, APPROVAL_TIMEOUT_SECONDS - elapsed);
    }
    return APPROVAL_TIMEOUT_SECONDS;
  });

  const statusClass = isError ? 'error' : isComplete ? 'complete' : 'running';
  const isRunning = !isComplete && !isError;
  const effectiveIcon = iconName || 'bi-tools';
  const classNames = ['workspace-chat-inline-tool', statusClass, iconImage && 'integration'].filter(Boolean).join(' ');

  const decision = localDecision || approval?.decision || (approval?.autoApproved ? 'approved' : undefined);
  const showApprovalPanel = approval && !decision && !approval.autoApproved;

  // Tab-title attention indicator: flag this approval as pending while it awaits
  // a decision so the user spots it in the tab strip if they've switched away.
  // Cleared when decided/timed out (panel hides) or when the segment unmounts.
  useEffect(() => {
    const requestId = approval?.requestId;
    if (!requestId) return;
    if (showApprovalPanel) {
      registerPendingApproval(requestId);
      return () => resolvePendingApproval(requestId);
    }
    resolvePendingApproval(requestId);
  }, [showApprovalPanel, approval?.requestId]);

  // Acknowledge that the card rendered (writes seen_at via the proxy) so the
  // backend grants the full approval window instead of fast-failing the
  // approval as "unattended" (BUG-140). Fire-and-forget; skipped for stale
  // trace replays where the window already expired (secondsLeft 0).
  const ackSentForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showApprovalPanel || !approval || !conversationId || secondsLeft <= 0) return;
    if (ackSentForRef.current === approval.requestId) return;
    ackSentForRef.current = approval.requestId;
    ackToolApproval(approval.requestId, conversationId).catch((err) => {
      console.warn('[WorkspaceChat] Approval ack failed:', err);
    });
  }, [showApprovalPanel, approval, conversationId, secondsLeft]);

  const handleDecision = useCallback(
    async (choice: 'approved' | 'denied') => {
      if (!approval || !conversationId) return;
      setSubmitting(true);
      try {
        const reason = choice === 'denied' ? denyReason.trim() || undefined : undefined;
        await approveToolAction(approval.requestId, choice, conversationId, reason);
        setLocalDecision(choice);
      } catch (err) {
        console.error('Approval failed:', err);
      } finally {
        setSubmitting(false);
      }
    },
    [approval, conversationId, denyReason]
  );

  // Countdown timer — ticks every second while approval panel is shown
  useEffect(() => {
    if (!showApprovalPanel) return;
    if (secondsLeft <= 0) {
      setLocalDecision('timeout');
      return;
    }
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [showApprovalPanel, secondsLeft]);

  // For approvalOnly segments (sub-agent approvals), hide entirely once decided
  // since the tool call info is already visible inside the subagent card.
  if (approvalOnly && decision) return null;
  const showCredentialPanel = Boolean(credentialRequest) && !credSubmitted;

  return (
    <div className="workspace-chat-inline-tool-wrapper">
      {/* Tool indicator line — hidden for approvalOnly (sub-agent) since the
          tool call is already shown inside the subagent card */}
      {!approvalOnly && (
        <div className={classNames}>
          <span className={`inline-tool-icon ${statusClass}`}>
            {iconImage ? (
              <img src={iconImage} alt="" className="inline-tool-icon-img" loading="lazy" />
            ) : (
              <i className={`bi ${effectiveIcon}`} />
            )}
          </span>
          <div className="inline-tool-content">
            <span className="inline-tool-text" style={{ whiteSpace: 'pre-line' }}>
              {displayText.replace(/\\n/g, '\n')}
            </span>
            {isRunning && !showApprovalPanel && (
              <Spinner animation="border" size="sm" className="inline-tool-trailing-spinner" />
            )}
            {decision && (
              <span className={`inline-tool-decision-badge ${decision}`}>
                {(decision === 'execution_timeout' || decision === 'execution_failed') && (
                  <i className="bi bi-exclamation-triangle me-1" />
                )}
                {approval?.autoApproved
                  ? t('approval.autoApproved')
                  : decision === 'approved'
                    ? t('approval.approved')
                    : decision === 'denied'
                      ? t('approval.denied')
                      : decision === 'execution_timeout' || decision === 'execution_failed'
                        ? t('approval.executionFailed')
                        : t('approval.timeout')}
              </span>
            )}
          </div>
        </div>
      )}

      {showCredentialPanel && credentialRequest && (
        <div className="inline-tool-approval-panel">
          <div className="approval-panel-header">
            <i className="bi bi-key" />
            <span>
              {t('credential.title', {
                defaultValue: `Connect ${credentialRequest.displayName}`,
                name: credentialRequest.displayName,
              })}
            </span>
          </div>
          <div className="approval-panel-details">
            <div className="approval-detail-row">
              <span className="approval-detail-value">
                {t('credential.description', {
                  defaultValue: `Enter your personal ${credentialRequest.displayName} credential. It will be stored in your personal vault, not shared with anyone else.`,
                  name: credentialRequest.displayName,
                })}
              </span>
            </div>
            {credentialRequest.fields.map((f) => (
              <div
                key={f.key}
                className="approval-detail-row"
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                <label className="approval-detail-label" htmlFor={`cred-${credentialRequest.connectorId}-${f.key}`}>
                  {/* Older connector-config snapshots stored raw i18n keys as
                      labels — t() resolves those and passes already-resolved
                      text through unchanged. */}
                  {t(f.label)}
                  {f.required && <span className="text-danger ms-1">*</span>}
                </label>
                <Form.Control
                  id={`cred-${credentialRequest.connectorId}-${f.key}`}
                  type={f.type || 'text'}
                  size="sm"
                  placeholder={f.placeholder || ''}
                  value={credValues[f.key] ?? ''}
                  onChange={(e) => setCredValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  disabled={credSubmitting}
                  autoComplete="off"
                />
              </div>
            ))}
            {credError && (
              <div className="approval-detail-row">
                <span className="approval-detail-value text-danger">{credError}</span>
              </div>
            )}
          </div>
          <div className="approval-panel-actions">
            <button
              className="approval-btn approve"
              onClick={handleCredSubmit}
              disabled={credSubmitting || !credCanSubmit}
            >
              {credSubmitting ? (
                <Spinner animation="border" size="sm" className="me-1" />
              ) : (
                <i className="bi bi-check-lg me-1" />
              )}
              {t('credential.submit', { defaultValue: 'Connect' })}
            </button>
          </div>
        </div>
      )}

      {credentialRequest && credSubmitted && (
        <div className="inline-tool-approval-panel">
          <div className="approval-panel-details">
            <div className="approval-detail-row">
              <span className="approval-detail-value">
                <i className="bi bi-check-circle text-success me-2" />
                {t('credential.submitted', {
                  defaultValue: `Connected. Ask me again to use ${credentialRequest.displayName}.`,
                  name: credentialRequest.displayName,
                })}
              </span>
            </div>
          </div>
        </div>
      )}

      {showApprovalPanel && (
        <div className="inline-tool-approval-panel">
          <div className="approval-panel-header">
            <i className="bi bi-shield-lock" />
            <span>{t('approval.title')}</span>
          </div>
          <div className="approval-panel-details">
            <div className="approval-detail-row">
              <span className="approval-detail-label">
                {isNumaToolAction(approval.actionKey) ? t('approval.source') : t('approval.integration')}:
              </span>
              <span className="approval-detail-value">{formatSourceName(approval.actionKey)}</span>
            </div>
            <div className="approval-detail-row">
              <span className="approval-detail-label">
                {isNumaToolAction(approval.actionKey) ? t('approval.operation') : t('approval.action')}:
              </span>
              <span className="approval-detail-value">{formatOperationName(approval.actionKey)}</span>
            </div>
            {approval.description && (
              <div className="approval-detail-row">
                <span className="approval-detail-label">{t('approval.description')}:</span>
                <span className="approval-detail-value" style={{ whiteSpace: 'pre-line' }}>
                  {approval.description.replace(/\\n/g, '\n')}
                </span>
              </div>
            )}
          </div>
          <div className="approval-panel-actions">
            <button className="approval-btn approve" onClick={() => handleDecision('approved')} disabled={submitting}>
              {submitting ? (
                <Spinner animation="border" size="sm" className="me-1" />
              ) : (
                <i className="bi bi-check-lg me-1" />
              )}
              {t('approval.approve')}
            </button>
            <button className="approval-btn deny" onClick={() => handleDecision('denied')} disabled={submitting}>
              <i className="bi bi-x-lg me-1" />
              {t('approval.deny')}
            </button>
            <Form.Control
              type="text"
              size="sm"
              placeholder={t('approval.denyReasonPlaceholder')}
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDecision('denied');
              }}
              disabled={submitting}
              className="approval-deny-reason-input"
            />
            <ApprovalCountdown secondsLeft={secondsLeft} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Container for a group of inline tools with connected dots.
 */
interface InlineToolGroupProps {
  segments: WorkspaceChatInlineToolSegment[];
  conversationId?: string;
}

function WorkspaceChatInlineToolGroup({ segments, conversationId }: InlineToolGroupProps) {
  if (segments.length === 0) return null;

  return (
    <div className="workspace-chat-inline-tool-group">
      {segments.map((segment) => (
        <MemoizedWorkspaceChatInlineTool key={segment.toolUseId} segment={segment} conversationId={conversationId} />
      ))}
    </div>
  );
}

// Memoize components to prevent unnecessary re-renders
const MemoizedWorkspaceChatInlineTool = memo(WorkspaceChatInlineTool);
MemoizedWorkspaceChatInlineTool.displayName = 'WorkspaceChatInlineTool';

const MemoizedWorkspaceChatInlineToolGroup = memo(WorkspaceChatInlineToolGroup);
MemoizedWorkspaceChatInlineToolGroup.displayName = 'WorkspaceChatInlineToolGroup';

export {
  MemoizedWorkspaceChatInlineTool as WorkspaceChatInlineTool,
  MemoizedWorkspaceChatInlineToolGroup as WorkspaceChatInlineToolGroup,
};
export default MemoizedWorkspaceChatInlineTool;
