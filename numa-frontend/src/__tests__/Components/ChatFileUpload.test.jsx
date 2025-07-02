/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ChatFileUpload } from '../../Components/ChatFileUpload';
import { useAuth } from '../../Providers/AuthProvider';

// Mock the required modules and hooks
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

// Add mocks for NumaRequestContext
vi.mock('../../Providers/NumaRequestContext', () => ({
  useNumaRequest: vi.fn(() => ({
    numaPost: vi.fn().mockResolvedValue({
      output_key: 'processed/file.json',
      output_bucket: 'test-bucket',
    }),
  })),
}));

// Add import for S3UploadModule mock
const { S3UploadModule } = vi.hoisted(() => ({ S3UploadModule: vi.fn() }));
vi.mock('../../Modules/S3UploadModule', () => ({
  S3UploadModule,
}));

vi.mock('../../utils/s3Utils', () => ({
  fetchFileFromS3: vi.fn(),
  uploadFileToS3: vi.fn(),
}));

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

describe('ChatFileUpload Component', () => {
  const mockOnHide = vi.fn();
  const mockOnUploadSuccess = vi.fn();
  const mockSetMessages = vi.fn();
  const mockRefreshSidebar = vi.fn();
  const mockSetIsFileProcessing = vi.fn();
  const mockCreateNewConversationIfNeeded = vi.fn();
  const mockAddMessage = vi.fn();
  const mockAddFileMessage = vi.fn();

  const defaultProps = {
    show: true,
    onHide: mockOnHide,
    onUploadSuccess: mockOnUploadSuccess,
    setMessages: mockSetMessages,
    conversationId: 'test-conversation',
    sub: 'test-user',
    refreshSidebar: mockRefreshSidebar,
    setIsFileProcessing: mockSetIsFileProcessing,
    createNewConversationIfNeeded: mockCreateNewConversationIfNeeded,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set default behaviors for mocked functions
    isFileProcessingComplete.mockReturnValue(true);

    // Reset the mock before each test
    vi.mocked(S3UploadModule).mockImplementation(({ onComplete }) => (
      <button
        data-testid="upload-button"
        onClick={() =>
          onComplete([
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

    useAuth.mockReturnValue({
      getCredentials: vi.fn(),
      bedrockRuntimeClient: {},
      numaChatDynamoUtils: {
        addMessage: mockAddMessage,
        addFileMessage: mockAddFileMessage,
      },
      numaChatBedrockUtils: {},
      user: { tokens: { idToken: 'test-token' } },
    });

    // Reset session storage
    window.sessionStorage.clear();
    window.sessionStorage.setItem('REGION', 'us-east-1');

    // Mock processFile to simulate successful processing
    // This matches the actual implementation's parameter structure
    processFile.mockImplementation((fileInfo) => {
      // Return a resolved promise with the processing result
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
    });
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

    // 1. Verify modal is ready
    expect(getByTestId('upload-modal-body')).toBeInTheDocument();
    expect(getByTestId('upload-button')).toBeInTheDocument();

    // 2. Trigger upload
    fireEvent.click(getByTestId('upload-button'));

    // 3. Verify processing starts and modal closes
    await waitFor(() => {
      expect(mockSetIsFileProcessing).toHaveBeenCalledWith(true);
      expect(mockOnHide).toHaveBeenCalled();
    });

    // 4. Verify processFile was called with correct parameters
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

    // 5. Verify successful completion
    await waitFor(() => {
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
    // Override mock for this specific test to match expected jpg file
    vi.mocked(S3UploadModule).mockImplementation(({ onComplete }) => (
      <button
        data-testid="upload-button"
        onClick={() =>
          onComplete([
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

    // First, wait for the processing message
    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
      const updateFunction = mockSetMessages.mock.calls[0][0];
      const result = updateFunction([]);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content.props.text).toBe('Processing 1 file(s)...');
      expect(result[0].content.props.showSpinner).toBe(true);
    });

    // Then, wait for the error message to be set
    await waitFor(() => {
      // Check that setMessages was called at least twice (once for processing, once for error)
      expect(mockSetMessages.mock.calls.length).toBeGreaterThan(1);

      // The second call should contain our error message
      const updateFunction = mockSetMessages.mock.calls[1][0];
      const result = updateFunction([]);

      expect(result[0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining(`Failed to process "test.jpg": ${error.message}`),
      });
    });
  });

  it('closes modal when onHide is called', () => {
    const { getByRole } = render(<ChatFileUpload {...defaultProps} />);

    const closeButton = getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(mockOnHide).toHaveBeenCalled();
  });
});
