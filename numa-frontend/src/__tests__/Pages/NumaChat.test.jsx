/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { MockBreadcrumbs, MockLayoutDashboard } from '../Mocks/ComponentMock';
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';
import { MockAwsClient } from '../Mocks/AwsClientMocks';

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumaChat } from '../../Pages/NumaChat';
import { authHandlers } from '../Mocks/AuthMock';

const { qBusinessClient: mockQBusinessClient } = authHandlers;

const renderChat = () => {
  return renderWithProviders(<NumaChat />);
};

describe('NumaChat Component', () => {
  beforeEach(() => {
    clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  /**
   * Verifies that the basic UI components are rendered
   */
  it('should render initial layout correctly', () => {
    // Render the NumaChat component
    renderChat();

    // Check that the title is present
    expect(screen.getByText('Numa Chat')).toBeInTheDocument();

    // Verify all mock components are rendered
    expect(screen.getByTestId('mock-nav')).toBeInTheDocument();
    expect(screen.getByTestId('mock-breadcrumbs')).toBeInTheDocument();
    expect(
      screen.getByTestId('mock-layout-dashboard-outer'),
    ).toBeInTheDocument();

    // Verify welcome message is displayed
    expect(
      screen.getByText(
        'Chat with your documents using Amazon Q Business. Ask anything!',
      ),
    ).toBeInTheDocument();
  });

  /**
   * Tests that existing conversations are loaded when the component mounts
   */
  it('should load conversations on mount', async () => {
    // Create mock conversation data
    const mockConversations = [
      {
        conversationId: '1',
        title: 'Test Chat 1',
        startTime: new Date().toISOString(),
      },
    ];

    // Mock the API response to return our test conversation
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversations: mockConversations,
    });

    // Render the component
    renderChat();

    // Wait for and verify the conversation appears in the sidebar
    await waitFor(() => {
      expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
    });
  });

  /**
   * Tests the message sending flow
   */
  it('should handle sending a new message', async () => {
    // Mock API responses:
    // 1. Empty conversations list
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    // 2. AI response to our message
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversationId: 'new-conv-id',
      systemMessage: 'AI response',
      systemMessageId: 'msg-1',
    });

    // Render the chat component
    renderChat();

    // Get the input field and send button
    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    // Type and send a message
    fireEvent.change(input, { target: { value: 'Hello AI' } });
    fireEvent.click(sendButton);

    // Wait for and verify both messages appear in the chat
    await waitFor(() => {
      // Find user message by its container and content
      const userMessage = screen.getByText((content, element) => {
        return (
          element.classList.contains('message') &&
          element.classList.contains('user') &&
          element.textContent.includes('Hello AI')
        );
      });
      // Find AI response by its container and content
      const aiMessage = screen.getByText((content, element) => {
        return (
          element.classList.contains('message') &&
          element.classList.contains('assistant') &&
          element.textContent.includes('AI response')
        );
      });

      // Verify both messages are displayed
      expect(userMessage).toBeInTheDocument();
      expect(aiMessage).toBeInTheDocument();
    });
  });

  /**
   * Tests error handling during message sending
   */
  it('should handle errors when sending messages', async () => {
    // Mock API responses:
    // 1. Empty conversations list
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    // 2. Simulate API error
    mockQBusinessClient.send.mockRejectedValueOnce(new Error('API Error'));

    // Render the chat component
    renderChat();

    // Get the input field and send button
    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    // Type and send a message
    fireEvent.change(input, { target: { value: 'Hello AI' } });
    fireEvent.click(sendButton);

    // Wait for and verify error message is displayed
    await waitFor(() => {
      expect(
        screen.getByText('Failed to send message. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  /**
   * Tests the "New Chat" functionality
   */
  it('should handle new chat creation', async () => {
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });

    renderChat();

    const newChatButton = screen.getByText('New Chat');

    // Add a message first
    const input = screen.getByPlaceholderText('Type your message here...');
    const form = screen.getByTestId('chat-form');

    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.submit(form);

    // Click new chat to clear messages
    fireEvent.click(newChatButton);

    await waitFor(() => {
      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    });
  });

  /**
   * Tests loading an existing conversation
   */
  it('should handle conversation selection', async () => {
    const mockConversations = [
      {
        conversationId: '1',
        title: 'Test Chat 1',
        startTime: new Date().toISOString(),
      },
    ];

    const mockMessages = {
      messages: [
        {
          role: 'USER',
          content: 'Hello',
          messageId: 'msg-1',
        },
        {
          role: 'ASSISTANT',
          content: 'Hi there',
          messageId: 'msg-2',
        },
      ],
    };

    mockQBusinessClient.send
      .mockResolvedValueOnce({ conversations: mockConversations })
      .mockResolvedValueOnce(mockMessages);

    renderChat();

    await waitFor(() => {
      expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Chat 1'));

    await waitFor(() => {
      // Find messages by their container and content
      const userMessage = screen.getByText((content, element) => {
        return (
          element.classList.contains('message') &&
          element.classList.contains('user') &&
          element.textContent.includes('Hello')
        );
      });
      const aiMessage = screen.getByText((content, element) => {
        return (
          element.classList.contains('message') &&
          element.classList.contains('assistant') &&
          element.textContent.includes('Hi there')
        );
      });

      expect(userMessage).toBeInTheDocument();
      expect(aiMessage).toBeInTheDocument();
    });
  });
});

describe('NumaChat Mobile Component', () => {
  beforeEach(() => {
    clearAllMocks();
    mockQBusinessClient.send.mockReset();

    // Set viewport to mobile width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500, // Mobile width
    });

    // Trigger resize event
    global.dispatchEvent(new Event('resize'));
  });

  /**
   * Verifies that conversations sidebar starts hidden on mobile
   */
  it('should start with conversations hidden on mobile', () => {
    renderChat();

    const sidebar = screen.getByTestId('sidebar-wrapper');
    expect(sidebar).toHaveClass('closed');
  });

  /**
   * Tests the mobile sidebar toggle functionality
   */
  it('should toggle conversation sidebar when chevron clicked', () => {
    renderChat();

    const sidebar = screen.getByTestId('sidebar-wrapper');
    const toggleButton = screen.getByLabelText('Show conversations');

    // Initially closed
    expect(sidebar).toHaveClass('closed');

    // Open sidebar
    fireEvent.click(toggleButton);
    expect(sidebar).toHaveClass('open');

    // Close sidebar
    fireEvent.click(toggleButton);
    expect(sidebar).toHaveClass('closed');
  });

  /**
   * Tests that selecting a conversation on mobile
   */
  it('should auto-hide conversations after selection on mobile', async () => {
    const mockConversations = [
      {
        conversationId: '1',
        title: 'Test Chat 1',
        startTime: new Date().toISOString(),
      },
    ];

    mockQBusinessClient.send
      .mockResolvedValueOnce({ conversations: mockConversations })
      .mockResolvedValueOnce({ messages: [] });

    renderChat();

    // Open sidebar
    const toggleButton = screen.getByLabelText('Show conversations');
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
    });

    // Select conversation
    fireEvent.click(screen.getByText('Test Chat 1'));

    // Verify sidebar is hidden
    const sidebar = screen.getByTestId('sidebar-wrapper');
    expect(sidebar).toHaveClass('closed');
  });

  /**
   * Verifies mobile-specific textarea properties
   */
  it('should use mobile-specific textarea rows', () => {
    renderChat();

    const textarea = screen.getByPlaceholderText('Type your message here...');
    expect(textarea).toHaveAttribute('rows', '2'); // Mobile uses 2 rows instead of 3
  });

  /**
   * Verifies mobile-specific button layout
   */
  it('should stack buttons vertically on mobile', () => {
    renderChat();

    const buttonContainer = screen.getByTestId('button-container');
    expect(buttonContainer).toHaveClass('flex-column');

    const buttons = buttonContainer.querySelectorAll('button');
    buttons.forEach((button) => {
      expect(button).toHaveClass('w-100');
    });
  });
});

describe('NumaChat Source Attributions', () => {
  /**
   * Tests source attribution rendering
   */
  it('should render source attributions for AI messages', async () => {
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversationId: 'new-conv-id',
      systemMessage: 'Response with sources',
      systemMessageId: 'msg-1',
      sourceAttributions: [
        {
          title: 'Source Document 1',
          url: 'https://example.com/doc1',
        },
        {
          title: 'Source Document 2',
          // No URL for this source
        },
      ],
    });

    renderChat();

    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    fireEvent.change(input, { target: { value: 'Tell me about sources' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      // Check for sources header
      expect(screen.getByText('Sources:')).toBeInTheDocument();

      // Check for numbered sources
      expect(
        screen.getByText((content, element) => {
          return element.textContent === '1. Source Document 1 (link)';
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText((content, element) => {
          return element.textContent === '2. Source Document 2';
        }),
      ).toBeInTheDocument();

      // Check for link
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', 'https://example.com/doc1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  /**
   * Verifies that source section is hidden when no sources exist
   */
  it('should not render source attributions when none are provided', async () => {
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversationId: 'new-conv-id',
      systemMessage: 'Response without sources',
      systemMessageId: 'msg-1',
      sourceAttributions: [], // Empty sources
    });

    renderChat();

    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    fireEvent.change(input, { target: { value: 'Tell me something' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.queryByText('Sources:')).not.toBeInTheDocument();
    });
  });

  /**
   * Tests handling of missing source attribution field in response
   */
  it('should handle missing sourceAttributions field', async () => {
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversationId: 'new-conv-id',
      systemMessage: 'Response without source field',
      systemMessageId: 'msg-1',
      // sourceAttributions field omitted entirely
    });

    renderChat();

    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    fireEvent.change(input, { target: { value: 'Tell me something' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.queryByText('Sources:')).not.toBeInTheDocument();
    });
  });
});

describe('NumaChat Responsive Behavior', () => {
  beforeEach(() => {
    clearAllMocks();
    mockQBusinessClient.send.mockReset();

    // Start with desktop width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
    global.dispatchEvent(new Event('resize'));
  });

  /**
   * Tests responsive layout changes
   */
  it('should adapt layout when transitioning from desktop to mobile', async () => {
    renderChat();

    // Verify desktop layout
    const sidebar = screen.getByTestId('sidebar-wrapper');
    const buttonContainer = screen.getByTestId('button-container');
    const textarea = screen.getByPlaceholderText('Type your message here...');

    // Check desktop state
    expect(sidebar).toHaveClass('open');
    expect(buttonContainer).not.toHaveClass('flex-column');
    expect(textarea).toHaveAttribute('rows', '3');

    // Change to mobile width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500,
    });
    global.dispatchEvent(new Event('resize'));

    // Check mobile state
    await waitFor(() => {
      expect(sidebar).toHaveClass('closed');
      expect(buttonContainer).toHaveClass('flex-column');
      expect(textarea).toHaveAttribute('rows', '2');

      // Check button styling
      const buttons = buttonContainer.querySelectorAll('button');
      buttons.forEach((button) => {
        expect(button).toHaveClass('w-100');
      });
    });

    // Verify mobile sidebar toggle works
    const toggleButton = screen.getByLabelText('Show conversations');
    fireEvent.click(toggleButton);
    expect(sidebar).toHaveClass('open');

    fireEvent.click(toggleButton);
    expect(sidebar).toHaveClass('closed');
  });

  /**
   * Verifies chat state persistence during viewport changes
   */
  it('should maintain chat state during viewport transitions', async () => {
    mockQBusinessClient.send.mockResolvedValueOnce({ conversations: [] });
    mockQBusinessClient.send.mockResolvedValueOnce({
      conversationId: 'new-conv-id',
      systemMessage: 'Test response',
      systemMessageId: 'msg-1',
    });

    renderChat();

    // Add a message in desktop view
    const input = screen.getByPlaceholderText('Type your message here...');
    const sendButton = screen.getByText('Send Message');

    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(
        screen.getByText((content, element) => {
          return (
            element.classList.contains('message') &&
            element.classList.contains('user') &&
            element.textContent.includes('Test message')
          );
        }),
      ).toBeInTheDocument();
    });

    // Change to mobile width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500,
    });
    global.dispatchEvent(new Event('resize'));

    // Verify messages are still present
    await waitFor(() => {
      expect(
        screen.getByText((content, element) => {
          return (
            element.classList.contains('message') &&
            element.classList.contains('user') &&
            element.textContent.includes('Test message')
          );
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText((content, element) => {
          return (
            element.classList.contains('message') &&
            element.classList.contains('assistant') &&
            element.textContent.includes('Test response')
          );
        }),
      ).toBeInTheDocument();
    });
  });
});
