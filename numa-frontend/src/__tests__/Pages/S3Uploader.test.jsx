/**
 * @vitest-environment jsdom
 */
import { setupAwsMocks } from '../Mocks/AwsMock';
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import axios from 'axios';
import { S3Uploader } from '../../Pages/S3Uploader';

// Mock FileUploader component
vi.mock('../../Components/FileUploader', () => ({
  FileUploader: ({ onUploadSuccess }) => (
    <div data-testid="file-uploader">
      <button onClick={onUploadSuccess}>Mock Upload</button>
    </div>
  ),
}));

describe('S3Uploader', () => {
  const mockFiles = [
    { key: 'file1.txt', lastModified: '2024-01-01', size: 1024 },
    { key: 'folder1/file2.txt', lastModified: '2024-01-02', size: 2048 },
    {
      key: 'folder1/subfolder/file3.txt',
      lastModified: '2024-01-03',
      size: 3072,
    },
  ];

  beforeEach(() => {
    clearAllMocks();
    setupAwsMocks();

    // Mock axios
    vi.mock('axios');
    axios.get.mockResolvedValue({ data: { files: mockFiles } });
  });

  const renderComponent = (props = {}) => {
    return renderWithProviders(<S3Uploader {...props} />);
  };

  it('should render initial layout correctly', () => {
    renderComponent();

    expect(screen.getByText('File Upload')).toBeInTheDocument();
    expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base Status')).toBeInTheDocument();
  });

  it('should display files and folders correctly', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeInTheDocument();
      expect(screen.getByText('folder1')).toBeInTheDocument();
    });

    // Test folder expansion
    const folder = screen.getByText('folder1');
    fireEvent.click(folder);

    await waitFor(() => {
      expect(screen.getByText('file2.txt')).toBeInTheDocument();
      expect(screen.getByText('subfolder')).toBeInTheDocument();
    });
  });

  it('should display sync status correctly', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText('Status:')).toBeInTheDocument();
      expect(screen.getByTestId('sync-button')).toBeInTheDocument();
    });
  });

  it('should handle sync modal interactions', async () => {
    renderComponent();

    const syncButton = screen.getByTestId('sync-button');
    fireEvent.click(syncButton);

    expect(screen.getByText('Start Knowledge Base Sync')).toBeInTheDocument();

    const startSyncButton = screen.getByText('Start Sync');
    fireEvent.click(startSyncButton);

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('should refresh file list after successful upload', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('file1.txt')).toBeInTheDocument();
    });

    const newFiles = [
      ...mockFiles,
      { key: 'newfile.txt', lastModified: '2024-01-04', size: 4096 },
    ];
    axios.get.mockResolvedValueOnce({ data: { files: newFiles } });

    const mockUploadButton = screen.getByText('Mock Upload');
    fireEvent.click(mockUploadButton);

    await waitFor(() => {
      expect(screen.getByText('newfile.txt')).toBeInTheDocument();
    });
  });

  it('should show loading state while fetching files', async () => {
    axios.get.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    renderComponent();

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    axios.get.mockRejectedValue(new Error('API Error'));

    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText('No files in knowledge base'),
      ).toBeInTheDocument();
    });

    consoleError.mockRestore();
  });

  it('should handle folder collapse and expand correctly', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('folder1')).toBeInTheDocument();
    });

    // First click to expand
    fireEvent.click(screen.getByText('folder1'));

    // Wait for initial expanded state
    await waitFor(() => {
      const folderContent = screen
        .getByText('file2.txt')
        .closest('.folder-content');
      expect(folderContent).toHaveClass('folder-content-expanded');
    });

    // Click to collapse
    fireEvent.click(screen.getByText('folder1'));

    // Wait for folder content to be collapsed
    await waitFor(() => {
      const folderContent = screen
        .getByText('file2.txt')
        .closest('.folder-content');
      expect(folderContent).toHaveClass('folder-content-collapsed');
    });

    // Click to expand again
    fireEvent.click(screen.getByText('folder1'));

    // Wait for folder content to be expanded
    await waitFor(() => {
      const folderContent = screen
        .getByText('file2.txt')
        .closest('.folder-content');
      expect(folderContent).toHaveClass('folder-content-expanded');
    });
  });
});
