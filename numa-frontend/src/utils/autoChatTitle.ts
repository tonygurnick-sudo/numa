import type { InvokeModelCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { NumaChatDynamoUtils } from './DynamoDBUtils';
import { getModelId, MODEL_TYPES } from './bedrockModelConfig';

export interface AutoNameOptions {
  conversationId: string;
  userId: string;
  bedrockRuntimeClient: BedrockRuntimeClient | null;
  numaChatDynamoUtils: NumaChatDynamoUtils | null;
  region?: string | null;
}

// Minimal shape of items stored in Dynamo we care about
interface ChatItem {
  message_type?: string;
  fileInfo?: { fileName?: string } | null;
  role?: 'user' | 'assistant' | 'system' | string;
  content?: string | null;
  timestamp?: number;
  conversationName?: string | null;
  nameSource?: string | null;
}

// (Default-name detection removed; we now allow auto-renaming unless nameSource === 'manual')

/** Strip obvious doc/comment blocks to avoid polluting naming prompt */
function stripDocTags(text: string): string {
  if (!text) return '';
  return text.replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Build a compact transcript for the LLM with token safety in mind */
function buildCompactTranscript(items: ChatItem[], maxChars = 4000): string {
  const lines: string[] = [];
  for (const it of items) {
    if (it.message_type === 'file' && it.fileInfo?.fileName) {
      lines.push(`User uploaded file: ${it.fileInfo.fileName}`);
      continue;
    }
    const role = it.role || it.message_type || 'unknown';
    const content = stripDocTags((it.content || '').toString())
      .replace(/\s+/g, ' ')
      .trim();
    if (!content) continue;
    const prefix = role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : 'System';
    lines.push(`${prefix}: ${content}`);
  }
  let transcript = lines.join('\n');
  if (transcript.length > maxChars) {
    transcript = transcript.slice(-maxChars); // keep the tail (more recent context)
  }
  return transcript;
}

/** Minimal sanitization: trim, strip quotes/newlines, cap length */
function sanitizeTitle(raw: string): string {
  if (!raw) return '';
  let title = raw.trim();
  if ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith("'") && title.endsWith("'"))) {
    title = title.slice(1, -1);
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (title.endsWith('.')) title = title.slice(0, -1);
  if (title.length > 200) title = title.slice(0, 200).trim();
  return title;
}

/** Create the Anthropic-style body for InvokeModel */
function buildInvokeModelBody(transcript: string) {
  const instruction =
    `You are a chat title generator.\n\n` +
    `TASK: Read the chat transcript and output ONLY a concise topic-style title.\n` +
    `RULES:\n` +
    `- Output a noun-phrase title (NOT a sentence or an answer).\n` +
    `- Identify up to the three most prevalent distinct topics in the conversation.\n` +
    `- Join topics using " / " in order of prevalence (e.g., Topic A / Topic B / Topic C).\n` +
    `- Keep each topic concise: ~2–6 words.\n` +
    `- Avoid first-person words (I, I'm, we, our).\n` +
    `- Avoid filler/stop words unless essential (the, a, an, is, are, have, be, to, of, in, on, at).\n` +
    `- No preambles (no: Based on..., Final title:, Recommended title:).\n` +
    `- No punctuation other than the slashes; no trailing period.\n` +
    `- Do NOT include quotes.\n\n` +
    `FEW-SHOT EXAMPLES:\n` +
    `User: do you sell shoes that are long?\n` +
    `Assistant: [answer]\n` +
    `Title: Shoe enquiry\n\n` +
    `User: why is the sky blue and the grass green?\n` +
    `Assistant: [answer]\n` +
    `Title: Sky and grass colours\n\n` +
    `User: We discussed Sales KPIs, Sprint planning and also touched OKRs\n` +
    `Assistant: [answer]\n` +
    `Title: Sales KPIs / Sprint planning / OKRs\n\n` +
    `Now generate the title for this chat. Output only the title:`;

  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'text', text: `\n\nChat Transcript:\n${transcript}` },
        ],
      },
    ],
  };
}

/**
 * Auto-name a conversation if its current name appears to be a default.
 * Returns true if the name was updated.
 */
export async function autoNameConversation({
  conversationId,
  userId,
  bedrockRuntimeClient,
  numaChatDynamoUtils,
  region = null,
}: AutoNameOptions): Promise<boolean> {
  try {
    if (!conversationId || !userId || !numaChatDynamoUtils) return false;

    // Load all items for the conversation (descending), we will sort ascending to find earliest
    const itemsResp = await numaChatDynamoUtils.queryConversations(conversationId, 1000, userId);
    const items: ChatItem[] = Array.isArray(itemsResp) ? (itemsResp as ChatItem[]) : [];
    if (items.length === 0) return false;

    // Sort by timestamp asc to find earliest meta and first user message
    items.sort((a: ChatItem, b: ChatItem) => (a.timestamp || 0) - (b.timestamp || 0));

    const metaItem = items.find((it: ChatItem) => it.message_type === 'meta');
    const currentName: string | null = metaItem?.conversationName || null;
    const nameSource: string | null = metaItem?.nameSource ?? null;

    // If a nameSource exists ('manual' or 'auto'), do not rename again
    if (nameSource) {
      return false;
    }

    // If Bedrock not available, skip (prompt-only approach)
    if (!bedrockRuntimeClient) return false;

    const transcript = buildCompactTranscript(items);
    if (!transcript) return false;

    // Choose a small/cheap model for title generation (Haiku)
    const REGION = region || window.sessionStorage.getItem('REGION');
    const modelId = getModelId(REGION, MODEL_TYPES.CLAUDE_HAIKU);

    const body = buildInvokeModelBody(transcript);
    const encodedBody = new TextEncoder().encode(JSON.stringify(body));

    const command = new InvokeModelCommand({
      modelId,
      body: encodedBody,
      contentType: 'application/json',
      accept: 'application/json',
    });

    let rawTitle = '';
    try {
      const response: InvokeModelCommandOutput = await bedrockRuntimeClient.send(command);
      const decoded = new TextDecoder().decode(response.body as Uint8Array);
      const data = JSON.parse(decoded);

      // Extract text from content blocks
      const firstBlock = data?.content?.[0];
      if (firstBlock?.type === 'text') {
        rawTitle = String(firstBlock.text || '').trim();
      } else if (typeof data?.output_text === 'string') {
        rawTitle = data.output_text.trim();
      } else {
        rawTitle = (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 200);
      }

      const finalTitle = sanitizeTitle(rawTitle);
      if (!finalTitle) return false;

      if (finalTitle !== currentName) {
        await numaChatDynamoUtils.updateConversationName(conversationId, userId, finalTitle, 'auto');
        return true;
      }
      return false;
    } catch (e) {
      console.error('Auto-naming via Bedrock failed:', e);
      return false;
    }
  } catch (err) {
    console.error('Auto-name conversation failed:', err);
    return false;
  }
}
