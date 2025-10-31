import type { ToolResultLike } from './helpers';

type AgentItem = {
  agent_id?: string;
  title?: string;
  description?: string;
  visibility?: string;
  agent_type?: string;
  estimated_time_saved_minutes?: number;
  tools_config?: Record<string, unknown>;
  created_at?: number;
  version?: number;
};

export type AgentCreationPayload = {
  status?: string;
  message?: string;
  agent?: AgentItem;
  warnings?: string[];
};

export function getAgentCreationPayload(result: ToolResultLike): AgentCreationPayload | null {
  try {
    // Prefer ToolResult JSON blocks if present; search all blocks and merge
    const blocks = Array.isArray(result?.content)
      ? (result.content as Array<{ json?: unknown; text?: string }>)
      : undefined;

    const merged: Record<string, unknown> = {};
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b && typeof b.json === 'object' && b.json) {
          const j = b.json as Record<string, unknown>;
          // Copy top-level fields like status/message/agent; later blocks can refine earlier ones
          if ('status' in j) merged.status = j.status as unknown;
          if ('message' in j) merged.message = j.message as unknown;
          if ('warnings' in j) merged.warnings = j.warnings as unknown;
          if ('agent' in j && j.agent) merged.agent = j.agent as unknown;
        }
      }
      if (merged.agent || merged.status) return merged as AgentCreationPayload;

      // Legacy: attempt to parse a JSON string in concatenated text blocks
      const textBlob = blocks
        .map((b) => b?.text || '')
        .join('')
        .trim();
      if (textBlob) {
        try {
          const parsed = JSON.parse(textBlob) as AgentCreationPayload;
          if (parsed && (parsed.agent || parsed.status)) return parsed;
        } catch {
          // Try relaxed parser for python-esque dict strings
          const relaxed = parseRelaxedAgentCreation(textBlob);
          if (relaxed) return relaxed;
        }
      }
    }

    // Fallback: some tool adapters may return the payload directly on the result object
    if (result && typeof result === 'object' && ('agent' in result || 'status' in result)) {
      return result as unknown as AgentCreationPayload;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Best-effort parser for python-like dict strings (single quotes/None/True/False)
function parseRelaxedAgentCreation(text: string): AgentCreationPayload | null {
  try {
    // Extract status/message via regex first
    const statusMatch = text.match(/["']status["']\s*:\s*["']([^"']+)["']/i);
    const messageMatch = text.match(/["']message["']\s*:\s*["']([\s\S]*?)["']\s*(,|\})/i);

    // Try to locate an agent object literal
    let agentObj: unknown | undefined;
    const agentKeyIdx = text.search(/["']agent["']\s*:/);
    if (agentKeyIdx >= 0) {
      const braceStart = text.indexOf('{', agentKeyIdx);
      if (braceStart >= 0) {
        let i = braceStart;
        let depth = 0;
        for (; i < text.length; i++) {
          const ch = text[i];
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (i < text.length) {
          const agentSlice = text.slice(braceStart, i + 1);
          const jsonish = agentSlice
            .replace(/'/g, '"')
            .replace(/\bNone\b/g, 'null')
            .replace(/\bTrue\b/g, 'true')
            .replace(/\bFalse\b/g, 'false');
          try {
            agentObj = JSON.parse(jsonish);
          } catch {
            /* ignore agent parse */
          }
        }
      }
    }

    const payload: AgentCreationPayload = {
      status: statusMatch ? statusMatch[1] : undefined,
      message: messageMatch ? messageMatch[1] : undefined,
      agent: (agentObj as AgentItem | undefined) ?? undefined,
    };

    // If we couldn't parse full agent JSON, extract minimal fields to signal presence
    if (!payload.agent) {
      const titleMatch = text.match(/["']title["']\s*:\s*["']([^"']+)["']/i);
      const visMatch = text.match(/["']visibility["']\s*:\s*["']([^"']+)["']/i);
      if (titleMatch || visMatch) {
        payload.agent = {
          title: titleMatch ? titleMatch[1] : undefined,
          visibility: visMatch ? visMatch[1] : undefined,
        } as AgentItem;
      }
    }

    if (payload.status || payload.message || payload.agent) return payload;
    return null;
  } catch {
    return null;
  }
}

export function getAgentCreationSummary(result: ToolResultLike): string {
  const payload = getAgentCreationPayload(result);
  if (!payload) return 'Agent creation';
  const { status = '', agent } = payload;
  if ((status || '').toLowerCase() === 'success' && agent) {
    const t = agent.title ? `"${agent.title}"` : 'agent';
    const scope = agent.visibility ? ` (${agent.visibility})` : '';
    return `Agent created: ${t}${scope}`;
  }
  if ((status || '').toLowerCase() === 'denied') return 'Agent creation denied';
  if ((status || '').toLowerCase() === 'error') return 'Agent creation failed';
  return 'Agent creation completed';
}
