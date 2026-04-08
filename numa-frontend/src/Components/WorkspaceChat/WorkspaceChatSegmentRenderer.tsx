/**
 * WorkspaceChatSegmentRenderer - Central dispatcher for rendering workspace chat segments
 *
 * Routes segment types to their appropriate components.
 */
import { useTranslation } from 'react-i18next';
import type {
  WorkspaceChatSegment,
  WorkspaceChatInlineToolSegment,
  WorkspaceChatInlineThinkingSegment,
  WorkspaceChatFolderAttachmentSegment,
  WorkspaceChatCompactionSegment,
  WorkspaceChatToolApprovalSegment,
} from '@/types/workspaceChatTypes';
import { WorkspaceChatInlineToolGroup } from './WorkspaceChatInlineTool';
import { WorkspaceChatSubagentCard } from './WorkspaceChatSubagentCard';
import { WorkspaceChatTodoCard } from './WorkspaceChatTodoCard';
import { WorkspaceChatInlineThinking } from './WorkspaceChatInlineThinking';
import { WorkspaceChatCompactionBlock } from './WorkspaceChatCompactionBlock';
import { WorkspaceChatToolApproval } from './WorkspaceChatToolApproval';
import { ClipboardList } from 'lucide-react';
import { UnifiedToolCard } from '../UnifiedToolCard';
import { OpsToolRenderer } from '../../toolRenderers/OpsToolRenderer';
import { RenderToolRenderer } from '../../toolRenderers/RenderToolRenderer';
import type { ToolResultLike } from '../../toolRenderers/helpers';
import WorkspaceChatMarkdown, { type FileReference, type FolderReference } from '../Renderers/WorkspaceChatMarkdown';
import { useAuth } from '../../Providers/AuthProvider';

interface Props {
  segments: WorkspaceChatSegment[];
  conversationId?: string;
  userSub?: string;
  bucket?: string;
  region?: string;
  onOpenFilePreview?: (ref: FileReference) => void;
  onOpenFolderPreview?: (ref: FolderReference) => void;
}

/**
 * Group consecutive inline_tool segments together.
 */
function groupSegments(
  segments: WorkspaceChatSegment[]
): Array<WorkspaceChatSegment | WorkspaceChatInlineToolSegment[]> {
  const result: Array<WorkspaceChatSegment | WorkspaceChatInlineToolSegment[]> = [];
  let currentInlineGroup: WorkspaceChatInlineToolSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === 'inline_tool') {
      currentInlineGroup.push(segment);
    } else {
      // Flush any accumulated inline tools
      if (currentInlineGroup.length > 0) {
        result.push(currentInlineGroup);
        currentInlineGroup = [];
      }
      result.push(segment);
    }
  }

  // Flush remaining inline tools
  if (currentInlineGroup.length > 0) {
    result.push(currentInlineGroup);
  }

  return result;
}

export function WorkspaceChatSegmentRenderer({
  segments,
  conversationId,
  userSub,
  bucket,
  region,
  onOpenFilePreview,
  onOpenFolderPreview,
}: Props) {
  const { t } = useTranslation('chat');
  const { getCredentials } = useAuth();
  const groupedSegments = groupSegments(segments);

  return (
    <>
      {groupedSegments.map((item, index) => {
        // Handle grouped inline tools
        if (Array.isArray(item)) {
          return <WorkspaceChatInlineToolGroup key={`inline-group-${index}`} segments={item} />;
        }

        const segment = item;

        switch (segment.kind) {
          case 'text':
            return (
              <WorkspaceChatMarkdown
                key={`text-${index}`}
                content={segment.text}
                conversationId={conversationId || ''}
                userSub={userSub || ''}
                bucket={bucket || ''}
                region={region || ''}
                onOpenFilePreview={onOpenFilePreview}
                onOpenFolderPreview={onOpenFolderPreview}
                getCredentials={getCredentials}
              />
            );

          case 'inline_thinking':
            return (
              <WorkspaceChatInlineThinking
                key={`inline-thinking-${index}`}
                isStreaming={(segment as WorkspaceChatInlineThinkingSegment).isStreaming}
              />
            );

          case 'subagent':
            return <WorkspaceChatSubagentCard key={`subagent-${segment.parentToolUseId}`} segment={segment} />;

          case 'todo':
            return <WorkspaceChatTodoCard key={`todo-${segment.toolUseId}`} segment={segment} />;

          case 'compaction':
            return (
              <WorkspaceChatCompactionBlock
                key={`compaction-${index}`}
                segment={segment as WorkspaceChatCompactionSegment}
              />
            );

          case 'tool_card': {
            // Ops tool renders inline-style: description line + rendered content (no card box)
            if (segment.toolName === 'mcp__numa__numa_ops_tool') {
              const opsInput = segment.input as { description?: string; operation?: string } | undefined;
              const displayText = opsInput?.description || opsInput?.operation?.replace(/_/g, ' ') || 'Numa Ops';
              return (
                <div key={`ops-${segment.toolUseId}-${!!segment.result}`}>
                  <div className="workspace-chat-inline-tool-group">
                    <div className={`workspace-chat-inline-tool ${segment.isLoading ? '' : 'complete'}`}>
                      <span className={`inline-tool-icon ${segment.isLoading ? 'running' : 'complete'}`}>
                        <ClipboardList size={14} />
                      </span>
                      <div className="inline-tool-content">
                        <span className="inline-tool-text">{displayText}</span>
                        {segment.isLoading && (
                          <span className="spinner-border spinner-border-sm inline-tool-trailing-spinner" />
                        )}
                      </div>
                    </div>
                  </div>
                  {segment.result && (
                    <OpsToolRenderer
                      result={segment.result as ToolResultLike}
                      conversationId={conversationId}
                      sub={userSub}
                    />
                  )}
                </div>
              );
            }
            // Numa tool renders inline-style (like Ops): description + optional sub-tool renderer
            if (segment.toolName === 'mcp__numa__numa_tool') {
              const numaInput = segment.input as { name?: string; description?: string } | undefined;
              const displayText = numaInput?.description || segment.label || 'Numa Tool';
              const subTool = numaInput?.name;
              const NUMA_ICONS: Record<string, string> = {
                knowledge_base: 'bi-folder2-open',
                web_search: 'bi-search',
                extract_content: 'bi-file-earmark-text',
                convert_document: 'bi-file-earmark-arrow-down',
                agents: 'bi-robot',
                memories: 'bi-lightbulb',
                render: 'bi-eye',
                files: 'bi-folder',
              };
              return (
                <div key={`numa-${segment.toolUseId}-${!!segment.result}`}>
                  <div className="workspace-chat-inline-tool-group">
                    <div className={`workspace-chat-inline-tool ${segment.isLoading ? '' : 'complete'}`}>
                      <span className={`inline-tool-icon ${segment.isLoading ? 'running' : 'complete'}`}>
                        <i className={`bi ${NUMA_ICONS[subTool || ''] || 'bi-tools'}`} />
                      </span>
                      <div className="inline-tool-content">
                        <span className="inline-tool-text">{displayText}</span>
                        {segment.isLoading && (
                          <span className="spinner-border spinner-border-sm inline-tool-trailing-spinner" />
                        )}
                      </div>
                    </div>
                  </div>
                  {segment.result && subTool === 'render' && (
                    <RenderToolRenderer
                      result={segment.result as ToolResultLike}
                      conversationId={conversationId}
                      sub={userSub}
                    />
                  )}
                </div>
              );
            }
            return (
              <UnifiedToolCard
                key={`tool-${segment.toolUseId}`}
                toolName={segment.toolName}
                label={segment.label}
                steps={segment.steps}
                result={segment.result}
                toolInput={segment.input}
                isLoading={segment.isLoading}
                conversationId={conversationId}
                sub={userSub}
              />
            );
          }

          case 'file_upload':
            return (
              <div key={`upload-${index}`} className="workspace-chat-file-upload-indicator">
                <i className="bi bi-file-earmark-arrow-up me-2" />
                <span>{t('workspace.segments.uploaded', { filename: segment.filename })}</span>
                {segment.uploadStatus === 'processing' && <span className="ms-2 spinner-border spinner-border-sm" />}
              </div>
            );

          case 'file_attachment':
            return (
              <div key={`attachment-${index}`} className="workspace-chat-file-attachment">
                <i className="bi bi-paperclip me-2" />
                <span>{segment.filename}</span>
                <span className="text-muted ms-2">({formatFileSize(segment.size)})</span>
              </div>
            );

          case 'folder_attachment': {
            const folderSeg = segment as WorkspaceChatFolderAttachmentSegment;
            return (
              <div key={`folder-${index}`} className="workspace-chat-file-attachment">
                <i className="bi bi-folder-fill me-2" />
                <span>{folderSeg.folderName}</span>
                <span className="text-muted ms-2">
                  ({t('workspace.segments.fileCount', { count: folderSeg.fileCount })},{' '}
                  {formatFileSize(folderSeg.totalSize)})
                </span>
              </div>
            );
          }

          case 'tool_approval':
            return (
              <WorkspaceChatToolApproval
                key={`approval-${segment.toolUseId}`}
                segment={segment as WorkspaceChatToolApprovalSegment}
                conversationId={conversationId || ''}
              />
            );

          default:
            return null;
        }
      })}
    </>
  );
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default WorkspaceChatSegmentRenderer;
