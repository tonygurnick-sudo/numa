/**
 * Service for interacting with the Numa Chat Agent via WebSocket API Gateway
 */

class ChatAgentWebSocket {
  constructor() {
    this.websocket = null;
    this.connectionPromise = null;
    this.responseCallbacks = new Map();
    this.currentRequestId = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 1000; // Start with 1 second
  }

  /**
   * Get the WebSocket URL from session storage
   */
  getWebSocketUrl() {
    const wsUrl = window.sessionStorage.getItem('CHAT_AGENT_URL');
    if (!wsUrl) {
      throw new Error('Chat Agent WebSocket URL not configured. Make sure the app is properly initialized.');
    }
    return wsUrl;
  }

  /**
   * Connect to the WebSocket
   */
  async connect() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
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

        this.websocket.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.websocket.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          this.connectionPromise = null;

          // Handle unexpected disconnections
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        };

        this.websocket.onerror = (error) => {
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
  async attemptReconnect() {
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
  handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      if ('data' in msg) {
        return; // Ignore raw data messages - These are from bedrock, not strands.
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
          if (this.currentOnEvent && this.isToolEvent(msg)) {
            try {
              this.currentOnEvent(msg);
            } catch (handlerErr) {
              console.error('Chat WS onEvent handler error:', handlerErr);
            }
          }

          // Handle content block deltas (don't duplicate in onEvent)
          if (msg.event?.contentBlockDelta?.delta?.text) {
            const textData = msg.event.contentBlockDelta.delta.text;
            cb({ type: 'chunk', data: textData });
          }

          // Handle message completion
          if (msg.event && (msg.event.messageStop || msg.event.complete)) {
            // Extract stop reason from the correct location
            let stopReason = 'complete';
            if (msg.event.messageStop && msg.event.messageStop.stopReason) {
              stopReason = msg.event.messageStop.stopReason;
            } else if (msg.event.stop_reason) {
              stopReason = msg.event.stop_reason;
            } else if (msg.event.stopReason) {
              stopReason = msg.event.stopReason;
            }

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
  isToolEvent(msg) {
    // Determine if this frame relates to a tool (call or result)
    const hasToolUseStart = msg.event?.contentBlockStart?.start?.toolUse;
    const hasCurrentTool = msg.current_tool_use || msg.event?.current_tool_use;

    // Check for toolResult directly on various paths
    const directToolResult = msg.message?.toolResult || msg.event?.toolResult || msg.delta?.toolResult;

    // Check arrays that may contain toolUse/toolResult objects
    const arrayContent = msg.message?.content;
    const arrayToolResult = Array.isArray(arrayContent) && arrayContent.some((item) => item.toolUse || item.toolResult);

    return hasToolUseStart || hasCurrentTool || directToolResult || arrayToolResult || msg.type === 'tool_use_complete';
  }

  /**
   * Send a message through the WebSocket
   */
  async sendMessage(message) {
    await this.connect();

    if (this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.websocket.send(JSON.stringify(message));
  }

  /**
   * Stream a prompt to Chat Agent.
   * @param {string} prompt
   * @param {Array} messages - Conversation history
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
    prompt,
    messages,
    enabledTools,
    systemPrompt,
    modelId,
    onChunk,
    onComplete,
    onError,
    onEvent,
    userAuth = null,
  ) {
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

    // Send the prompt with enabled tools configuration, system prompt, model ID, and user auth
    const messagePayload = {
      prompt,
      messages,
      enabledTools,
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

  cleanup() {
    this.responseCallbacks.delete('current');
    this.currentOnEvent = null;
  }

  /**
   * Disconnect the WebSocket
   */
  disconnect() {
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
  isConnected() {
    return this.websocket && this.websocket.readyState === WebSocket.OPEN;
  }
}

// Create a singleton instance
const chatAgentWS = new ChatAgentWebSocket();

/**
 * Call the Chat Agent with streaming response via WebSocket
 * @param {string} prompt - The user's prompt/question
 * @param {Array} messages - Optional array of message objects for context
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
  prompt,
  messages = [{ role: 'user', content: [{ text: prompt }] }],
  enabledTools = ['query_knowledge_base', 'web_search'],
  systemPrompt = '',
  modelId = null,
  onChunk,
  onComplete,
  onError,
  onEvent = null,
  userAuth = null,
) =>
  chatAgentWS.streamPrompt(
    prompt,
    messages,
    enabledTools,
    systemPrompt,
    modelId,
    onChunk,
    onComplete,
    onError,
    onEvent,
    userAuth,
  );

/**
 * Check if the Chat Agent is available
 * @returns {boolean} True if the agent WebSocket URL is configured
 */
export const isChatAgentAvailable = () => {
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
export const getChatAgentUrl = () => {
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
export const connectChatAgent = () => {
  return chatAgentWS.connect();
};

/**
 * Disconnect from the WebSocket
 */
export const disconnectChatAgent = () => {
  chatAgentWS.disconnect();
};

/**
 * Check if the WebSocket is currently connected
 * @returns {boolean} True if connected
 */
export const isChatAgentConnected = () => {
  return chatAgentWS.isConnected();
};

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  chatAgentWS.disconnect();
});
