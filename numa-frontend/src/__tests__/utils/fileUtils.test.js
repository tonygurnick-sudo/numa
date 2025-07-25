/**
 * @vitest-environment jsdom
 */
import { describe, test, expect } from 'vitest';
import { getContentType, isFileTypeValidForBedrockKB, getBedrockKBSupportedExtensions } from '../../utils/fileUtils';

describe('getContentType', () => {
  test('should return correct MIME type for PDF', () => {
    expect(getContentType('document.pdf')).toBe('application/pdf');
  });

  test('should return correct MIME type for JPEG', () => {
    expect(getContentType('image.jpg')).toBe('image/jpeg');
  });

  test('should return correct MIME type for PNG', () => {
    expect(getContentType('image.png')).toBe('image/png');
  });

  test('should return correct MIME type for DOCX', () => {
    expect(getContentType('document.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  test('should return correct MIME type for XLS', () => {
    expect(getContentType('spreadsheet.xls')).toBe('application/vnd.ms-excel');
  });

  test('should return correct MIME type for CSV', () => {
    expect(getContentType('data.csv')).toBe('text/csv');
  });

  test('should return application/octet-stream for unknown types', () => {
    expect(getContentType('unknownfile.xyz')).toBe('application/octet-stream');
  });

  test('should handle null or undefined filenames', () => {
    expect(getContentType(null)).toBe('application/octet-stream');
    expect(getContentType(undefined)).toBe('application/octet-stream');
  });
});

describe('isFileTypeValidForBedrockKB', () => {
  test('should return true for valid file types', () => {
    const pdfFile = { name: 'document.pdf', type: 'application/pdf' };
    const docxFile = {
      name: 'document.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const txtFile = { name: 'document.txt', type: 'text/plain' };

    expect(isFileTypeValidForBedrockKB(pdfFile)).toBe(true);
    expect(isFileTypeValidForBedrockKB(docxFile)).toBe(true);
    expect(isFileTypeValidForBedrockKB(txtFile)).toBe(true);
  });

  test('should return false for invalid file types', () => {
    const imageFile = { name: 'image.jpg', type: 'image/jpeg' };
    const zipFile = { name: 'archive.zip', type: 'application/zip' };

    expect(isFileTypeValidForBedrockKB(imageFile)).toBe(false);
    expect(isFileTypeValidForBedrockKB(zipFile)).toBe(false);
  });

  test('should handle files with no MIME type by checking extension', () => {
    const pdfFileNoMime = { name: 'document.pdf', type: '' };
    const docxFileNoMime = { name: 'document.docx', type: '' };
    const invalidFileNoMime = { name: 'image.jpg', type: '' };

    expect(isFileTypeValidForBedrockKB(pdfFileNoMime)).toBe(true);
    expect(isFileTypeValidForBedrockKB(docxFileNoMime)).toBe(true);
    expect(isFileTypeValidForBedrockKB(invalidFileNoMime)).toBe(false);
  });

  test('should handle null or undefined files', () => {
    expect(isFileTypeValidForBedrockKB(null)).toBe(false);
    expect(isFileTypeValidForBedrockKB(undefined)).toBe(false);
  });
});

describe('getBedrockKBSupportedExtensions', () => {
  test('should return a comma-separated list of supported extensions', () => {
    const extensions = getBedrockKBSupportedExtensions();

    // Check that it returns a non-empty string
    expect(typeof extensions).toBe('string');
    expect(extensions.length).toBeGreaterThan(0);

    // Check that common formats are included
    expect(extensions).toContain('pdf');
    expect(extensions).toContain('txt');
    expect(extensions).toContain('doc');
  });
});
