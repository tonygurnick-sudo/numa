import { WebSearchRenderer } from '../toolRenderers/WebSearchRenderer';
import { KnowledgeBaseRenderer } from '../toolRenderers/KnowledgeBaseRenderer';
import { FallbackRenderer } from '../toolRenderers/FallbackRenderer';

export const TOOL_CONFIG = {
  web_search: {
    label: 'Web Search',
    renderer: WebSearchRenderer,
  },
  query_knowledge_base: {
    label: 'Knowledge Base',
    renderer: KnowledgeBaseRenderer,
  },
  _default: {
    label: 'Unknown Tool',
    renderer: FallbackRenderer,
  },
};
