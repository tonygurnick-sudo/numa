import type React from 'react';
import { WebSearchRenderer } from '../toolRenderers/WebSearchRenderer';
import { KnowledgeBaseRenderer } from '../toolRenderers/KnowledgeBaseRenderer';
import { FallbackRenderer } from '../toolRenderers/FallbackRenderer';
import { AgentCreationRenderer } from '../toolRenderers/AgentCreationRenderer';
import { IntegrationsRenderer } from '../toolRenderers/IntegrationsRenderer';
import { getConnectionDisplayName, getConnectionIcon, getConnectionFallbackIcon } from '../config/integrationsConfig';

type ToolRenderer = (props: { result: unknown }) => React.ReactNode;

export type ToolDescriptor = {
  label: string;
  renderer: ToolRenderer;
};

// Static mapping for known core tools
export const TOOL_CONFIG: Record<string, ToolDescriptor> = {
  web_search: {
    label: 'Web Search',
    renderer: WebSearchRenderer,
  },
  query_knowledge_base: {
    label: 'Knowledge Base',
    renderer: KnowledgeBaseRenderer,
  },
  create_agent_tool: {
    label: 'Agent Creation',
    renderer: AgentCreationRenderer,
  },
  integrations: {
    label: 'Integration',
    renderer: IntegrationsRenderer,
  },
  _default: {
    label: 'Unknown Tool',
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
  if (name === 'query_knowledge_base') return { kind: 'icon', className: 'bi bi-database' };
  if (name === 'create_agent_tool') return { kind: 'icon', className: 'bi bi-robot' };

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
        return [`Search the web for "${q.trim()}"...`];
      }
    } catch {
      /* ignore */
    }
    return ['Searching the web...'];
  }
  // Knowledge base customisation
  if (name === 'query_knowledge_base') {
    try {
      const q =
        inputPayload && typeof inputPayload === 'object' && 'query' in (inputPayload as Record<string, unknown>)
          ? (inputPayload as Record<string, unknown>)['query']
          : undefined;
      if (typeof q === 'string' && q.trim()) {
        return [`Running query "${q.trim()}"...`];
      }
    } catch {
      /* ignore */
    }
    return ['Running query...'];
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
    const friendly = action ? humanize(action) : 'Executing action';
    return [`Executing ${friendly} tool`];
  }

  // Generic default
  return [];
}
