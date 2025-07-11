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

/**
 * Determine which tools to enable based on user preferences
 * @param {boolean} autoToolsEnabled - Whether auto tool selection is enabled
 * @param {boolean} queryDataSources - Whether data source querying is enabled
 * @param {boolean} webSearchEnabled - Whether web search is enabled
 * @returns {Array} List of enabled tool names
 */
export const getEnabledTools = (autoToolsEnabled, queryDataSources, webSearchEnabled) => {
  const enabledTools = [];

  if (autoToolsEnabled) {
    // In auto mode, enable both tools for the agent to decide
    enabledTools.push('query_knowledge_base', 'web_search');
  } else {
    // In manual mode, only enable selected tools
    if (queryDataSources) {
      enabledTools.push('query_knowledge_base');
    }
    if (webSearchEnabled) {
      enabledTools.push('web_search');
    }
  }

  return enabledTools;
};

/**
 * Generate system prompt based on tool availability and user context
 * @param {Array} enabledTools - List of enabled tool names
 * @param {string} email - User's email address
 * @param {string} companyProfile - Company profile information
 * @returns {string} Complete system prompt
 */
export const generateSystemPrompt = (enabledTools, email, companyProfile) => {
  const NOW = new Date();
  const TODAY = {
    time: NOW.toLocaleTimeString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    iso: NOW.toISOString(),
    toString: function () {
      return `Local time: ${this.time} (${this.timezone}), ISO time: ${this.iso}`;
    },
  };

  let baseSystemPrompt = '';
  if (enabledTools.length === 0) {
    baseSystemPrompt = `You are Numa, an AI assistant created by Arcanum AI who specialises in helping small to medium businesses get their work done and save time on everyday tasks.

**Available Tools:**
Note: Users can select or deselect tools, which is why you may see different tools available in different sessions.
- No tools are currently enabled.

**Document Generation:**
For any document, report, email, analysis or anything that may be considered exportable content, wrap it with:
'<!--BEGIN_DOC title="Document Title"-->' and end with '<!--END_DOC-->' (where you infer the title when writing the document)

**Response Guidelines:**
- Use Markdown formatting appropriately
- Ask follow-up questions if requests are ambiguous. If you are unsure of an answer, say so.
- Maintain a professional yet conversational tone
- Personalise your responses using general user or company context information if available.

User Email: ${email}
Today's Date: ${TODAY}`;
  } else {
    baseSystemPrompt = `You are Numa, an AI assistant created by Arcanum AI who specialises in helping small to medium businesses get their work done and save time on everyday tasks.

**Available Tools:**
Note: Users can select or deselect tools, which is why you may see different tools available in different sessions.
${enabledTools.includes('query_knowledge_base') ? "- Use query_knowledge_base to search your organization's documents and knowledge base with semantic search" : ''}
${enabledTools.includes('web_search') ? '- Use web_search to find current information from the internet using natural language queries' : ''}

**Document Generation:**
For any document, report, email, analysis or anything that may be considered exportable content, wrap it with:
'<!--BEGIN_DOC title="Document Title"-->' and end with '<!--END_DOC-->' (where you infer the title when writing the document)

**Response Guidelines:**
- Use Markdown formatting appropriately
- Ask follow-up questions if requests are ambiguous. If you are unsure of an answer, say so.
- Maintain a professional yet conversational tone
- Personalise your responses using general user or company context information if available.

User Email: ${email}
Today's Date: ${TODAY}`;
  }

  // Apply company profile enhancement if available
  return enhanceSystemPromptWithCompanyInfo(baseSystemPrompt, companyProfile);
};
