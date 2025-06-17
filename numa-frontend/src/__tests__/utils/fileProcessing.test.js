/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFile } from '../../utils/fileProcessing';

// Hoist mocks before imports are processed
const { fetchFileFromS3 } = vi.hoisted(() => ({
  fetchFileFromS3: vi.fn(),
}));

// Mock dependencies
vi.mock('../../utils/s3Utils', () => ({
  fetchFileFromS3,
}));

describe('File Processing Utils', () => {
  // Setup test environment
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock session storage and local storage
    const sessionStorageData = {
      REGION: 'us-east-1',
      API_ENDPOINT: '/api',
      id_token: 'session-id-token-123',
    };

    const mockGetItem = vi.fn((key) => sessionStorageData[key] || null);
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: mockGetItem,
      },
      writable: true,
    });

    const localStorageData = {
      idToken: 'local-id-token-123',
    };
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key) => localStorageData[key] || null),
      },
      writable: true,
    });

    // Mock global fetch
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            output_key: 'processed/output.json',
            output_bucket: 'output-bucket',
          }),
        text: () => Promise.resolve('{"error": "Error text"}'),
      });
    });

    // Mock fetchFileFromS3 to simulate successful file fetch from S3
    fetchFileFromS3.mockImplementation(() =>
      Promise.resolve({
        text: () =>
          Promise.resolve(
            JSON.stringify({
              pages: [{ text: 'Page 1 content' }, { text: 'Page 2 content' }],
              documentInfo: { title: 'Test Document' },
            }),
          ),
      }),
    );

    // Mock setTimeout to avoid actual waiting in tests
    vi.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 123; // dummy timeout id
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processFile', () => {
    it('should handle failed Lambda call and fall back to S3 polling', async () => {
      // Create a mock numaPost function that fails with a timeout
      const mockNumaPost = vi.fn().mockRejectedValueOnce(new Error('Gateway Timeout'));

      const fileInfo = {
        s3Key: 'input/timeout.pdf',
        s3Bucket: 'input-bucket',
        fileName: 'timeout.pdf',
      };

      const authContext = {
        user: { tokens: { idToken: 'auth-context-token' } },
      };

      const getCredentials = vi.fn().mockResolvedValue({});

      const result = await processFile(fileInfo, authContext, getCredentials, mockNumaPost);

      // Verify numaPost was called with correct parameters
      expect(mockNumaPost).toHaveBeenCalledWith(
        expect.stringContaining('/extract-content'),
        expect.objectContaining({
          input_bucket: 'input-bucket',
          input_key: 'input/timeout.pdf',
          output_bucket: 'input-bucket',
          output_key: expect.stringContaining('input/timeout.pdf.json'),
          file_name: 'timeout.pdf',
        }),
      );

      // Verify S3 polling was attempted
      expect(fetchFileFromS3).toHaveBeenCalled();

      // Check result structure reflects polling success
      expect(result).toEqual(
        expect.objectContaining({
          s3Key: 'input/timeout.pdf',
        }),
      );
    });
  });
});
