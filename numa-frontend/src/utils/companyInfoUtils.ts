import { uploadFileToS3, fetchFileFromS3 } from './s3Utils';

// Constants
const COMPANY_INFO_KEY = 'company-data.json'; // Keep the same file name for backward compatibility
const COMPANY_PROFILE_CACHE_KEY = 'COMPANY_PROFILE_DATA';

/**
 * Returns the cached company profile from sessionStorage, or null if not cached.
 */
const getCachedCompanyProfile = () => {
  try {
    const cached = window.sessionStorage.getItem(COMPANY_PROFILE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

/**
 * Writes the company profile to the sessionStorage cache.
 */
const setCachedCompanyProfile = (companyInfo) => {
  try {
    window.sessionStorage.setItem(COMPANY_PROFILE_CACHE_KEY, JSON.stringify(companyInfo));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

/**
 * Clears the cached company profile from sessionStorage.
 * Call this when you need to force a fresh fetch from S3.
 */
export const clearCompanyProfileCache = () => {
  try {
    window.sessionStorage.removeItem(COMPANY_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
};

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

    // Convert company info to JSON string
    const dataContent = JSON.stringify(companyInfo, null, 2);

    // Create a processed file object that matches what uploadFileToS3 expects
    const processedFile = {
      content: dataContent,
      contentType: 'application/json',
      inferredType: 'json',
    };

    // Use the existing uploadFileToS3 utility function
    const result = await uploadFileToS3(
      processedFile.content,
      processedFile.contentType,
      s3Bucket,
      COMPANY_INFO_KEY,
      region,
      getCredentials
    );

    // Update the sessionStorage cache so chat pages pick up changes immediately
    setCachedCompanyProfile(companyInfo);

    return result;
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
  // Check sessionStorage cache first to avoid unnecessary S3 calls (and 403 console errors)
  const cached = getCachedCompanyProfile();
  if (cached) {
    return cached;
  }

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
      setCachedCompanyProfile(companyInfo);
      return companyInfo;
    } catch (fetchError) {
      // Check if this is a 404 (Not Found) or 403 (Forbidden) error, which is expected for new environments
      // S3 often returns 403 instead of 404 when the file doesn't exist due to bucket policy
      if (
        fetchError.message &&
        (fetchError.message.includes('Not Found') || fetchError.message.includes('Forbidden'))
      ) {
        console.warn('Company information file does not exist yet. Will create on first save.');
        const emptyProfile = { profile: '', lastUpdated: null };
        setCachedCompanyProfile(emptyProfile);
        return emptyProfile;
      }
      // For other errors, re-throw to be handled by the outer catch
      throw fetchError;
    }
  } catch (error) {
    // Handle any other errors (silently for expected missing file scenarios)
    console.warn('Company profile not available:', error.message || error);
    const emptyProfile = { profile: '', lastUpdated: null };
    setCachedCompanyProfile(emptyProfile);
    return emptyProfile;
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
