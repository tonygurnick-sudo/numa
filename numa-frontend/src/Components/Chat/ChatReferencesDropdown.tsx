import { useState, useEffect, useRef } from 'react';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { getContentType } from '../../utils/fileUtils';
import { getUrlTagFromS3Object } from '../../utils/s3Utils';
import { Button, Collapse } from 'react-bootstrap';

type ChatReferencesDropdownProps = {
  references: string[];
  getCredentials: () => Promise<AwsCredentialIdentity>;
  showAsDropdown?: boolean;
  label?: string;
  showLabel?: boolean;
  noIndent?: boolean; // when true, remove left margin to align with surrounding text
};

const ChatReferencesDropdown = ({
  references,
  getCredentials,
  showAsDropdown = true,
  label = 'References',
  showLabel = true,
  noIndent = false,
}: ChatReferencesDropdownProps) => {
  const [open, setOpen] = useState(false);
  const [processedRefs, setProcessedRefs] = useState([]);
  const [downloadingIndex, setDownloadingIndex] = useState(null);
  const downloadLinkRef = useRef(null);
  const region = window.sessionStorage.getItem('REGION');

  useEffect(() => {
    // Process references when they change
    const processReferences = async () => {
      if (!references || references.length === 0) return;

      const uniqueRefs = new Set();

      const processed = await Promise.all(
        references.map(async (ref) => {
          if (uniqueRefs.has(ref)) {
            return null; // Skip duplicate references
          }
          uniqueRefs.add(ref);

          // Check if it's an S3 URI
          if (ref.startsWith('s3://')) {
            try {
              // Parse the S3 URI
              const s3Parts = ref.replace('s3://', '').split('/');
              const bucket = s3Parts[0];
              const key = s3Parts.slice(1).join('/');

              // Extract filename for display
              const fileName = key.split('/').pop() || 'file';

              // Store bucket and key for later pre-signed URL generation
              return {
                originalRef: ref,
                bucket,
                key,
                displayName: fileName,
                isS3: true,
              };
            } catch (error) {
              console.error('Error processing S3 URI:', error);
              return {
                originalRef: ref,
                url: '#',
                displayName: ref,
                isS3: true,
                error: true,
              };
            }
          }

          if (ref.includes('.s3.amazonaws.com/')) {
            try {
              // Extract bucket and key from URL
              const url = new URL(ref);
              const bucket = url.hostname.split('.s3.amazonaws.com')[0];
              let key = url.pathname.substring(1); // Remove leading slash

              // Handle double-encoded URLs (common in Amazon Q Business responses)
              if (key.includes('%25')) {
                key = decodeURIComponent(key);
              }

              // Extract filename for display and decode it properly
              let fileName = key.split('/').pop() || 'file';
              fileName = decodeURIComponent(fileName);

              // Store bucket and key for later pre-signed URL generation
              return {
                originalRef: ref,
                bucket,
                key,
                displayName: fileName,
                isS3: true,
              };
            } catch (error) {
              console.error('Error processing Amazon Q Business URL:', error);
              return {
                originalRef: ref,
                url: ref, // Fall back to the original URL
                displayName: 'Document',
                isS3: true,
              };
            }
          }

          // Not an S3 URI or URL, return as is
          return {
            originalRef: ref,
            url: ref,
            displayName: ref,
            isS3: false,
          };
        }),
      );
      const finalRefs = processed.filter(Boolean);
      console.log('[ChatReferencesDropdown] Processed references:', finalRefs);
      setProcessedRefs(finalRefs);
    };

    processReferences();
  }, [references]);

  // Function to extract the original URL from a web crawler key
  const extractCrawlerUrl = (key) => {
    const match = key.match(/^web-crawler\/[^/]+\/(.+)$/);
    if (!match) return null;

    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      console.error('Failed to decode crawler URL:', e);
      return null;
    }
  };

  // Function to handle document access using invisible link approach with pre-signed URLs
  const handleDocumentAccess = async (ref, index) => {
    // For non-S3 URLs, just open the URL directly
    if (!ref.isS3 || !ref.bucket || !ref.key) {
      window.open(ref.url, '_blank');
      return;
    }

    try {
      setDownloadingIndex(index);

      if (ref.key.startsWith('web-crawler/')) {
        const crawlerUrl = extractCrawlerUrl(ref.key);
        if (crawlerUrl) {
          window.open(crawlerUrl, '_blank');
          return;
        }
      }

      // If not a web crawler URL or extraction failed, try to get URL from tags
      const urlFromTag = await getUrlTagFromS3Object(ref.key, ref.bucket, region, getCredentials);

      // If we found a URL in the tags, open it directly
      if (urlFromTag) {
        window.open(urlFromTag, '_blank');
        return;
      }

      // If no URL tag found, fall back to pre-signed URL
      const signedUrl = await getPresignedUrl(ref, getCredentials);
      if (!signedUrl) {
        return;
      }

      const link = document.createElement('a');
      link.href = signedUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
    } catch (error) {
      console.error('Error accessing document:', error);
      alert(`Unable to access document: ${error.message}`);
    } finally {
      setDownloadingIndex(null);
    }
  };

  const getPresignedUrl = async (ref, getCredentials) => {
    try {
      const s3Key = ref.key;
      const s3Bucket = ref.bucket;

      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      const credentials = await getCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      const contentType = getContentType(s3Key);

      const s3Client = new S3Client({
        region,
        credentials,
        ResponseContentDisposition: `inline; filename="${s3Key}"`,
        ResponseContentType: contentType,
      });

      const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      });

      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      return signedUrl;
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      return null;
    }
  };

  // Render the reference list items
  const renderReferenceItems = () => (
    <ul className="list-unstyled">
      {processedRefs.map((ref, idx) => (
        <li key={idx}>
          <Button
            variant="link"
            className="p-0"
            onClick={() => handleDocumentAccess(ref, idx)}
            disabled={downloadingIndex === idx}
            style={{
              color: ref.error ? '#dc3545' : '#4b007d',
              textDecoration: ref.error ? 'line-through' : 'underline',
            }}
          >
            {ref.isS3 ? (
              <>
                <i className="bi bi-file-earmark-text me-1"></i>
                {ref.displayName}
                {downloadingIndex === idx && (
                  <span className="ms-2">
                    <i className="bi bi-arrow-down-circle-fill animate-pulse"></i>
                  </span>
                )}
              </>
            ) : (
              ref.displayName
            )}
          </Button>
          {ref.error && <span className="text-danger ms-2">(Unable to access file)</span>}
        </li>
      ))}
    </ul>
  );

  if (!references || references.length === 0) return null;

  // Simple list mode (for tool results)
  if (!showAsDropdown) {
    return (
      <div className={`references-list ${noIndent ? '' : 'mt-2'}`}>
        {/* Invisible link for downloads */}
        <a ref={downloadLinkRef} style={{ display: 'none' }} />
        {showLabel && <strong>{label}:</strong>}
        <div className={noIndent ? '' : 'ms-3'}>{renderReferenceItems()}</div>
      </div>
    );
  }

  // Dropdown mode (for main chat)
  return (
    <div className="references-dropdown mt-2">
      {/* Invisible link for downloads */}
      <a ref={downloadLinkRef} style={{ display: 'none' }} />
      <Button
        variant="link"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-controls="references-collapse"
        aria-expanded={open}
        style={{ color: '#4b007d' }}
      >
        {open ? `Hide ${label}` : `Show ${label}`}
      </Button>
      <Collapse in={open}>
        <div id="references-collapse" className="ms-3">
          {renderReferenceItems()}
        </div>
      </Collapse>
    </div>
  );
};

export { ChatReferencesDropdown };
