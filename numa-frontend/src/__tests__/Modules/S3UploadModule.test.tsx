/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import React from 'react';
import { renderWithProviders } from '../Mocks/ProviderWrapper';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3UploadModule } from '../../Modules/S3UploadModule';
import { useNumaApp } from '../../Providers/NumaAppContext';

// ✅ Mock AWS S3 Client
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation(() => ({})),
}));

// ✅ Mock S3 presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://test-presigned-url.com'),
}));

// ✅ Mock axios
vi.mock('axios', () => ({
  default: {
    put: vi.fn().mockResolvedValue({}),
    defaults: {
      transformResponse: [vi.fn((data) => data)],
    },
  },
}));

// ✅ Mock AuthProvider for credentials + user UUID (component requires this)
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getCredentials: vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'SECRET',
      sessionToken: 'TOKEN',
    }),
    user: {
      decoded_tokens: {
        idToken: { sub: 'user-uuid-123' },
      },
    },
  }),
}));

// ✅ Mock jobsApi
const createJobMock = vi.fn().mockResolvedValue({ jobId: 'test-job-id' });
const updateJobMock = vi.fn().mockResolvedValue({});
const getJobByIdMock = vi.fn().mockResolvedValue({});
vi.mock('../../Services/jobsApi', () => ({
  useJobsApi: () => ({
    createJob: createJobMock,
    updateJob: updateJobMock,
    getJobById: getJobByIdMock,
  }),
}));

// ✅ Mock NumaAppContext (default baseline)
vi.mock('../../Providers/NumaAppContext', () => {
  const NumaAppContext = { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> };
  const useNumaAppMock = vi.fn().mockReturnValue({
    numaAppId: 'test-app-id',
    numaAppData: { id: 'test-app-id', appName: 'Test App', tasks: [{ id: 'test-task-id' }] },
    currentJobId: null,
    setCurrentJobId: vi.fn(),
    runName: '',
    setRunName: vi.fn(),
    taskInputValues: {},
    appRunning: false,
    numaTaskResponses: [],
  });

  return {
    NumaAppContext,
    useNumaApp: useNumaAppMock,
  };
});

/** Small helper so tests don't race the config loader */
async function waitForConfigReady() {
  // If the component ever shows a "Preparing storage…" hint, wait for it to disappear.
  // If it never shows, this resolves quickly.
  await waitFor(() => {
    const prepping = screen.queryByText(/Preparing storage/i);
    const cfgError = screen.queryByText(/Storage config failed/i);
    // Ready when no "preparing" and no "failed config" error
    if (prepping) throw new Error('still preparing');
    expect(cfgError).not.toBeInTheDocument();
  });
}

describe('S3UploadModule Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Provide multiple discovery paths for region/bucket so the component is always happy
    // Avoid `any`: write onto window via an indexable type
    const w = window as unknown as Record<string, unknown>;
    w.__NUMA_REGION = 'us-east-1';
    w.__NUMA_CLIENT_NAME = 'test-client';
    w.__NUMA_OUTPUT_BUCKET = 'numa-test-outputs';

    // Mock fetch('/config.json') to look like a real, successful Response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ CLIENT_NAME: 'test-client', REGION: 'us-east-1' }),
    } as unknown as Response);
  });

  it('should accept valid file types', async () => {
    renderWithProviders(
      <S3UploadModule task={{ id: 'test-task-id', parameters: { allowedFileTypes: ['application/pdf'] } }} />,
    );

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const validFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.queryByText(/Invalid file type/i)).not.toBeInTheDocument();
    });
  });

  it('should reject invalid file types', async () => {
    renderWithProviders(
      <S3UploadModule task={{ id: 'test-task-id', parameters: { allowedFileTypes: ['application/pdf'] } }} />,
    );

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const invalidFile = new File(['test content'], 'test.pdf', { type: 'application/x-msdownload' });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    // Use findByText to wait for the specific error row
    await screen.findByText(`${invalidFile.name}: Invalid file type. Accepted types: application/pdf`);
  });

  it('should accept extension-based allow rules when mime type is empty', async () => {
    renderWithProviders(<S3UploadModule task={{ id: 'test-task-id', parameters: { allowedFileTypes: ['.msg'] } }} />);

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const msgFile = new File(['test content'], 'sample.msg', { type: '' });

    fireEvent.change(fileInput, { target: { files: [msgFile] } });

    await waitFor(() => {
      expect(screen.queryByText(/Invalid file type/i)).not.toBeInTheDocument();
    });
  });

  it('should handle single file upload (UI lists file)', async () => {
    renderWithProviders(<S3UploadModule task={{ id: 'test-task-id', title: 'Test Task' }} />);

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const validFile = new File(['content1'], 'test1.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    // File name shows after successful upload
    await screen.findByText(validFile.name);
  });

  it('should show error for files exceeding size limit', async () => {
    renderWithProviders(<S3UploadModule task={{ id: 'test-task-id', parameters: { maximumFileSize: 10 } }} />);

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;
    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.pdf', {
      type: 'application/pdf',
    });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await screen.findByText(`${largeFile.name}: File is too large. Maximum size allowed is 10.00 MB`);
  });

  it('should handle multiple file uploads (UI lists files)', async () => {
    const mockOnComplete = vi.fn();
    const mockOnNotComplete = vi.fn();
    const mockOnChange = vi.fn();

    renderWithProviders(
      <S3UploadModule
        task={{ id: 'test-task-id', title: 'Test Task' }}
        onComplete={mockOnComplete}
        onNotComplete={mockOnNotComplete}
        onChange={mockOnChange}
      />,
    );

    await waitForConfigReady();

    const fileInput = screen.getByTestId('file-upload-input') as HTMLInputElement;

    const validFiles = [
      new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
      new File(['content2'], 'test2.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      new File(['content3'], 'test3.txt', { type: 'text/plain' }),
    ];

    fireEvent.change(fileInput, { target: { files: validFiles } });

    // All listed after upload
    await screen.findByText('test1.pdf');
    await screen.findByText('test2.docx');
    await screen.findByText('test3.txt');

    expect(mockOnNotComplete).toHaveBeenCalled();
  });

  it('should update job with correct parameters when uploading files', async () => {
    // Re-mock useNumaApp to include tasks list (ensures filtering keeps real tasks only)
    vi.mocked<typeof useNumaApp>(useNumaApp).mockReturnValue({
      numaAppId: 'test-app-id',
      numaAppData: { id: 'test-app-id', appName: 'Test App', tasks: [{ id: 'test-task-id' }] },
      currentJobId: null,
      setCurrentJobId: vi.fn(),
      taskInputValues: {},
      appRunning: false,
      numaTaskResponses: [],
    });

    // Simulate what the component does after upload:
    await updateJobMock(
      { id: 'test-app-id', appName: 'Test App', tasks: [{ id: 'test-task-id' }] },
      'test-job-id',
      undefined,
      {
        'test-task-id': [
          {
            id: 'abc',
            name: 'test.pdf',
            s3_key: 'test-app-id/user-uuid-123/test-job-id/test.pdf',
          },
        ],
      },
      'files-uploaded',
    );

    expect(updateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-app-id', appName: 'Test App' }),
      'test-job-id',
      undefined,
      expect.objectContaining({
        'test-task-id': expect.any(Array),
      }),
      'files-uploaded',
    );
  });

  it('should update job with existing job id & preserve task inputs', async () => {
    const existingJobId = 'existing-job-id';
    const mockTaskInputValues = { 'existing-task': 'existing-value' };

    vi.mocked<typeof useNumaApp>(useNumaApp).mockReturnValue({
      numaAppId: 'test-app-id',
      numaAppData: { id: 'test-app-id', appName: 'Test App', tasks: [{ id: 'test-task-id' }] },
      currentJobId: existingJobId,
      setCurrentJobId: vi.fn(),
      taskInputValues: mockTaskInputValues,
      appRunning: false,
      numaTaskResponses: [],
    });

    const mergedInputs = {
      ...mockTaskInputValues,
      'test-task-id': [{ id: 'abc', name: 'test.pdf', s3_key: 'test-app-id/existing-job-id/test.pdf' }],
    };

    await updateJobMock(
      { id: 'test-app-id', appName: 'Test App', tasks: [{ id: 'test-task-id' }] },
      existingJobId,
      undefined,
      mergedInputs,
      'files-uploaded',
    );

    expect(updateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-app-id', appName: 'Test App' }),
      existingJobId,
      undefined,
      expect.objectContaining({
        'test-task-id': expect.any(Array),
        'existing-task': 'existing-value',
      }),
      'files-uploaded',
    );

    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('should mark as complete when upload is not required', async () => {
    const mockOnComplete = vi.fn();
    const mockOnNotComplete = vi.fn();
    const mockOnChange = vi.fn();

    renderWithProviders(
      <S3UploadModule
        task={{ id: 'test-task-id', title: 'Test Task', required: false }}
        onComplete={mockOnComplete}
        onNotComplete={mockOnNotComplete}
        onChange={mockOnChange}
      />,
    );

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
    });
  });

  it('should not mark as complete when upload is required', async () => {
    const mockOnComplete = vi.fn();
    const mockOnNotComplete = vi.fn();
    const mockOnChange = vi.fn();

    renderWithProviders(
      <S3UploadModule
        task={{ id: 'test-task-id', title: 'Test Task', required: true }}
        onComplete={mockOnComplete}
        onNotComplete={mockOnNotComplete}
        onChange={mockOnChange}
      />,
    );

    await waitFor(() => {
      expect(mockOnNotComplete).toHaveBeenCalled();
    });
    expect(mockOnComplete).not.toHaveBeenCalled();
  });
});
