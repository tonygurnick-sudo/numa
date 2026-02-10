/**
 * WorkspaceChatSubagentCard - Collapsible container for Task subagent activity
 *
 * Displays a card with the task description and a scrollable list of
 * subagent events, rendered using the shared tool formatting utilities
 * so integration icons, skill labels, and display text stay consistent
 * with the main agent's inline tool rendering.
 */
import { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import type {
  WorkspaceChatSubagentSegment,
  SDKEvent,
  SDKAssistantEvent,
  SDKContentBlock,
  ToolCategory,
} from '@/types/workspaceChatTypes';
import {
  getInlineToolDisplay,
  getToolCategoryAndIcon,
  formatIntegrationToolLabel,
  INTEGRATION_MCP_TOOLS,
} from '@/utils/workspaceChatEventHandlers';
import { resolveToolVisual } from '@/utils/ToolConfig';

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
  iconImage?: string;
  category?: ToolCategory;
}

/**
 * Extract summary of what the subagent did from its events.
 * Uses the same formatting utilities as the main agent's inline tools
 * so integration icons, skill labels, and display text stay consistent.
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

        let text: string;
        let icon: string | undefined;
        let iconImage: string | undefined;
        let category: ToolCategory | undefined;

        // Integration MCP tools get branded display (logos, formatted labels)
        if (INTEGRATION_MCP_TOOLS.has(toolBlock.name) && input) {
          const integrationInfo = formatIntegrationToolLabel(toolBlock.name, input);
          if (integrationInfo) {
            const visual = resolveToolVisual(integrationInfo.integrationToolName);
            iconImage = visual.kind === 'image' ? visual.src : undefined;
            icon = visual.kind === 'icon' ? visual.className.replace('bi ', '') : undefined;
            text = integrationInfo.description
              ? `${integrationInfo.actionName}: ${integrationInfo.description}`
              : integrationInfo.actionName;
            category = 'important';
          } else {
            // Fallback for unrecognized integration tool format
            const display = getInlineToolDisplay(toolBlock.name, input);
            const catAndIcon = getToolCategoryAndIcon(toolBlock.name, input);
            text = display.text;
            icon = catAndIcon.iconName;
            category = catAndIcon.category;
          }
        } else {
          // All other tools use shared display + category utilities
          const display = getInlineToolDisplay(toolBlock.name, input);
          const catAndIcon = getToolCategoryAndIcon(toolBlock.name, input);
          text = display.text;
          icon = catAndIcon.iconName;
          category = catAndIcon.category;
        }

        // Deduplicate by text
        if (text && !seenTexts.has(text)) {
          seenTexts.add(text);
          summaries.push({ text, icon: icon || 'bi-tools', iconImage, category });
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
                      ) : summary.iconImage ? (
                        <img src={summary.iconImage} alt="" className="inline-tool-icon-img" loading="lazy" />
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
