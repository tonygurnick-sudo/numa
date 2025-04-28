import { fetchFileFromS3 } from './s3Utils';

/**
 * Process a file by calling the extract-content-from-file lambda
 *
 * @param {Object} fileInfo - Information about the file in S3
 * @param {string} fileInfo.s3Key - The S3 key of the file
 * @param {string} fileInfo.s3Bucket - The S3 bucket where the file is stored
 * @param {string} fileInfo.fileType - The type of the file (mime-type or extension)
 * @param {string} fileInfo.fileName - The name of the file
 * @param {Object} authContext - Auth context that provides tokens/credentials
 * @param {Function} getIdentityPoolCredentials - Function to get AWS credentials
 * @param {Function} numaPost - The numaPost function from RequestProvider context
 * @returns {Promise<Object>} - Processed file metadata
 */
export const processFile = async (fileInfo, authContext, getIdentityPoolCredentials, numaPost) => {
  const { s3Key, s3Bucket, fileName } = fileInfo;

  try {
    // Call the Lambda to process the file
    const { output_key, output_bucket } = await callExtractContentLambda(
      s3Bucket,
      s3Key,
      fileName,
      authContext,
      getIdentityPoolCredentials,
      numaPost,
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
const callExtractContentLambda = async (bucket, key, fileName, authContext, getIdentityPoolCredentials, numaPost) => {
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
      console.log('Error during initial request:', initialError);
      // If we got a timeout or other error, the Lambda might still be processing
      // so we'll start polling the expected output location
      console.log('Initial request failed. Starting S3 polling...');
    }

    // Start polling the S3 location directly
    return await pollS3ForFile(outputBucket, outputKey, getIdentityPoolCredentials);
  } catch (error) {
    console.error('Error in extract content lambda process:', error);
    throw new Error(`File processing failed: ${error.message}`);
  }
};

/**
 * Poll S3 directly for the file until it exists
 */
const pollS3ForFile = async (bucket, key, getIdentityPoolCredentials) => {
  const POLL_INTERVAL = 10000; // Check every 10 seconds
  const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes total polling time
  const region = window.sessionStorage.getItem('REGION');

  const startTime = Date.now();
  const maxEndTime = startTime + MAX_POLL_TIME;
  let attempt = 0;

  console.log(
    `Starting polling for ${key} with ${POLL_INTERVAL / 1000} second intervals (max ${MAX_POLL_TIME / 60000} minutes)`,
  );

  while (Date.now() < maxEndTime) {
    attempt++;

    console.log(`Polling attempt ${attempt} for ${key} (${Math.round((maxEndTime - Date.now()) / 1000)}s remaining)`);

    try {
      // Try to fetch the file from S3
      const contentFile = await fetchFileFromS3(key, bucket, region, getIdentityPoolCredentials);

      if (contentFile) {
        console.log(`Found file in S3: ${bucket}/${key}`);
        return {
          output_key: key,
          output_bucket: bucket,
        };
      }
    } catch (error) {
      console.warn(`Error checking S3 (attempt ${attempt}):`, error);
      // Continue to wait - file might not exist yet
    }

    // Wait for fixed interval before next check
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error(`File processing timed out after ${attempt} polling attempts (${MAX_POLL_TIME / 1000} seconds)`);
};
