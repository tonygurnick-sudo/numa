import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import '@testing-library/jest-dom';
import { ChatFileUpload } from '../../Components/ChatFileUpload';

describe('ChatFileUpload Component', () => {
  const mockOnHide = vi.fn();
  const mockOnUploadSuccess = vi.fn();
  const defaultProps = {
    show: true,
    onHide: mockOnHide,
    onUploadSuccess: mockOnUploadSuccess,
  };

  // Mock FileReader
  let currentFileReaderInstance;
  const createMockFileReader = () => ({
    onload: null,
    onerror: null,
    readAsText: vi.fn(function () {
      currentFileReaderInstance = this;
      // Store the current instance for async completion
      setTimeout(() => {
        this.result = 'test content';
        this.onload();
      }, 0);
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the FileReader constructor to create new instance each time
    global.FileReader = vi.fn(() => createMockFileReader());
    // Mock btoa for base64 encoding
    global.btoa = vi.fn((str) => Buffer.from(str).toString('base64'));
  });

  it('renders upload modal correctly', () => {
    render(<ChatFileUpload {...defaultProps} />);
    expect(screen.getByText('Upload Files for Chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('validates file size', async () => {
    render(<ChatFileUpload {...defaultProps} />);
    const input = screen.getByTestId('file-input');

    // Create a mock file that exceeds size limit (11MB)
    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(screen.getByText(/File size exceeds 10MB limit/)).toBeInTheDocument();
    });
  });

  it('validates file type', async () => {
    render(<ChatFileUpload {...defaultProps} />);
    const input = screen.getByTestId('file-input');

    // Create a mock file with unsupported extension
    const invalidFile = new File(['test content'], 'test.xyz', { type: 'application/xyz' });

    fireEvent.change(input, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(screen.getByText(/Invalid file type/)).toBeInTheDocument();
    });
  });

  it('handles valid file upload', async () => {
    render(<ChatFileUpload {...defaultProps} />);
    const input = screen.getByTestId('file-input');

    // Create a valid text file
    const validFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [validFile] } });

    // Click upload button
    const uploadButton = screen.getByRole('button', { name: 'Upload' });
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(mockOnUploadSuccess).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'test.txt',
            type: 'text/plain',
            data: expect.any(String), // base64 encoded content
          }),
        ]),
      );
      expect(mockOnHide).toHaveBeenCalled();
    });
  });

  it('allows removing selected files', async () => {
    render(<ChatFileUpload {...defaultProps} />);
    const input = screen.getByTestId('file-input');

    // Add a file
    const validFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [validFile] } });

    // Wait for file to be listed
    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });

    // Click remove button
    const removeButton = screen.getByTestId('remove-file-test.txt');
    fireEvent.click(removeButton);

    // Verify file is removed
    expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
  });

  it('handles multiple file upload', async () => {
    render(<ChatFileUpload {...defaultProps} />);
    const input = screen.getByTestId('file-input');

    // Create multiple valid files
    const file1 = new File(['content 1'], 'test1.txt', { type: 'text/plain' });
    const file2 = new File(['content 2'], 'test2.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file1, file2] } });

    // Click upload button
    const uploadButton = screen.getByRole('button', { name: 'Upload' });
    fireEvent.click(uploadButton);

    // Wait for first file to be processed
    await waitFor(() => {
      expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockOnUploadSuccess).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'test1.txt',
            type: 'text/plain',
            data: expect.any(String),
          }),
          expect.objectContaining({
            name: 'test2.pdf',
            type: 'application/pdf',
            data: expect.any(String),
          }),
        ]),
      );
    });
  });
});
