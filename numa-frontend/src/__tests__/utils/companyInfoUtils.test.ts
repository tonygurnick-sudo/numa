/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveCompanyInfo,
  fetchCompanyInfo,
  getProfileText,
  migrateCompanyProfile,
  type CompanyProfileData,
} from '../../utils/companyInfoUtils';
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

  const mockProfileData: CompanyProfileData = {
    companyName: 'Acme Corp',
    industry: 'SaaS',
    country: 'Australia',
    companyInformation: mockProfileText,
    bestPractices: '',
    lastUpdated: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.removeItem('COMPANY_PROFILE_DATA');
  });

  describe('migrateCompanyProfile', () => {
    it('should migrate old format (profile -> companyInformation)', () => {
      const result = migrateCompanyProfile({ profile: 'old text', lastUpdated: '2023-01-01T00:00:00.000Z' });
      expect(result.companyInformation).toBe('old text');
      expect(result.companyName).toBe('');
      expect(result.lastUpdated).toBe('2023-01-01T00:00:00.000Z');
    });

    it('should pass through new format unchanged', () => {
      const result = migrateCompanyProfile({
        companyName: 'Test',
        companyInformation: 'new text',
        bestPractices: 'some practices',
        lastUpdated: '2023-01-01T00:00:00.000Z',
      });
      expect(result.companyName).toBe('Test');
      expect(result.companyInformation).toBe('new text');
      expect(result.bestPractices).toBe('some practices');
    });

    it('should return empty profile for null/undefined input', () => {
      const result = migrateCompanyProfile(null as unknown as Record<string, unknown>);
      expect(result.companyInformation).toBe('');
      expect(result.companyName).toBe('');
    });
  });

  describe('saveCompanyInfo', () => {
    it('should save structured company info to S3', async () => {
      const result = await saveCompanyInfo(mockProfileData, mockS3Bucket, mockRegion, mockGetCredentials);

      expect(uploadFileToS3).toHaveBeenCalledTimes(1);
      expect(uploadFileToS3).toHaveBeenCalledWith(
        expect.stringContaining(mockProfileText),
        'application/json',
        mockS3Bucket,
        'company-data.json',
        mockRegion,
        mockGetCredentials
      );

      expect(result).toBe('s3://test-bucket/company-data.json');
    });

    it('should throw an error if region is missing', async () => {
      await expect(saveCompanyInfo(mockProfileData, mockS3Bucket, '' as string, mockGetCredentials)).rejects.toThrow(
        'Region is missing for saveCompanyInfo'
      );
    });

    it('should throw an error if S3 bucket is missing', async () => {
      await expect(saveCompanyInfo(mockProfileData, '' as string, mockRegion, mockGetCredentials)).rejects.toThrow(
        'S3 bucket name is missing for saveCompanyInfo'
      );
    });
  });

  describe('fetchCompanyInfo', () => {
    const mockOldFormatInfo = {
      profile: mockProfileText,
      lastUpdated: '2023-01-01T00:00:00.000Z',
    };

    const mockBlob = new Blob([JSON.stringify(mockOldFormatInfo)], { type: 'application/json' });

    beforeEach(() => {
      mockBlob.text = vi.fn().mockResolvedValue(JSON.stringify(mockOldFormatInfo));
      (fetchFileFromS3 as ReturnType<typeof vi.fn>).mockResolvedValue(mockBlob);
    });

    it('should fetch and migrate old format company info from S3', async () => {
      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);

      expect(fetchFileFromS3).toHaveBeenCalledTimes(1);
      expect(result.companyInformation).toBe(mockProfileText);
      expect(result.lastUpdated).toBe('2023-01-01T00:00:00.000Z');
    });

    it('should return empty profile if region is missing', async () => {
      const result = await fetchCompanyInfo(mockS3Bucket, '' as string, mockGetCredentials);
      expect(fetchFileFromS3).not.toHaveBeenCalled();
      expect(result.companyInformation).toBe('');
    });

    it('should handle 404 errors gracefully', async () => {
      (fetchFileFromS3 as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Not Found'));
      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);
      expect(result.companyInformation).toBe('');
    });

    it('should handle other errors gracefully', async () => {
      (fetchFileFromS3 as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Something went wrong'));
      const result = await fetchCompanyInfo(mockS3Bucket, mockRegion, mockGetCredentials);
      expect(result.companyInformation).toBe('');
    });
  });

  describe('getProfileText', () => {
    it('should extract companyInformation from new format', () => {
      const result = getProfileText(mockProfileData);
      expect(result).toBe(mockProfileText);
    });

    it('should fall back to profile field from old format', () => {
      const result = getProfileText({ profile: 'old text' } as Record<string, unknown>);
      expect(result).toBe('old text');
    });

    it('should return empty string if company info is null', () => {
      expect(getProfileText(null)).toBe('');
    });

    it('should return empty string if no profile fields exist', () => {
      expect(getProfileText({ lastUpdated: '2023-01-01T00:00:00.000Z' } as Record<string, unknown>)).toBe('');
    });
  });
});
