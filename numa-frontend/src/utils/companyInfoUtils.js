import { uploadFileToS3, fetchFileFromS3 } from './s3Utils';

// Constants
const COMPANY_INFO_KEY = 'company-data.json'; // Keep the same file name for backward compatibility

/**
 * Saves the company information to S3
 * @param {string} profileText - The company profile text
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - The AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<string>} - The S3 URI of the saved data
 */
export const saveCompanyInfo = async (profileText, s3Bucket, region, getCredentials) => {
  try {
    // Validate required parameters
    if (!region) {
      throw new Error('Region is missing for saveCompanyInfo');
    }

    if (!s3Bucket) {
      throw new Error('S3 bucket name is missing for saveCompanyInfo');
    }

    // Create a structured JSON object with the profile text
    // This allows for future expansion with additional company information
    const companyInfo = {
      profile: profileText,
      lastUpdated: new Date().toISOString(),
    };
    console.log('companyInfo', companyInfo);

    // Convert company info to JSON string
    const dataContent = JSON.stringify(companyInfo, null, 2);

    // Create a processed file object that matches what uploadFileToS3 expects
    const processedFile = {
      content: dataContent,
      contentType: 'application/json',
      inferredType: 'json',
    };

    // Use the existing uploadFileToS3 utility function
    return await uploadFileToS3(
      processedFile.content,
      processedFile.contentType,
      s3Bucket,
      COMPANY_INFO_KEY,
      region,
      getCredentials,
    );
  } catch (error) {
    console.error('Error saving company information:', error);
    throw error; // Re-throw the error for the component to handle
  }
};

/**
 * Fetches the company information from S3
 * @param {string} s3Bucket - The S3 bucket name
 * @param {string} region - The AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<Object>} - The company info object with profile text and metadata
 */
export const fetchCompanyInfo = async (s3Bucket, region, getCredentials) => {
  try {
    // Validate required parameters
    if (!region) {
      console.error('Region is missing for fetchCompanyInfo');
      return { profile: '', lastUpdated: null };
    }

    if (!s3Bucket) {
      console.error('S3 bucket name is missing for fetchCompanyInfo');
      return { profile: '', lastUpdated: null };
    }

    try {
      // Use the fetchFileFromS3 utility function to get the file
      const fileBlob = await fetchFileFromS3(COMPANY_INFO_KEY, s3Bucket, region, getCredentials);

      // Convert blob to JSON
      const text = await fileBlob.text();
      const companyInfo = JSON.parse(text);
      return companyInfo;
    } catch (fetchError) {
      // Check if this is a 404 (Not Found) error, which is expected for new environments
      if (fetchError.message && fetchError.message.includes('Not Found')) {
        console.log('Company information file does not exist yet. Will create on first save.');
        return { profile: '', lastUpdated: null };
      }
      // For other errors, re-throw to be handled by the outer catch
      throw fetchError;
    }
  } catch (error) {
    // Handle any other errors
    console.error('Error fetching company information:', error);
    return { profile: '', lastUpdated: null };
  }
};

/**
 * Helper function to extract just the profile text from the company information
 * @param {Object} companyInfo - The company info object
 * @returns {string} - The company profile text
 */
export const getProfileText = (companyInfo) => {
  return companyInfo?.profile || '';
};
