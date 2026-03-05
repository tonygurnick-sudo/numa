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
import React, { memo, useState, useEffect, useCallback } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatInlineToolSegment } from '@/types/workspaceChatTypes';
import { approveToolAction } from '../../Services/workspaceChatAgentService';

const APPROVAL_TIMEOUT_SECONDS = 90;

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

/** Extract a human-readable integration name from an action key like "google_drive-get-current-user" */
function formatIntegrationName(actionKey: string): string {
  const slug = actionKey.split('-')[0] || actionKey;
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Format the action part of an action key (e.g., "google_drive-get-current-user" → "Get Current User") */
function formatActionName(actionKey: string): string {
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
  const { displayText, isComplete, isError, iconName, iconImage, approval, approvalOnly } = segment;
  const [submitting, setSubmitting] = useState(false);
  const [localDecision, setLocalDecision] = useState<string | undefined>(undefined);
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

  const handleDecision = useCallback(
    async (choice: 'approved' | 'denied') => {
      if (!approval || !conversationId) return;
      setSubmitting(true);
      try {
        await approveToolAction(approval.requestId, choice, conversationId);
        setLocalDecision(choice);
      } catch (err) {
        console.error('Approval failed:', err);
      } finally {
        setSubmitting(false);
      }
    },
    [approval, conversationId]
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
                {decision === 'execution_timeout' && <i className="bi bi-exclamation-triangle me-1" />}
                {approval?.autoApproved
                  ? t('approval.autoApproved')
                  : decision === 'approved'
                    ? t('approval.approved')
                    : decision === 'denied'
                      ? t('approval.denied')
                      : decision === 'execution_timeout'
                        ? t('approval.executionTimeout')
                        : t('approval.timeout')}
              </span>
            )}
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
              <span className="approval-detail-label">{t('approval.integration')}:</span>
              <span className="approval-detail-value">{formatIntegrationName(approval.actionKey)}</span>
            </div>
            <div className="approval-detail-row">
              <span className="approval-detail-label">{t('approval.action')}:</span>
              <span className="approval-detail-value">{formatActionName(approval.actionKey)}</span>
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
