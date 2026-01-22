/**
 * Quick Actions Configuration for Numa Chat V2
 *
 * This file defines the quick action buttons that appear on the new chat page
 * to help users discover what Numa can do. Actions can either prefill the
 * chat input (for user completion) or send immediately to start a conversation.
 */

export type QuickActionBehavior = 'prefill' | 'send';

export type QuickActionCategory = 'document' | 'research' | 'productivity' | 'integration';

export type QuickActionFeature = 'webSearch' | 'knowledgeBase' | 'agents' | 'integrations';

export interface QuickActionConfig {
  /** Unique identifier for the action */
  id: string;
  /** Display label shown on the button */
  label: string;
  /** Longer description shown in tooltip */
  description: string;
  /** Bootstrap icon class (e.g., 'bi-file-earmark-text') */
  icon: string;
  /** The prompt text to use - either prefilled or sent immediately */
  prompt: string;
  /** Whether to prefill input (user completes) or send immediately */
  behavior: QuickActionBehavior;
  /** Category for grouping/filtering actions */
  category: QuickActionCategory;
  /** Required feature flag - action hidden if feature not enabled */
  requiresFeature?: QuickActionFeature;
  /** Required integration ID - action hidden if integration not connected */
  requiresIntegration?: string;
  /** Priority for sorting (lower = shown first) */
  priority: number;
}

/**
 * All available quick actions
 * Actions are shown based on enabled features and connected integrations
 */
export const QUICK_ACTIONS_CONFIG: Record<string, QuickActionConfig> = {
  draftDocument: {
    id: 'draftDocument',
    label: 'Draft a document',
    description: 'Get help writing documents, reports, or proposals',
    icon: 'bi-file-earmark-text',
    prompt: 'Can you help me draft a document?',
    behavior: 'send',
    category: 'document',
    priority: 10,
  },
  analyzeFile: {
    id: 'analyzeFile',
    label: 'Analyze a file',
    description: 'Upload and analyze documents or data files',
    icon: 'bi-bar-chart',
    prompt: "I have a file I'd like to upload and have you analyze.",
    behavior: 'send',
    category: 'document',
    priority: 20,
  },
  searchKnowledgeBase: {
    id: 'searchKnowledgeBase',
    label: 'Search knowledge base',
    description: "Search your organization's documents and data",
    icon: 'bi-folder2-open',
    prompt: 'I want help searching my knowledge base for something.',
    behavior: 'send',
    category: 'research',
    requiresFeature: 'knowledgeBase',
    priority: 40,
  },
  prepMeeting: {
    id: 'prepMeeting',
    label: 'Prep for a meeting',
    description: 'Prepare agendas, talking points, and background research',
    icon: 'bi-calendar-event',
    prompt: 'Can you help me prepare for an upcoming meeting?',
    behavior: 'send',
    category: 'productivity',
    priority: 50,
  },
  writeEmail: {
    id: 'writeEmail',
    label: 'Write an email',
    description: 'Draft professional emails for any situation',
    icon: 'bi-envelope',
    prompt: 'Can you help me write an email?',
    behavior: 'send',
    category: 'productivity',
    priority: 60,
  },
  brainstorm: {
    id: 'brainstorm',
    label: 'Brainstorm ideas',
    description: 'Generate creative ideas and explore possibilities',
    icon: 'bi-lightbulb',
    prompt: 'Can you me brainstorm ideas?',
    behavior: 'send',
    category: 'productivity',
    priority: 70,
  },
  summarizeDocument: {
    id: 'summarizeDocument',
    label: 'Summarize a document',
    description: 'Get a concise summary of any document',
    icon: 'bi-file-earmark-break',
    prompt: "I have a document I'd like to upload for you to summarise.",
    behavior: 'send',
    category: 'document',
    priority: 80,
  },
  createAgent: {
    id: 'createAgent',
    label: 'Create an agent',
    description: 'Create a new AI agent for specific tasks',
    icon: 'bi-robot',
    prompt: "I'd like to create a Numa agent.",
    behavior: 'send',
    category: 'productivity',
    priority: 80,
  },
  // Integration-dependent actions (shown only when integration is connected)
  checkCalendar: {
    id: 'checkCalendar',
    label: 'Check my calendar',
    description: 'View your upcoming meetings and schedule',
    icon: 'bi-calendar-check',
    prompt: 'What meetings do I have scheduled for today and tomorrow?',
    behavior: 'send',
    category: 'integration',
    requiresIntegration: 'google_calendar',
    priority: 100,
  },
  checkEmails: {
    id: 'checkEmails',
    label: 'Check my emails',
    description: 'Review your recent emails and inbox',
    icon: 'bi-envelope-open',
    prompt: 'Can you show me my recent emails?',
    behavior: 'send',
    category: 'integration',
    requiresIntegration: 'gmail',
    priority: 110,
  },
};

export interface GetVisibleQuickActionsOptions {
  /** Whether web search feature is enabled */
  webSearchEnabled?: boolean;
  /** Whether knowledge base feature is enabled (has at least one KB) */
  kbEnabled?: boolean;
  /** Whether agents feature is enabled */
  agentsEnabled?: boolean;
  /** Set of connected integration IDs */
  connectedIntegrations?: Set<string>;
  /** Maximum number of actions to return */
  maxVisible?: number;
}

/**
 * Get the list of quick actions that should be visible based on enabled features
 * and connected integrations.
 *
 * @param options - Configuration options for filtering actions
 * @returns Array of visible quick action configs, sorted by priority
 */
export const getVisibleQuickActions = (options: GetVisibleQuickActionsOptions = {}): QuickActionConfig[] => {
  const {
    webSearchEnabled = false,
    kbEnabled = false,
    agentsEnabled = false,
    connectedIntegrations = new Set<string>(),
    maxVisible = 8,
  } = options;

  const allActions = Object.values(QUICK_ACTIONS_CONFIG);

  // Filter actions based on requirements
  const visibleActions = allActions.filter((action) => {
    // Check feature requirements
    if (action.requiresFeature) {
      switch (action.requiresFeature) {
        case 'webSearch':
          if (!webSearchEnabled) return false;
          break;
        case 'knowledgeBase':
          if (!kbEnabled) return false;
          break;
        case 'agents':
          if (!agentsEnabled) return false;
          break;
        case 'integrations':
          // Generic integrations check - requires at least one connected
          if (connectedIntegrations.size === 0) return false;
          break;
      }
    }

    // Check integration requirements
    if (action.requiresIntegration) {
      // Check if the specific integration is connected
      // Also check for alternative integrations (e.g., microsoft_outlook_calendar for calendar)
      const calendarIntegrations = ['google_calendar', 'microsoft_outlook_calendar'];
      const emailIntegrations = ['gmail', 'microsoft_outlook'];

      if (action.requiresIntegration === 'google_calendar') {
        // Calendar action - accept any calendar integration
        if (!calendarIntegrations.some((id) => connectedIntegrations.has(id))) {
          return false;
        }
      } else if (action.requiresIntegration === 'gmail') {
        // Email action - accept any email integration
        if (!emailIntegrations.some((id) => connectedIntegrations.has(id))) {
          return false;
        }
      } else if (!connectedIntegrations.has(action.requiresIntegration)) {
        return false;
      }
    }

    return true;
  });

  // Sort by priority and limit
  return visibleActions.sort((a, b) => a.priority - b.priority).slice(0, maxVisible);
};

/**
 * Get a specific quick action by ID
 */
export const getQuickActionById = (id: string): QuickActionConfig | undefined => {
  return QUICK_ACTIONS_CONFIG[id];
};
