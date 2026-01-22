/**
 * WorkspaceChatSubagentCard - Collapsible container for Task subagent activity
 *
 * Displays a card with the task description and a scrollable list of
 * subagent events, rendered recursively using the segment renderer.
 */
import { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import type {
  WorkspaceChatSubagentSegment,
  SDKEvent,
  SDKAssistantEvent,
  SDKContentBlock,
} from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatSubagentSegment;
}

/**
 * Get a friendly label for the subagent type.
 */
function getSubagentTypeLabel(subagentType: string): string {
  const labels: Record<string, string> = {
    explore: 'Exploring',
    'general-purpose': 'Analyzing',
    plan: 'Planning',
    'knowledge-search': 'Searching KB',
  };
  return labels[subagentType] || 'Task';
}

interface ToolSummary {
  text: string;
  icon: string;
}

/**
 * Get icon for a tool name.
 * Handles multiple naming conventions (PascalCase, snake_case, kebab-case).
 */
function getToolIcon(toolName: string): string {
  const iconMap: Record<string, string> = {
    // File operations
    Read: 'bi-file-earmark-text',
    Write: 'bi-file-earmark-plus',
    Edit: 'bi-pencil-square',
    // Search/explore
    Grep: 'bi-search',
    Glob: 'bi-folder2-open',
    Bash: 'bi-terminal',
    // Web search variants
    WebSearch: 'bi-search',
    web_search: 'bi-search',
    'web-search': 'bi-search',
    // Web fetch variants
    WebFetch: 'bi-globe',
    web_fetch: 'bi-globe',
    'web-fetch': 'bi-globe',
  };
  return iconMap[toolName] || 'bi-tools';
}

/**
 * Extract summary of what the subagent did from its events.
 */
function getSubagentSummary(events: SDKEvent[]): ToolSummary[] {
  const summaries: ToolSummary[] = [];
  const seenTexts = new Set<string>();

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const assistantEvent = event as SDKAssistantEvent;

    for (const block of assistantEvent.message.content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as SDKContentBlock & { name: string; input: unknown };
        const input = toolBlock.input as Record<string, unknown> | undefined;
        let text = '';
        const icon = getToolIcon(toolBlock.name);

        switch (toolBlock.name) {
          case 'Read': {
            const path = input?.file_path as string;
            if (path) {
              const filename = path.split('/').pop() || path;
              text = `Reading ${filename}`;
            }
            break;
          }
          case 'Write': {
            const path = input?.file_path as string;
            if (path) {
              const filename = path.split('/').pop() || path;
              text = `Created ${filename}`;
            }
            break;
          }
          case 'Grep':
          case 'Glob':
            text = 'Searching files';
            break;
          case 'Bash': {
            const desc = input?.description as string;
            if (desc) {
              text = desc;
            } else {
              text = 'Running command';
            }
            break;
          }
          default:
            text = `Using ${toolBlock.name}`;
        }

        // Deduplicate by text
        if (text && !seenTexts.has(text)) {
          seenTexts.add(text);
          summaries.push({ text, icon });
        }
      }
    }
  }

  return summaries;
}

export function WorkspaceChatSubagentCard({ segment }: Props) {
  const { taskDescription, subagentType, events, isComplete } = segment;
  const [collapsed, setCollapsed] = useState(false);

  const typeLabel = getSubagentTypeLabel(subagentType);
  const summaries = getSubagentSummary(events);

  return (
    <div className={`workspace-chat-subagent-card ${isComplete ? 'complete' : 'running'}`}>
      {/* Header */}
      <div
        className="subagent-header"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <div className="subagent-title">
          <span className="subagent-type-badge">{typeLabel}</span>
          <span className="subagent-description">{taskDescription}</span>
        </div>
        <div className="subagent-status">
          {!isComplete && (
            <span className="subagent-spinner">
              <i className="bi bi-arrow-repeat spinning" />
            </span>
          )}
          <span className="subagent-chevron">
            <i className={`bi bi-chevron-${collapsed ? 'down' : 'up'}`} />
          </span>
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="subagent-content">
          {summaries.length > 0 ? (
            <div className="subagent-activity-list">
              {summaries.map((summary, index) => {
                const isLast = index === summaries.length - 1;
                const isRunning = isLast && !isComplete;
                return (
                  <div key={index} className="subagent-activity-item">
                    <span className={`activity-icon ${isRunning ? 'running' : 'complete'}`}>
                      {isRunning ? (
                        <Spinner animation="border" size="sm" className="activity-spinner" />
                      ) : (
                        <i className={`bi ${summary.icon}`} />
                      )}
                    </span>
                    <span className="activity-text">{summary.text}</span>
                  </div>
                );
              })}
              {!isComplete && (
                <div className="subagent-activity-item">
                  <span className="activity-icon running">
                    <Spinner animation="border" size="sm" className="activity-spinner" />
                  </span>
                  <span className="activity-text thinking">Working...</span>
                </div>
              )}
            </div>
          ) : (
            <div className="subagent-empty">{isComplete ? 'Completed' : 'Starting...'}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorkspaceChatSubagentCard;
