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

// Add import for S3UploadModule mock
const { S3UploadModule } = vi.hoisted(() => ({ S3UploadModule: vi.fn() }));
vi.mock('../../Modules/S3UploadModule', () => ({
  S3UploadModule,
}));

vi.mock('../../utils/s3Utils', () => ({
  fetchFileFromS3: vi.fn(),
  uploadFileToS3: vi.fn(),
}));

const { processFile } = vi.hoisted(() => ({ processFile: vi.fn() }));
vi.mock('../../utils/fileProcessing', () => ({
  processFile,
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
      getIdentityPoolCredentials: vi.fn(),
      bedrockRuntimeClient: {},
      numaChatDynamoUtils: {
        addMessage: mockAddMessage,
        addFileMessage: mockAddFileMessage,
      },
      numaChatBedrockUtils: {},
    });

    // Reset session storage
    window.sessionStorage.clear();
    window.sessionStorage.setItem('REGION', 'us-east-1');
  });

  it('renders modal with upload component and supported file types', () => {
    const { getByTestId, getByRole, getByText } = render(<ChatFileUpload {...defaultProps} />);

    expect(getByRole('dialog')).toBeInTheDocument();
    expect(getByTestId('upload-button')).toBeInTheDocument();
    expect(getByText('Supported File Types:')).toBeInTheDocument();
    expect(getByText('PDF (pdf)')).toBeInTheDocument();
  });

  it('handles file upload process correctly', async () => {
    // Mock successful file processing
    vi.mocked(processFile).mockResolvedValueOnce({
      content: 'processed content',
      inferredType: 'pdf',
      contentType: 'application/pdf',
    });

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

    // 4. Verify successful completion
    await waitFor(() => {
      expect(mockAddFileMessage).toHaveBeenCalledWith({
        conversationId: 'test-conversation',
        userId: 'test-user',
        contentType: 'application/pdf',
        fileName: 'test.pdf',
        fileType: 'pdf',
        s3Bucket: 'test-bucket',
        s3Key: 'test/path',
        extractedContentS3Key: 'test/path-processed.pdf',
      });

      expect(mockSetMessages).toHaveBeenCalled();
      expect(mockRefreshSidebar).toHaveBeenCalled();
      expect(mockSetIsFileProcessing).toHaveBeenCalledWith(false);
    });
  });

  it('creates new conversation if conversationId is not provided', async () => {
    const newConversationId = 'new-conversation';
    mockCreateNewConversationIfNeeded.mockResolvedValueOnce(newConversationId);

    // Mock successful file processing
    vi.mocked(processFile).mockResolvedValueOnce({
      content: 'processed content',
      inferredType: 'pdf',
      contentType: 'application/pdf',
    });

    const propsWithoutConversation = {
      ...defaultProps,
      conversationId: null,
    };

    const { getByTestId } = render(<ChatFileUpload {...propsWithoutConversation} />);

    fireEvent.click(getByTestId('upload-button'));

    await waitFor(() => {
      expect(mockCreateNewConversationIfNeeded).toHaveBeenCalled();
      expect(mockAddFileMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: newConversationId,
        }),
      );
    });
  });

  it('handles image file upload differently', async () => {
    // Override the mock for this specific test
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

    const imageFile = {
      filePath: 'test/path',
      fileName: 'test.jpg',
      fileType: 'image/jpeg',
      s3Bucket: 'test-bucket',
      file: new Blob(['test']),
    };

    // Mock Date.now() to get consistent ephemeralId
    const mockNow = 1741208054292;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);

    // Mock successful image processing
    vi.mocked(processFile).mockResolvedValueOnce({
      content: 'image description',
      inferredType: 'jpeg',
      contentType: 'image/jpeg',
    });

    // Mock numaChatBedrockUtils
    useAuth.mockReturnValue({
      getIdentityPoolCredentials: vi.fn(),
      bedrockRuntimeClient: {},
      numaChatDynamoUtils: {
        addMessage: mockAddMessage,
        addFileMessage: mockAddFileMessage,
      },
      numaChatBedrockUtils: {},
    });

    const { getByTestId } = render(<ChatFileUpload {...defaultProps} />);

    // Trigger the upload
    fireEvent.click(getByTestId('upload-button'));

    // Check ephemeral message is added
    await waitFor(() => {
      const setMessagesCall = mockSetMessages.mock.calls[0][0];
      const result = setMessagesCall([]);
      expect(result).toContainEqual({
        role: 'assistant',
        content: 'Processing file 1/1: test.jpg...',
        status: 'processingFile',
        ephemeralId: mockNow,
      });
    });

    // Check file is processed
    await waitFor(() => {
      expect(processFile).toHaveBeenCalledWith(imageFile.file, 'jpeg', expect.anything());
    });

    // Check final message is added
    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalledWith({
        conversationId: 'test-conversation',
        userId: 'test-user',
        messageType: 'image_description',
        role: 'system',
        content: 'image description',
        fileInfo: {
          fileName: 'test.jpg',
          fileType: 'image/jpeg',
          description: 'image description',
        },
      });
    });

    // Check success message is added
    await waitFor(() => {
      const setMessagesCall = mockSetMessages.mock.calls[mockSetMessages.mock.calls.length - 1][0];
      const result = setMessagesCall([]);
      expect(result).toEqual([
        {
          role: 'assistant',
          content: 'File "test.jpg" uploaded and processed.',
        },
      ]);
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
    vi.mocked(processFile).mockRejectedValueOnce(error);

    const { getByTestId } = render(<ChatFileUpload {...defaultProps} />);

    fireEvent.click(getByTestId('upload-button'));

    // First, wait for the processing message
    await waitFor(() => {
      const setMessagesCall = mockSetMessages.mock.calls[0][0];
      const result = setMessagesCall([]);
      expect(result[0]).toMatchObject({
        role: 'assistant',
        content: 'Processing file 1/1: test.jpg...',
        status: 'processingFile',
      });
    });

    // Then, wait for the error message
    await waitFor(() => {
      const setMessagesCall = mockSetMessages.mock.calls[mockSetMessages.mock.calls.length - 1][0];
      const result = setMessagesCall([]);
      expect(result[0]).toMatchObject({
        role: 'system',
        content: `Error while processing files: ${error.message}`,
      });
      expect(mockSetIsFileProcessing).toHaveBeenCalledWith(false);
    });
  });

  it('closes modal when onHide is called', () => {
    const { getByRole } = render(<ChatFileUpload {...defaultProps} />);

    const closeButton = getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(mockOnHide).toHaveBeenCalled();
  });
});
