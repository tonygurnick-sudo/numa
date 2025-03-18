import { useState, useEffect, useRef } from 'react';
import { Button, Collapse } from 'react-bootstrap';

/**
 * Helper component to display a collapsible references panel
 * Handles S3 URIs by generating pre-signed URLs and displaying user-friendly names
 */
export function ReferencesDropdown({ references, getIdentityPoolCredentials }) {
  const [open, setOpen] = useState(false);
  const [processedRefs, setProcessedRefs] = useState([]);
  const [downloadingIndex, setDownloadingIndex] = useState(null);
  const downloadLinkRef = useRef(null);

  useEffect(() => {
    // Process references when they change
    const processReferences = async () => {
      if (!references || references.length === 0) return;

      const processed = await Promise.all(
        references.map(async (ref) => {
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

          // Check if it's an S3 URL from Amazon Q Business (https://bucket-name.s3.amazonaws.com/...)
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

      setProcessedRefs(processed);
    };

    processReferences();
  }, [references, getIdentityPoolCredentials]);

  // Function to handle document access using invisible link approach with pre-signed URLs
  const handleDocumentAccess = async (ref, index) => {
    if (!ref.isS3 || !ref.bucket || !ref.key) {
      // For non-S3 URLs, just open in a new tab
      window.open(ref.url, '_blank');
      return;
    }

    try {
      setDownloadingIndex(index);

      // Always use the pre-signed URL approach for all S3 documents
      // This ensures proper authentication regardless of the source
      // Generate a pre-signed URL
      const region = window.sessionStorage.getItem('REGION') || 'us-east-1';
      const s3Key = ref.key;
      const s3Bucket = ref.bucket;

      // Import the required S3 modules dynamically
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      // Get credentials from the auth provider
      const credentials = await getIdentityPoolCredentials();
      if (!credentials) {
        throw new Error('Failed to get AWS credentials');
      }

      // Create an S3 client with the credentials
      const s3Client = new S3Client({
        region,
        credentials,
      });

      // Create a GetObject command
      const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      });

      // Generate a pre-signed URL (valid for 1 hour)
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      console.log('Original S3 URL:', ref.originalRef);
      console.log('Generated Pre-signed URL:', signedUrl);

      // Create an invisible link element and trigger it programmatically
      const link = document.createElement('a');
      link.href = signedUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      // Clean up the DOM after the link is clicked
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

  if (!references || references.length === 0) return null;

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
        {open ? 'Hide References' : 'Show References'}
      </Button>
      <Collapse in={open}>
        <div id="references-collapse" className="ms-3">
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
        </div>
      </Collapse>
    </div>
  );
}
