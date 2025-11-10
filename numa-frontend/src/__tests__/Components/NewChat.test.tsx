/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import { NewChat } from '../../Components/Chat/NewChat';

// ✅ Minimal mock so ConversationAvatar’s hook doesn’t require a provider
vi.mock('../../hooks/useAgentById', () => ({
  useAgentById: (_agentId?: string) => ({ agent: null }),
}));

// ✅ Keep ChatInput lightweight and controllable
vi.mock('../../Components/Chat/ChatInput', () => ({
  ChatInput: ({
    placeholderOverride,
    handleSubmit,
  }: {
    placeholderOverride?: string;
    handleSubmit?: (event: React.FormEvent) => void;
  }) => (
    <form
      data-testid="chat-input-mock"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit?.(event);
      }}
    >
      <textarea aria-label="Chat input mock" placeholder={placeholderOverride || 'Chat input mock'} />
      <button type="submit">Send</button>
    </form>
  ),
}));

const createBaseProps = () => {
  return {
    inputMessage: '',
    setInputMessage: vi.fn(),
    handleSubmit: vi.fn(),
    setShowUploadModal: vi.fn(),
    buttonStatus: 'idle',
    queryDataSources: false,
    setQueryDataSources: vi.fn(),
    webSearchEnabled: false,
    setWebSearchEnabled: vi.fn(),
    createAgentEnabled: false,
    setCreateAgentEnabled: vi.fn(),
    autoToolsEnabled: true,
    setAutoToolsEnabled: vi.fn(),
    availableConnections: [],
    enabledConnections: [],
    setEnabledConnections: vi.fn(),
    connectionsLoading: false,
    hasPipedreamFeature: false,
    uploadsInProgress: false,
    noToolsActive: false,
    inputRef: React.createRef<HTMLTextAreaElement>(),
    recentConversations: [] as Array<{
      conversation_id: string;
      conversationName?: string | null;
      latestTimestamp: number;
      // Optional agent metadata (not used in these tests)
      isAgentConversation?: boolean;
      agentId?: string | null;
      agentIcon?: string | null;
      agentTitle?: string | null;
    }>,
    hideSuggestions: vi.fn(),
    onContinueConversation: vi.fn(),
    suggestionsLoading: false,
    userName: undefined,
    onRenameConversation: undefined,
    onDeleteConversation: undefined,
  };
};

describe('NewChat component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading spinner while suggestions load', () => {
    const props = {
      ...createBaseProps(),
      suggestionsLoading: true,
    };

    render(<NewChat {...props} />);

    expect(screen.getByText('Loading recent conversations...')).toBeInTheDocument();
  });

  it('renders recent conversations and handles continue click', async () => {
    const hideSuggestions = vi.fn();
    const onContinueConversation = vi.fn();

    const props = {
      ...createBaseProps(),
      hideSuggestions,
      onContinueConversation,
      recentConversations: [
        {
          conversation_id: 'abc-123',
          conversationName: 'Quarterly Planning',
          latestTimestamp: Date.now() - 5 * 60 * 1000,
        },
      ],
    };

    render(<NewChat {...props} />);

    const suggestionButton = screen.getByRole('button', { name: /Quarterly Planning/i });
    fireEvent.click(suggestionButton);

    await waitFor(() => {
      expect(hideSuggestions).toHaveBeenCalledTimes(1);
      expect(onContinueConversation).toHaveBeenCalledWith('abc-123');
    });
  });

  it('invokes rename and delete callbacks when provided', async () => {
    const onRenameConversation = vi.fn().mockResolvedValue(undefined);
    const onDeleteConversation = vi.fn().mockResolvedValue(undefined);

    const props = {
      ...createBaseProps(),
      onRenameConversation,
      onDeleteConversation,
      recentConversations: [
        {
          conversation_id: 'conv-001',
          conversationName: 'Policy Review',
          latestTimestamp: Date.now(),
        },
      ],
    };

    render(<NewChat {...props} />);

    const renameButton = screen.getByLabelText('Rename conversation');
    fireEvent.click(renameButton);

    const deleteButton = screen.getByLabelText('Delete conversation');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(onRenameConversation).toHaveBeenCalledWith('conv-001', 'Policy Review');
      expect(onDeleteConversation).toHaveBeenCalledWith('conv-001');
    });
  });

  it('formats greeting with provided user name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 9, 0, 0));

    const props = {
      ...createBaseProps(),
      userName: 'jane.doe',
    };

    render(<NewChat {...props} />);

    expect(screen.getByText('Good morning, Jane Doe')).toBeInTheDocument();
  });
});
