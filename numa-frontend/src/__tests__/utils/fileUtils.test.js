/**
 * @vitest-environment jsdom
 */
import { describe, test, expect } from 'vitest';
import { getContentType } from '../../utils/fileUtils';

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
});
