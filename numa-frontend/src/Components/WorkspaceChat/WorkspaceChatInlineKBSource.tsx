import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { getFileIconClass } from '../../utils/fileUtils';
import { getSignedUrlForS3Object } from '../../utils/s3Utils';

export interface KBSourceReference {
  s3Uri: string;
  bucket: string;
  key: string;
  filename: string;
  /** If the source is a web-crawled URL, store the decoded URL here */
  sourceUrl?: string;
}

interface WorkspaceChatInlineKBSourceProps {
  sourceRef: KBSourceReference;
  getCredentials: () => Promise<AwsCredentialIdentity>;
  region: string;
}

/**
 * Parse an S3 URI into bucket and key components
 * @param s3Uri - S3 URI in format s3://bucket/key
 */
// eslint-disable-next-line react-refresh/only-export-components
export const parseS3Uri = (s3Uri: string): { bucket: string; key: string } | null => {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
};

/**
 * Check if a string is a URL-encoded web URL
 */
const isEncodedWebUrl = (str: string): boolean => {
  return str.startsWith('https%3A') || str.startsWith('http%3A');
};

/**
 * Build a KBSourceReference from an S3 URI
 */
// eslint-disable-next-line react-refresh/only-export-components
export const buildKBSourceReference = (s3Uri: string): KBSourceReference | null => {
  const parsed = parseS3Uri(s3Uri);
  if (!parsed) return null;

  const rawFilename = parsed.key.split('/').pop() || parsed.key;

  // Check if filename is a URL-encoded web URL (from web crawler)
  let filename = rawFilename;
  let sourceUrl: string | undefined;

  if (isEncodedWebUrl(rawFilename)) {
    try {
      sourceUrl = decodeURIComponent(rawFilename);
      // Extract a friendly display name from the URL
      const url = new URL(sourceUrl);
      filename = url.hostname + url.pathname;
      // Truncate if too long
      if (filename.length > 50) {
        filename = filename.substring(0, 47) + '...';
      }
    } catch {
      // If decoding fails, use the raw filename
      filename = rawFilename;
    }
  }

  return {
    s3Uri,
    bucket: parsed.bucket,
    key: parsed.key,
    filename,
    sourceUrl,
  };
};

/**
 * WorkspaceChatInlineKBSource - Minimal inline KB source reference
 * Displays file icon + filename + open icon
 * - For web URLs: opens the source URL directly
 * - For S3 files: generates a presigned URL on click
 */
export const WorkspaceChatInlineKBSource: React.FC<WorkspaceChatInlineKBSourceProps> = ({
  sourceRef,
  getCredentials,
  region,
}) => {
  const { t } = useTranslation('chat');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use globe icon for web URLs, file icon for S3 files
  const isWebSource = !!sourceRef.sourceUrl;
  const iconClass = isWebSource ? 'bi bi-globe' : getFileIconClass(sourceRef.filename);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // For web URLs, just open directly
      if (sourceRef.sourceUrl) {
        window.open(sourceRef.sourceUrl, '_blank');
        return;
      }

      // For S3 files, generate presigned URL
      if (isLoading) return;

      setIsLoading(true);
      setError(null);

      try {
        const signedUrl = await getSignedUrlForS3Object(
          sourceRef.key,
          sourceRef.bucket,
          region,
          getCredentials,
          3600 // 1 hour expiration
        );
        window.open(signedUrl, '_blank');
      } catch (err) {
        console.error('Failed to generate presigned URL for KB source:', err);
        setError(t('workspace.kbSource.failedToOpen'));
      } finally {
        setIsLoading(false);
      }
    },
    [sourceRef, getCredentials, region, isLoading]
  );

  // Title shows the full source URL or S3 URI
  const title = error || sourceRef.sourceUrl || sourceRef.s3Uri;

  return (
    <button
      className={`workspace-chat-inline-kb-source ${error ? 'has-error' : ''}`}
      onClick={handleClick}
      disabled={isLoading}
      title={title}
      aria-label={t('workspace.kbSource.openFile', { filename: sourceRef.filename })}
    >
      <i className={`${iconClass} file-icon`}></i>
      <span className="file-name">{sourceRef.filename}</span>
      {isLoading ? (
        <span className="spinner-border spinner-border-sm loading-icon" role="status" aria-hidden="true"></span>
      ) : (
        <i className="bi bi-box-arrow-up-right open-icon"></i>
      )}
    </button>
  );
};
