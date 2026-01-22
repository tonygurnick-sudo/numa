import React, { useMemo, useState, useEffect, memo } from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { getVisibleQuickActions, type QuickActionConfig } from '../../config/quickActionsConfig';

interface QuickActionsRowProps {
  /** Callback when a quick action is clicked */
  onQuickAction: (action: QuickActionConfig) => void;
  /** Whether web search is enabled (auto tools or explicit) */
  webSearchEnabled?: boolean;
  /** Whether knowledge base is enabled (has at least one KB) */
  kbEnabled?: boolean;
  /** Whether agents feature is enabled */
  agentsEnabled?: boolean;
  /** Set of connected integration IDs */
  connectedIntegrations?: Set<string>;
  /** Whether buttons should be disabled (e.g., during streaming) */
  disabled?: boolean;
  /** Maximum number of actions to show */
  maxVisible?: number;
}

/**
 * QuickActionsRow displays a row of quick action buttons on the new chat page.
 * These help non-technical users discover what Numa can do by providing
 * one-click prompts for common tasks.
 *
 * Actions are filtered based on enabled features and connected integrations.
 * On mobile, the row becomes horizontally scrollable.
 */
const QuickActionsRow: React.FC<QuickActionsRowProps> = ({
  onQuickAction,
  webSearchEnabled = false,
  kbEnabled = false,
  agentsEnabled = false,
  connectedIntegrations = new Set<string>(),
  disabled = false,
  maxVisible = 6,
}) => {
  // Track viewport width for responsive behavior
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [isSmallMobile, setIsSmallMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 400 : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      setIsSmallMobile(window.innerWidth <= 400);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Get visible actions based on enabled features
  const visibleActions = useMemo(() => {
    return getVisibleQuickActions({
      webSearchEnabled,
      kbEnabled,
      agentsEnabled,
      connectedIntegrations,
      maxVisible: isMobile ? Math.min(maxVisible, 4) : maxVisible,
    });
  }, [webSearchEnabled, kbEnabled, agentsEnabled, connectedIntegrations, maxVisible, isMobile]);

  // Don't render if no actions are visible
  if (visibleActions.length === 0) {
    return null;
  }

  const handleClick = (action: QuickActionConfig) => {
    if (!disabled) {
      onQuickAction(action);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: QuickActionConfig) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault();
      onQuickAction(action);
    }
  };

  return (
    <div className="quick-actions-row" role="group" aria-label="Quick actions">
      <div className="quick-actions-scroll">
        {visibleActions.map((action) => (
          <OverlayTrigger
            key={action.id}
            placement="top"
            overlay={<Tooltip id={`quick-action-${action.id}`}>{action.description}</Tooltip>}
          >
            <button
              type="button"
              className={`quick-action-btn ${disabled ? 'disabled' : ''}`}
              onClick={() => handleClick(action)}
              onKeyDown={(e) => handleKeyDown(e, action)}
              disabled={disabled}
              aria-label={action.label}
            >
              <i className={`bi ${action.icon}`} aria-hidden="true" />
              {!isSmallMobile && <span className="quick-action-label">{action.label}</span>}
            </button>
          </OverlayTrigger>
        ))}
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
const MemoizedQuickActionsRow = memo(QuickActionsRow);
MemoizedQuickActionsRow.displayName = 'QuickActionsRow';

export { MemoizedQuickActionsRow as QuickActionsRow };
export default MemoizedQuickActionsRow;
