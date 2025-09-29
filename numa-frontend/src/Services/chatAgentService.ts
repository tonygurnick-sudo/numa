/**
 * Service for interacting with the Numa Chat Agent via WebSocket API Gateway
 */
import type { AgentEventFrame, OnChunk, OnComplete, OnError, OnEvent } from '../types/chat';
import { getStopReason, isMessageStopFrame, isToolEventFrame, tryGetDeltaText } from '../types/chat';

class ChatAgentWebSocket {
  private websocket: WebSocket | null;
  private connectionPromise: Promise<void> | null;
  private responseCallbacks;
  private currentRequestId: number;
  private reconnectAttempts: number;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private currentOnEvent: OnEvent | null | undefined;

  constructor() {
    this.websocket = null;
    this.connectionPromise = null;
    this.responseCallbacks = new Map();
    this.currentRequestId = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 1000; // Start with 1 second
    this.currentOnEvent = null;
  }

  /**
   * Get the WebSocket URL from session storage
   */
  getWebSocketUrl(): string {
    const wsUrl = window.sessionStorage.getItem('CHAT_AGENT_URL');
    if (!wsUrl) {
      throw new Error('Chat Agent WebSocket URL not configured. Make sure the app is properly initialized.');
    }
    return wsUrl;
  }

  /**
   * Connect to the WebSocket
   */
  async connect(): Promise<void> {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        const wsUrl = this.getWebSocketUrl();

        // Add ID token as query parameter for authentication
        let authenticatedWsUrl = wsUrl;
        const idToken = localStorage.getItem('idToken');
        if (idToken) {
          const separator = wsUrl.includes('?') ? '&' : '?';
          authenticatedWsUrl = `${wsUrl}${separator}Authorization=${encodeURIComponent(idToken)}`;
        }

        console.log('Connecting to Chat Agent WebSocket:', wsUrl, '(with auth)');

        this.websocket = new WebSocket(authenticatedWsUrl);

        this.websocket.onopen = () => {
          console.log('Connected to Chat Agent WebSocket');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          resolve();
        };

        this.websocket.onmessage = (event: MessageEvent) => {
          this.handleMessage(event);
        };

        this.websocket.onclose = (event: CloseEvent) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          this.connectionPromise = null;

          // Handle unexpected disconnections
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        };

        this.websocket.onerror = (error: Event) => {
          console.error('WebSocket error:', error);
          this.connectionPromise = null;
          reject(new Error('Failed to connect to Chat Agent WebSocket'));
        };

        // Timeout for connection
        setTimeout(() => {
          if (this.websocket.readyState !== WebSocket.OPEN) {
            this.websocket.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
      } catch (error) {
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
    this.reconnectDelay *= 2; // Exponential backoff

    try {
      await this.connect();
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data as string) as AgentEventFrame;
      if ('data' in msg) {
        // Ignore top-level text frames from Strands ModelStreamEvent to avoid duplicate rendering;
        // we extract text from contentBlockDelta deltas instead.
        return;
      }

      // Handle streaming for the current request
      if (!this.responseCallbacks.has('current')) return;
      const cb = this.responseCallbacks.get('current');

      switch (msg.type) {
        case 'start':
          cb({ type: 'start' });
          break;
        case 'event': {
          // Forward raw event frame to optional handler (e.g., UI wants to render tool events)
          // But only forward tool-specific events, not content deltas
          if (this.currentOnEvent && isToolEventFrame(msg)) {
            try {
              this.currentOnEvent(msg);
            } catch (handlerErr) {
              console.error('Chat WS onEvent handler error:', handlerErr);
            }
          }

          // Handle content block deltas (don't duplicate in onEvent)
          const textData = tryGetDeltaText(msg);
          if (typeof textData === 'string') cb({ type: 'chunk', data: textData });

          // Handle message completion
          if (isMessageStopFrame(msg)) {
            // Extract stop reason from the correct location
            const stopReason = getStopReason(msg) || 'complete';

            // If the agent indicates it is pausing to perform a tool call, keep
            // the stream open so that follow-up content (after the tool call has
            // finished) will still be delivered through the same callback chain.
            if (stopReason === 'tool_use') {
              if (this.currentOnEvent) {
                this.currentOnEvent({ type: 'tool_use_complete', original: msg });
              }
              return;
            }

            console.log('[Chat WS] Stream complete');
            console.log('[Chat WS] Calling completion callback with stop_reason:', stopReason);
            cb({
              type: 'complete',
              stop_reason: stopReason,
            });
          }
          break;
        }
        case 'error':
          cb({ type: 'error', error: msg.error });
          break;
        default:
        // ignore other frame types for now
      }
    } catch (err) {
      console.error('WS parse error', err);
    }
  }

  /**
   * Helper method to determine if a message is a tool-specific event
   * This prevents duplicate processing of content deltas
   */
  isToolEvent(msg: AgentEventFrame): boolean {
    return isToolEventFrame(msg);
  }

  /**
   * Send a message through the WebSocket
   */
  async sendMessage(message: Record<string, unknown>): Promise<void> {
    await this.connect();

    if (this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.websocket.send(JSON.stringify(message));
  }

  /**
   * Stream a prompt to Chat Agent.
   * @param {string} prompt
   * @param {string} conversationId - Conversation ID for backend to load history
   * @param {Array} enabledTools - Array of tool names to enable
   * @param {string} systemPrompt - System prompt for the agent
   * @param {string} modelId - Model ID to use for this request
   * @param {function} onChunk
   * @param {function} onComplete
   * @param {function} onError
   * @param {function=} onEvent
   * @param {Object=} userAuth
   * @returns {function} abort() – remove listeners
   */
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
    await this.connect();
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

    // Send the prompt with conversationId for backend to load history and enabled connections
    const messagePayload: Record<string, unknown> = {
      prompt,
      conversationId,
      enabledTools,
      enabledConnections,
      systemPrompt,
      modelId,
    };

    // Add JWT token for backend authentication (backend expects 'jwtToken')
    const idToken = localStorage.getItem('idToken');
    if (idToken) {
      messagePayload.jwtToken = idToken;
    }

    // Add user authentication context if provided
    if (userAuth) {
      messagePayload.userAuth = userAuth;
    }

    this.websocket.send(JSON.stringify(messagePayload));
    return () => this.cleanup();
  }

  cleanup(): void {
    this.responseCallbacks.delete('current');
    this.currentOnEvent = null;
  }

  /**
   * Disconnect the WebSocket
   */
  disconnect(): void {
    if (this.websocket) {
      this.websocket.close(1000, 'Client disconnect');
      this.websocket = null;
    }
    this.connectionPromise = null;
    this.responseCallbacks.clear();
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return !!this.websocket && this.websocket.readyState === WebSocket.OPEN;
  }
}

// Create a singleton instance
const chatAgentWS = new ChatAgentWebSocket();

/**
 * Call the Chat Agent with streaming response via WebSocket
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
 * @returns {boolean} True if the agent WebSocket URL is configured
 */
export const isChatAgentAvailable = (): boolean => {
  try {
    chatAgentWS.getWebSocketUrl();
    return true;
  } catch {
    return false;
  }
};

/**
 * Get the Chat Agent WebSocket URL
 * @returns {string|null} The WebSocket URL or null if not configured
 */
export const getChatAgentUrl = (): string | null => {
  try {
    return chatAgentWS.getWebSocketUrl();
  } catch {
    return null;
  }
};

/**
 * Manually connect to the WebSocket (optional - connections are automatic)
 * @returns {Promise} Promise that resolves when connected
 */
export const connectChatAgent = (): Promise<void> => chatAgentWS.connect();

/**
 * Disconnect from the WebSocket
 */
export const disconnectChatAgent = (): void => {
  chatAgentWS.disconnect();
};

/**
 * Check if the WebSocket is currently connected
 * @returns {boolean} True if connected
 */
export const isChatAgentConnected = (): boolean => chatAgentWS.isConnected();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  chatAgentWS.disconnect();
});
