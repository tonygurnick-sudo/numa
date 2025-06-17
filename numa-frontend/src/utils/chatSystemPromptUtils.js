import { fetchCompanyInfo, getProfileText } from './companyInfoUtils';

/**
 * Enhances the base system prompt with company profile information
 * @param {string} basePrompt - The base system prompt
 * @param {string} companyProfile - Optional pre-loaded company profile text
 * @returns {string} - Enhanced system prompt with company profile
 */
export const enhanceSystemPromptWithCompanyInfo = (basePrompt, companyProfile) => {
  if (!companyProfile || companyProfile.trim() === '') {
    return basePrompt;
  }

  // Split the base prompt to insert company info before user information
  const userInfoSplit = 'Here is some information about the user that you can use to personalise your response:';

  if (basePrompt.includes(userInfoSplit)) {
    const [beforeUserInfo, afterUserInfo] = basePrompt.split(userInfoSplit);
    return `${beforeUserInfo.trim()}\n\n**Company Information:**\n${companyProfile}\n\n${userInfoSplit}${afterUserInfo}`;
  }

  // If we can't find the split point, just append company info to the end
  return `${basePrompt}\n\n**Company Information:**\n${companyProfile}`;
};

/**
 * Loads company profile information from S3
 * @param {string} companyBucket - S3 bucket name for company data
 * @param {string} region - AWS region
 * @param {Function} getCredentials - Function to get AWS credentials
 * @returns {Promise<string>} - Company profile text or empty string if not available
 */
export const loadCompanyProfile = async (companyBucket, region, getCredentials) => {
  if (!region || !companyBucket || !getCredentials) {
    console.log('Missing required parameters for loading company profile');
    return '';
  }

  try {
    const companyInfo = await fetchCompanyInfo(companyBucket, region, getCredentials);
    return getProfileText(companyInfo);
  } catch (error) {
    console.error('Error loading company profile:', error);
    return '';
  }
};
