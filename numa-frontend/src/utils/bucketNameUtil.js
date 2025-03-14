import { GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Generates policy builder specific bucket paths
 * @param {Object} config - Application config object
 * @param {string} jobId - The job ID for the policy
 * @param {S3Client} s3Client - The S3 client instance
 * @param {string} fileExtension - The file extension, default is '.pdf'
 * @returns {Promise<Object>} - An object containing the bucket name and key
 */
export const getPolicyBuilderBucketInfo = async (config, jobId, s3Client, fileExtension = '.pdf') => {
  // Check if CLIENT_NAME is defined
  if (config.CLIENT_NAME === undefined) {
    console.warn('CLIENT_NAME is not defined in the config');
  }

  // Check if CLIENT_NAME is defined
  if (config.CLIENT_NAME === undefined) {
    console.warn('CLIENT_NAME is not defined in the config');
  }

  // Check if JOB_ID is defined
  if (jobId === undefined) {
    console.warn('JOB_ID is not defined in the config');
  }

  // Check if S3 client is defined
  if (s3Client === undefined) {
    console.warn('S3 client is not defined in the config');
  }

  // Default bucket name from config
  const bucketName = config.OUTPUTS_BUCKET_NAME;
  if (bucketName === undefined) {
    console.warn('OUTPUTS_BUCKET_NAME is not defined in the config');
  }

  // Define new and legacy key paths
  const newKeyPath = `policy-builder/${jobId}/final_policy${fileExtension}`;
  const legacyKeyPath = `${config.CLIENT_NAME}-nzsba-policy-builder/${jobId}/final_policy${fileExtension}`;

  console.log('newKeyPath', newKeyPath);
  console.log('legacyKeyPath', legacyKeyPath);

  // Try to find the file at the new location first
  let key = newKeyPath;
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3Client.send(command);
    console.log('File found at new location:', key);
  } catch {
    console.log('File not found at new location, trying old location');
    // If the file doesn't exist at the new location, try the old location
    key = legacyKeyPath;
  }

  return {
    bucketName,
    key,
  };
};
