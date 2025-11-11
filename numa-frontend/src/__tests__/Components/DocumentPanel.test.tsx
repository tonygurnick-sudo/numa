/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { DocumentPanel } from '../../Components/DocumentPanel';

// Mock useAuth so that any component calling it (e.g. inside ResultActions) doesn't throw an error.
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getCredentials: vi.fn(),
  }),
}));

// Mock MarkdownContent to simply render its content in a div with a test id.
vi.mock('../../Components/Renderers/MarkdownContent', () => ({
  MarkdownContent: ({ content }) => <div data-testid="markdown-content">{content}</div>,
}));

// Mock ResultActions to render a div that shows the document title.
vi.mock('../../Components/ResultActions', () => ({
  ResultActions: ({ title }) => <div data-testid="result-actions">Actions for {title}</div>,
}));

describe('DocumentPanel Component', () => {
  it('renders "No Document" view when documentContent is not provided', () => {
    const onClose = vi.fn();
    render(<DocumentPanel documentContent={null} onClose={onClose} />);

    // Verify that the "No Document" title and fallback message are rendered.
    expect(screen.getByText('No Document')).toBeInTheDocument();
    expect(screen.getByText('No document to display.')).toBeInTheDocument();

    // Check that the close button exists and clicking it calls onClose.
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders document view when documentContent is provided', () => {
    const onClose = vi.fn();
    const documentContent = {
      title: 'Test Document',
      content: 'This is test content.',
    };

    render(<DocumentPanel documentContent={documentContent} onClose={onClose} />);

    // Verify that the header displays the provided document title.
    expect(screen.getByText('Test Document')).toBeInTheDocument();

    // Verify that the close button exists.
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    // Verify that the MarkdownContent renders the provided content.
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('This is test content.');

    // Verify that the ResultActions component is rendered with the correct title.
    expect(screen.getByTestId('result-actions')).toHaveTextContent('Actions for Test Document');
  });

  it('calls onClose when close button is clicked in document view', () => {
    const onClose = vi.fn();
    const documentContent = {
      title: 'Sample Document',
      content: 'Sample content.',
    };

    render(<DocumentPanel documentContent={documentContent} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});
