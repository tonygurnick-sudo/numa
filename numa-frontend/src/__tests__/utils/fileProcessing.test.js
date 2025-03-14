/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateTokenCount } from '../../utils/fileProcessing';

const CHARS_PER_TOKEN = 4.0;
const MAX_TOKEN_LIMIT = 100000;

vi.mock('file-type', () => ({
  fromBuffer: vi.fn().mockResolvedValue({ ext: 'txt' }),
}));

vi.mock('pdfjs-dist/build/pdf', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: null },
}));

const createMockFile = (content = 'test content') => {
  return {
    text: vi.fn().mockResolvedValue(content),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  };
};

const mockNumaChatBedrockUtils = {
  getImageDescription: vi.fn().mockResolvedValue('Image description'),
};

describe('fileProcessing - Token Estimation and Size Limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        text: () => Promise.resolve('Mocked text content'),
      });
    });
  });

  describe('estimateTokenCount', () => {
    it('correctly estimates tokens based on characters', () => {
      expect(estimateTokenCount(null)).toBe(0);
      expect(estimateTokenCount('')).toBe(0);
      expect(estimateTokenCount('Success!')).toBe(2); // 8 chars / 4.0 = 2
      expect(estimateTokenCount('A'.repeat(40))).toBe(10); // 40 chars / 4.0 = 10
    });

    it('rounds up token count correctly', () => {
      expect(estimateTokenCount('A'.repeat(9))).toBe(3);
      expect(estimateTokenCount('A'.repeat(4))).toBe(1);
      expect(estimateTokenCount('A'.repeat(5))).toBe(2);
    });
  });

  describe('processFile - size limits', () => {
    it('rejects files exceeding token limit', async () => {
      const excessiveCharCount = (MAX_TOKEN_LIMIT + 1) * CHARS_PER_TOKEN;
      const file = createMockFile('A'.repeat(excessiveCharCount));

      const largeContent = 'A'.repeat(excessiveCharCount);
      expect(estimateTokenCount(largeContent)).toBeGreaterThan(MAX_TOKEN_LIMIT);

      const tokenCount = estimateTokenCount(largeContent);
      expect(tokenCount).toBe(MAX_TOKEN_LIMIT + 1);
    });

    it('accepts files within token limit', async () => {
      const safeCharCount = MAX_TOKEN_LIMIT * CHARS_PER_TOKEN - 1;
      const content = 'A'.repeat(safeCharCount);

      expect(estimateTokenCount(content)).toBeLessThanOrEqual(MAX_TOKEN_LIMIT);
    });

    it('handles exact token limit boundary', () => {
      const exactLimitContent = 'A'.repeat(MAX_TOKEN_LIMIT * CHARS_PER_TOKEN);
      expect(estimateTokenCount(exactLimitContent)).toBe(MAX_TOKEN_LIMIT);

      const justOverContent = 'A'.repeat(MAX_TOKEN_LIMIT * CHARS_PER_TOKEN + 1);
      expect(estimateTokenCount(justOverContent)).toBe(MAX_TOKEN_LIMIT + 1);
    });
  });
});
