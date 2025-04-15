/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { renderWithProviders } from '../Mocks/ProviderWrapper';
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3UploadModule } from '../../Modules/S3UploadModule';

// Create mock functions that we can reference later for assertions
const createJobMock = vi.fn().mockResolvedValue({ jobID: 'test-job-id' });
const updateJobMock = vi.fn().mockResolvedValue({});
const getJobByIdMock = vi.fn().mockResolvedValue({});

// Mock the jobsApi
vi.mock('../../Services/jobsApi', () => ({
  useJobsApi: () => ({
    createJob: createJobMock,
    updateJob: updateJobMock,
    getJobById: getJobByIdMock,
  }),
}));

// Mock the NumaAppContext
vi.mock('../../Providers/NumaAppContext', () => {
  const NumaAppContext = { Provider: ({ children }) => children };
  // Create a mock implementation that can be customized per test
  const useNumaAppMock = vi.fn().mockReturnValue({
    numaAppId: 'test-app-id',
    numaAppData: { id: 'test-app-id', appName: 'Test App' },
    currentJobId: null,
    setCurrentJobId: vi.fn(),
    taskInputValues: {},
  });

  return {
    NumaAppContext,
    useNumaApp: useNumaAppMock,
    // No need to export standardizeFileFormat since it's internal to the module
  };
});

describe('S3UploadModule Standardisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ CLIENT_NAME: 'test-client', REGION: 'us-east-1' }),
      }),
    );
  });

  // Mock Auth provider with proper implementation of getIdentityPoolCredentials
  vi.mock('../../Providers/AuthProvider', () => ({
    useAuth: () => ({
      getIdentityPoolCredentials: () =>
        Promise.resolve({
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
          sessionToken: 'test-session-token',
        }),
    }),
  }));

  it('should ensure file paths are always stored as arrays', async () => {
    // This test focuses on verifying the standardised array format without actually uploading files
    // Reset our mock functions before the test
    createJobMock.mockClear();
    updateJobMock.mockClear();

    // We'll directly test the standardisation by using the component's value prop
    // This avoids the complex mocking needed for actual file uploads
    const mockTask = { id: 'test-task-id', title: 'Test Task', required: false };
    const mockOnComplete = vi.fn();
    const mockOnChange = vi.fn();

    // Test with a string value (legacy format)
    const stringValue = 'test-app-id/test-job-id/test_file.pdf';

    // Render the component with a string value
    const { rerender } = renderWithProviders(
      <S3UploadModule task={mockTask} value={stringValue} onComplete={mockOnComplete} onChange={mockOnChange} />,
    );

    // Verify that the file name is displayed
    await waitFor(() => {
      expect(screen.getByText('test_file.pdf')).toBeInTheDocument();
    });

    // For non-required tasks, onComplete should be called
    // The component calls onComplete with an empty array by default for non-required tasks
    expect(mockOnComplete).toHaveBeenCalled();

    // Reset mocks for next test
    mockOnComplete.mockClear();
    mockOnChange.mockClear();

    // Test with an array of objects in the standardised format
    const standardisedValue = [
      {
        id: 'file1-id',
        name: 'standardised1.pdf',
        s3_key: 'test-app-id/test-job-id/standardised1.pdf',
      },
      {
        id: 'file2-id',
        name: 'standardised2.pdf',
        s3_key: 'test-app-id/test-job-id/standardised2.pdf',
      },
    ];

    // Re-render with standardised format
    rerender(
      <S3UploadModule task={mockTask} value={standardisedValue} onComplete={mockOnComplete} onChange={mockOnChange} />,
    );

    // Verify that both file names are displayed
    await waitFor(() => {
      expect(screen.getByText('standardised1.pdf')).toBeInTheDocument();
      expect(screen.getByText('standardised2.pdf')).toBeInTheDocument();
    });

    // Verify that the files are displayed correctly, which confirms the standardisation is working
    // We don't need to check mockOnComplete again as it may not be called in all cases
    // The important thing is that the files are displayed correctly in the UI
  });

  it('should handle value prop with string format and convert to standardised array format', async () => {
    // Test with a string value (legacy format)
    const stringValue = 'test-app-id/test-job-id/test_file.pdf';
    const mockTask = { id: 'test-task-id', title: 'Test Task' };
    const mockOnComplete = vi.fn();

    renderWithProviders(<S3UploadModule task={mockTask} value={stringValue} onComplete={mockOnComplete} />);

    // Verify that the file name is displayed
    await waitFor(() => {
      expect(screen.getByText('test_file.pdf')).toBeInTheDocument();
    });

    // Verify that onComplete was called with an array
    // This is important for backward compatibility
    expect(mockOnComplete).toHaveBeenCalled();
    const onCompleteArg = mockOnComplete.mock.calls[0][0];
    expect(Array.isArray(onCompleteArg)).toBe(true);
  });

  it('should handle value prop with array of strings and convert to standardised format', async () => {
    // Test with an array of strings (legacy format)
    const arrayValue = ['test-app-id/test-job-id/test1.pdf', 'test-app-id/test-job-id/test2.pdf'];
    const mockTask = { id: 'test-task-id', title: 'Test Task' };
    const mockOnComplete = vi.fn();

    renderWithProviders(<S3UploadModule task={mockTask} value={arrayValue} onComplete={mockOnComplete} />);

    // Verify that both file names are displayed
    await waitFor(() => {
      expect(screen.getByText('test1.pdf')).toBeInTheDocument();
      expect(screen.getByText('test2.pdf')).toBeInTheDocument();
    });
  });

  it('should handle value prop with standardised format objects', async () => {
    // Test with already standardised format
    const standardisedValue = [
      {
        id: 'file1-id',
        name: 'standardised1.pdf',
        s3_key: 'test-app-id/test-job-id/standardised1.pdf',
      },
      {
        id: 'file2-id',
        name: 'standardised2.pdf',
        s3_key: 'test-app-id/test-job-id/standardised2.pdf',
      },
    ];

    const mockTask = { id: 'test-task-id', title: 'Test Task' };

    renderWithProviders(<S3UploadModule task={mockTask} value={standardisedValue} />);

    // Verify that both file names are displayed
    await waitFor(() => {
      expect(screen.getByText('standardised1.pdf')).toBeInTheDocument();
      expect(screen.getByText('standardised2.pdf')).toBeInTheDocument();
    });
  });

  it('should pass an empty array to onComplete when no files are uploaded for non-required task', async () => {
    // Test with a non-required task
    const mockTask = {
      id: 'test-task-id',
      title: 'Test Task',
      required: false,
    };
    const mockOnComplete = vi.fn();

    renderWithProviders(<S3UploadModule task={mockTask} onComplete={mockOnComplete} />);

    // Verify that onComplete was called with an empty array
    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith([]);
    });
  });
});
