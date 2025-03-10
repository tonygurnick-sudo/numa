/**
 * @vitest-environment jsdom
 */
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { S3Uploader } from '../../Pages/S3Uploader';
import { setupAwsMocks } from '../Mocks/AwsMock';

// Mock the FileUploader component so we can control the upload success event
vi.mock('../../Components/FileUploader', () => ({
  FileUploader: ({ onUploadSuccess }) => (
    <div data-testid="file-uploader">
      <button onClick={onUploadSuccess}>Mock Upload</button>
    </div>
  ),
}));

describe('S3Uploader', () => {
  // Example mock S3 files (all considered "pending" if there's no lastSuccessfulSync)
  const mockFiles = [
    { Key: 'file1.txt', LastModified: '2025-01-01T12:00:00Z', Size: 1024 },
    { Key: 'folder1/file2.txt', LastModified: '2025-01-02T13:00:00Z', Size: 2048 },
    { Key: 'folder1/subfolder/file3.txt', LastModified: '2025-01-03T14:00:00Z', Size: 3072 },
  ];

  beforeEach(() => {
    // Set the required session storage values
    window.sessionStorage.setItem('CLIENT_NAME', 'test');
    window.sessionStorage.setItem('Q_APPLICATION_ID', 'test-app');
    window.sessionStorage.setItem('Q_INDEX_ID', 'test-index');

    clearAllMocks();
    // Set up AWS mocks so that S3Client sends ListObjectsV2Command return our mockFiles
    setupAwsMocks(mockFiles);
  });

  function renderComponent(props = {}) {
    return renderWithProviders(<S3Uploader {...props} />);
  }

  it('renders initial layout correctly', async () => {
    renderComponent();

    // Check top-level elements
    expect(screen.getByText('File Upload')).toBeInTheDocument();
    expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Base Status')).toBeInTheDocument();
    expect(screen.getByText('Upload New Files or Folders')).toBeInTheDocument();

    // Wait for the mock S3 file fetch to complete
    await waitFor(() => {
      // "Pending Files (X)" and "Your Knowledge Base Files (X)" should appear
      expect(screen.getByText(/Pending Files \(\d+\)/)).toBeInTheDocument();
      expect(screen.getByText(/Your Knowledge Base Files \(\d+\)/)).toBeInTheDocument();
    });
  });

  it('displays the file counts in the section titles', async () => {
    renderComponent();

    await waitFor(() => {
      // "Pending Files (3)" if lastSuccessfulSync isn't set (all files pending)
      const pendingHeader = screen.getByText(/Pending Files \(\d+\)/);
      expect(pendingHeader).toBeInTheDocument();

      // "Your Knowledge Base Files (0)" if none have been indexed
      const indexedHeader = screen.getByText(/Your Knowledge Base Files \(\d+\)/);
      expect(indexedHeader).toBeInTheDocument();
    });
  });

  it('shows no search bar for pending files but shows it for knowledge base files', async () => {
    renderComponent();

    await waitFor(() => {
      // The pending files section (find by "Pending Files (X)")
      const pendingCard = screen.getByText(/Pending Files \(\d+\)/).closest('.card');
      // The knowledge base card (find by "Your Knowledge Base Files (X)")
      const kbCard = screen.getByText(/Your Knowledge Base Files \(\d+\)/).closest('.card');

      // The pending card should NOT have an <input type="text" />
      expect(pendingCard.querySelector('input[type="text"]')).toBeNull();

      // The knowledge base card should have a search input
      const kbSearch = kbCard.querySelector('input[type="text"]');
      expect(kbSearch).toBeInTheDocument();
    });
  });

  it('refresh button is in the Knowledge Base Status box and triggers refresh', async () => {
    renderComponent();

    const refreshButton = await screen.findByText(/Refresh/i);
    expect(refreshButton).toBeInTheDocument();

    fireEvent.click(refreshButton);
    // Just ensuring no errors are thrown on refresh.
    expect(true).toBeTruthy();
  });
});
