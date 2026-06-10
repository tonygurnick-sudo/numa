import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import JSZip from 'jszip';
import { withPRM } from './prmUtils';

const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_EXPIRY_SKEW_MS = 5000;

export const getCachedBrandingAssetUrl = (value: unknown): string | undefined => {
  const location = resolveS3Location(value);
  if (!location) {
    return undefined;
  }

  const cached = SIGNED_URL_CACHE.get(`${location.bucket}|${location.key}`);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt - SIGNED_URL_EXPIRY_SKEW_MS <= Date.now()) {
    SIGNED_URL_CACHE.delete(`${location.bucket}|${location.key}`);
    return undefined;
  }

  return cached.url;
};

export const fetchFileFromS3 = async (s3Key, s3Bucket, region, getCredentials) => {
  const credentials = await getCredentials(); // Fetch credentials from AuthProvider

  if (!credentials?.accessKeyId) {
    throw new Error('AWS Credentials are missing.');
  }

  const s3Client = withPRM(S3Client, {
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

  const s3Client = withPRM(S3Client, { region, credentials });

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      })
    );
    return true;
  } catch (error) {
    if (error?.name === 'NotFound' || error?.Code === 'NotFound') {
      return false;
    }
    throw error;
  }
};

export const getInitialBrandingAssetUrl = (
  value: unknown,
  fallback: string,
  options: { useCache?: boolean } = {}
): string => {
  if (options.useCache) {
    const cached = getCachedBrandingAssetUrl(value);
    if (cached) {
      return cached;
    }
  }

  const location = resolveS3Location(value);
  if (!location) {
    return fallback;
  }

  const region = typeof window !== 'undefined' ? window.sessionStorage?.getItem('REGION') : null;
  if (!region) {
    return fallback;
  }

  const unsigned = buildS3HttpsUrl(location.bucket, location.key, region);
  return unsigned ?? fallback;
};

export const uploadFileToS3 = async (content, contentType, s3Bucket, s3Key, region, getCredentials) => {
  const credentials = await getCredentials();
  const s3Client = withPRM(S3Client, { region, credentials });

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

  const s3Client = withPRM(S3Client, {
    region,
    credentials,
  });

  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

type S3Location = {
  bucket: string;
  key: string;
  region?: string;
};

export const resolveS3Location = (value: unknown): S3Location | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && value.startsWith('s3://')) {
    const withoutScheme = value.slice('s3://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) {
      return null;
    }

    return {
      bucket: withoutScheme.slice(0, slashIndex),
      key: withoutScheme.slice(slashIndex + 1),
    };
  }

  try {
    const url = new URL(String(value));
    const path = url.pathname.replace(/^\/+/u, '');
    if (!path) {
      return null;
    }

    const hostParts = url.hostname.split('.');
    const s3Index = hostParts.findIndex((part) => part === 's3');

    if (s3Index > 0) {
      const bucket = hostParts.slice(0, s3Index).join('.');
      const regionPart = hostParts[s3Index + 1];
      const region = regionPart && regionPart !== 'amazonaws' ? regionPart : undefined;

      return {
        bucket,
        key: path,
        region,
      };
    }

    if (url.hostname === 's3.amazonaws.com' || url.hostname.startsWith('s3.')) {
      const segments = path.split('/');
      const bucket = segments.shift();
      const key = segments.join('/');
      if (bucket && key) {
        return { bucket, key };
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const buildS3HttpsUrl = (bucket: string | undefined, key: string | undefined, region?: string | null) => {
  if (!bucket || !key) {
    return undefined;
  }

  const normalizedKey = key.replace(/^\/+/u, '');
  if (region) {
    return `https://${bucket}.s3.${region}.amazonaws.com/${normalizedKey}`;
  }

  return `https://${bucket}.s3.amazonaws.com/${normalizedKey}`;
};

type ResolveBrandingAssetOptions = {
  region?: string | null;
  sign?: boolean;
  expiresIn?: number;
};

export const resolveBrandingAssetUrl = async (
  value: unknown,
  getCredentials?: () => Promise<unknown>,
  options: ResolveBrandingAssetOptions = {}
): Promise<string | undefined> => {
  if (!value) {
    return undefined;
  }

  const rawValue = typeof value === 'string' ? value : String(value);
  const location = resolveS3Location(value);
  if (!location) {
    return rawValue;
  }

  const inferredRegion =
    options.region ??
    location.region ??
    (typeof window !== 'undefined' ? window.sessionStorage?.getItem('REGION') : null);

  const unsignedUrl = inferredRegion ? buildS3HttpsUrl(location.bucket, location.key, inferredRegion) : rawValue;

  const cacheKey = `${location.bucket}|${location.key}`;
  const expiresInSeconds = options.expiresIn ?? 900;

  if (inferredRegion) {
    const cached = SIGNED_URL_CACHE.get(cacheKey);
    if (cached && cached.expiresAt - SIGNED_URL_EXPIRY_SKEW_MS > Date.now()) {
      return cached.url;
    }
  }

  if (options.sign === false || !getCredentials || !inferredRegion) {
    SIGNED_URL_CACHE.delete(cacheKey);
    return unsignedUrl;
  }

  try {
    const signedUrl = await getSignedUrlForS3Object(
      location.key,
      location.bucket,
      inferredRegion,
      getCredentials,
      options.expiresIn ?? 900
    );
    SIGNED_URL_CACHE.set(cacheKey, {
      url: signedUrl,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
    return signedUrl;
  } catch (error) {
    console.error('Failed to sign S3 asset URL', { value, error });
    return unsignedUrl;
  }
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

    // Fetch as blob to bypass cross-origin download attribute restrictions
    const response = await fetch(signedUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
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

    const s3Client = withPRM(S3Client, {
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

    const s3Client = withPRM(S3Client, {
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

    const s3Client = withPRM(S3Client, {
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
            }))
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
          }))
        );
      }
    }

    return { successful, failed };
  } catch (error) {
    console.error('Error in bulk delete operation:', error);
    throw error;
  }
};

/**
 * Progress callback for folder download operations
 */
export interface FolderDownloadProgress {
  processed: number;
  total: number;
  currentFile: string;
  phase: 'listing' | 'downloading' | 'zipping';
}

/**
 * Download an entire folder from S3 as a zip file
 * @param {string} folderPrefix - The folder prefix to download
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} [zipFilename] - Optional custom name for the zip file
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<void>}
 */
export const downloadFolderAsZip = async (
  folderPrefix: string,
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>,
  zipFilename?: string,
  onProgress?: (progress: FolderDownloadProgress) => void
): Promise<void> => {
  try {
    // Ensure folderPrefix ends with /
    const normalizedPrefix = folderPrefix.endsWith('/') ? folderPrefix : `${folderPrefix}/`;

    // Report listing phase
    if (onProgress) {
      onProgress({
        processed: 0,
        total: 0,
        currentFile: '',
        phase: 'listing',
      });
    }

    // List all objects in the folder
    const objectKeys = await listObjectsInFolder(normalizedPrefix, s3Bucket, region, getCredentials);

    if (objectKeys.length === 0) {
      throw new Error('No files found in the specified folder');
    }

    const zip = new JSZip();
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = withPRM(S3Client, {
      region,
      credentials,
    });

    // Download each file and add to zip
    for (let i = 0; i < objectKeys.length; i++) {
      const key = objectKeys[i];

      // Skip if it's just the folder marker (empty key ending with /)
      if (key.endsWith('/')) {
        continue;
      }

      // Report downloading progress
      if (onProgress) {
        onProgress({
          processed: i,
          total: objectKeys.length,
          currentFile: key,
          phase: 'downloading',
        });
      }

      const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: key,
      });

      const response = await s3Client.send(command);

      if (response.Body) {
        // Convert stream to array buffer
        const bodyContents = await response.Body.transformToByteArray();

        // Get the relative path within the folder
        const relativePath = key.substring(normalizedPrefix.length);

        // Add file to zip with its relative path
        zip.file(relativePath, bodyContents);
      }
    }

    // Report zipping phase
    if (onProgress) {
      onProgress({
        processed: objectKeys.length,
        total: objectKeys.length,
        currentFile: '',
        phase: 'zipping',
      });
    }

    // Generate the zip file
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Determine the zip filename
    const folderName = normalizedPrefix.slice(0, -1).split('/').pop() || 'folder';
    const finalZipName = zipFilename || `${folderName}.zip`;

    // Trigger download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalZipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    console.error('Error downloading folder as zip:', error);
    throw error;
  }
};

/**
 * Path to use for an S3 object inside a zip: the key with its KB prefix
 * (`documents/kb-<id>/`, `documents/company/`, `documents/numa-support/`)
 * stripped, so the archive mirrors the folder structure the user sees in the
 * file browser. Falls back to the full key if the prefix shape is unexpected.
 */
export const zipPathFromKbKey = (key: string): string => {
  const match = key.match(/^documents\/(?:kb-[^/]+|company|numa-support)\/(.+)$/u);
  return match ? match[1] : key;
};

/**
 * Download an explicit set of S3 objects as a single zip, preserving a
 * caller-supplied path for each entry. Unlike downloadMultipleFilesAsZip (which
 * flattens to the bare filename), this keeps folder structure and avoids name
 * collisions across folders — used by bulk download when the selection contains
 * whole folders and/or files from different folders.
 *
 * @param {Array<{key: string, zipPath: string}>} entries - Objects + their in-zip paths
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} [zipFilename] - Optional custom name for the zip file (default: 'files.zip')
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<void>}
 */
export const downloadKeysAsZip = async (
  entries: { key: string; zipPath: string }[],
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>,
  zipFilename: string = 'files.zip',
  onProgress?: (progress: FolderDownloadProgress) => void
): Promise<void> => {
  try {
    if (entries.length === 0) {
      throw new Error('No files to download');
    }

    const zip = new JSZip();
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = withPRM(S3Client, {
      region,
      credentials,
    });

    for (let i = 0; i < entries.length; i++) {
      const { key, zipPath } = entries[i];

      if (onProgress) {
        onProgress({
          processed: i,
          total: entries.length,
          currentFile: key,
          phase: 'downloading',
        });
      }

      const response = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));

      if (response.Body) {
        const bodyContents = await response.Body.transformToByteArray();
        zip.file(zipPath || key.split('/').pop() || key, bodyContents);
      }
    }

    if (onProgress) {
      onProgress({ processed: entries.length, total: entries.length, currentFile: '', phase: 'zipping' });
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    console.error('Error downloading keys as zip:', error);
    throw error;
  }
};

/**
 * Download multiple files from S3 as a zip file
 * @param {Array<string>} s3Keys - Array of S3 object keys to download
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {string} [zipFilename] - Optional custom name for the zip file (default: 'files.zip')
 * @param {Function} [onProgress] - Optional progress callback
 * @returns {Promise<void>}
 */
export const downloadMultipleFilesAsZip = async (
  s3Keys: string[],
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>,
  zipFilename: string = 'files.zip',
  onProgress?: (progress: FolderDownloadProgress) => void
): Promise<void> => {
  try {
    if (s3Keys.length === 0) {
      throw new Error('No files to download');
    }

    const zip = new JSZip();
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = withPRM(S3Client, {
      region,
      credentials,
    });

    // Download each file and add to zip
    for (let i = 0; i < s3Keys.length; i++) {
      const key = s3Keys[i];

      // Report progress
      if (onProgress) {
        onProgress({
          processed: i,
          total: s3Keys.length,
          currentFile: key,
          phase: 'downloading',
        });
      }

      const command = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: key,
      });

      const response = await s3Client.send(command);

      if (response.Body) {
        const bodyContents = await response.Body.transformToByteArray();

        // Use just the filename (not full path) in the zip
        const filename = key.split('/').pop() || key;
        zip.file(filename, bodyContents);
      }
    }

    // Report zipping phase
    if (onProgress) {
      onProgress({
        processed: s3Keys.length,
        total: s3Keys.length,
        currentFile: '',
        phase: 'zipping',
      });
    }

    // Generate and download the zip
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    console.error('Error downloading files as zip:', error);
    throw error;
  }
};

/**
 * List all folders in a knowledge base
 * @param {string} kbId - The knowledge base ID (e.g., 'company' or a UUID)
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<string[]>} - Sorted array of folder paths (e.g., ['folder1', 'folder1/subfolder', 'folder2'])
 */
export const listFoldersInKB = async (
  kbId: string,
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>
): Promise<string[]> => {
  try {
    const credentials = await getCredentials();

    if (!credentials?.accessKeyId) {
      throw new Error('AWS Credentials are missing.');
    }

    const s3Client = withPRM(S3Client, {
      region,
      credentials,
    });

    // Determine the KB prefix
    const kbPrefix = kbId === 'company' ? 'documents/company/' : `documents/kb-${kbId}/`;

    const allKeys: string[] = [];
    let continuationToken = null;

    // List all objects in the KB prefix
    do {
      const command = new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: kbPrefix,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        allKeys.push(...response.Contents.map((obj) => obj.Key || '').filter((key) => key !== ''));
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // Extract unique folder paths
    const folderSet = new Set<string>();

    for (const key of allKeys) {
      // Remove the KB prefix to get the relative path
      const relativePath = key.startsWith(kbPrefix) ? key.substring(kbPrefix.length) : key;

      // Split by '/' to get all path segments
      const segments = relativePath.split('/');

      // Build all parent folder paths
      // For example, 'folder1/folder2/file.txt' would add 'folder1' and 'folder1/folder2'
      for (let i = 1; i < segments.length; i++) {
        const folderPath = segments.slice(0, i).join('/');
        if (folderPath) {
          folderSet.add(folderPath);
        }
      }
    }

    // Convert to array and sort
    const folders = Array.from(folderSet).sort((a, b) => {
      // Sort alphabetically, with shallower folders first
      const aDepth = a.split('/').length;
      const bDepth = b.split('/').length;

      if (aDepth !== bDepth) {
        return aDepth - bDepth;
      }

      return a.localeCompare(b);
    });

    return folders;
  } catch (error) {
    console.error('Error listing folders in KB:', error);
    throw error;
  }
};

// ─── Copy to Knowledge Base ─────────────────────────────────────────────────

export interface CopyToKBOptions {
  sourceKey: string;
  destKey: string;
  bucket: string;
  region: string;
  kbId: string;
  tenantId: string;
  uploaderSub: string;
  uploaderEmail: string;
  getCredentials: () => Promise<unknown>;
}

/** Server-side copy of a single file into a KB prefix, plus metadata sidecar. */
export const copyFileToKB = async (opts: CopyToKBOptions): Promise<void> => {
  const credentials = await opts.getCredentials();
  const s3Client = withPRM(S3Client, { region: opts.region, credentials });

  await s3Client.send(
    new CopyObjectCommand({
      Bucket: opts.bucket,
      CopySource: `${opts.bucket}/${opts.sourceKey}`,
      Key: opts.destKey,
    })
  );

  // Write metadata sidecar (skip for Q Business company KB)
  const preferredKb = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';
  if (!(preferredKb === 'q' && opts.kbId === 'company')) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: `${opts.destKey}.metadata.json`,
        Body: JSON.stringify({
          metadataAttributes: {
            kb_id: opts.kbId,
            uploaded_at: new Date().toISOString(),
            tenant_id: opts.tenantId,
            uploader_id: opts.uploaderSub,
            uploader_email: opts.uploaderEmail,
          },
        }),
        ContentType: 'application/json',
      })
    );
  }
};

export interface CopyItemsToKBProgress {
  completed: number;
  total: number;
  currentFile: string;
}

/** Copy multiple files into a KB, reporting progress. */
export const copyItemsToKB = async (
  sourceKeys: string[],
  destKbPrefix: string,
  destFolder: string,
  opts: Omit<CopyToKBOptions, 'sourceKey' | 'destKey'>,
  onProgress?: (p: CopyItemsToKBProgress) => void
): Promise<void> => {
  for (let i = 0; i < sourceKeys.length; i++) {
    const sourceKey = sourceKeys[i];
    const fileName = sourceKey.split('/').pop() ?? sourceKey;
    const folder = destFolder ? `${destFolder}/` : '';
    const destKey = `${destKbPrefix}${folder}${fileName}`.replace(/\/{2,}/g, '/');
    onProgress?.({ completed: i, total: sourceKeys.length, currentFile: fileName });
    await copyFileToKB({ ...opts, sourceKey, destKey });
  }
  onProgress?.({ completed: sourceKeys.length, total: sourceKeys.length, currentFile: '' });
};
