/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';
import { ChatFileUpload } from '../../Components/Chat/ChatFileUpload';
import { useAuth } from '../../Providers/AuthProvider';

// Mock the required modules and hooks
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

// Mock NumaRequestContext
vi.mock('../../Providers/NumaRequestContext', () => ({
  useNumaRequest: vi.fn(() => ({
    numaPost: vi.fn().mockResolvedValue({
      output_key: 'processed/file.json',
      output_bucket: 'test-bucket',
    }),
  })),
}));

// Mock KnowledgeBaseProvider
vi.mock('../../Providers/KnowledgeBaseProvider', () => ({
  useKnowledgeBase: vi.fn(() => ({
    selectedKB: { kb_id: 'test-kb' },
    selectedKbId: 'test-kb',
  })),
}));

// Mock S3UploadModule to surface a test button that triggers onComplete
const { S3UploadModule } = vi.hoisted(() => ({ S3UploadModule: vi.fn() }));
vi.mock('../../Modules/S3UploadModule', () => ({
  S3UploadModule,
}));

// Stub s3 utils (not used directly here but kept for completeness)
vi.mock('../../utils/s3Utils', () => ({
  fetchFileFromS3: vi.fn(),
  uploadFileToS3: vi.fn(),
}));

// fileProcessing helpers used by ChatFileUpload
const { processFile, isFileProcessingComplete, cleanupFileProcessingTask } = vi.hoisted(() => ({
  processFile: vi.fn(),
  isFileProcessingComplete: vi.fn(),
  cleanupFileProcessingTask: vi.fn(),
}));
vi.mock('../../utils/fileProcessing', () => ({
  processFile,
  isFileProcessingComplete,
  cleanupFileProcessingTask,
}));

type ChatMessage = {
  role: 'assistant' | 'system' | 'user';
  content: React.ReactNode | string;
  status?: string;
  ephemeralId?: number;
};

describe('ChatFileUpload Component', () => {
  const mockOnHide = vi.fn();
  const mockSetMessages = vi.fn<(updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void>();
  const mockRefreshSidebar = vi.fn();
  const mockSetIsFileProcessing = vi.fn();
  const mockEnsureConversationReady = vi.fn<[], Promise<string>>();
  const mockAddMessage = vi.fn();
  const mockAddFileMessage = vi.fn();
  const mockResetInactivityTimer = vi.fn();
  const mockResetNewChatFlag = vi.fn();
  const mockSetPendingAgent = vi.fn();

  const defaultProps = {
    show: true,
    onHide: mockOnHide,
    setMessages: mockSetMessages,
    conversationId: 'test-conversation',
    sub: 'test-user',
    refreshSidebar: mockRefreshSidebar,
    setIsFileProcessing: mockSetIsFileProcessing,
    ensureConversationReady: mockEnsureConversationReady,
    resetInactivityTimer: mockResetInactivityTimer,
    resetUserNewChatFlag: mockResetNewChatFlag,
    pendingAgent: null,
    currentAgent: null,
    setPendingAgent: mockSetPendingAgent,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // process completes immediately in tests
    isFileProcessingComplete.mockReturnValue(true);

    // S3UploadModule mock triggers onComplete with one PDF file
    vi.mocked(S3UploadModule).mockImplementation(({ onComplete }) => (
      <button
        data-testid="upload-button"
        onClick={() =>
          onComplete?.([
            {
              filePath: 'test/path',
              fileName: 'test.pdf',
              fileType: 'application/pdf',
              s3Bucket: 'test-bucket',
              file: new Blob(['test']),
            },
          ])
        }
      >
        Upload Files
      </button>
    ));

    mockEnsureConversationReady.mockResolvedValue('test-conversation');

    // Minimal auth context for ChatFileUpload (no need for decoded_tokens here)
    (useAuth as unknown as vi.Mock).mockReturnValue({
      getCredentials: vi.fn(),
      bedrockRuntimeClient: {},
      numaChatDynamoUtils: {
        addMessage: mockAddMessage,
        addFileMessage: mockAddFileMessage,
        updateMetaItem: vi.fn(),
      },
      numaChatBedrockUtils: {},
      user: { tokens: { idToken: 'test-token' } },
    });

    // Session storage region used deeper by s3 utils (kept for parity)
    window.sessionStorage.clear();
    window.sessionStorage.setItem('REGION', 'us-east-1');

    // processFile resolves with expected shape
    processFile.mockImplementation(
      (fileInfo: { fileType?: string; fileName: string; s3Key: string; s3Bucket: string }) => {
        return Promise.resolve({
          content: 'processed content',
          inferredType: fileInfo.fileType?.includes('pdf')
            ? 'pdf'
            : fileInfo.fileType?.includes('image')
              ? 'jpeg'
              : 'text',
          contentType: fileInfo.fileType,
          fileName: fileInfo.fileName,
          s3Key: fileInfo.s3Key,
          s3Bucket: fileInfo.s3Bucket,
          extractedContentS3Key: `${fileInfo.s3Key}-processed`,
          output_bucket: fileInfo.s3Bucket,
          documentInfo: { title: fileInfo.fileName },
        });
      },
    );
  });

  it('renders modal with upload component and supported file types', () => {
    const { getByTestId, getByRole, getByText } = render(<ChatFileUpload {...defaultProps} />);

    expect(getByRole('dialog')).toBeInTheDocument();
    expect(getByTestId('upload-button')).toBeInTheDocument();
    expect(getByText('Supported File Types:')).toBeInTheDocument();
    expect(getByText('PDF (pdf)')).toBeInTheDocument();
  });

  it('handles file upload process correctly', async () => {
    const { getByTestId } = render(<ChatFileUpload {...defaultProps} />);

    // Modal & trigger present
    expect(getByTestId('upload-modal-body')).toBeInTheDocument();
    expect(getByTestId('upload-button')).toBeInTheDocument();

    // Trigger upload
    fireEvent.click(getByTestId('upload-button'));

    // Processing starts and modal closes
    await waitFor(() => {
      expect(mockSetIsFileProcessing).toHaveBeenCalledWith(true);
      expect(mockOnHide).toHaveBeenCalled();
    });

    // ensureConversationReady is called; first arg must be the preview name ("test.pdf")
    await waitFor(() => {
      expect(mockEnsureConversationReady).toHaveBeenCalled();
      const firstCall = mockEnsureConversationReady.mock.calls[0];
      expect(firstCall?.[0]).toBe('test.pdf');
      // We intentionally do NOT assert about a second argument here, because
      // when there is no active agent, the component passes only one parameter.
    });

    // processFile invoked with correct params
    await waitFor(() => {
      expect(processFile).toHaveBeenCalledWith(
        expect.objectContaining({
          s3Key: 'test/path',
          s3Bucket: 'test-bucket',
          fileName: 'test.pdf',
        }),
        expect.objectContaining({
          user: expect.anything(),
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    // Side-effects: timers/messages/sidebar updates
    await waitFor(() => {
      expect(mockResetInactivityTimer).toHaveBeenCalled();

      // First updater: "Processing..." assistant row
      const updater1 = mockSetMessages.mock.calls[0][0] as (prev: ChatMessage[]) => ChatMessage[];
      const result1 = updater1([]);
      expect(result1[0].role).toBe('assistant');

      // Later, addFileMessage called with proper payload
      expect(mockAddFileMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'test-conversation',
          userId: 'test-user',
          fileName: 'test.pdf',
          fileType: 'application/pdf',
          s3Key: 'test/path',
          s3Bucket: 'test-bucket',
          extractedContentS3Key: expect.any(String),
        }),
      );

      expect(mockSetMessages).toHaveBeenCalled();
      expect(mockRefreshSidebar).toHaveBeenCalled();
    });
  });

  it('handles upload errors gracefully', async () => {
    // Override S3UploadModule for a jpg
    vi.mocked(S3UploadModule).mockImplementation(({ onComplete }) => (
      <button
        data-testid="upload-button"
        onClick={() =>
          onComplete?.([
            {
              filePath: 'test/path',
              fileName: 'test.jpg',
              fileType: 'image/jpeg',
              s3Bucket: 'test-bucket',
              file: new Blob(['test']),
            },
          ])
        }
      >
        Upload Files
      </button>
    ));

    const error = new Error('Upload failed');
    processFile.mockRejectedValueOnce(error);

    const { getByTestId } = render(<ChatFileUpload {...defaultProps} />);

    fireEvent.click(getByTestId('upload-button'));

    // First assistant "Processing..." row is added
    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
      const updater = mockSetMessages.mock.calls[0][0] as (prev: ChatMessage[]) => ChatMessage[];
      const result = updater([]);
      expect(result[0].role).toBe('assistant');
      // Result[0].content is a React node (UploadStatusRow); shallow check:
      expect(result[0].status).toBe('processingFile');
    });

    // Then an error message shows up
    await waitFor(() => {
      expect(mockSetMessages.mock.calls.length).toBeGreaterThan(1);
      const updater = mockSetMessages.mock.calls[1][0] as (prev: ChatMessage[]) => ChatMessage[];
      const result = updater([]);
      expect(result[0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining(`Failed to process "test.jpg": ${error.message}`),
      });
    });
  });

  it('closes modal when onHide is called (close button)', () => {
    const { getByRole } = render(<ChatFileUpload {...defaultProps} />);
    const closeButton = getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(mockOnHide).toHaveBeenCalled();
  });
});
