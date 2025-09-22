import { fetchCompanyInfo, getProfileText } from './companyInfoUtils';

/**
 * Enhances the base system prompt with company profile information
 * @param {string} basePrompt - The base system prompt
 * @param {string} companyProfile - Optional pre-loaded company profile text
 * @param {number} [maxLength=3000] - Maximum character length for company profile in chat context
 * @returns {string} - Enhanced system prompt with company profile
 */
export const enhanceSystemPromptWithCompanyInfo = (basePrompt, companyProfile, maxLength = 3000) => {
  if (!companyProfile || companyProfile.trim() === '') {
    return basePrompt;
  }

  // Truncate company profile if it exceeds the maximum length
  let truncatedProfile = companyProfile;
  let truncationNote = '';

  if (companyProfile.length > maxLength) {
    // Find a good breaking point (end of a sentence) near the maxLength
    const breakPoint = companyProfile.substring(0, maxLength).lastIndexOf('.');
    const actualBreakPoint = breakPoint > 0 ? breakPoint + 1 : maxLength;

    truncatedProfile = companyProfile.substring(0, actualBreakPoint).trim();
    truncationNote = '\n\n[Note: Company profile has been truncated for chat context]';
  }

  // Split the base prompt to insert company info before user information
  const userInfoSplit = 'Here is some information about the user that you can use to personalise your response:';

  if (basePrompt.includes(userInfoSplit)) {
    const [beforeUserInfo, afterUserInfo] = basePrompt.split(userInfoSplit);
    return `${beforeUserInfo.trim()}\n\n**Company Information:**\n${truncatedProfile}${truncationNote}\n\n${userInfoSplit}${afterUserInfo}`;
  }

  // If we can't find the split point, just append company info to the end
  return `${basePrompt}\n\n**Company Information:**\n${truncatedProfile}${truncationNote}`;
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

// Core delegation framework for when connections are available
const DELEGATION_FRAMEWORK = `
**Working with Connections/Integrations:**
You need to think of it like you manage a team of specialist assistants through connection tools. The tools for connections do not work like normal function calling. They expect a single "instruction" parameter. Each tool connects you to a sub-agent expert who completes tasks and reports back to you. This is for connecting to external services like Slack, Notion, Google Calendar, etc.

**How to Use Connections:**

**Delegation Approach:**
- Structure instructions as: "[ACTION] because [INTENT] with [TECHNICAL_DETAILS]"
- Think: "I need X outcome, so I'll ask the [specialist] to do Y"
- Be specific about what outcome you need, not just what data to retrieve
- Include context for why you need it and how detailed the response should be
- Give instructions relevant to each tool. E.g. don't ask google_drive-find-file with instructions to download the tool, instead ask for the file id and then call the download tool separately.

**Expected Response Patterns:**
- Small-medium/structured data (events, contacts) → Ask specialist to return actual data for your analysis
- Large/complex data (documents, transcripts) → Specialist returns processed results due to context limits as it would not fit in the tool response.

**Planning Multi-step Tasks:**
If you anticipate follow-up actions, request supporting details upfront:
✓ "List events today with event IDs because I may need to update one"
✓ "Find the contract document and extract key terms because I need to reference specific clauses"

**Examples:**
✓ "List my events today because I need to analyze my schedule for conflicts, include full details like duration and attendees"
✗ "List calendar events today"
✓ "Find the Q3 sales report because I need to prepare for the board meeting, provide actual revenue numbers and regional breakdown"
✗ "Get sales report"
✓ "Download me example.txt file from google drive and summarize its contents because I need to understand the key points for my meeting, include any action items"
✗ "Download example.txt file from google drive" (the sub-agent will not know what to do with the file - it needs clear instructions for analysis, summarization, or full content extraction within context limits)`;

// Connection-specific prompt instructions
const CONNECTION_PROMPTS: Record<string, string> = {
  slack:
    '- When using Slack tools: Always use as_user: true and include_sent_via_pipedream_flag: false parameters. Only list channels the user is in and that are not archived unless they specifically ask.',
  notion:
    "- When using Notion tools: Focus on the user's accessible pages and databases. Provide structured responses when creating or updating content.",
  google_calendar:
    "- When using Google Calendar tools: Always consider the user's timezone and provide clear time references. When creating events, ask for confirmation of key details.",
  gmail:
    "- When using Gmail tools: Always consider the user's timezone when referencing emails from their inbox, even if they are received in UTC.",
};

/**
 * Generate system prompt based on tool availability and user context
 * @param {Array} enabledTools - List of enabled tool names
 * @param {string} email - User's email address
 * @param {string} companyProfile - Company profile information
 * @param {Array} enabledConnections - List of enabled connection names (optional)
 * @returns {string} Complete system prompt
 */
export const generateSystemPrompt = (enabledTools, email, companyProfile, enabledConnections: string[] = []) => {
  const NOW = new Date();
  const TODAY = {
    date: NOW.toLocaleDateString(),
    time: NOW.toLocaleTimeString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    toString: function () {
      return `Local date: ${this.date}, Local time: ${this.time} (${this.timezone})`;
    },
  };

  // Helper function to generate connection-specific prompts
  const generateConnectionPrompts = (connections: string[]) => {
    const connectionSpecificPrompts = connections
      .map((connection) => CONNECTION_PROMPTS[connection])
      .filter((prompt) => prompt)
      .join('\n');

    if (connections.length > 0) {
      let result = DELEGATION_FRAMEWORK;
      if (connectionSpecificPrompts) {
        result += '\n**IMPORTANT Connection-Specific Guidelines:**\n' + connectionSpecificPrompts;
      }
      return result;
    }
    return '';
  };

  // Generate connection prompts for enabled connections
  const connectionPrompts = generateConnectionPrompts(enabledConnections);

  let baseSystemPrompt = '';
  if (enabledTools.length === 0 && enabledConnections.length === 0) {
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
    // Build tools section with both tools and connections
    const toolLines: string[] = [];

    if (enabledTools.includes('query_knowledge_base')) {
      toolLines.push(
        "- Use query_knowledge_base to search your organization's documents and knowledge base with semantic search",
      );
    }

    if (enabledTools.includes('web_search')) {
      toolLines.push('- Use web_search to find current information from the internet using natural language queries');
    }

    if (connectionPrompts) {
      toolLines.push(connectionPrompts);
    }

    const toolsSection = toolLines.length > 0 ? toolLines.join('\n') : '- No tools are currently enabled.';

    baseSystemPrompt = `You are Numa, an AI assistant created by Arcanum AI who specialises in helping small to medium businesses get their work done and save time on everyday tasks.

**Available Tools:**
Note: Users can select or deselect tools, which is why you may see different tools available in different sessions.
${toolsSection}

**Document Generation:**
For any document, report, email, analysis or anything that may be considered exportable content, wrap it with:
'<!--BEGIN_DOC title="Document Title"-->' and end with '<!--END_DOC-->' (where you infer the title when writing the document)

**Response Guidelines:**
- Use Markdown formatting appropriately
- Ask follow-up questions if requests are ambiguous. If you are unsure of an answer, say so.
- Maintain a professional yet conversational tone
- Personalise your responses using general user or company context information if available.
${enabledTools.includes('web_search') ? '- Decision rubric: Use web_search when the user explicitly asks you to look online or check a website, or when the information is time-sensitive, likely to change, or you are uncertain. Prefer query_knowledge_base for organisational content. When web_search is enabled, do not apologise about browsing limitations; when it is disabled but would help, explain briefly and offer to proceed without it.' : ''}
User Email: ${email}
Today's Date: ${TODAY}`;
  }

  // Apply company profile enhancement if available
  return enhanceSystemPromptWithCompanyInfo(baseSystemPrompt, companyProfile);
};
