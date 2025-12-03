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
  messageContext?: string | null;
  role?: 'user' | 'assistant' | 'system' | string;
  content?: string | null;
  timestamp?: number;
  conversationName?: string | null;
  nameSource?: string | null;
}

// (Default-name detection removed; we now allow auto-renaming unless nameSource === 'manual')

/** Strip obvious doc/comment blocks and agent reference file lists to avoid polluting naming prompt */
function stripDocTags(text: string): string {
  if (!text) return '';
  // Remove HTML comment blocks
  let cleaned = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // Remove agent reference files section (e.g., "**📎 Reference Files:**\n- file1.xlsx\n- file2.pdf")
  cleaned = cleaned.replace(/\*\*📎 Reference Files:\*\*[\s\S]*?(?=\n\n|\n[A-Z]|$)/g, '');
  return cleaned;
}

/** Build a compact transcript for the LLM with token safety in mind */
function buildCompactTranscript(items: ChatItem[], maxChars = 4000): string {
  const lines: string[] = [];
  for (const it of items) {
    if (it.message_type === 'file' && it.fileInfo?.fileName) {
      // Skip agent reference files - they are preloaded context, not user uploads
      if (it.messageContext === 'agent_reference') {
        continue;
      }
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
    // Role
    `You are an expert at deriving concise, topic-style chat titles that capture the overall intent of a conversation.\n\n` +
    // Task
    `Your task is to read the messages between the user and the AI assistant and produce a single, concise noun-phrase title for the chat.\n\n` +
    // Rules
    `RULES:\n` +
    `- Output a title (NOT a sentence or an answer).\n` +
    `- Include multiple topics in the title if applicable` +
    `- Keep the title's concise.\n` +
    `- Avoid first-person words (I, I'm, we, our).\n` +
    `- No preambles or explanations (do not write: Based on..., Final title:, Recommended title:).\n` +
    `- Do NOT include quotes.\n\n` +
    // Example
    `EXAMPLE:\n` +
    `If the user said: "Can you analyse this Excel file and let me know how the Q4 performance is going?"\n` +
    `and the AI Assistant responded: "Analysing Excel file... Based on the file, Tech Solutions is performing well in Q4 and profits are high."\n` +
    `then an appropriate title would be: "Tech Solutions Q4 Profit Analysis".`;

  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          {
            type: 'text',
            text:
              `\n\nHere is the chat transcript between the user and the AI Assistant:\n${transcript}\n\n` +
              `Please generate the title for this chat. Output only the final title and nothing else.`,
          },
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

    // Diagnostic logging to understand auto-naming behavior
    console.log('[AutoName] Checking conversation:', {
      conversationId,
      currentName,
      nameSource,
      hasMetaItem: !!metaItem,
      itemCount: items.length,
    });

    // If a nameSource exists ('manual' or 'auto'), do not rename again
    if (nameSource) {
      console.log('[AutoName] Skipping - nameSource already set:', nameSource);
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
        console.log('[AutoName] Renaming conversation:', {
          conversationId,
          oldName: currentName,
          newName: finalTitle,
        });
        await numaChatDynamoUtils.updateConversationName(conversationId, userId, finalTitle, 'auto');
        return true;
      }
      console.log('[AutoName] Skipping - name unchanged:', finalTitle);
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
