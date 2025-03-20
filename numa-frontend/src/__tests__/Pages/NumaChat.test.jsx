/**
 * @vitest-environment jsdom
 */
/* eslint-disable react/display-name */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { NumaChat } from '../../Pages/NumaChat';

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
// ChatMessages renders provided messages and always an "Open Doc" button.
vi.mock('../../Components/ChatMessages', () => ({
  ChatMessages: ({ messages, onOpenDocument }) => (
    <div data-testid="chat-messages">
      {messages && messages.length > 0 ? messages.map((msg, index) => <div key={index}>{msg.content}</div>) : null}
      <button data-testid="open-doc" onClick={() => onOpenDocument('Doc Title', 'Doc Content')}>
        Open Doc
      </button>
    </div>
  ),
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
    getIdentityPoolCredentials: vi.fn().mockResolvedValue({}),
  }),
}));

// --- Mock sessionStorage ---
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: (key) => {
      if (key === 'Q_APPLICATION_ID') return 'dummy-app-id';
      if (key === 'Q_RETRIEVER_ID') return 'dummy-retriever-id';
      return null;
    },
    setItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// --- Additional Tests for NumaChat ---
describe('NumaChat Component', () => {
  it('renders main page layout', () => {
    render(<NumaChat />);
    expect(screen.getByText('Numa Chat')).toBeInTheDocument();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Chat');
    expect(screen.getByTestId('layout-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('chat-history-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('data-sources-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('resizable-split-view')).toBeInTheDocument();
    expect(screen.getAllByText(/click the/i)[0]).toBeInTheDocument(); // Get first "click the" text
  });

  it('clicking New Chat button resets conversation', async () => {
    render(<NumaChat />);
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
    render(<NumaChat />);
    expect(screen.getByTestId('chat-input-field')).toBeInTheDocument();
    const submitButton = screen.getByTestId('chat-submit');
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    });
  });

  it('displays initial assistant greeting when no conversation exists', async () => {
    render(<NumaChat />);
    // Wait for asynchronous conversation initialization to set the greeting.
    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('How can I help you today?');
    });
  });

  it('updates isMobile prop in ChatInput when window is resized', async () => {
    window.innerWidth = 1024;
    render(<NumaChat />);
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
    render(<NumaChat />);
    expect(screen.queryByTestId('chat-file-upload')).toBeNull();
  });

  it('creates a new conversation and stores conversation id in localStorage', async () => {
    // Reset localStorage mock.
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');
    render(<NumaChat />);
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

  it('renders right pane in ResizableSplitView when document is opened', async () => {
    render(<NumaChat />);
    // Initially, the right pane should not be rendered.
    expect(screen.queryByTestId('right-pane')).toBeNull();
    // Simulate clicking the "Open Doc" button in ChatMessages.
    const openDocButton = screen.getByTestId('open-doc');
    fireEvent.click(openDocButton);
    // Wait for the ResizableSplitView to render its right pane.
    await waitFor(() => {
      expect(screen.getByTestId('right-pane')).toBeInTheDocument();
    });
  });
});
