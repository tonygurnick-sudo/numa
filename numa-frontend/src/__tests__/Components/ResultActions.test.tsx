/**
 * @vitest-environment jsdom
 */

// 1) Import mocks first if needed
import { clearAuthMocks } from '../Mocks/AuthMockHandlers';
import { renderWithProviders } from '../Mocks/ProviderWrapper';

// 2) Standard imports
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// 3) Import the component to test
import { ResultActions } from '../../Components/ResultActions';

// 4) Mock out file-saver (saveAs), jsPDF, docx, and any other external libraries as needed
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

// Mock jsPDF which is used for PDF generation
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({
    internal: {
      pageSize: {
        getWidth: vi.fn().mockReturnValue(210), // A4 width in mm
        getHeight: vi.fn().mockReturnValue(297), // A4 height in mm
      },
    },
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    setFillColor: vi.fn(),
    text: vi.fn(),
    splitTextToSize: vi.fn().mockReturnValue(['mocked text line']),
    getTextWidth: vi.fn().mockReturnValue(50),
    line: vi.fn(),
    rect: vi.fn(),
    addPage: vi.fn(),
    setPage: vi.fn(),
    getNumberOfPages: vi.fn().mockReturnValue(1),
    output: vi.fn().mockReturnValue(new Blob(['PDF content'], { type: 'application/pdf' })),
  })),
}));

// Mock docx to avoid actual file creation in tests
vi.mock('docx', () => {
  return {
    Document: vi.fn().mockImplementation(() => ({})),
    Packer: {
      toBlob: vi.fn().mockResolvedValue(
        new Blob(['DOCX content'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    },
    Paragraph: vi.fn(),
    HeadingLevel: {
      HEADING_1: 'Heading1',
      HEADING_2: 'Heading2',
      HEADING_3: 'Heading3',
    },
  };
});

// Mock your S3 uploader if necessary
vi.mock('../../utils/s3Utils', () => ({
  uploadFileToS3: vi.fn().mockResolvedValue('mock-file-name.pdf'),
}));

describe('ResultActions Component', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    clearAuthMocks();

    // Some tests rely on sessionStorage items
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'CLIENT_NAME') return 'testclient';
          if (key === 'REGION') return 'us-east-1';
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
    });
  });

  it('renders without crashing and shows all dropdowns', () => {
    renderWithProviders(<ResultActions content="Some test content" title="Test Title" />);

    // Check for "Download" dropdown
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();

    // Check for "Share" dropdown
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();

    // Check for single "Add to Company Knowledge" button
    expect(screen.getByRole('button', { name: /add to company knowledge/i })).toBeInTheDocument();
  });

  it('handles "Download -> PDF" correctly', async () => {
    const { saveAs } = await import('file-saver');

    renderWithProviders(<ResultActions content="**Bold** text" title="My PDF Title" />);

    // Click "Download"
    const downloadButton = screen.getByRole('button', { name: /download/i });
    fireEvent.click(downloadButton);

    // Click "PDF" in dropdown
    const pdfOption = screen.getByText(/pdf/i);
    fireEvent.click(pdfOption);

    // html2pdf mock returns a Blob, so check if saveAs is called
    await waitFor(() => {
      expect(saveAs).toHaveBeenCalledTimes(1);
    });
    expect(saveAs.mock.calls[0][1]).toBe('My PDF Title.pdf');
  });

  it('handles "Share -> Email" correctly', async () => {
    // We can mock window.open to see if a mailto link is used
    const mockOpen = vi.fn();
    // Keep a reference to the real window.open
    const realOpen = window.open;
    window.open = mockOpen;

    renderWithProviders(<ResultActions content="Hello from test" title="ShareTitle" />);

    // Open share dropdown
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    // Click "Email"
    fireEvent.click(screen.getByText(/email/i));

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });
    const mailtoUrl = mockOpen.mock.calls[0][0];
    expect(mailtoUrl).toContain('mailto:?subject=ShareTitle&body=Hello%20from%20test');

    // Restore real window.open
    window.open = realOpen;
  });

  it('handles "Share -> Copy to Clipboard" correctly', async () => {
    // We can mock navigator.clipboard
    const writeTextMock = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      writable: true,
    });

    renderWithProviders(<ResultActions content="<b>Copy me</b>" title="CopyTitle" />);

    // Open share dropdown
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    // Click "Copy to Clipboard"
    fireEvent.click(screen.getByText(/copy to clipboard/i));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('Copy me'); // HTML tags removed
    });
  });

  it('handles "Print" correctly by opening a new window with content', async () => {
    const mockOpen = vi.fn(() => ({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
    }));
    const realOpen = window.open;
    window.open = mockOpen;

    renderWithProviders(<ResultActions content="**Markdown** content" title="PrintTest" />);

    // Open "Share" dropdown
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    // Click "Print"
    fireEvent.click(screen.getByText(/print/i));

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });

    window.open = realOpen;
  });
});
