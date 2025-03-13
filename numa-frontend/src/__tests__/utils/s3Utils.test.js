/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFileFromS3 } from '../../utils/s3Utils';

// Mock AWS SDK modules
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn(),
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-signed-url.com/file'),
}));

// Mock global fetch
global.fetch = vi.fn();

describe('S3 Utilities', () => {
  // Setup test data
  const mockCredentials = {
    accessKeyId: 'mock-access-key',
    secretAccessKey: 'mock-secret-key',
    sessionToken: 'mock-session-token',
  };

  const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue(mockCredentials);
  const mockS3Bucket = 'mock-bucket';
  const mockS3Key = 'mock-key.txt';
  const mockRegion = 'us-east-1';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup fetch mock for successful response
    global.fetch.mockResolvedValue({
      ok: true,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'text/plain',
      }),
      blob: vi.fn().mockResolvedValue(new Blob(['mock file content'], { type: 'text/plain' })),
    });
  });

  it('should throw an error when credentials are missing', async () => {
    // Setup mock to return invalid credentials
    mockGetIdentityPoolCredentials.mockResolvedValueOnce({});

    // Call the function and expect it to throw
    await expect(fetchFileFromS3(mockS3Key, mockS3Bucket, mockRegion, mockGetIdentityPoolCredentials)).rejects.toThrow(
      'AWS Credentials are missing.',
    );
  });
});
