/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ChatMessages } from '../../Components/ChatMessages';
import '@testing-library/jest-dom';

// Mock the useAuth hook
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getCredentials: vi.fn(),
  }),
}));

describe('ChatMessages Component - Additional Tests', () => {
  const loadingIndicatorStyle = {};

  const dummyRef = React.createRef();
  const noop = () => {};

  it('renders ephemeral message for "initializing" status', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    expect(screen.getByText('Initializing chat...')).toBeInTheDocument();
  });

  it('renders ephemeral message for "processingFile" status', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    expect(screen.getByText('Processing Upload...')).toBeInTheDocument();
  });

  it('renders ephemeral message for "querying" status', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    expect(screen.getByText('Querying data sources...')).toBeInTheDocument();
  });

  it('renders ephemeral message for "thinking" status', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders a normal user message correctly', () => {
    const messages = [
      {
        role: 'user',
        content: 'Hello, this is a user message.',
      },
    ];
    render(
      <ChatMessages
        messages={messages}
        messageEndRef={dummyRef}
        loadingIndicatorStyle={loadingIndicatorStyle}
        onOpenDocument={noop}
      />,
    );
    expect(screen.getByText('You:')).toBeInTheDocument();
    expect(screen.getByText('Hello, this is a user message.')).toBeInTheDocument();
  });

  it('renders ChatReferencesDropdown when references are provided', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    // Assuming that the ChatReferencesDropdown renders a button with text "Show References"
    expect(screen.getByText(/show references/i)).toBeInTheDocument();
  });

  it('adds message-with-doc class when docTitle and docContent are provided', () => {
    const messages = [
      {
        role: 'assistant',
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
      />,
    );
    // The container should have a message with class "message-with-doc"
    const messageElement = container.querySelector('.message-with-doc');
    expect(messageElement).toBeTruthy();
  });
});
