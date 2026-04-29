import { fetchCompanyInfo, getProfileText } from './companyInfoUtils';
import { getFlag } from './featureFlags';

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
    console.warn('Missing required parameters for loading company profile');
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
 * @param {boolean} webSearchEnabled - Whether web search is enabled
 * @param {boolean} createAgentEnabled - Whether agent creation is enabled
 * @param {string[]} enabledKBIds - List of enabled knowledge base IDs
 * @returns {Array} List of enabled tool names
 */
export const getEnabledTools = (
  autoToolsEnabled: boolean,
  webSearchEnabled: boolean,
  _dataAnalysisEnabled = false,
  createAgentEnabled = false,
  enabledKBIds: string[] = [],
  _dataAnalysisAvailable = true,
  memoriesEnabled = true,
  numaOpsEnabled = false
) => {
  const enabledTools: string[] = [];
  const agentsFeatureEnabled = getFlag('AGENTS');
  const numaOpsFeatureEnabled = getFlag('NUMA_OPS');

  if (autoToolsEnabled) {
    // In all tools mode, enable tools; include agent creation only when feature enabled
    if (Array.isArray(enabledKBIds) && enabledKBIds.length > 0) enabledTools.push('knowledge_base');
    enabledTools.push('web_search');
    if (agentsFeatureEnabled) enabledTools.push('create_agent_tool');
    enabledTools.push('memories_tool');
    if (numaOpsFeatureEnabled) enabledTools.push('numa_ops_tool');
  } else {
    // In manual mode, only enable selected tools based on what's selected
    if (Array.isArray(enabledKBIds) && enabledKBIds.length > 0) enabledTools.push('knowledge_base');
    if (webSearchEnabled) enabledTools.push('web_search');
    if (agentsFeatureEnabled && createAgentEnabled) enabledTools.push('create_agent_tool');
    if (memoriesEnabled) enabledTools.push('memories_tool');
    if (numaOpsFeatureEnabled && numaOpsEnabled) enabledTools.push('numa_ops_tool');
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
- For all API calls where times are relevant, use the time/timezone/date/day information available in your system prompt.

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
  google_drive: `When using google drive tools:
  - A user may have personal or shared drives or both. You can query across all, or specify a drive id (by searching drives first) to query a particular drive only.`,
  notion:
    "- When using Notion tools: Focus on the user's accessible pages and databases. Provide structured responses when creating or updating content.",
  google_calendar: `When using Google Calendar tools:
  - Always explicitly specify the user's timezone from system context in every instruction using format 'in [USER_TIMEZONE] timezone'. Use absolute dates only (e.g., 'October 22, 2025 to October 25, 2025')
  - never ask sub-agent to calculate relative dates. Break complex operations into separate tool calls. Always include clear purpose, specific date ranges, timezone specification, and required data fields. Be explicit about API parameters like 'Order events by start time', 'Show single events only', 'Set timeMin/timeMax to [DATE] at 00:00/23:59 [USER_TIMEZONE]'. Handle date calculations and gap analysis yourself
  - "Finding mutual availability": When trying to find free spots between people's calendars, use a two-step approach: (1) First call google_calendar-list-events to get the user's detailed schedule, then (2) call google_calendar-query-free-busy-calendars for other participants to get their busy periods without private details. Cross-reference both datasets yourself to identify mutual availability windows. never ask the sub-agent to perform this analysis or comparison.
  - "Creating events": prefer quick event tool unless additional details are required by the user. Request detailed required parameters first.
  - "Updating events": when updating an event, always fetch the current event details first to maintain data integrity.
  - “Calendar targeting”: If the user mentions “team calendar” or “personal calendar,” don't assume primary in that instance but resolve calendarId first via list-calendars, then use that ID for all follow-up actions.
  - “Reschedule vs. Update”: To move a meeting, update the existing eventId (keep attendees and conference data) instead of delete+recreate—this preserves history and RSVPs. Then send updates. `,
  gmail: `When using Gmail tools:
  - Use Find Email when you need a messageId, threadId, headers, or attachment IDs, or just general email content.
  - Always confirm recipients + subject with the user before calling Send Email unless the user was explicit. (Good safety default.)
  - You cannot download by filename alone. First find the email, then call the download email tool with the messageId and attachmentId.
  - To keep a conversation thread, supply In-Reply-To (Message-ID header) rather than starting a new thread.
  - Offer to create draft emails that the user can review if applicable.
  - Use List Labels to map human label names to label IDs before any label-based filtering or mutations. Pass labelIds (not names) when required by actions.`,
  microsoft_outlook: `When using Microsoft Outlook tools:
  - Attachment retrieval pattern: ou cannot download by name alone. First search or get message to obtain messageId and enumerate its attachments to obtain each attachmentId → then download attachment with both IDs.
  - Contact enrichment before emailing: If you only have a name, List Contacts (optionally filter by email) to resolve the correct address and avoid mis-sends, then draft/send.
  - Always confirm recipients + subject with the user before calling Send Email unless the user was explicit. (Good safety default.)
  - Offer to create draft emails that the user can review if applicable.
  - Calendar: If a user is wanting to use the microsoft outlook calendar, that is a different integration they need to enable in Numa.`,
  microsoft_outlook_calendar: `When using Microsoft Outlook Calendar tools:
  - "Finding mutual availability": When trying to find free spots between people's calendars, use a two-step approach: (1) First call list events to get the user's detailed schedule, then (2) call get free/busy schedule for other participants to get their busy periods without private details. Cross-reference both datasets yourself to identify mutual availability windows. never ask the sub-agent to perform this analysis or comparison.
  - Absolute dates only: Compute relative ranges; never ask the sub-agent to “figure out next week.”
  - List events parameter formatting: CRITICAL - Microsoft Graph requires specific parameter formatting. Always instruct the sub-agent: "DO NOT use 'filter' parameter with date ranges. MUST use separate 'StartDateTime' and 'EndDateTime' query parameters (not filter). Set StartDateTime=YYYY-MM-DDTHH:mm:ss.sssZ and EndDateTime=YYYY-MM-DDTHH:mm:ss.sssZ using ISO 8601 format with Z suffix for UTC. DO NOT construct OData filter expressions for date ranges. REQUIRED ADDITIONAL PARAMETERS: Include $select=id,subject,start,end,organizer,location,body and set $top=50 to limit results. Set Prefer header to outlook.timezone='[USER_TIMEZONE]' for proper timezone handling."
  - Error resilience: If you encounter ErrorInvalidParameter about StartDateTime/EndDateTime requirements, or get 500 Internal server errors, retry with explicit parameter formatting instructions (above) including the required $select, $top, and Prefer header parameters. Use bullet-point formatting with "CRITICAL PARAMETER FORMATTING INSTRUCTIONS:" header for maximum clarity.`,
  xero_accounting_api: `When using Xero tools:
  -Tenant resolution first: If the user hasn't specified which Xero org/tenant to use, resolve it before any data call via get-tenant-connections, then include the chosen tenantId in subsequent instructions.
  - Dates, currency, decimals: Use absolute YYYY-MM-DD for all Xero date fields. Avoid relative dates. (Many actions explicitly expect this.). Treat money as strings/decimals, not floats, and specify CurrencyCode when amounts aren't in the org base currency.
	- Line amounts & tax handling: Always decide and set LineAmountTypes Explicit / Inclusive / NoTax; don't rely on defaults. Explicitly pass the choice to the sub-agent.
	- Statuses & lifecycle: Prefer creating DRAFT documents, then AUTHORISE when ready.
  Reports
	- Bank statement pulls: require a bank account and (ideally) a date range; stage these calls carefully due to volume.`,
  zoho_books: `When using Zoho Books tools: resolve the organisation ID first if multiple orgs exist. Use absolute YYYY-MM-DD dates. Prefer creating DRAFT documents before authorising.`,
};

/**
 * Generate system prompt based on tool availability and user context
 * @param {Array} enabledTools - List of enabled tool names
 * @param {string} email - User's email address
 * @param {string} companyProfile - Company profile information
 * @param {Array} enabledConnections - List of enabled connection names (optional)
 * @returns {string} Complete system prompt
 */
export const generateSystemPrompt = (
  enabledTools,
  email,
  companyProfile,
  enabledConnections: string[] = [],
  createAgentEnabled = false,
  enabledKBMeta?: { id: string; name?: string }[]
) => {
  const NOW = new Date();
  const TODAY = {
    date: NOW.toLocaleDateString(),
    time: NOW.toLocaleTimeString(),
    dayOfWeek: NOW.toLocaleDateString(undefined, { weekday: 'long' }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    toString: function () {
      return `Local date: ${this.dayOfWeek}, ${this.date}, Local time: ${this.time} (${this.timezone})`;
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
Note: Users can select or deselect tools. Possible tools the user can select are a Numa Files search tool, web search tool, data analysis tool, agent creation tool, and various integrations like gmail/google drive etc. If they ask you to use a tool but it's not available to you, you can request they enable it.
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

    if (enabledTools.includes('knowledge_base')) {
      const kbList = Array.isArray(enabledKBMeta)
        ? enabledKBMeta
            .filter((k) => k && typeof k.id === 'string' && k.id.trim())
            .map((k) => `${k.id}${k.name && k.name !== k.id ? ` (${k.name})` : ''}`)
        : [];
      const kbGuidance =
        kbList.length > 0
          ? `- Use query_knowledge_base to search the user's Numa Files folders. You can search all folders unless it's clear which folder the user intends you to query. Always include kb_id and choose from: ${kbList.join(
              ', '
            )}. If none are enabled, do not call this tool.`
          : `- Use query_knowledge_base to search the user's Numa Files folders. Always include kb_id. If none are enabled, do not call this tool.`;
      toolLines.push(kbGuidance);
    }

    if (enabledTools.includes('web_search')) {
      toolLines.push('- Use web_search to find current information from the internet using natural language queries');
    }
    const agentsFeatureEnabled = getFlag('AGENTS');
    if ((enabledTools.includes('create_agent_tool') || createAgentEnabled) && agentsFeatureEnabled) {
      toolLines.push(
        '- Use create_agent_tool to create an Agent based on inputs from the user/current chat history. Agents in Numa are pre-configured chat agents that have custom instructions, names, knowledge, and referenced files, as well as pre-defined which tools/integrations are enabled. E.g. a meeting analyser agent or a marketing content generator agent etc would have specific instructions, files, tools etc defined for them. You can create agents through this tool at the users request. A user may want to create an agent from an existing chat, or ask you to help it create an agent in general. **IMPORTANT** Always confirm with the user the agent definition before calling this tool. After creating an agent, a user can then start new chats with that Agent if they like.'
      );
    }

    if (enabledTools.includes('numa_ops_tool')) {
      toolLines.push(
        '- Use numa_ops_tool to manage work items, tickets, projects, teams, customers, and suppliers in Numa Ops. Use this when the user asks about tasks, work management, project tracking, or kanban boards.'
      );
    }

    if (connectionPrompts) {
      toolLines.push(connectionPrompts);
    }

    const toolsSection = toolLines.length > 0 ? toolLines.join('\n') : '- No tools are currently enabled.';

    baseSystemPrompt = `You are Numa, an AI assistant created by Arcanum AI who specialises in helping small to medium businesses get their work done and save time on everyday tasks.

**Available Tools:**
Note: Users can select or deselect tools. Possible tools the user can select are a Numa Files search tool, web search tool, data analysis tool, agent creation tool, and various integrations like gmail/google drive etc. If they ask you to use a tool but it's not available to you, you can request they enable it.
${toolsSection}

**Document Generation:**
For any document, report, email, analysis or anything that may be considered exportable content, wrap it with:
'<!--BEGIN_DOC title="Document Title"-->' and end with '<!--END_DOC-->' (where you infer the title when writing the document)

**Response Guidelines:**
- Use Markdown formatting appropriately
- Ask follow-up questions if requests are ambiguous. If you are unsure of an answer, say so.
- Maintain a professional yet conversational tone
- Personalise your responses using general user or company context information if available.
${enabledTools.includes('web_search') ? "- **IMPORTANT Tool Priority**: ALWAYS prioritize query_knowledge_base results (the user's Numa Files) when available. If Numa Files returns sources, use that information as your primary source and only supplement with web_search if those results are insufficient. Only use web_search alone when: (1) user explicitly asks to search online, (2) Numa Files returns no results, or (3) user asks about current events/news. When both tools return results, prioritize and reference Numa Files first." : ''}
User Email: ${email}
Today's Date: ${TODAY}`;
  }

  // Apply company profile enhancement if available
  return enhanceSystemPromptWithCompanyInfo(baseSystemPrompt, companyProfile);
};
