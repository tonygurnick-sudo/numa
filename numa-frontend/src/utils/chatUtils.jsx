import { useState, useEffect } from 'react';
import { Button, Collapse } from 'react-bootstrap';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Helper component to display a collapsible references panel
 * Handles S3 URIs by generating pre-signed URLs and displaying user-friendly names
 */
export function ReferencesDropdown({ references, getIdentityPoolCredentials }) {
  const [open, setOpen] = useState(false);
  const [processedRefs, setProcessedRefs] = useState([]);

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

              // Get pre-signed URL
              const credentials = await getIdentityPoolCredentials();
              const s3Client = new S3Client({
                region: 'us-east-1', // Use the appropriate region
                credentials,
              });

              const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key,
              });

              const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

              // Extract filename for display
              const fileName = key.split('/').pop() || 'file';

              return {
                originalRef: ref,
                url: signedUrl,
                displayName: fileName,
                isS3: true,
              };
            } catch (error) {
              console.error('Error generating pre-signed URL:', error);
              return {
                originalRef: ref,
                url: '#',
                displayName: ref,
                isS3: true,
                error: true,
              };
            }
          }

          // Not an S3 URI, return as is
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

  if (!references || references.length === 0) return null;

  return (
    <div className="references-dropdown mt-2">
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
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: ref.error ? '#dc3545' : '#4b007d',
                    textDecoration: ref.error ? 'line-through' : 'underline',
                  }}
                >
                  {ref.isS3 ? (
                    <>
                      <i className="bi bi-file-earmark-text me-1"></i>
                      {ref.displayName}
                    </>
                  ) : (
                    ref.displayName
                  )}
                </a>
                {ref.error && <span className="text-danger ms-2">(Unable to access file)</span>}
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </div>
  );
}
