/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCompanyInfo, fetchCompanyInfo, getProfileText } from '../../utils/companyInfoUtils';
import { uploadFileToS3, fetchFileFromS3 } from '../../utils/s3Utils';

// Mock the s3Utils functions
vi.mock('../../utils/s3Utils', () => ({
  uploadFileToS3: vi.fn().mockResolvedValue('s3://test-bucket/company-data.json'),
  fetchFileFromS3: vi.fn(),
}));

describe('companyInfoUtils', () => {
  const mockS3Bucket = 'test-bucket';
  const mockRegion = 'us-east-1';
  const mockGetCredentials = vi.fn().mockResolvedValue({ accessKeyId: 'test', secretAccessKey: 'test' });
  const mockProfileText = 'This is a test company profile';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the sessionStorage cache so it doesn't leak between tests
    window.sessionStorage.removeItem('COMPANY_PROFILE_DATA');
  });

  describe('saveCompanyInfo', () => {
    it('should save company info to S3', async () => {
      // Call the function
      const result = await saveCompanyInfo(mockProfileText, mockS3Bucket, mockRegion, mockGetCredentials);

      // Check that uploadFileToS3 was called with the correct parameters
      expect(uploadFileToS3).toHaveBeenCalledTimes(1);
      expect(uploadFileToS3).toHaveBeenCalledWith(
        expect.stringContaining(mockProfileText), // content
        'application/json', // contentType
        mockS3Bucket,
        'company-data.json',
        mockRegion,
        mockGetCredentials,
      );

      // Check the result
      expect(result).toBe('s3://test-bucket/company-data.json');
    });

    it('should throw an error if region is missing', async () => {
      await expect(saveCompanyInfo(mockProfileText, mockS3Bucket, null, mockGetCredentials)).rejects.toThrow(
        'Region is missing for saveCompanyInfo',
      );
    });

    it('should throw an error if S3 bucket is missing', async () => {
      await expect(saveCompanyInfo(mockProfileText, null, mockRegion, mockGetCredentials)).rejects.toThrow(
        'S3 bucket name is missing for saveCompanyInfo',
      );
    });

    it('should handle errors from uploadFileToS3', async () => {
      // Mock uploadFileToS3 to throw an error
      uploadFileToS3.mockRejectedValueOnce(new Error('Upload failed'));

      await expect(saveCompanyInfo(mockProfileText, mockS3Bucket, mockRegion, mockGetCredentials)).rejects.toThrow(
        'Upload failed',
      );
    });
  });

  describe('fetchCompanyInfo', () => {
    const mockCompanyInfo = {
      profile: mockProfileText,
      lastUpdated: '2023-01-01T00:00:00.000Z',
    };

    const mockBlob = new Blob([JSON.stringify(mockCompanyInfo)], { type: 'application/json' });

    beforeEach(() => {
      // Mock text method on Blob
      mockBlob.text = vi.fn().mockResolvedValue(JSON.stringify(mockCompanyInfo));

      // Mock fetchFileFromS3 to return the blob
      fetchFileFromS3.mockResolvedValue(mockBlob);
    });

    it('should fetch company info from S3', async () => {
      // Call the function
      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);

      // Check that fetchFileFromS3 was called with the correct parameters
      expect(fetchFileFromS3).toHaveBeenCalledTimes(1);
      expect(fetchFileFromS3).toHaveBeenCalledWith('company-data.json', mockS3Bucket, mockRegion, mockGetCredentials);

      // Check the result
      expect(result).toEqual(mockCompanyInfo);
    });

    it('should return empty profile if region is missing', async () => {
      const result = await fetchCompanyInfo(mockS3Bucket, null, mockGetCredentials);

      expect(fetchFileFromS3).not.toHaveBeenCalled();
      expect(result).toEqual({ profile: '', lastUpdated: null });
    });

    it('should return empty profile if S3 bucket is missing', async () => {
      const result = await fetchCompanyInfo(null, mockRegion, mockGetCredentials);

      expect(fetchFileFromS3).not.toHaveBeenCalled();
      expect(result).toEqual({ profile: '', lastUpdated: null });
    });

    it('should handle 404 errors gracefully', async () => {
      // Mock fetchFileFromS3 to throw a 404 error
      fetchFileFromS3.mockRejectedValueOnce(new Error('Not Found'));

      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);

      expect(result).toEqual({ profile: '', lastUpdated: null });
    });

    it('should handle other errors gracefully', async () => {
      // Mock fetchFileFromS3 to throw a generic error
      fetchFileFromS3.mockRejectedValueOnce(new Error('Something went wrong'));

      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);

      expect(result).toEqual({ profile: '', lastUpdated: null });
    });
  });

  describe('getProfileText', () => {
    it('should extract profile text from company info', () => {
      const mockCompanyInfo = {
        profile: mockProfileText,
        lastUpdated: '2023-01-01T00:00:00.000Z',
      };

      const result = getProfileText(mockCompanyInfo);

      expect(result).toBe(mockProfileText);
    });

    it('should return empty string if company info is null', () => {
      const result = getProfileText(null);

      expect(result).toBe('');
    });

    it('should return empty string if profile is missing', () => {
      const result = getProfileText({ lastUpdated: '2023-01-01T00:00:00.000Z' });

      expect(result).toBe('');
    });
  });
});
