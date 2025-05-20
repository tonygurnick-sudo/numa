import { GetObjectCommand, GetObjectTaggingCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const fetchFileFromS3 = async (s3Key, s3Bucket, region, getIdentityPoolCredentials) => {
  const credentials = await getIdentityPoolCredentials(); // Fetch credentials from AuthProvider

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

export const uploadFileToS3 = async (content, contentType, s3Bucket, s3Key, region, getIdentityPoolCredentials) => {
  const credentials = await getIdentityPoolCredentials();
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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @param {number} expiresIn - URL expiration time in seconds
 * @returns {Promise<string>} - The signed URL
 */
export const getSignedUrlForS3Object = async (
  s3Key,
  s3Bucket,
  region,
  getIdentityPoolCredentials,
  expiresIn = 3600,
) => {
  const credentials = await getIdentityPoolCredentials();

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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @param {string} [customFilename] - Optional custom filename for download
 * @returns {Promise<void>}
 */
export const downloadFileFromS3 = async (
  s3Key,
  s3Bucket,
  region,
  getIdentityPoolCredentials,
  customFilename = null,
) => {
  try {
    const blob = await fetchFileFromS3(s3Key, s3Bucket, region, getIdentityPoolCredentials);
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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @returns {Promise<void>}
 */
export const openFileFromS3InNewTab = async (s3Key, s3Bucket, region, getIdentityPoolCredentials) => {
  try {
    const blob = await fetchFileFromS3(s3Key, s3Bucket, region, getIdentityPoolCredentials);
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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @param {string} [customFilename] - Optional custom filename for download
 * @returns {Promise<void>}
 */
export const downloadFileWithSignedUrl = async (
  s3Key,
  s3Bucket,
  region,
  getIdentityPoolCredentials,
  customFilename = null,
) => {
  try {
    const signedUrl = await getSignedUrlForS3Object(s3Key, s3Bucket, region, getIdentityPoolCredentials);
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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @returns {Promise<string|null>} - The URL from the tag or null if not found
 */
export const getUrlTagFromS3Object = async (s3Key, s3Bucket, region, getIdentityPoolCredentials) => {
  try {
    const credentials = await getIdentityPoolCredentials();

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
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @returns {Promise<void>}
 */
export const openFileWithSignedUrl = async (s3Key, s3Bucket, region, getIdentityPoolCredentials) => {
  try {
    const signedUrl = await getSignedUrlForS3Object(s3Key, s3Bucket, region, getIdentityPoolCredentials);
    window.open(signedUrl, '_blank');
  } catch (error) {
    console.error('Error opening file with signed URL:', error);
    throw error;
  }
};
