import {
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const fetchFileFromS3 = async (s3Key, s3Bucket, region, getCredentials) => {
  const credentials = await getCredentials(); // Fetch credentials from AuthProvider

  if (!credentials?.accessKeyId) {
    throw new Error('AWS Credentials are missing.');
  }

  const s3Client = new S3Client({
    region,
    credentials,
  });

  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const blob = await response.blob();
  return new Blob([blob], { type: response.headers.get('content-type') });
};

/**
 * Check if an S3 object exists using a HEAD request.
 */
export const doesObjectExist = async (s3Key, s3Bucket, region, getCredentials) => {
  const credentials = await getCredentials();

  if (!credentials?.accessKeyId) {
    throw new Error('AWS Credentials are missing.');
  }

  const s3Client = new S3Client({ region, credentials });

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      }),
    );
    return true;
  } catch (error) {
    if (error?.name === 'NotFound' || error?.Code === 'NotFound') {
      return false;
    }
    throw error;
  }
};

export const uploadFileToS3 = async (content, contentType, s3Bucket, s3Key, region, getCredentials) => {
  const credentials = await getCredentials();
  const s3Client = new S3Client({ region, credentials });

  // Upload file to S3
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: content,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return `s3://${s3Bucket}/${s3Key}`;
};

// New file handling utilities

/**
 * Get a signed URL for an S3 object
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {number} expiresIn - URL expiration time in seconds
 * @returns {Promise<string>} - The signed URL
 */
export const getSignedUrlForS3Object = async (s3Key, s3Bucket, region, getCredentials, expiresIn = 3600) => {
  const credentials = await getCredentials();

  if (!credentials?.accessKeyId) {
    throw new Error('AWS Credentials are missing.');
  }

  const s3Client = new S3Client({
    region,
    credentials,
  });

  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Extract filename from an S3 key or path
 * @param {string} path - S3 key or file path
 * @returns {string} - The extracted filename
 */
export const extractFilenameFromPath = (path) => {
  if (!path) return 'file';
  return path.split('/').pop();
};

/**
 * Download a file from S3 to the user's device
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} [customFilename] - Optional custom filename for download
 * @returns {Promise<void>}
 */
export const downloadFileFromS3 = async (s3Key, s3Bucket, region, getCredentials, customFilename = null) => {
  try {
    const blob = await fetchFileFromS3(s3Key, s3Bucket, region, getCredentials);
    const url = URL.createObjectURL(blob);
    const filename = customFilename || extractFilenameFromPath(s3Key);

    // Create and trigger download link
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up the URL object after download
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    console.error('Error downloading file from S3:', error);
    throw error;
  }
};

/**
 * Open a file from S3 in a new browser tab
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<void>}
 */
export const openFileFromS3InNewTab = async (s3Key, s3Bucket, region, getCredentials) => {
  try {
    const blob = await fetchFileFromS3(s3Key, s3Bucket, region, getCredentials);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (error) {
    console.error('Error opening file from S3:', error);
    throw error;
  }
};

/**
 * Download a file using a signed URL
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} [customFilename] - Optional custom filename for download
 * @returns {Promise<void>}
 */
export const downloadFileWithSignedUrl = async (s3Key, s3Bucket, region, getCredentials, customFilename = null) => {
  try {
    const signedUrl = await getSignedUrlForS3Object(s3Key, s3Bucket, region, getCredentials);
    const filename = customFilename || extractFilenameFromPath(s3Key);

    // Create and trigger download link
    const a = document.createElement('a');
    a.href = signedUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error) {
    console.error('Error downloading file with signed URL:', error);
    throw error;
  }
};

/**
 * Get the URL tag from an S3 object
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<string|null>} - The URL from the tag or null if not found
 */
export const getUrlTagFromS3Object = async (s3Key, s3Bucket, region, getCredentials) => {
  try {
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      console.error('AWS Credentials are missing');
      return null;
    }

    const s3Client = new S3Client({
      region,
      credentials,
    });

    const command = new GetObjectTaggingCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    });

    const response = await s3Client.send(command);

    if (response.TagSet) {
      const urlTag = response.TagSet.find((tag) => tag.Key === 'url');
      // Decode the URL value if it exists
      return urlTag ? decodeURIComponent(urlTag.Value) : null;
    }

    return null;
  } catch (error) {
    console.error('Error getting URL tag from S3 object:', error);
    return null;
  }
};

/**
 * Open a file in a new tab using a signed URL
 * @param {string} s3Key - The S3 object key
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<void>}
 */
export const openFileWithSignedUrl = async (s3Key, s3Bucket, region, getCredentials) => {
  try {
    const signedUrl = await getSignedUrlForS3Object(s3Key, s3Bucket, region, getCredentials);
    window.open(signedUrl, '_blank');
  } catch (error) {
    console.error('Error opening file with signed URL:', error);
    throw error;
  }
};

/**
 * List all objects in an S3 folder (prefix)
 * @param {string} folderPrefix - The folder prefix to list objects from
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<Array>} - Array of S3 object keys
 */
export const listObjectsInFolder = async (folderPrefix, s3Bucket, region, getCredentials) => {
  try {
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = new S3Client({
      region,
      credentials,
    });

    const objects = [];
    let continuationToken = null;

    do {
      const command = new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: folderPrefix,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        objects.push(...response.Contents.map((obj) => obj.Key));
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
  } catch (error) {
    console.error('Error listing objects in folder:', error);
    throw error;
  }
};

/**
 * Delete multiple objects from S3 using bulk delete (up to 1000 objects per batch)
 * @param {Array<string>} objectKeys - Array of S3 object keys to delete
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {Function} [onProgress] - Optional progress callback function
 * @returns {Promise<{successful: Array, failed: Array}>} - Results of deletion
 */
export const deleteMultipleObjectsFromS3 = async (objectKeys, s3Bucket, region, getCredentials, onProgress = null) => {
  try {
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = new S3Client({
      region,
      credentials,
    });

    const successful = [];
    const failed = [];
    const BATCH_SIZE = 1000; // S3 DeleteObjects limit

    // Process in batches of 1000
    for (let i = 0; i < objectKeys.length; i += BATCH_SIZE) {
      const batch = objectKeys.slice(i, i + BATCH_SIZE);

      const command = new DeleteObjectsCommand({
        Bucket: s3Bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: false, // Get detailed results
        },
      });

      try {
        const response = await s3Client.send(command);

        if (response.Deleted) {
          successful.push(...response.Deleted.map((obj) => obj.Key));
        }

        if (response.Errors) {
          failed.push(
            ...response.Errors.map((err) => ({
              key: err.Key,
              code: err.Code,
              message: err.Message,
            })),
          );
        }

        // Call progress callback if provided
        if (onProgress) {
          onProgress({
            processed: Math.min(i + BATCH_SIZE, objectKeys.length),
            total: objectKeys.length,
            successful: successful.length,
            failed: failed.length,
          });
        }
      } catch (error) {
        console.error(`Error deleting batch ${i / BATCH_SIZE + 1}:`, error);
        failed.push(
          ...batch.map((key) => ({
            key,
            code: 'BATCH_ERROR',
            message: error.message,
          })),
        );
      }
    }

    console.log(`Bulk delete completed: ${successful.length} successful, ${failed.length} failed`);
    return { successful, failed };
  } catch (error) {
    console.error('Error in bulk delete operation:', error);
    throw error;
  }
};
