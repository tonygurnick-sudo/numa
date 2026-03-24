/**
 * Generates policy builder specific bucket paths
 * @param {Object} config - Application config object
 * @param {string} jobId - The job ID for the policy
 * @param {string} stepFunctionJobId - The job ID for the step function
 * @param {S3Client} s3Client - The S3 client instance
 * @param {string} fileExtension - The file extension, default is '.pdf'
 * @param {string} userId - The user's sub from authentication
 * @param {Object} jobDetails - Optional job details with results field
 * @returns {Promise<Object>} - An object containing the bucket name and key
 */
export const getPolicyBuilderBucketInfo = async (
  config,
  jobId,
  stepFunctionJobId,
  s3Client,
  fileExtension = '.pdf',
  userId,
  jobDetails = null
) => {
  // Check if CLIENT_NAME is defined
  if (config.CLIENT_NAME === undefined) {
    console.warn('CLIENT_NAME is not defined in the config');
  }

  // Check if STEP_FUNCTION_JOB_ID is defined
  if (stepFunctionJobId === undefined) {
    console.warn('STEP_FUNCTION_JOB_ID is not defined in the config');
  }

  // Check if JOB_ID is defined
  if (jobId === undefined) {
    console.warn('JOB_ID is not defined in the config');
  }

  // Check if S3 client is defined
  if (s3Client === undefined) {
    console.warn('S3 client is not defined in the config');
  }

  // Check if userId is defined
  if (userId === undefined) {
    console.warn('userId is not defined');
  }

  // Default bucket name from config
  const bucketName = config.OUTPUTS_BUCKET_NAME;
  if (bucketName === undefined) {
    console.warn('OUTPUTS_BUCKET_NAME is not defined in the config');
  }

  // Try to extract the key from the job results if available
  let key;

  // Check if we have job details with results
  if (jobDetails && jobDetails.results) {
    try {
      // Parse the results JSON string
      const resultsObj = typeof jobDetails.results === 'string' ? JSON.parse(jobDetails.results) : jobDetails.results;

      // Check if we have a final_policy_pdf_key in the results
      if (resultsObj.final_policy_pdf_key) {
        key = resultsObj.final_policy_pdf_key;
        return { bucketName, key };
      }
    } catch (error) {
      console.error('Error parsing job results:', error);
    }
  }

  // Fall back to constructing the key if we couldn't extract it from results
  key = `policy-builder/${userId}/${stepFunctionJobId}/final_policy${fileExtension}`;

  return {
    bucketName,
    key,
  };
};
