/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ChatMessages } from '../../Components/Chat/ChatMessages';
import '@testing-library/jest-dom';

// Mock the useAuth hook
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getCredentials: vi.fn(),
  }),
  useAuthOptional: () => ({
    getCredentials: vi.fn(),
  }),
}));

// Mock the useBranding hook
vi.mock('../../Providers/BrandingContext', () => ({
  useBranding: () => ({
    branding: {
      name: 'Test',
      resolvedAssets: {},
      assets: {},
      logo: '/test-logo.svg',
    },
  }),
}));

// Mock the useBrandingAsset hook
vi.mock('../../hooks/useBrandingAsset', () => ({
  useBrandingAsset: (rawValue: string, fallback: string) => rawValue || fallback,
}));

describe('ChatMessages Component - Additional Tests', () => {
  const loadingIndicatorStyle = {};

  const dummyRef = React.createRef<HTMLDivElement>();
  const noop = () => {};

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  it('renders ephemeral message for "initializing" status', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        status: 'initializing',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.getByText('Initializing chat...')).toBeInTheDocument();
  });

  it('renders ephemeral message for "processingFile" status', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        status: 'processingFile',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.getByText('Processing Upload...')).toBeInTheDocument();
  });

  it('renders ephemeral message for "thinking" status', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        status: 'thinking',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders a normal user message correctly', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Hello, this is a user message.',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.getByText('You:')).toBeInTheDocument();
    expect(screen.getByText('Hello, this is a user message.')).toBeInTheDocument();
  });

  it('renders ChatReferencesDropdown when references are provided', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Message with references',
        references: ['s3://bucket/file.txt'],
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    // Assuming that the ChatReferencesDropdown renders a button with text "Show References"
    expect(screen.getByText(/show references/i)).toBeInTheDocument();
  });

  it('adds message-with-doc class when docTitle and docContent are provided', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Message with a document bubble',
        docTitle: 'My Doc',
        docContent: 'Document content here',
      },
    ];
    const { container } = render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    // The container should have a message with class "message-with-doc"
    const messageElement = container.querySelector('.message-with-doc');
    expect(messageElement).toBeTruthy();
  });

  it("doesn't render legacy 'querying' status (agent mode only)", () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        status: 'querying',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.queryByText('Querying data sources...')).not.toBeInTheDocument();
  });

  it('renders segment-based content in agent mode', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Fallback content',
        segments: [{ kind: 'text' as const, text: 'This is segment text' }],
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
        isConversationLoading={false}
      />
    );
    expect(screen.getByText('This is segment text')).toBeInTheDocument();
    expect(screen.queryByText('Fallback content')).not.toBeInTheDocument();
  });
});
