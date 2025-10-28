/**
 * Service for interacting with the Numa Chat Agent via HTTP streaming (Function URL through CloudFront)
 */
import type {
  AgentEventFrame,
  OnChunk,
  OnComplete,
  OnError,
  OnEvent,
  ChatAgentRequest,
  ChatAgentNdjsonFrame,
  StreamCallbackMessage,
} from '../types/chat';
import { getStopReason, isMessageStopFrame, isToolEventFrame, tryGetDeltaText } from '../types/chat';

class ChatAgentHttpStream {
  private currentOnEvent: OnEvent | null | undefined;
  private readerAbortController: AbortController | null;
  private responseCallbacks: Map<string, (msg: StreamCallbackMessage) => void>;

  constructor() {
    this.currentOnEvent = null;
    this.readerAbortController = null;
    this.responseCallbacks = new Map();
  }

  getHttpUrl(): string {
    return '/api/numa-chat-agent/stream';
  }

  async connect(): Promise<void> {
    // No-op for HTTP streaming; kept for API parity
    return Promise.resolve();
  }

  isConnected(): boolean {
    // Always available (request-scoped)
    return true;
  }

  cleanup(): void {
    this.responseCallbacks.delete('current');
    this.currentOnEvent = null;
  }

  handleFrame(frame: ChatAgentNdjsonFrame, onChunk: OnChunk, onComplete: OnComplete, onError: OnError): void {
    if (!this.responseCallbacks.has('current')) return;
    const cb = this.responseCallbacks.get('current');

    try {
      switch (frame.type) {
        case 'start':
          cb({ type: 'start' });
          break;
        case 'event': {
          const evt = frame as AgentEventFrame;
          // Ignore top-level model text frames to avoid duplication.
          // We rely on Bedrock-like nested contentBlockDelta events for tokens.
          if (Object.prototype.hasOwnProperty.call(evt as Record<string, unknown>, 'data')) {
            break;
          }
          if (this.currentOnEvent && isToolEventFrame(evt)) {
            try {
              this.currentOnEvent(evt);
            } catch (handlerErr) {
              console.error('Chat HTTP onEvent handler error:', handlerErr);
            }
          }
          let textData = tryGetDeltaText(evt);
          if (typeof textData !== 'string') {
            const e = evt as Record<string, unknown>;
            const altDelta = (e.delta as { text?: unknown } | undefined)?.text ?? e.data;
            if (typeof altDelta === 'string') textData = altDelta;
          }
          if (typeof textData === 'string') cb({ type: 'chunk', data: textData });
          if (isMessageStopFrame(evt)) {
            const stopReason = getStopReason(evt) || 'complete';
            // Do not mark complete on tool_use pauses;
            // allow stream to continue for post-tool assistant content.
            if (stopReason === 'tool_use') {
              try {
                if (this.currentOnEvent) {
                  this.currentOnEvent({ type: 'tool_use_complete', original: evt } as unknown as AgentEventFrame);
                }
              } catch (e) {
                console.warn('Error emitting tool_use_complete event', e);
              }
            } else {
              cb({ type: 'complete', stop_reason: stopReason });
            }
          }
          break;
        }
        case 'error':
          cb({ type: 'error', error: frame.error });
          break;
        case 'completion':
          // Terminal marker from backend; mark complete if not already
          cb({ type: 'complete', stop_reason: 'complete' });
          break;
        case 'ping':
          // Heartbeat from server; ignore
          break;
        default:
        // ignore other types (e.g., ping)
      }
    } catch (err) {
      console.error('HTTP stream frame error', err);
      onError(err as Error);
    }
  }

  async streamPrompt(
    prompt: string,
    conversationId: string,
    enabledTools: string[],
    systemPrompt: string,
    modelId: string | null,
    onChunk: OnChunk,
    onComplete: OnComplete,
    onError: OnError,
    onEvent: OnEvent | null,
    userAuth: Record<string, unknown> | null = null,
    enabledConnections: string[] = [],
  ): Promise<() => void> {
    this.currentOnEvent = onEvent;
    this.responseCallbacks.set('current', (msg) => {
      switch (msg.type) {
        case 'start':
          console.debug('agent started');
          break;
        case 'chunk':
          onChunk(msg.data);
          break;
        case 'complete':
          onComplete(msg.stop_reason);
          this.cleanup();
          break;
        case 'error':
          onError(new Error(msg.error));
          this.cleanup();
          break;
      }
    });

    // Capture client local time information for backend routing/prompting (timezone-aware)
    const NOW = new Date();
    const timeInfo = {
      date: NOW.toLocaleDateString(),
      time: NOW.toLocaleTimeString(),
      // Include dayOfWeek for better calendaring context (e.g., "Monday")
      dayOfWeek: NOW.toLocaleDateString(undefined, { weekday: 'long' }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      iso: NOW.toISOString(),
      summary: `Local date: ${NOW.toLocaleDateString(undefined, { weekday: 'long' })}, ${NOW.toLocaleDateString()}, Local time: ${NOW.toLocaleTimeString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    };

    const payload: ChatAgentRequest = {
      prompt,
      conversationId,
      enabledTools,
      enabledConnections,
      systemPrompt,
      modelId,
      timeInfo,
    };

    const idToken = localStorage.getItem('idToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    if (userAuth) payload.userAuth = userAuth;

    const url = this.getHttpUrl();
    this.readerAbortController = new AbortController();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: this.readerAbortController.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat agent HTTP error: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Emit a synthetic start when first bytes arrive if backend start is delayed
      let started = false;
      const emitStart = () => {
        if (!started) {
          started = true;
          this.handleFrame({ type: 'start' } as AgentEventFrame, onChunk, onComplete, onError);
        }
      };

      // Read stream
      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          emitStart();
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const maybe: unknown = JSON.parse(line);
              // Temporary compatibility: unwrap non-streaming Function URL responses
              const isApiGwLikeResponse = (v: unknown): v is { statusCode: number | string; body: string } => {
                if (typeof v !== 'object' || v === null) return false;
                const obj = v as Record<string, unknown>;
                return 'statusCode' in obj && typeof obj.body === 'string';
              };

              if (isApiGwLikeResponse(maybe)) {
                const inner = maybe.body;
                inner
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .forEach((l) => {
                    try {
                      const innerFrame = JSON.parse(l) as ChatAgentNdjsonFrame;
                      this.handleFrame(innerFrame, onChunk, onComplete, onError);
                    } catch {
                      console.warn('Invalid inner NDJSON line:', l);
                    }
                  });
                continue;
              }

              const frame = maybe as ChatAgentNdjsonFrame;
              this.handleFrame(frame, onChunk, onComplete, onError);
            } catch {
              console.warn('Invalid NDJSON line from chat agent:', line);
            }
          }
        }
        // Flush any trailing line
        const tail = buffer.trim();
        if (tail) {
          try {
            const maybe: unknown = JSON.parse(tail);
            const isApiGwLikeResponse = (v: unknown): v is { statusCode: number | string; body: string } => {
              if (typeof v !== 'object' || v === null) return false;
              const obj = v as Record<string, unknown>;
              return 'statusCode' in obj && typeof obj.body === 'string';
            };
            if (isApiGwLikeResponse(maybe)) {
              const inner = maybe.body;
              inner
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .forEach((l) => {
                  try {
                    const innerFrame = JSON.parse(l) as ChatAgentNdjsonFrame;
                    this.handleFrame(innerFrame, onChunk, onComplete, onError);
                  } catch {
                    console.warn('Invalid inner NDJSON line (tail):', l);
                  }
                });
            } else {
              const frame = maybe as ChatAgentNdjsonFrame;
              this.handleFrame(frame, onChunk, onComplete, onError);
            }
          } catch {
            // ignore
          }
        }
      };

      pump().catch((err) => {
        console.error('HTTP streaming pump error', err);
        onError(err as Error);
        this.cleanup();
      });
    } catch (err) {
      onError(err as Error);
      this.cleanup();
    }

    return () => {
      if (this.readerAbortController) this.readerAbortController.abort();
      this.cleanup();
    };
  }
}

const chatAgentWS = new ChatAgentHttpStream();

/**
 * Call the Chat Agent with streaming response via HTTP
 * @param {string} prompt - The user's prompt/question
 * @param {string} conversationId - Conversation ID for backend to load history
 * @param {Array} enabledTools - Array of tool names to enable
 * @param {string} systemPrompt - Optional system prompt for the agent
 * @param {string} modelId - Model ID to use for this request
 * @param {function} onChunk - Callback function for each chunk of data
 * @param {function} onComplete - Callback function when streaming is complete
 * @param {function} onError - Callback function for errors
 * @param {function=} onEvent - Optional raw event handler
 * @param {Object=} userAuth - Optional user authentication context
 * @returns {function} Abort function to cancel the stream
 */
export const callChatAgentStreaming = (
  prompt: string,
  conversationId: string,
  enabledTools: string[] = ['query_knowledge_base', 'web_search'],
  systemPrompt: string = '',
  modelId: string | null = null,
  onChunk: OnChunk,
  onComplete: OnComplete,
  onError: OnError,
  onEvent: OnEvent | null = null,
  userAuth: Record<string, unknown> | null = null,
  enabledConnections: string[] = [],
) =>
  chatAgentWS.streamPrompt(
    prompt,
    conversationId,
    enabledTools,
    systemPrompt,
    modelId,
    onChunk,
    onComplete,
    onError,
    onEvent,
    userAuth,
    enabledConnections,
  );

/**
 * Check if the Chat Agent is available
 * @returns {boolean} True if the agent streaming endpoint is available
 */
export const isChatAgentAvailable = (): boolean => true;

/**
 * Get the Chat Agent streaming URL
 * @returns {string|null} The streaming URL or null if not configured
 */
export const getChatAgentUrl = (): string | null => '/api/numa-chat-agent/stream';

/**
 * Manually connect (no-op for HTTP streaming)
 * @returns {Promise} Promise that resolves when connected
 */
export const connectChatAgent = (): Promise<void> => chatAgentWS.connect();

/**
 * Disconnect (no-op for HTTP streaming)
 */
export const disconnectChatAgent = (): void => {
  // No persistent connection to close
};

/**
 * Check if the streaming client is connected (always true for HTTP request-scoped)
 * @returns {boolean} True if connected
 */
export const isChatAgentConnected = (): boolean => chatAgentWS.isConnected();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  // Nothing to clean up
});
