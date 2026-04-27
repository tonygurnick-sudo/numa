/**
 * @vitest-environment jsdom
 */
import { describe, test, expect } from 'vitest';
import { getContentType, getBedrockKBSupportedExtensions } from '../../utils/fileUtils';

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
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
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
