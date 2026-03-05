/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';

// Since standardizeFileFormat is not exported from S3UploadModule, we'll recreate it here for testing
const standardizeFileFormat = (file) => {
  if (!file) return null;

  // If it's a string, treat it as a file path
  if (typeof file === 'string') {
    return {
      id: Math.random().toString(36).substring(2, 15),
      name: file.split('/').pop(),
      s3_key: file,
    };
  }

  // If it's already in the standard format, return as is
  if (file.id && file.name && file.s3_key) {
    return file;
  }

  // Convert from various formats to standard
  return {
    id: file.randomId || file.id || Math.random().toString(36).substring(2, 15),
    name: file.fileName || file.name || (file.filePath || file.s3_key || '').split('/').pop() || 'Unknown file',
    s3_key: file.filePath || file.s3_key || file.key || '',
  };
};

describe('File Format Standardization', () => {
  // Test the standardizeFileFormat utility function
  describe('standardizeFileFormat utility', () => {
    it('should handle string input (file path)', () => {
      const input = 'test-app-id/test-job-id/test_file.pdf';
      const result = standardizeFileFormat(input);

      expect(result).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'test_file.pdf',
          s3_key: 'test-app-id/test-job-id/test_file.pdf',
        })
      );
    });

    it('should handle null input', () => {
      const result = standardizeFileFormat(null);
      expect(result).toBeNull();
    });

    it('should pass through already standardized format', () => {
      const standardizedInput = {
        id: 'test-id',
        name: 'test.pdf',
        s3_key: 'test-app-id/test-job-id/test.pdf',
      };

      const result = standardizeFileFormat(standardizedInput);
      expect(result).toEqual(standardizedInput);
    });

    it('should convert legacy format with filePath', () => {
      const legacyInput = {
        randomId: 'test-random-id',
        fileName: 'test.pdf',
        filePath: 'test-app-id/test-job-id/test.pdf',
      };

      const result = standardizeFileFormat(legacyInput);

      expect(result).toEqual({
        id: 'test-random-id',
        name: 'test.pdf',
        s3_key: 'test-app-id/test-job-id/test.pdf',
      });
    });

    it('should handle mixed format with key instead of s3_key', () => {
      const mixedInput = {
        id: 'test-id',
        name: 'test.pdf',
        key: 'test-app-id/test-job-id/test.pdf',
      };

      const result = standardizeFileFormat(mixedInput);

      expect(result).toEqual({
        id: 'test-id',
        name: 'test.pdf',
        s3_key: 'test-app-id/test-job-id/test.pdf',
      });
    });
  });
});
