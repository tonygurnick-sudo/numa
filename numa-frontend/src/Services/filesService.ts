/**
 * File display utilities (icon class lookup, size formatting).
 */

export const getFileIcon = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'bi bi-file-earmark';

  const ext = fileName.slice(dot).toLowerCase();

  if (ext === '.pdf') return 'bi bi-file-earmark-pdf';
  if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'bi bi-file-earmark-word';
  if (['.xls', '.xlsx', '.ods', '.csv', '.tsv'].includes(ext)) return 'bi bi-file-earmark-spreadsheet';
  if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'bi bi-file-earmark-slides';
  if (['.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.dbf', '.sql'].includes(ext)) return 'bi bi-database-add';
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'].includes(ext))
    return 'bi bi-file-earmark-image';
  if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'].includes(ext)) return 'bi bi-file-earmark-music';
  if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.wmv', '.flv'].includes(ext)) return 'bi bi-file-earmark-play';
  if (['.zip', '.tar', '.gz', '.rar', '.7z', '.bz2'].includes(ext)) return 'bi bi-file-earmark-zip';
  if (
    [
      '.js',
      '.ts',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.html',
      '.css',
      '.json',
      '.xml',
      '.yaml',
      '.yml',
      '.sh',
      '.bat',
    ].includes(ext)
  )
    return 'bi bi-file-earmark-code';
  if (['.txt', '.md', '.log', '.ini', '.cfg', '.conf'].includes(ext)) return 'bi bi-file-earmark-text';

  return 'bi bi-file-earmark';
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};
