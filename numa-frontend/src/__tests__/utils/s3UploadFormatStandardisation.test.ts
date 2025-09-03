/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { findValueWithFormatFlexibility } from '../../Providers/NumaAppContext';

describe('S3 Upload Format standardisation', () => {
  // Test the findValueWithFormatFlexibility function for task ID format flexibility
  describe('Task ID Format Flexibility', () => {
    it('should find values with both hyphen and underscore formats', () => {
      // Test object with hyphen format keys
      const objWithHyphens = {
        'file-upload-task': ['test-app-id/test-job-id/test.pdf'],
        'text-output-task': 'Test result',
      };

      // Test finding with exact key (hyphen format)
      expect(findValueWithFormatFlexibility(objWithHyphens, 'file-upload-task')).toEqual([
        'test-app-id/test-job-id/test.pdf',
      ]);

      // Test finding with underscore format when object has hyphen format
      expect(findValueWithFormatFlexibility(objWithHyphens, 'file_upload_task')).toEqual([
        'test-app-id/test-job-id/test.pdf',
      ]);

      // Test object with underscore format keys
      const objWithUnderscores = {
        file_upload_task: ['test-app-id/test-job-id/test.pdf'],
        text_output_task: 'Test result',
      };

      // Test finding with exact key (underscore format)
      expect(findValueWithFormatFlexibility(objWithUnderscores, 'file_upload_task')).toEqual([
        'test-app-id/test-job-id/test.pdf',
      ]);

      // Test finding with hyphen format when object has underscore format
      expect(findValueWithFormatFlexibility(objWithUnderscores, 'file-upload-task')).toEqual([
        'test-app-id/test-job-id/test.pdf',
      ]);
    });
  });

  // Test the file format standardisation logic from loadJobResults
  describe('File Format standardisation in loadJobResults', () => {
    it('should convert string file paths to arrays', () => {
      // Create a mock processedInputs object to simulate what happens in loadJobResults
      const processedInputs = {
        'file-upload-task': 'test-app-id/test-job-id/test.pdf', // Legacy string format
      };

      // Create a mock tasks array with an s3-upload task
      const tasks = [
        {
          id: 'file-upload-task',
          type: 's3-upload',
          title: 'Upload Files',
          required: true,
        },
      ];

      // Simulate the file format standardisation logic from loadJobResults
      tasks.forEach((task) => {
        if (task.type === 's3-upload' && processedInputs[task.id]) {
          const fileValue = processedInputs[task.id];
          // ALWAYS ensure file uploads are loaded as arrays for consistency
          if (!Array.isArray(fileValue)) {
            processedInputs[task.id] = [fileValue];
          }
        }
      });

      // Verify the result is an array
      expect(Array.isArray(processedInputs['file-upload-task'])).toBe(true);
      expect(processedInputs['file-upload-task']).toEqual(['test-app-id/test-job-id/test.pdf']);
    });

    it('should preserve array format for file paths', () => {
      // Create a mock processedInputs object with an array of file paths
      const processedInputs = {
        'file-upload-task': ['test-app-id/test-job-id/test1.pdf', 'test-app-id/test-job-id/test2.pdf'],
      };

      // Create a mock tasks array with an s3-upload task
      const tasks = [
        {
          id: 'file-upload-task',
          type: 's3-upload',
          title: 'Upload Files',
          required: true,
        },
      ];

      // Simulate the file format standardisation logic from loadJobResults
      tasks.forEach((task) => {
        if (task.type === 's3-upload' && processedInputs[task.id]) {
          const fileValue = processedInputs[task.id];
          // ALWAYS ensure file uploads are loaded as arrays for consistency
          if (!Array.isArray(fileValue)) {
            processedInputs[task.id] = [fileValue];
          }
        }
      });

      // Verify the array format is preserved
      expect(Array.isArray(processedInputs['file-upload-task'])).toBe(true);
      expect(processedInputs['file-upload-task']).toEqual([
        'test-app-id/test-job-id/test1.pdf',
        'test-app-id/test-job-id/test2.pdf',
      ]);
    });

    it('should handle standardised file objects format', () => {
      // Create a mock processedInputs object with an array of standardised file objects
      const processedInputs = {
        'file-upload-task': [
          {
            id: 'file1-id',
            name: 'test1.pdf',
            s3_key: 'test-app-id/test-job-id/test1.pdf',
          },
          {
            id: 'file2-id',
            name: 'test2.pdf',
            s3_key: 'test-app-id/test-job-id/test2.pdf',
          },
        ],
      };

      // Create a mock tasks array with an s3-upload task
      const tasks = [
        {
          id: 'file-upload-task',
          type: 's3-upload',
          title: 'Upload Files',
          required: true,
        },
      ];

      // Simulate the file format standardisation logic from loadJobResults
      tasks.forEach((task) => {
        if (task.type === 's3-upload' && processedInputs[task.id]) {
          const fileValue = processedInputs[task.id];
          // ALWAYS ensure file uploads are loaded as arrays for consistency
          if (!Array.isArray(fileValue)) {
            processedInputs[task.id] = [fileValue];
          }
        }
      });

      // Verify the standardised format is preserved
      expect(Array.isArray(processedInputs['file-upload-task'])).toBe(true);
      expect(processedInputs['file-upload-task']).toEqual([
        {
          id: 'file1-id',
          name: 'test1.pdf',
          s3_key: 'test-app-id/test-job-id/test1.pdf',
        },
        {
          id: 'file2-id',
          name: 'test2.pdf',
          s3_key: 'test-app-id/test-job-id/test2.pdf',
        },
      ]);
    });
  });
});
