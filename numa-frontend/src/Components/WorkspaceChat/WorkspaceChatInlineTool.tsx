/**
 * WorkspaceChatInlineTool - Minimal tool indicator with icons
 *
 * Displays tool activities as single lines with status indicators.
 * - Important tools show specific icons (web search, KB, file creation)
 * - Default tools show generic tools icon (bi-tools)
 * - Running tools show a spinner next to the icon
 * - Transient tools (file searches) are removed when text starts streaming
 */
import React, { memo } from 'react';
import { Spinner } from 'react-bootstrap';
import type { WorkspaceChatInlineToolSegment } from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatInlineToolSegment;
}

/**
 * Single inline tool indicator showing status and display text.
 */
function WorkspaceChatInlineTool({ segment }: Props) {
  const { displayText, isComplete, isError, iconName } = segment;

  // Determine status class
  const statusClass = isError ? 'error' : isComplete ? 'complete' : 'running';
  const isRunning = !isComplete && !isError;

  // Use provided icon or default to tools icon
  const effectiveIcon = iconName || 'bi-tools';

  // Build class names
  const classNames = ['workspace-chat-inline-tool', statusClass].filter(Boolean).join(' ');

  return (
    <div className={classNames}>
      {/* Show spinner while running, icon when complete */}
      <span className={`inline-tool-icon ${statusClass}`}>
        {isRunning ? (
          <Spinner animation="border" size="sm" className="inline-tool-spinner" />
        ) : (
          <i className={`bi ${effectiveIcon}`} />
        )}
      </span>
      <div className="inline-tool-content">
        <span className="inline-tool-text">{displayText}</span>
      </div>
    </div>
  );
}

/**
 * Container for a group of inline tools with connected dots.
 */
interface InlineToolGroupProps {
  segments: WorkspaceChatInlineToolSegment[];
}

function WorkspaceChatInlineToolGroup({ segments }: InlineToolGroupProps) {
  if (segments.length === 0) return null;

  return (
    <div className="workspace-chat-inline-tool-group">
      {segments.map((segment) => (
        <MemoizedWorkspaceChatInlineTool key={segment.toolUseId} segment={segment} />
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
