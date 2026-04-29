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
        })
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
  listFoldersInKB: vi.fn().mockResolvedValue(['folder1', 'folder2']),
}));

// Mock document converter service to force client-side fallback
vi.mock('../../Services/documentConverterService', () => ({
  downloadPdf: vi.fn().mockRejectedValue(new Error('mock server failure')),
  downloadDocx: vi.fn().mockRejectedValue(new Error('mock server failure')),
}));

// Mock knowledgeBaseService to return test KBs
vi.mock('../../Services/knowledgeBaseService', () => ({
  knowledgeBaseService: {
    listUserKBs: vi.fn().mockResolvedValue([
      { kb_id: 'company', kb_name: 'Company Knowledge Base', role: 'VIEWER' },
      { kb_id: 'user-kb-123', kb_name: 'My Personal KB', role: 'OWNER' },
      { kb_id: 'shared-kb-456', kb_name: 'Shared Team KB', role: 'EDITOR' },
    ]),
    getKnowledgeBase: vi.fn().mockResolvedValue(null),
    createKnowledgeBase: vi.fn().mockResolvedValue(null),
    updateKnowledgeBase: vi.fn().mockResolvedValue(null),
    deleteKnowledgeBase: vi.fn().mockResolvedValue(null),
  },
  UserKB: {},
}));

// Mock KnowledgeBaseProvider — the provider now uses numaGet('/api/kb') instead
// of knowledgeBaseService.listUserKBs, so we mock the provider directly.
vi.mock('../../Providers/KnowledgeBaseProvider', () => ({
  KnowledgeBaseProvider: ({ children }) => children,
  useKnowledgeBase: () => ({
    availableKBs: [
      { kb_id: 'company', kb_name: 'Company Knowledge Base', role: 'VIEWER' },
      { kb_id: 'user-kb-123', kb_name: 'My Personal KB', role: 'OWNER' },
      { kb_id: 'shared-kb-456', kb_name: 'Shared Team KB', role: 'EDITOR' },
    ],
    isLoadingKBs: false,
    selectedKB: null,
    selectedKbId: null,
    setSelectedKB: vi.fn(),
    kbError: null,
    refreshKBs: vi.fn().mockResolvedValue(undefined),
    selectKBById: vi.fn(),
    fetchKBDetails: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('ResultActions Component', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    clearAuthMocks();

    // Mock localStorage with idToken so KnowledgeBaseProvider can load
    const localStorageData: Record<string, string> = {
      idToken: 'mock-id-token',
    };
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key) => localStorageData[key] || null),
        setItem: vi.fn((key, value) => {
          localStorageData[key] = value;
        }),
        removeItem: vi.fn((key) => {
          delete localStorageData[key];
        }),
        clear: vi.fn(),
      },
      writable: true,
    });

    // Some tests rely on sessionStorage items
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          if (key === 'CLIENT_NAME') return 'testclient';
          if (key === 'REGION') return 'us-east-1';
          if (key === 'DATA_BUCKET') return 'test-data-bucket';
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
    });
  });

  it('renders without crashing and shows all dropdowns', async () => {
    renderWithProviders(<ResultActions content="Some test content" title="Test Title" />);

    // Check for "Download" dropdown
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();

    // Check for "Share" dropdown
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();

    // Check for "Add to folder" dropdown (post Numa Files rebrand)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to folder/i })).toBeInTheDocument();
    });
  });

  it('shows folder dropdown options when clicked', async () => {
    renderWithProviders(<ResultActions content="Some test content" title="Test Title" />);

    // Wait for the folder dropdown to be available
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to folder/i })).toBeInTheDocument();
    });

    // Click the folder dropdown
    fireEvent.click(screen.getByRole('button', { name: /add to folder/i }));

    // Check that user KBs with OWNER/EDITOR role are shown
    await waitFor(() => {
      expect(screen.getByText(/my personal kb/i)).toBeInTheDocument();
      expect(screen.getByText(/shared team kb/i)).toBeInTheDocument();
    });
  });

  it('opens modal when a KB is selected', async () => {
    renderWithProviders(<ResultActions content="Test content" title="Test Doc" />);

    // Wait for the KB dropdown to be available
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to folder/i })).toBeInTheDocument();
    });

    // Click the KB dropdown
    fireEvent.click(screen.getByRole('button', { name: /add to folder/i }));

    // Wait for dropdown items and click one
    await waitFor(() => {
      expect(screen.getByText(/my personal kb/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/my personal kb/i));

    // Check that modal shows with the selected KB name (using getAllByText since it appears multiple times)
    await waitFor(() => {
      // Modal should be visible with the selected KB name
      const kbNameElements = screen.getAllByText(/my personal kb/i);
      expect(kbNameElements.length).toBeGreaterThan(0);
    });
  });

  it('handles "Download -> PDF" correctly', async () => {
    const { saveAs } = await import('file-saver');
    const { downloadPdf } = await import('../../Services/documentConverterService');

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
    expect(downloadPdf).toHaveBeenCalledTimes(1);
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
