/**
 * File utilities
 * Provides file type validation, content type detection, and other file-related utilities
 */

// Supported MIME types for Bedrock Knowledge Base
const BEDROCK_KB_MIME_TYPES = [
  'text/plain', // Plain text
  'application/pdf', // PDF
  'application/msword', // Microsoft Word
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', // Microsoft PowerPoint
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', // Microsoft Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Excel (xlsx)
  'text/csv', // CSV
  'text/html', // HTML
  'text/markdown', // Markdown
  'application/json', // JSON
  'application/jsonl', // JSON Lines
];

// Comprehensive map of file extensions to MIME types
const EXTENSION_TO_MIME = {
  // Text formats
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  json: 'application/json',
  jsonl: 'application/jsonl',
  xml: 'application/xml',

  // Document formats
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Code/development files (allowed - map to text/plain)
  py: 'text/plain',
  sh: 'text/plain',
  js: 'text/plain',
  jsx: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  java: 'text/plain',
  cpp: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  hpp: 'text/plain',
  go: 'text/plain',
  rb: 'text/plain',
  php: 'text/plain',
  yaml: 'text/plain',
  yml: 'text/plain',
  drawio: 'text/plain',

  // Image formats (jpg/jpeg/png/gif/svg/webp allowed, others blocked)
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/x-icon',
  heic: 'image/heic',

  // Archives (zip allowed in some contexts, others blocked)
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  bz2: 'application/x-bzip2',

  // Audio formats (blocked)
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',

  // Video formats (blocked)
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

/**
 * Get content type based on file extension
 * @param {string} fileName - The file name to extract extension from
 * @returns {string} - The MIME type for the file extension
 */
export const getContentType = (fileName) => {
  if (!fileName) return 'application/octet-stream';
  const extension = fileName.split('.').pop().toLowerCase();
  return EXTENSION_TO_MIME[extension] || 'application/octet-stream'; // Default to binary if unknown
};

/**
 * Validates if a file is supported by Bedrock Knowledge Base
 * @param {File} file - The file to validate
 * @returns {boolean} - Whether the file is supported
 */
export const isFileTypeValidForBedrockKB = (file) => {
  if (!file) return false;

  // Check MIME type first
  if (BEDROCK_KB_MIME_TYPES.includes(file.type)) {
    return true;
  }

  // If MIME type check fails, try checking by extension
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension) return false;

  const mimeType = EXTENSION_TO_MIME[extension];
  return mimeType ? BEDROCK_KB_MIME_TYPES.includes(mimeType) : false;
};

/**
 * Gets a list of supported file extensions for Bedrock Knowledge Base
 * @returns {string} - Comma-separated list of supported file extensions
 */
export const getBedrockKBSupportedExtensions = () => {
  // Filter extensions that map to supported MIME types
  const supportedExtensions = Object.entries(EXTENSION_TO_MIME)
    .filter(([, mimeType]) => BEDROCK_KB_MIME_TYPES.includes(mimeType))
    .map(([ext]) => ext);

  return supportedExtensions.join(', ');
};

/**
 * Raw data file extensions that should trigger warnings
 * These are file types that are supported by Bedrock KB but may not be optimal for knowledge base indexing when large
 */
const RAW_DATA_EXTENSIONS = [
  'csv', // Comma-separated values
  'json', // JSON data files (can be large data dumps)
  'jsonl', // JSON Lines format
  'xml', // XML data exports
  'txt', // Plain text files (could be data dumps, logs, etc.)
];

/**
 * Size threshold for large files (in bytes) - 12MB
 */
const LARGE_FILE_THRESHOLD = 12 * 1024 * 1024; // 12MB

/**
 * Checks if a file is a raw data file (CSV, Parquet, etc.)
 * @param {File} file - The file to check
 * @returns {boolean} - Whether the file is a raw data file
 */
export const isRawDataFile = (file) => {
  if (!file) return false;

  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? RAW_DATA_EXTENSIONS.includes(extension) : false;
};

/**
 * Checks if a file is large (above threshold)
 * @param {File} file - The file to check
 * @returns {boolean} - Whether the file is large
 */
export const isLargeFile = (file) => {
  if (!file) return false;
  return file.size > LARGE_FILE_THRESHOLD;
};

/**
 * Checks if a file is a large raw data file that should trigger a warning
 * @param {File} file - The file to check
 * @returns {boolean} - Whether the file should trigger a warning
 */
export const shouldShowLargeDataFileWarning = (file) => {
  const isRaw = isRawDataFile(file);
  const isLarge = isLargeFile(file);
  const shouldWarn = isRaw && isLarge;

  // Debug logging for troubleshooting
  if (file && file.size > 1024 * 1024) {
    // Log for files > 1MB
    console.log(
      `File: ${file.name}, Size: ${formatFileSize(file.size)}, IsRaw: ${isRaw}, IsLarge: ${isLarge}, ShouldWarn: ${shouldWarn}`,
    );
  }

  return shouldWarn;
};

/**
 * Gets the formatted file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted file size
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Map file extension to Bootstrap icon class name
 * Used for displaying file type icons in the UI
 * @param {string} filename - The filename to extract extension from
 * @returns {string} - Bootstrap icon class name
 */
export const getFileIconClass = (filename: string): string => {
  if (!filename) return 'bi bi-file-earmark';

  const extension = filename.split('.').pop()?.toLowerCase();

  const iconMap: Record<string, string> = {
    docx: 'bi bi-filetype-docx',
    doc: 'bi bi-filetype-doc',
    pdf: 'bi bi-filetype-pdf',
    csv: 'bi bi-filetype-csv',
    xlsx: 'bi bi-filetype-xlsx',
    xls: 'bi bi-filetype-xlsx',
    txt: 'bi bi-filetype-txt',
    jpg: 'bi bi-filetype-jpg',
    jpeg: 'bi bi-filetype-jpg',
    json: 'bi bi-filetype-json',
    html: 'bi bi-filetype-html',
    htm: 'bi bi-filetype-html',
    heic: 'bi bi-filetype-heic',
    m4p: 'bi bi-filetype-m4p',
    md: 'bi bi-filetype-md',
    mp3: 'bi bi-filetype-mp3',
    png: 'bi bi-filetype-png',
    pptx: 'bi bi-filetype-pptx',
    ppt: 'bi bi-filetype-pptx',
    svg: 'bi bi-filetype-svg',
    mp4: 'bi bi-filetype-mp4',
    wav: 'bi bi-filetype-wav',
    xml: 'bi bi-filetype-xml',
  };

  return iconMap[extension || ''] || 'bi bi-file-earmark';
};

// For backward compatibility
export default {
  getContentType,
  isFileTypeValidForBedrockKB,
  getBedrockKBSupportedExtensions,
  isRawDataFile,
  isLargeFile,
  shouldShowLargeDataFileWarning,
  formatFileSize,
  getFileIconClass,
};
