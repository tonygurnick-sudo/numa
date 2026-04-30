/**
 * Global capabilities metadata — single source of truth.
 *
 * This file defines the display metadata for every feature flag that can
 * appear in the admin Capabilities tab.  It is imported by:
 *   1. numa-client-stack.ts  → generates capabilities.json on the frontend S3 bucket
 *   2. tools/seed-capabilities-metadata.ts → populates the deployer DynamoDB table
 *
 * To add a new capability:
 *   1. Add an entry here
 *   2. Add the camelCase config key in numa-client-stack.ts config.json generation
 *   3. Use getFlag('MY_FLAG') in frontend code
 *   4. Run the seed script to sync DynamoDB
 *   5. Deploy
 */

export interface CapabilityMetadata {
  /** UPPER_SNAKE_CASE flag name matching sessionStorage / config.json keys */
  flag: string;
  /** Human-readable display name */
  title: string;
  /** One-line description of what this capability does */
  description: string;
  /** Bootstrap Icons class e.g. "bi-code-slash" */
  icon: string;
  /** If true, the admin cannot toggle this — it is always on when deployed */
  system_only: boolean;
  /** If true, only visible when DEVELOPER_MODE is enabled */
  dev_only: boolean;
  /** Parent flags that must be enabled for this capability to function */
  dependencies: string[];
  /** Default enabled state — used when config.json doesn't explicitly set this flag */
  enabled: boolean;
}

export const CAPABILITIES_METADATA: CapabilityMetadata[] = [
  // ── Parent capabilities (no dependencies) ──────────────────────────
  {
    flag: 'NUMA_WORKSPACE_CHAT',
    title: 'Workspace Chat',
    description: 'Next-gen AI chat with sandboxed code execution and persistent workspaces.',
    icon: 'bi-chat-dots',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'AGENTS',
    title: 'Agents',
    description: 'Custom AI agent creation, management, and marketplace.',
    icon: 'bi-robot',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'SCHEDULING',
    title: 'Scheduling',
    description: 'Agent scheduling, recurring runs, and notification system.',
    icon: 'bi-calendar-check',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'NUMA_OPS',
    title: 'Numa Ops',
    description: 'Work management and operational task tracking.',
    icon: 'bi-kanban',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'KNOWLEDGE_BASES',
    title: 'Knowledge Bases',
    description: 'Enterprise search and retrieval from uploaded documents.',
    icon: 'bi-book',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'PIPEDREAM_INTEGRATIONS',
    title: 'Pipedream Integrations',
    description: 'SaaS tool integrations via Pipedream (Gmail, Slack, Jira, etc.).',
    icon: 'bi-plug',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'DATA_CONNECTORS_ENABLED',
    title: 'Data Connectors',
    description: 'Connect external data sources for knowledge base sync.',
    icon: 'bi-cloud-download',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'DEVELOPER_MODE',
    title: 'Developer Mode',
    description: 'Enables developer tools, file drill-down, metadata inspection, and debug views.',
    icon: 'bi-code-slash',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'MFA_ENABLED',
    title: 'Multi-Factor Authentication',
    description: 'Require TOTP-based multi-factor authentication for all users.',
    icon: 'bi-shield-lock',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'SSO_ENABLED',
    title: 'Single Sign-On (SSO)',
    description:
      'SAML 2.0 single sign-on integration with Azure AD, Okta, Google Workspace, and other identity providers.',
    icon: 'bi-shield-check',
    system_only: true,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'SSO_ENTERPRISE',
    title: 'SSO Enterprise',
    description:
      'Advanced SSO features: group mapping, OIDC support, SSO-only mode, SCIM provisioning, and user management.',
    icon: 'bi-building-lock',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['SSO_ENABLED'],
  },
  {
    flag: 'SECRETS_VAULT_ENABLED',
    title: 'Secrets Vault',
    description: 'Secure credential storage for integrations and connections.',
    icon: 'bi-key',
    system_only: false,
    dev_only: true,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'OAUTH_INTEGRATIONS_ENABLED',
    title: 'OAuth Integrations',
    description: 'OAuth-based connectors for external services.',
    icon: 'bi-link-45deg',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'NUMA_APPS',
    title: 'Numa Apps',
    description: 'Step Functions-based AI applications for document analysis, policy generation, and more.',
    icon: 'bi-grid-3x3-gap',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'JOB_HISTORY',
    title: 'Job History',
    description: 'View and manage historical app run results and artifacts.',
    icon: 'bi-clock-history',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: ['NUMA_APPS'],
  },
  {
    flag: 'USAGE_REPORTING',
    title: 'Usage Reporting',
    description: 'Login activity heatmaps and usage analytics for admins.',
    icon: 'bi-bar-chart-line',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'V2_APPS',
    title: 'V2 Apps',
    description: 'Next-generation apps running on workspace agent.',
    icon: 'bi-lightning',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },

  // ── Child capabilities (have dependencies) ─────────────────────────
  {
    flag: 'NUMA_DROP_ZONES',
    title: 'Drop Zones',
    description: 'Shared upload folders for receiving files from external users.',
    icon: 'bi-cloud-upload',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'NUMA_SHARING',
    title: 'Sharing',
    description: 'Share documents with external users for public Q&A conversations.',
    icon: 'bi-share',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: [],
  },
  {
    flag: 'WORKSPACE_CHAT_MODEL_SELECTION',
    title: 'Model Selection',
    description: 'Allow users to choose between AI models in Workspace Chat.',
    icon: 'bi-sliders',
    system_only: false,
    dev_only: false,
    enabled: true,
    dependencies: ['NUMA_WORKSPACE_CHAT'],
  },
  {
    flag: 'CHAT_SUGGESTIONS',
    title: 'Suggested Next Messages',
    description:
      'Show clickable next-message suggestions above the chat input after each response, helping users discover what Numa can do.',
    icon: 'bi-lightbulb',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['NUMA_WORKSPACE_CHAT'],
  },
  {
    flag: 'RACETECH_DATA_FEED',
    title: 'RaceTech Data Feed',
    description: 'External data feed upload endpoint for daily database imports.',
    icon: 'bi-speedometer2',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'DISASTER_RECOVERY',
    title: 'Disaster Recovery',
    description: 'S3 replication, DynamoDB exports, Cognito and Secrets backups with 14-day retention.',
    icon: 'bi-shield-check',
    system_only: true,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'PUBLIC_DEMO',
    title: 'Public Demo',
    description:
      'Public-facing demo chat page (unlisted URL, no auth required). Uses Haiku 4.5 with daily cost limits.',
    icon: 'bi-globe',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['NUMA_WORKSPACE_CHAT'],
  },
];
