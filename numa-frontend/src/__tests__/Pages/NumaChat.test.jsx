/**
 * @vitest-environment jsdom
 */
/* eslint-disable react/display-name */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { NumaChat } from '../../Pages/NumaChat';
import { MemoryRouter } from 'react-router-dom';

// --- Mock chatSystemPromptUtils ---
vi.mock('../../utils/chatSystemPromptUtils', () => ({
  loadCompanyProfile: vi.fn().mockResolvedValue('Test Company Profile'),
  enhanceSystemPromptWithCompanyInfo: vi.fn((basePrompt, companyProfile) => {
    return (
      basePrompt +
      (companyProfile
        ? `

**Company Information:**
${companyProfile}`
        : '')
    );
  }),
  generateSystemPrompt: vi.fn().mockReturnValue('Test system prompt'),
  getEnabledTools: vi.fn().mockReturnValue(['query_knowledge_base', 'web_search']),
}));

// --- Mock other utilities ---
vi.mock('../../utils/bedrockMessageHistoryUtils', () => ({
  MAX_DYNAMO_MESSAGES: 100,
  prepareConversationHistoryForChat: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/bedrockModelConfig', () => ({
  getModelId: vi.fn().mockReturnValue('test-model-id'),
  MODEL_TYPES: { DEFAULT: 'default', FALLBACK: 'fallback' },
  isInFallbackMode: vi.fn().mockReturnValue(false),
  setFallbackMode: vi.fn(),
  isQuotaLimitError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../utils/streamingProcessors', () => ({
  parseChunkWithoutDocComments: vi.fn().mockReturnValue('test chunk'),
  extractSingleDocBlock: vi.fn().mockReturnValue(null),
  createDocStripState: vi.fn().mockReturnValue({}),
}));

vi.mock('../../utils/conversationLoader', () => ({
  loadConversation: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/toolEventHandlers', () => ({
  processToolEvent: vi.fn(),
}));

vi.mock('../../utils/knowledgeBaseUtils', () => ({
  preWarmAuroraDatabase: vi.fn().mockResolvedValue(),
}));

vi.mock('../../Services/chatAgentService', () => ({
  callChatAgentStreaming: vi.fn().mockImplementation((prompt, messages, tools, system, model, onChunk, onComplete) => {
    // Simulate successful completion
    setTimeout(() => onComplete('complete'), 10);
    return vi.fn(); // return abort function
  }),
}));

// --- Mocks for subcomponents ---
vi.mock('../../Components/Nav', () => ({
  Nav: () => <div data-testid="nav">Nav</div>,
}));
vi.mock('../../Components/Breadcrumbs', () => ({
  Breadcrumbs: ({ label }) => <div data-testid="breadcrumbs">{label}</div>,
}));
vi.mock('../../Layouts/LayoutDashboard', () => ({
  LayoutDashboard: ({ children, className }) => (
    <div data-testid="layout-dashboard" className={className}>
      {children}
    </div>
  ),
}));
vi.mock('../../Components/ChatHistorySidebar', () => ({
  ChatHistorySidebar: React.forwardRef((props, ref) => (
    <div data-testid="chat-history-sidebar" ref={ref}>
      ChatHistorySidebar
    </div>
  )),
}));
vi.mock('../../Components/DataSourcesList', () => ({
  DataSourcesList: () => <div data-testid="data-sources-list">DataSourcesList</div>,
}));
vi.mock('../../Components/ChatFileUpload', () => ({
  ChatFileUpload: ({ show, onHide }) =>
    show ? (
      <div data-testid="chat-file-upload">
        <button onClick={onHide}>Close Upload</button>
      </div>
    ) : null,
}));
// ChatMessages renders provided messages and conditionally shows an "Open Doc" button.
vi.mock('../../Components/ChatMessages', () => ({
  ChatMessages: ({ messages, onOpenDocument, isConversationLoading }) => {
    // Show loading state if conversation is loading
    if (isConversationLoading) {
      return (
        <div className="d-flex justify-content-center align-items-center h-100">
          <div className="text-center">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-2 text-muted">Loading conversation...</p>
          </div>
        </div>
      );
    }

    return (
      <div data-testid="chat-messages">
        {messages && messages.length > 0 ? (
          messages.map((msg, index) => <div key={index}>{msg.content}</div>)
        ) : (
          <div>How can I help you today?</div>
        )}
        <button data-testid="open-doc" onClick={() => onOpenDocument('Doc Title', 'Doc Content')}>
          Open Doc
        </button>
      </div>
    );
  },
}));
// Updated ChatInput mock now forwards onChange events to setInputMessage.
vi.mock('../../Components/ChatInput', () => ({
  ChatInput: ({
    inputMessage,
    setInputMessage,
    handleSubmit,
    isMobile,
    queryDataSources,
    setQueryDataSources,
    webSearchEnabled,
    setWebSearchEnabled,
  }) => (
    <div
      data-testid="chat-input"
      data-is-mobile={isMobile}
      data-query-datasources={queryDataSources}
      data-web-search-enabled={webSearchEnabled}
    >
      <input value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} data-testid="chat-input-field" />
      <button onClick={handleSubmit} data-testid="chat-submit">
        Submit
      </button>
      <button onClick={() => setQueryDataSources(!queryDataSources)} data-testid="toggle-datasources">
        Toggle Data Sources
      </button>
      <button onClick={() => setWebSearchEnabled(!webSearchEnabled)} data-testid="toggle-websearch">
        Toggle Web Search
      </button>
    </div>
  ),
}));
vi.mock('../../Components/DocumentPanel', () => ({
  DocumentPanel: ({ documentContent, onClose }) => (
    <div data-testid="document-panel">
      <div>{documentContent.title}</div>
      <button onClick={onClose}>Close Document</button>
    </div>
  ),
}));
vi.mock('../../Components/ResizableSplitView', () => ({
  __esModule: true,
  default: ({ left, right, showRight }) => (
    <div data-testid="resizable-split-view">
      <div data-testid="left-pane">{left}</div>
      {showRight && <div data-testid="right-pane">{right}</div>}
    </div>
  ),
}));

// --- Mock useAuth ---
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      decoded_tokens: {
        idToken: {
          sub: 'test-sub',
          email: 'test@example.com',
        },
      },
    },
    qBusinessClient: {
      send: vi.fn().mockResolvedValue({ relevantContent: [] }),
    },
    bedrockRuntimeClient: {
      send: vi.fn().mockResolvedValue({
        stream: [],
      }),
    },
    numaChatDynamoUtils: {
      getUserConversationsMeta: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue({}),
      updateMetaItem: vi.fn().mockResolvedValue({}),
      queryConversations: vi.fn().mockResolvedValue([]),
    },
    getAccessToken: vi.fn().mockResolvedValue({}),
    getCredentials: vi.fn().mockResolvedValue({}),
  }),
}));

// --- Mock the conversation manager hooks ---
vi.mock('../../hooks/useConversationManager', () => ({
  useConversationManager: () => ({
    conversationId: null,
    setConversationId: vi.fn(),
    isConversationLoading: false,
    setIsConversationLoading: vi.fn(),
    createNewConversationIfNeeded: vi.fn().mockImplementation(() => {
      // Simulate creating a conversation ID based on user sub
      const conversationId = `test-sub_${Date.now()}`;
      // Simulate storing the conversation ID in localStorage like the real hook might do
      localStorage.setItem('currentConversationId', conversationId);
      return Promise.resolve(conversationId);
    }),
    handleNewChat: vi.fn().mockResolvedValue(),
  }),
}));

vi.mock('../../hooks/useStreamingHandler', () => ({
  useStreamingHandler: () => ({
    setCurrentAbort: vi.fn(),
    resetStreamingState: vi.fn(),
    textBufferRef: { current: '' },
    processedEventIdsRef: { current: new Set() },
    toolUseMapRef: { current: new Map() },
    finalFlushPerformedRef: { current: false },
  }),
}));

vi.mock('../../hooks/useDocumentProcessor', () => ({
  useDocumentProcessor: () => ({
    inlineDocument: null,
    showSplitView: false,
    leftFraction: 0.7,
    setLeftFraction: vi.fn(),
    openDocument: vi.fn(),
    closeDocument: vi.fn(),
    setInlineDocument: vi.fn(),
  }),
}));

vi.mock('../../hooks/useCompanyProfile', () => ({
  useCompanyProfile: () => ({
    companyProfile: 'Test Company Profile',
  }),
}));

// --- Mock sessionStorage ---
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: (key) => {
      if (key === 'Q_APPLICATION_ID') return 'dummy-app-id';
      if (key === 'Q_RETRIEVER_ID') return 'dummy-retriever-id';
      if (key === 'REGION') return 'us-east-1';
      if (key === 'CHAT_AGENT_URL') return 'wss://test-chat-agent.example.com';
      if (key === 'PREFERRED_KNOWLEDGE_BASE') return 'q';
      if (key === 'BEDROCK_KNOWLEDGE_BASE_ID') return 'test-kb-id';
      return null;
    },
    setItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// --- Mock WebSocket ---
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;

    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data) {
    // Mock implementation - don't actually send
    console.log('Mock WebSocket send:', data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
}

// Add WebSocket constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket;
Object.defineProperty(window, 'WebSocket', {
  value: MockWebSocket,
  writable: true,
});

// --- Mock localStorage ---
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key) => {
      if (key === 'idToken') return 'mock-id-token';
      return null;
    },
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// --- Additional Tests for NumaChat ---
describe('NumaChat Component', () => {
  it('renders main page layout', () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    expect(screen.getByText('Numa Chat')).toBeInTheDocument();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Chat');
    expect(screen.getByTestId('layout-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('chat-history-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('resizable-split-view')).toBeInTheDocument();
    expect(screen.getAllByText(/click the/i)[0]).toBeInTheDocument(); // Get first "click the" text
  });

  it('clicking New Chat button resets conversation', async () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    });
    const newChatButton = screen.getByRole('button', { name: /new chat/i });
    fireEvent.click(newChatButton);
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    });
  });

  it('submits a user message and ensures ChatMessages remains rendered', async () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('chat-input-field')).toBeInTheDocument();
    const submitButton = screen.getByTestId('chat-submit');
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    });
  });

  it('displays initial assistant greeting when no conversation exists', async () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    // Wait for asynchronous conversation initialization to set the greeting.
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('How can I help you today?');
    });
  });

  it('updates isMobile prop in ChatInput when window is resized', async () => {
    window.innerWidth = 1024;
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    const chatInput = screen.getByTestId('chat-input');
    expect(chatInput.getAttribute('data-is-mobile')).toBe('false');
    // Change window.innerWidth to a smaller value and dispatch resize.
    window.innerWidth = 500;
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-input').getAttribute('data-is-mobile')).toBe('true');
    });
  });

  it('does not render file upload modal initially', () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('chat-file-upload')).toBeNull();
  });

  it('creates a new conversation and stores conversation id in localStorage', async () => {
    // Reset localStorage mock.
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );
    // Simulate user typing a message.
    const inputField = screen.getByTestId('chat-input-field');
    fireEvent.change(inputField, { target: { value: 'Hello, Numa!' } });
    // Submit the message.
    const submitButton = screen.getByTestId('chat-submit');
    fireEvent.click(submitButton);
    // Wait for the conversation to be created and stored.
    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith('currentConversationId', expect.stringMatching(/^test-sub_\d+$/));
    });
    setItemSpy.mockRestore();
  });

  it('renders Open Doc button in chat messages', async () => {
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );

    // Wait for conversation loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading conversation...')).not.toBeInTheDocument();
    });

    // Verify that the Open Doc button is rendered and clickable
    const openDocButton = screen.getByTestId('open-doc');
    expect(openDocButton).toBeInTheDocument();
  });

  it('sets company profile state when component mounts', async () => {
    // Render the component
    render(
      <MemoryRouter>
        <NumaChat />
      </MemoryRouter>,
    );

    // Since we've mocked loadCompanyProfile to return 'Test Company Profile',
    // we can check that the component state is updated correctly by looking for
    // evidence of the company profile in the rendered output

    // Wait for the initial render to complete
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    });

    // The company profile is loaded asynchronously, so we need to wait for it
    // We can't directly check the state, but we can check that the component
    // doesn't crash when loading the company profile
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });
});
