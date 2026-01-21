import type React from 'react';
import { WebSearchRenderer } from '../toolRenderers/WebSearchRenderer';
import { KnowledgeBaseRenderer } from '../toolRenderers/KnowledgeBaseRenderer';
import { FallbackRenderer } from '../toolRenderers/FallbackRenderer';
import { DataAnalysisRenderer } from '../toolRenderers/DataAnalysisRenderer';
import { AgentCreationRenderer } from '../toolRenderers/AgentCreationRenderer';
import { IntegrationsRenderer } from '../toolRenderers/IntegrationsRenderer';
import { getConnectionDisplayName, getConnectionIcon, getConnectionFallbackIcon } from '../config/integrationsConfig';
import i18n from '../i18n';

type ToolRenderer = (props: { result: unknown }) => React.ReactNode;

export type ToolDescriptor = {
  label: string;
  renderer: ToolRenderer;
};

// Static mapping for known core tools
export const TOOL_CONFIG: Record<string, ToolDescriptor> = {
  web_search: {
    label: i18n.t('common:toolLabels.webSearch'),
    renderer: WebSearchRenderer,
  },
  query_knowledge_base: {
    label: i18n.t('common:toolLabels.knowledgeBase'),
    renderer: KnowledgeBaseRenderer,
  },
  create_agent_tool: {
    label: i18n.t('common:toolLabels.agentCreation'),
    renderer: AgentCreationRenderer,
  },
  data_analysis: {
    label: i18n.t('common:toolLabels.dataAnalysis'),
    renderer: DataAnalysisRenderer,
  },
  integrations: {
    label: i18n.t('common:toolLabels.integration'),
    renderer: IntegrationsRenderer,
  },
  _default: {
    label: i18n.t('common:toolLabels.unknown'),
    renderer: FallbackRenderer,
  },
};

// Helper: convert snake/hyphen to spaced words; optionally title case
const humanize = (s: string, { titleCase = false }: { titleCase?: boolean } = {}) => {
  const spaced = (s || '').replace(/[-_]+/g, ' ').trim();
  if (!titleCase) return spaced;
  return spaced.replace(/\b\w/g, (m) => m.toUpperCase());
};

// Resolve descriptor dynamically to support integration tool names like `gmail_integration`
export function resolveToolDescriptor(toolName: string | null | undefined): ToolDescriptor {
  const name = toolName || '';
  if (!name) return TOOL_CONFIG._default;
  // Use static mapping first
  if (TOOL_CONFIG[name]) return TOOL_CONFIG[name];

  // Integration router tools follow `<integration>_integration`
  if (name.endsWith('_integration')) {
    const integrationId = name.replace(/_integration$/, '');
    const display = getConnectionDisplayName(integrationId) || humanize(integrationId, { titleCase: true });
    return { label: display, renderer: IntegrationsRenderer };
  }

  // Fallback
  return TOOL_CONFIG._default;
}

// Visuals used by UnifiedToolCard (either a Bootstrap icon class or an image src)
export type ToolVisual = { kind: 'icon'; className: string } | { kind: 'image'; src: string; alt?: string };

export function resolveToolVisual(toolName: string | null | undefined): ToolVisual {
  const name = toolName || '';
  if (!name) return { kind: 'icon', className: 'bi bi-tools' };

  // Core tools
  if (name === 'web_search') return { kind: 'icon', className: 'bi bi-search' };
  if (name === 'query_knowledge_base') return { kind: 'icon', className: 'bi bi-folder2-open' };
  if (name === 'create_agent_tool') return { kind: 'icon', className: 'bi bi-robot' };
  if (name === 'data_analysis') return { kind: 'icon', className: 'bi bi-bar-chart' };

  // Integrations: prefer branded image; fallback to bootstrap icon class from config
  if (name.endsWith('_integration')) {
    const integrationId = name.replace(/_integration$/, '');
    const img = getConnectionIcon(integrationId);
    if (img) return { kind: 'image', src: img, alt: integrationId };
    const fallback = getConnectionFallbackIcon(integrationId) || 'bi bi-plug';
    return { kind: 'icon', className: fallback };
  }

  return { kind: 'icon', className: 'bi bi-tools' };
}

// Generate friendly action steps to show under "Calling …" once final tool input is available
export function getToolActionSteps(toolName: string | null | undefined, inputPayload: unknown): string[] {
  const name = toolName || '';
  // Web search customisation
  if (name === 'web_search') {
    try {
      const q =
        inputPayload && typeof inputPayload === 'object' && 'query' in (inputPayload as Record<string, unknown>)
          ? (inputPayload as Record<string, unknown>)['query']
          : undefined;
      if (typeof q === 'string' && q.trim()) {
        return [i18n.t('common:toolSteps.webSearch.query', { query: q.trim() })];
      }
    } catch {
      /* ignore */
    }
    return [i18n.t('common:toolSteps.webSearch.running')];
  }
  // Knowledge base customisation
  if (name === 'query_knowledge_base') {
    try {
      const q =
        inputPayload && typeof inputPayload === 'object' && 'query' in (inputPayload as Record<string, unknown>)
          ? (inputPayload as Record<string, unknown>)['query']
          : undefined;
      if (typeof q === 'string' && q.trim()) {
        return [i18n.t('common:toolSteps.knowledgeBase.query', { query: q.trim() })];
      }
    } catch {
      /* ignore */
    }
    return [i18n.t('common:toolSteps.knowledgeBase.running')];
  }
  if (name === 'data_analysis') {
    const steps: string[] = [i18n.t('common:toolSteps.dataAnalysis.calling')];
    try {
      if (inputPayload && typeof inputPayload === 'object') {
        const obj = inputPayload as Record<string, unknown>;
        const names = Array.isArray(obj.file_names) ? obj.file_names : undefined;
        if (Array.isArray(names) && names.length > 0) {
          steps.push(i18n.t('common:toolSteps.dataAnalysis.analyzingFiles', { files: names.join(', ') }));
        } else {
          steps.push(i18n.t('common:toolSteps.dataAnalysis.running'));
        }
      } else {
        steps.push(i18n.t('common:toolSteps.dataAnalysis.running'));
      }
    } catch {
      steps.push(i18n.t('common:toolSteps.dataAnalysis.running'));
    }
    return steps;
  }

  // Integrations: the `input` typically contains `tool: <action-name>`
  if (name.endsWith('_integration')) {
    let action: string | undefined;
    try {
      if (inputPayload && typeof inputPayload === 'object' && 'tool' in (inputPayload as Record<string, unknown>)) {
        const t = (inputPayload as Record<string, unknown>)['tool'];
        if (typeof t === 'string' && t.trim()) action = t.trim();
      }
    } catch {
      /* ignore */
    }
    const friendly = action ? humanize(action) : i18n.t('common:toolSteps.integration.actionFallback');
    return [i18n.t('common:toolSteps.integration.executing', { action: friendly })];
  }

  // Generic default
  return [];
}
