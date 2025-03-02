/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { renderWithProviders } from '../Mocks/ProviderWrapper';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3UploadModule } from '../../Modules/S3UploadModule';

describe('S3UploadModule Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ CLIENT_NAME: 'test-client', REGION: 'us-east-1' }),
      }),
    );
  });

  it('should accept valid file types', async () => {
    renderWithProviders(<S3UploadModule />);

    const fileInput = screen.getByTestId('file-upload-input');

    const validFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, {
      target: { files: [validFile] },
    });

    await waitFor(() => {
      expect(screen.queryByText('Invalid file type')).not.toBeInTheDocument();
    });
  });

  it('should reject invalid file types', async () => {
    const task = {
      parameters: {
        allowedFileTypes: ['application/pdf'],
      },
    };
    renderWithProviders(<S3UploadModule task={task} />);

    const fileInput = screen.getByTestId('file-upload-input');
    const invalidFile = new File(['test content'], 'test.exe', { type: 'application/x-msdownload' });

    fireEvent.change(fileInput, {
      target: { files: [invalidFile] },
    });

    await waitFor(() => {
      expect(
        screen.getByText(`${invalidFile.name}: Invalid file type. Accepted types: application/pdf`),
      ).toBeInTheDocument();
    });
  });

  it('should handle single file upload', async () => {
    renderWithProviders(<S3UploadModule />);

    const fileInput = screen.getByTestId('file-upload-input');

    const validFile = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, {
      target: { files: [validFile] },
    });

    await waitFor(() => {
      expect(
        screen.getByText((content, element) => {
          return element.tagName.toLowerCase() === 'li' && content.includes(validFile.name);
        }),
      ).toBeInTheDocument();
    });
  });

  it('should show error for files exceeding size limit', async () => {
    const task = {
      parameters: {
        maximumFileSize: 10, // 10 MB
      },
    };
    renderWithProviders(<S3UploadModule task={task} />);

    const fileInput = screen.getByTestId('file-upload-input');

    // Create a mock file that exceeds the size limit (10MB = 10 * 1024 * 1024 bytes)
    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, {
      target: { files: [largeFile] },
    });

    await waitFor(() => {
      expect(
        screen.getByText(`${largeFile.name}: File is too large. Maximum size allowed is 10.00 MB`),
      ).toBeInTheDocument();
    });
  });

  it('should handle multiple file uploads', async () => {
    const mockOnComplete = vi.fn();
    const mockOnNotComplete = vi.fn();
    const mockOnChange = vi.fn();

    renderWithProviders(
      <S3UploadModule onComplete={mockOnComplete} onNotComplete={mockOnNotComplete} onChange={mockOnChange} />,
    );

    const fileInput = screen.getByTestId('file-upload-input');

    const validFiles = [
      new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
      new File(['content2'], 'test2.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      new File(['content3'], 'test3.txt', { type: 'text/plain' }),
    ];

    fireEvent.change(fileInput, {
      target: { files: validFiles },
    });

    await waitFor(() => {
      validFiles.forEach((file) => {
        expect(screen.getByText(file.name)).toBeInTheDocument();
      });
    });

    expect(mockOnNotComplete).toHaveBeenCalled();
  });
});
