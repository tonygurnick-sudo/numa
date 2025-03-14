/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPolicyBuilderBucketInfo } from '../../utils/bucketNameUtil';
import { S3Client } from '@aws-sdk/client-s3';

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn(() => ({
      send: vi.fn(),
    })),
    GetObjectCommand: vi.fn(),
  };
});

describe('bucketNameUtil', () => {
  let s3Client;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    s3Client = new S3Client();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPolicyBuilderBucketInfo', () => {
    it('should return the correct bucket info object', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test data
      const config = { OUTPUTS_BUCKET_NAME: 'numa-testclient-outputs', CLIENT_NAME: 'testclient' };
      const jobId = 'job123';

      // Expected result
      const expected = {
        bucketName: 'numa-testclient-outputs',
        key: 'policy-builder/job123/final_policy.pdf',
      };

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result
      expect(result).toEqual(expected);
    });

    it('should handle missing OUTPUTS_BUCKET_NAME in config', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test with missing bucket name
      const config = { CLIENT_NAME: 'testclient' };
      const jobId = 'job123';

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result has undefined bucketName but still has paths
      expect(result).toEqual({
        bucketName: undefined,
        key: 'policy-builder/job123/final_policy.pdf',
      });

      // Verify warning was logged
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OUTPUTS_BUCKET_NAME is not defined'));
    });

    it('should handle missing CLIENT_NAME in config', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test with missing client name
      const config = { OUTPUTS_BUCKET_NAME: 'numa-outputs' };
      const jobId = 'job123';

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result
      expect(result).toEqual({
        bucketName: 'numa-outputs',
        key: 'policy-builder/job123/final_policy.pdf',
      });

      // Verify warning was logged
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('CLIENT_NAME is not defined'));
    });

    it('should handle empty jobId', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test with empty job ID
      const config = { OUTPUTS_BUCKET_NAME: 'numa-testclient-outputs', CLIENT_NAME: 'testclient' };
      const jobId = '';

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result
      expect(result).toEqual({
        bucketName: 'numa-testclient-outputs',
        key: 'policy-builder//final_policy.pdf',
      });
    });

    it('should handle null or undefined jobId', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test with null job ID
      const config = { OUTPUTS_BUCKET_NAME: 'numa-testclient-outputs', CLIENT_NAME: 'testclient' };

      // Call with null
      const resultNull = await getPolicyBuilderBucketInfo(config, null, s3Client);

      // Verify the result
      expect(resultNull).toEqual({
        bucketName: 'numa-testclient-outputs',
        key: 'policy-builder/null/final_policy.pdf',
      });

      // Call with undefined
      const resultUndefined = await getPolicyBuilderBucketInfo(config, undefined, s3Client);

      // Verify the result
      expect(resultUndefined).toEqual({
        bucketName: 'numa-testclient-outputs',
        key: 'policy-builder/undefined/final_policy.pdf',
      });
    });

    it('should use the legacy key if the new key is not found', async () => {
      // Mock the S3 client to simulate a failure for the new key and success for the legacy key
      s3Client.send
        .mockRejectedValueOnce(new Error('Not Found')) // Simulate not found for new key
        .mockResolvedValueOnce({}); // Simulate success for legacy key

      // Test data
      const config = { OUTPUTS_BUCKET_NAME: 'numa-testclient-outputs', CLIENT_NAME: 'testclient' };
      const jobId = 'job123';

      // Expected result
      const expected = {
        bucketName: 'numa-testclient-outputs',
        key: 'testclient-nzsba-policy-builder/job123/final_policy.pdf',
      };

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result
      expect(result).toEqual(expected);
    });

    it('should use "final_policy" as the default file name', async () => {
      // Mock the S3 client to simulate a successful response
      s3Client.send.mockResolvedValueOnce({});

      // Test data
      const config = { OUTPUTS_BUCKET_NAME: 'numa-testclient-outputs', CLIENT_NAME: 'testclient' };
      const jobId = 'job123';

      // Expected result with default file name
      const expected = {
        bucketName: 'numa-testclient-outputs',
        key: 'policy-builder/job123/final_policy.pdf',
      };

      // Call the function
      const result = await getPolicyBuilderBucketInfo(config, jobId, s3Client);

      // Verify the result
      expect(result).toEqual(expected);
    });
  });
});
