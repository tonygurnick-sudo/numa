import type { InvokeModelCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { getModelId, MODEL_TYPES } from './bedrockModelConfig';
import type {
  WorkspaceChatMessage,
  WorkspaceChatSegment,
  WorkspaceChatToolCardSegment,
  WorkspaceChatInlineToolSegment,
} from '../types/workspaceChatTypes';

export interface SuggestionResult {
  suggestions: string[] | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface GenerateSuggestionsOptions {
  bedrockClient: BedrockRuntimeClient;
  region: string | null;
  messages: WorkspaceChatMessage[];
  enabledTools: string[];
  enabledConnections: string[];
  connectedDataConnectorIds: string[];
  language: string | null;
  signal?: AbortSignal;
}

interface SeedEntry {
  readonly label: string;
  readonly tools?: readonly string[];
}

// Seed next-message phrasings — examples for the model to adapt or remix.
// Goal: blend genuine follow-ups with Numa feature discovery in plain English.
//
// `tools`: at least one must be in enabled tools/connections/connectors for the
// seed to be eligible. Omit `tools` for always-eligible seeds (these use
// always-on capabilities like document generation, charts, code execution).
const SUGGESTION_SEEDS: readonly SeedEntry[] = [
  // ── Documents ──
  { label: 'Save this as a PDF I can share.' },
  { label: 'Make a polished PDF report out of this.' },
  { label: 'Put this in a Word document.' },
  { label: 'Fill in this template document for me.' },
  { label: 'Add our logo and letterhead to this.' },
  { label: 'Turn this into a spreadsheet.' },
  { label: 'Build me an Excel with multiple sheets for this.' },
  { label: 'Make a slide deck out of this.' },
  // ── Charts, dashboards, inline visuals ──
  { label: 'Show me this as a chart.' },
  { label: 'Build me a dashboard for this.' },
  { label: 'Draw me a diagram of this.' },
  { label: 'Visualise this for me inline.' },
  // ── Numa Files ──
  { label: 'Save this to my Numa Files.', tools: ['knowledge_base'] },
  { label: 'Find related files in my folders.', tools: ['knowledge_base'] },
  { label: 'List the folders I have access to.', tools: ['knowledge_base'] },
  { label: 'What do my files say about this?', tools: ['knowledge_base'] },
  // ── Memories ──
  { label: 'Remember this for next time.', tools: ['memories_tool'] },
  { label: 'Add that to my profile.', tools: ['memories_tool'] },
  { label: 'What do you already know about me on this?', tools: ['memories_tool'] },
  { label: 'Save that as one of my preferences.', tools: ['memories_tool'] },
  // ── Agents ──
  { label: 'Create an agent that does this for me.', tools: ['create_agent_tool'] },
  { label: 'Turn this into a reusable workflow.', tools: ['create_agent_tool'] },
  { label: 'Make an agent I can run again later.', tools: ['create_agent_tool'] },
  // ── Web search ──
  { label: 'Find the latest on this online.', tools: ['web_search'] },
  { label: 'Are there any recent updates I should know?', tools: ['web_search'] },
  // ── Email ──
  { label: 'Draft an email about this.', tools: ['gmail', 'outlook'] },
  { label: 'Save this as a draft in my inbox.', tools: ['gmail', 'outlook'] },
  { label: 'Email this PDF to the right person.', tools: ['gmail', 'outlook'] },
  // ── Calendar ──
  { label: 'Find time on my calendar for this.', tools: ['google_calendar', 'outlook_calendar'] },
  { label: 'Block out time for this in my calendar.', tools: ['google_calendar', 'outlook_calendar'] },
  // ── Slack ──
  { label: 'Share a summary of this in Slack.', tools: ['slack'] },
  { label: 'Post this to a Slack channel.', tools: ['slack'] },
  // ── Numa Ops ──
  { label: 'Create a ticket for this.', tools: ['numa_ops_tool'] },
  { label: 'Add this to my to-do list.', tools: ['numa_ops_tool'] },
  // ── Data connectors ──
  { label: 'Check my connected drives for this.', tools: ['data_connectors'] },
  { label: 'Find this in Google Drive or SharePoint.', tools: ['data_connectors'] },
  // ── Helpful follow-ups ──
  { label: 'Explain this in simpler terms.' },
  { label: 'What should I do next?' },
] as const;

/** Filter seeds to only those whose required tools are available */
export function filterSeeds(
  enabledTools: string[],
  enabledConnections: string[],
  connectedDataConnectorIds: string[]
): string[] {
  const available = new Set([...enabledTools, ...enabledConnections, ...connectedDataConnectorIds]);
  // Generic `data_connectors` tag matches if any data connector is connected
  if (connectedDataConnectorIds.length > 0) available.add('data_connectors');
  return SUGGESTION_SEEDS.filter((seed) => {
    if (!seed.tools || seed.tools.length === 0) return true;
    return seed.tools.some((t) => available.has(t));
  }).map((s) => s.label);
}

// ────────────────────────────────────────────────────────────────────────
// Transcript building
// ────────────────────────────────────────────────────────────────────────

const TURN_LIMIT = 8;
const USER_CHAR_CAP = 2000;
const ASSISTANT_TEXT_CAP = 2500;
const TOOL_INPUT_CAP = 250;
const TOOL_RESULT_CAP = 500;

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Extract human-readable text from a tool result (handles { content: [...] } and raw arrays) */
function extractToolResultText(result: unknown, cap: number): string {
  if (result === null || result === undefined) return '';
  const arr = Array.isArray(result) ? result : (result as { content?: unknown }).content;
  if (Array.isArray(arr)) {
    const text = arr
      .map((b) => {
        if (typeof b === 'string') return b;
        if (typeof b === 'object' && b !== null) {
          const block = b as { type?: string; text?: string };
          return block.type === 'text' ? block.text || '' : '';
        }
        return '';
      })
      .join(' ')
      .trim();
    if (text) return text.slice(0, cap);
  }
  return safeStringify(result).slice(0, cap);
}

function formatToolSegment(seg: WorkspaceChatToolCardSegment | WorkspaceChatInlineToolSegment): string {
  if (seg.kind === 'inline_tool') {
    // displayText is already a human-readable phrasing (e.g. "Saving memory...")
    return `[${seg.displayText || seg.toolName}]`;
  }
  // tool_card
  const name = seg.label || seg.toolName;
  const inputStr = seg.input ? safeStringify(seg.input).slice(0, TOOL_INPUT_CAP) : '';
  const resultStr = extractToolResultText(seg.result, TOOL_RESULT_CAP);
  const head = inputStr ? `[Tool: ${name} · input: ${inputStr}]` : `[Tool: ${name}]`;
  return resultStr ? `${head}\n  result: ${resultStr}` : head;
}

/** Build a richly-detailed transcript of the last several turns. */
function buildContextTranscript(messages: WorkspaceChatMessage[]): string {
  const frames = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-TURN_LIMIT);

  return frames
    .map((msg) => {
      if (msg.role === 'user') {
        return `User: ${(msg.content || '').slice(0, USER_CHAR_CAP)}`.trim();
      }

      // Assistant: walk segments in order, including tool inputs and results.
      const parts: string[] = [];
      let textBudget = ASSISTANT_TEXT_CAP;

      for (const seg of (msg.segments ?? []) as WorkspaceChatSegment[]) {
        if (seg.kind === 'text') {
          if (seg.text && textBudget > 0) {
            const slice = seg.text.slice(0, textBudget);
            parts.push(slice);
            textBudget -= slice.length;
          }
        } else if (seg.kind === 'tool_card' || seg.kind === 'inline_tool') {
          parts.push(formatToolSegment(seg));
        }
      }

      if (parts.length === 0) {
        const fallback = (msg.content || '').slice(0, ASSISTANT_TEXT_CAP);
        if (fallback) parts.push(fallback);
      }

      return `Assistant: ${parts.join('\n')}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Determine if the last assistant message is tool-only (no text content) */
export function isToolOnlyTurn(messages: WorkspaceChatMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return false;

  const hasTextSegment = (lastAssistant.segments ?? []).some(
    (s: WorkspaceChatSegment) => s.kind === 'text' && (s as { kind: 'text'; text: string }).text?.trim()
  );
  const hasTopLevelText = (lastAssistant.content || '').trim().length > 0;
  return !hasTextSegment && !hasTopLevelText;
}

// ────────────────────────────────────────────────────────────────────────
// Capability description (mirrors workspace agent skills)
// ────────────────────────────────────────────────────────────────────────

interface CapabilityContext {
  capabilities: string;
  integrationsLine: string;
}

function buildCapabilityContext(
  enabledTools: string[],
  enabledConnections: string[],
  connectedDataConnectorIds: string[]
): CapabilityContext {
  const has = (t: string) => enabledTools.includes(t);
  const lines: string[] = [];

  // Always-on capabilities — these come from skills loaded for every workspace.
  lines.push(
    `- **Word documents (.docx)** — create branded reports, fill templates, maintain formatting, drop in logos / letterheads / images. Great for filling templates with details from the conversation.`
  );
  lines.push(
    `- **PDFs** — build polished, branded PDFs with images, headings, tables, and styling. Also extract text or merge existing PDFs.`
  );
  lines.push(
    `- **Excel / spreadsheets** — create or analyse .xlsx with multiple sheets, formulas, coloured cells, charts in cells, pivots. Reads CSV/TSV too.`
  );
  lines.push(`- **PowerPoint slide decks** — build presentations and pitch decks.`);
  lines.push(
    `- **Charts, dashboards, and inline visuals** — render charts, diagrams, styled HTML, and SVG directly in the chat so the user sees them right away.`
  );
  lines.push(
    `- **Code execution** — run Python or Bash in a sandboxed workspace for analysis, file processing, or ad-hoc scripts.`
  );

  // Conditionally enabled
  if (has('memories_tool')) {
    lines.push(
      `- **Memories** — remember facts, preferences, and context across conversations. Many users do not realise this exists; surface it whenever they share a preference, correction, or recurring fact.`
    );
  }
  if (has('create_agent_tool')) {
    lines.push(
      `- **Numa Agents** — turn a workflow the user does often into a reusable agent they can run again later with different inputs.`
    );
  }
  if (has('knowledge_base')) {
    lines.push(
      `- **Numa Files** — folders the user can save, search, list, audit, upload, and download files from. Includes their "Personal" folder, the company-shared "Company Files", and any folders shared with them.`
    );
  }
  if (has('web_search')) {
    lines.push(
      `- **Web search** — find current information and recent updates from the internet, including JS-rendered pages.`
    );
  }
  if (has('numa_ops_tool')) {
    lines.push(`- **Numa Ops** — create and manage tickets, kanban boards, projects, customers, and suppliers.`);
  }
  if (connectedDataConnectorIds.length > 0) {
    lines.push(
      `- **Connected drives** — search and read files from external drives the user has connected (${connectedDataConnectorIds.join(', ')}).`
    );
  }

  const capabilities = lines.join('\n');

  const integrationsLine =
    enabledConnections.length > 0
      ? `Connected integrations available right now: **${enabledConnections.join(', ')}**. Numa can draft emails or messages, search them, send files through them, schedule events, and use them as part of the conversation.`
      : `No external SaaS integrations (Gmail, Slack, Calendar, etc.) are connected yet — do not suggest actions that need them.`;

  return { capabilities, integrationsLine };
}

// ────────────────────────────────────────────────────────────────────────
// Prompt + request
// ────────────────────────────────────────────────────────────────────────

function buildRequestBody(
  transcript: string,
  eligibleSeeds: string[],
  capabilityContext: CapabilityContext,
  language: string | null
) {
  const langInstruction =
    language && language !== 'browser'
      ? `Write the suggestions in ${language}.`
      : 'Match the language the user is using in the conversation.';

  const systemPrompt = `# Role

You suggest 2-3 short next-message ideas a non-technical user might send to Numa, an AI workspace assistant. Many users do not yet know everything Numa can do — your job is to help them discover useful capabilities while making genuinely helpful follow-ups. Each suggestion is a short message the user could click to send straight to Numa.

# What Numa can do

${capabilityContext.capabilities}

# Connected right now

${capabilityContext.integrationsLine}

# How to choose

Read the conversation carefully. Pick suggestions that map naturally to what just happened:
- The user expresses a preference, correction, or rule → "Remember that I [preference]." or "Add that to my profile."
- The user describes something they do regularly → "Create an agent that does this for me."
- The user shares numbers, lists, or structured data → "Show me this as a chart." or "Build me a dashboard."
- The user produces a long answer they will want later → "Save this to my Numa Files." or "Make me a PDF of this."
- A document or template is involved → "Fill in this template with the details we just discussed."
- The user mentions a person and email is connected → "Draft an email to them about this."
- The user just used a Numa feature (e.g. saved a memory) → suggest a *complementary* next step using a different capability, not the same feature again.

# Style

- Plain, friendly English. No jargon. Each suggestion ≤80 characters and directly actionable when clicked.
- Vary the suggestions across capabilities. Aim to surface at least one capability the user may not have discovered yet.
- Avoid suggestions that just rephrase what was already said.
- ${langInstruction}

# Inspiration

Example phrasings — adapt them, mix-and-match, or invent your own when it fits the conversation better. You are encouraged to be creative when the conversation calls for it, but every suggestion must map to a real Numa capability listed above (or a connected integration).

${eligibleSeeds.map((s) => `- ${s}`).join('\n')}

# Hard rules

- Never invent features Numa does not have (no "team rosters", "schedule trackers", "CRM dashboards" unless those are real capabilities listed above).
- Never suggest using an integration that is not in the connected list above.
- Never repeat the feature the user just used in the previous turn — pick a complementary one.
- If you cannot find 2-3 strong suggestions, return 2 high-quality ones rather than padding with filler.`;

  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 350,
    temperature: 0.7,
    system: systemPrompt,
    tools: [
      {
        name: 'suggest_next_messages',
        description: 'Output 2-3 suggested next messages for the user.',
        input_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              minItems: 2,
              maxItems: 3,
              items: { type: 'string', maxLength: 80 },
            },
          },
          required: ['suggestions'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'suggest_next_messages' },
    messages: [
      {
        role: 'user',
        content: `Here is the recent conversation:\n\n${transcript}\n\nWhat should the user say next?`,
      },
    ],
  };
}

export async function generateChatSuggestions({
  bedrockClient,
  region,
  messages,
  enabledTools,
  enabledConnections,
  connectedDataConnectorIds,
  language,
  signal,
}: GenerateSuggestionsOptions): Promise<SuggestionResult> {
  try {
    const transcript = buildContextTranscript(messages);
    if (!transcript) return { suggestions: null, usage: null };

    const eligibleSeeds = filterSeeds(enabledTools, enabledConnections, connectedDataConnectorIds);
    const capabilityContext = buildCapabilityContext(enabledTools, enabledConnections, connectedDataConnectorIds);

    const REGION = region || window.sessionStorage.getItem('REGION');
    const modelId = getModelId(REGION, MODEL_TYPES.CLAUDE_HAIKU);

    const body = buildRequestBody(transcript, eligibleSeeds, capabilityContext, language);
    const encodedBody = new TextEncoder().encode(JSON.stringify(body));

    if (signal?.aborted) return { suggestions: null, usage: null };

    const command = new InvokeModelCommand({
      modelId,
      body: encodedBody,
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response: InvokeModelCommandOutput = await bedrockClient.send(command);

    if (signal?.aborted) return { suggestions: null, usage: null };

    const decoded = new TextDecoder().decode(response.body as Uint8Array);
    const data = JSON.parse(decoded) as {
      content?: Array<{ type: string; name?: string; input?: { suggestions?: unknown[] } }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const toolUseBlock = data.content?.find((b) => b.type === 'tool_use' && b.name === 'suggest_next_messages');
    const raw = toolUseBlock?.input?.suggestions;

    if (!Array.isArray(raw)) return { suggestions: null, usage: null };

    const suggestions = raw
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 80);

    const usage =
      data.usage?.input_tokens != null
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens ?? 0 }
        : null;

    return { suggestions: suggestions.length >= 2 ? suggestions : null, usage };
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return { suggestions: null, usage: null };
    console.error('[ChatSuggestions] generation failed:', err);
    return { suggestions: null, usage: null };
  }
}
