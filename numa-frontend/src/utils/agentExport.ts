import type { AgentPayload, AgentSummary, AgentToolsConfig } from '../types/agents';

export type AgentExportV1 = {
  meta: {
    version: 1;
    exportedAt: string;
  };
  agent: {
    visibility?: AgentPayload['visibility'];
    agentType?: AgentPayload['agentType'];
    title: string;
    description?: string;
    systemPrompt: string;
    userWelcomeMessage?: string;
    estimatedTimeSavedMinutes?: number;
    icon?: string;
    requiredIntegrations?: string[];
    toolsConfig?: AgentToolsConfig;
  };
  attachments?: {
    // Metadata only; ignored on import
    iconImage?: AgentSummary['iconImage'] | AgentPayload['iconImage'] | null;
    referenceFiles?: string[]; // names only
  };
};

const toSlug = (text: string, fallback = 'agent') =>
  (text || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;

export function serializeAgentSummaryToExport(agent: AgentSummary): AgentExportV1 {
  return {
    meta: { version: 1 as const, exportedAt: new Date().toISOString() },
    agent: {
      visibility: agent.visibility,
      agentType: agent.agentType,
      title: agent.title,
      description: agent.description || '',
      systemPrompt: agent.systemPrompt,
      userWelcomeMessage: agent.userWelcomeMessage || '',
      estimatedTimeSavedMinutes: agent.estimatedTimeSavedMinutes,
      icon: agent.icon,
      requiredIntegrations: agent.requiredIntegrations || [],
      toolsConfig: agent.toolsConfig || {},
    },
    attachments: {
      iconImage: agent.iconImage ?? null,
      referenceFiles: (agent.referenceFiles || []).map((f) => f.fileName),
    },
  };
}

export function serializeAgentPayloadToExport(payload: AgentPayload): AgentExportV1 {
  return {
    meta: { version: 1 as const, exportedAt: new Date().toISOString() },
    agent: {
      visibility: payload.visibility,
      agentType: payload.agentType,
      title: payload.title,
      description: payload.description || '',
      systemPrompt: payload.systemPrompt,
      userWelcomeMessage: payload.userWelcomeMessage || '',
      estimatedTimeSavedMinutes: payload.estimatedTimeSavedMinutes,
      icon: payload.icon,
      requiredIntegrations: payload.requiredIntegrations || [],
      toolsConfig: payload.toolsConfig || {},
    },
    attachments: {
      iconImage: payload.iconImage ?? null,
      referenceFiles: (payload.referenceFiles || []).map((f) => f.fileName),
    },
  };
}

export function downloadAgentExport(exp: AgentExportV1, titleForName?: string) {
  const filename = `agent-${toSlug(titleForName || exp.agent.title)}-v1.json`;
  const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns a sanitized AgentPayload and warnings
export function parseAgentImport(raw: string): { payload: AgentPayload; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON file');
  }

  const warnings: string[] = [];

  // Accept either our export shape or a raw AgentPayload-like object
  const maybeExport = data as Partial<AgentExportV1> | Partial<AgentPayload>;
  let source: Partial<AgentPayload> | undefined;

  if (maybeExport && (maybeExport as AgentExportV1)?.meta && (maybeExport as AgentExportV1)?.agent) {
    const e = maybeExport as AgentExportV1;
    source = e.agent as Partial<AgentPayload>;
    // Note attachments are not imported
    if (e.attachments?.iconImage) warnings.push('Uploaded avatar image is not imported.');
    if (e.attachments?.referenceFiles?.length) warnings.push('Reference files are not imported.');
  } else {
    source = maybeExport as Partial<AgentPayload>;
  }

  if (!source) {
    throw new Error('Unsupported agent export format');
  }

  const title = String(source.title || '').trim();
  const systemPrompt = String(source.systemPrompt || '').trim();
  if (!title) throw new Error('Missing required field: title');
  if (!systemPrompt) throw new Error('Missing required field: systemPrompt');

  const payload: AgentPayload = {
    visibility: source.visibility === 'public' || source.visibility === 'personal' ? source.visibility : 'personal',
    agentType: (source.agentType as string) || 'task',
    title,
    description: (source.description as string) || '',
    systemPrompt,
    userWelcomeMessage: (source.userWelcomeMessage as string) || '',
    estimatedTimeSavedMinutes:
      typeof source.estimatedTimeSavedMinutes === 'number' ? source.estimatedTimeSavedMinutes : undefined,
    icon: (source.icon as string) || 'bi bi-robot',
    iconImage: null, // never import icon image directly
    requiredIntegrations: Array.isArray(source.requiredIntegrations)
      ? (source.requiredIntegrations as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    toolsConfig: sanitizeToolsConfig(source.toolsConfig),
    referenceFiles: [], // not imported; must be re-uploaded
    createdByName: undefined,
  };

  return { payload, warnings };
}

function sanitizeToolsConfig(tc: unknown): AgentToolsConfig {
  const out: AgentToolsConfig = {};
  if (!tc || typeof tc !== 'object') return out;
  const obj = tc as Record<string, unknown>;
  if (typeof obj.autoToolsEnabled === 'boolean') out.autoToolsEnabled = obj.autoToolsEnabled;
  if (typeof obj.queryDataSources === 'boolean') out.queryDataSources = obj.queryDataSources;
  if (typeof obj.webSearchEnabled === 'boolean') out.webSearchEnabled = obj.webSearchEnabled;
  if (Array.isArray(obj.enabledConnections)) {
    out.enabledConnections = (obj.enabledConnections as unknown[]).filter((x): x is string => typeof x === 'string');
  }
  return out;
}
