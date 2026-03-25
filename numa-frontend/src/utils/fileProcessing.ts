import { fetchFileFromS3, doesObjectExist } from './s3Utils';

/**
 * Process a file by calling the extract-content-from-file lambda
 *
 * @param {Object} fileInfo - Information about the file in S3
 * @param {string} fileInfo.s3Key - The S3 key of the file
 * @param {string} fileInfo.s3Bucket - The S3 bucket where the file is stored
 * @param {string} fileInfo.fileType - The type of the file (mime-type or extension)
 * @param {string} fileInfo.fileName - The name of the file
 * @param {Object} authContext - Auth context that provides tokens/credentials
 * @param {Function} getCredentials - Function to get AWS credentials
 * @param {Function} numaPost - The numaPost function from RequestProvider context
 * @returns {Promise<Object>} - Processed file metadata
 */
export const processFile = async (fileInfo, authContext, getCredentials, numaPost) => {
  const { s3Key, s3Bucket, fileName } = fileInfo;

  try {
    // Call the Lambda to process the file
    const { output_key, output_bucket } = await callExtractContentLambda(
      s3Bucket,
      s3Key,
      fileName,
      authContext,
      getCredentials,
      numaPost
    );

    // Return the processed file data
    return {
      fileName,
      s3Key,
      s3Bucket,
      extractedContentS3Key: output_key,
      output_bucket: output_bucket,
    };
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  }
};

/**
 * Call the extract-content-from-file lambda function to process a file in S3
 */
const callExtractContentLambda = async (bucket, key, fileName, authContext, getCredentials, numaPost) => {
  try {
    // Get API endpoint from session storage
    const API_GATEWAY_URL = window.sessionStorage.getItem('API_ENDPOINT') || '/api';
    const extractUrl = `${API_GATEWAY_URL}/extract-content`;

    const outputBucket = bucket;

    // Keep the file in the same folder but append .json extension
    const keyParts = key.split('/');
    const baseName = keyParts.pop(); // Get the file name without path
    const directory = keyParts.join('/'); // Get the directory path
    const outputKey = `${directory}/${baseName}.json`;

    const requestBody = {
      input_bucket: bucket,
      input_key: key,
      output_bucket: bucket,
      output_key: outputKey,
      file_name: fileName,
    };

    // Try the initial request - this might succeed for quick processing
    try {
      // Use numaPost instead of fetch - it will handle auth headers automatically
      const responseData = await numaPost(extractUrl, requestBody);

      if (responseData) {
        return {
          output_key: responseData.output_key,
          output_bucket: responseData.output_bucket,
        };
      }
    } catch (initialError) {
      console.error('Error during initial request:', initialError);
      // If we got a timeout or other error, the Lambda might still be processing
      // so we'll start polling the expected output location
      console.error('Initial request failed. Starting S3 polling...');
    }

    // Start polling the S3 location directly
    return await pollS3ForFile(outputBucket, outputKey, getCredentials);
  } catch (error) {
    console.error('Error in extract content lambda process:', error);
    throw new Error(`File processing failed: ${error.message}`);
  }
};

/**
 * Poll S3 directly for the file until it exists
 */
const pollS3ForFile = async (bucket, key, getCredentials) => {
  const POLL_INTERVAL = 10000; // Check every 10 seconds
  const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes total polling time
  const region = window.sessionStorage.getItem('REGION');

  const startTime = Date.now();
  const maxEndTime = startTime + MAX_POLL_TIME;
  let attempt = 0;

  // Derive status file key from output key
  const statusKey = key.endsWith('.json') ? key.replace(/\.json$/, '.status.json') : `${key}.status.json`;

  while (Date.now() < maxEndTime) {
    attempt++;

    try {
      // Quietly check for status file existence first (HEAD)
      const statusExists = await doesObjectExist(statusKey, bucket, region, getCredentials);

      if (statusExists) {
        // Fetch and inspect status JSON
        const statusBlob = await fetchFileFromS3(statusKey, bucket, region, getCredentials);
        const statusText = await statusBlob.text();
        try {
          const status = JSON.parse(statusText);
          const state = (status?.status || '').toUpperCase();
          if (state === 'SUCCEEDED') {
            const outKey = status?.output_key || key;
            const outBucket = status?.output_bucket || bucket;
            return { output_key: outKey, output_bucket: outBucket };
          }
          if (state === 'FAILED') {
            const msg = status?.error_message || 'File processing failed';
            throw new Error(msg);
          }
          // IN_PROGRESS or unknown -> keep waiting
        } catch (parseErr) {
          // If status is malformed, log and continue polling
          console.warn('Unable to parse status JSON; continuing to poll.', parseErr);
        }
      } else {
        // If no status file yet, check if output exists directly
        try {
          const outputExists = await doesObjectExist(key, bucket, region, getCredentials);
          if (outputExists) {
            return { output_key: key, output_bucket: bucket };
          }
        } catch (headErr) {
          console.warn('HEAD check encountered an error; will retry.', headErr);
        }
      }
    } catch (error) {
      // Avoid noisy console errors during normal polling
      console.warn(`S3 check encountered an error on attempt ${attempt}:`, error);
    }

    // Wait for fixed interval before next check
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error(`File processing timed out after ${attempt} polling attempts (${MAX_POLL_TIME / 1000} seconds)`);
};
