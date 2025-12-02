/**
 * Document Converter Service
 *
 * Converts markdown content to DOCX or PDF format via the server-side
 * document-converter Lambda and returns a presigned download URL.
 */

export interface ConvertDocumentResponse {
  success: boolean;
  downloadUrl: string;
  filename: string;
  size: number;
}

type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

/**
 * Convert markdown to DOCX or PDF format.
 */
export const convertDocument = async (
  numaPost: NumaPost,
  markdown: string,
  format: 'docx' | 'pdf',
  title?: string,
): Promise<ConvertDocumentResponse> => {
  const response = (await numaPost('/api/document-converter', {
    markdown,
    format,
    ...(title && { title }),
  })) as ConvertDocumentResponse;
  return response;
};

/**
 * Trigger a file download without opening a new tab (avoids popup blockers).
 */
const triggerDownload = (url: string, filename: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Convert markdown to DOCX and trigger download.
 */
export const downloadDocx = async (numaPost: NumaPost, markdown: string, title?: string): Promise<void> => {
  const result = await convertDocument(numaPost, markdown, 'docx', title);
  triggerDownload(result.downloadUrl, result.filename);
};

/**
 * Convert markdown to PDF and trigger download.
 */
export const downloadPdf = async (numaPost: NumaPost, markdown: string, title?: string): Promise<void> => {
  const result = await convertDocument(numaPost, markdown, 'pdf', title);
  triggerDownload(result.downloadUrl, result.filename);
};
