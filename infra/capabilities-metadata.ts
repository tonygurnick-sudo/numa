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

/**
 * Commercial tier a capability belongs to. 'standard' (default, omittable) is
 * included in every plan; 'gold' marks a premium capability. Classification /
 * display only today — there is no entitlement enforcement yet (the platform
 * has no plan/subscription model), so this drives the Capabilities-tab badge,
 * not access. Add tiers here when the commercial model needs them.
 */
export type CapabilityTier = 'standard' | 'gold';

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
  /**
   * Commercial tier. Omitted/'standard' = in every plan; 'gold' = premium,
   * surfaced with a "Gold" badge in the Capabilities tab. LABEL ONLY — no
   * entitlement enforcement is attached (no plan/subscription model exists yet).
   */
  tier?: CapabilityTier;
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
    flag: 'EVENT_TRIGGERS',
    title: 'Event Triggers',
    description:
      'Event-triggered automations — fire agents on Slack messages, Gmail emails, and other external events. Disable to release Scheduling without releasing Triggers.',
    icon: 'bi-lightning-charge',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['SCHEDULING'],
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
    flag: 'NUMA_VOICE',
    title: 'Numa Voice',
    description:
      'Amazon Connect outbound calling for SDRs with AI call prep, live assist, and post-call analysis (transcription, summary, CRM write-back).',
    icon: 'bi-telephone',
    // System-managed (admin cannot toggle; always on when deployed) and a
    // premium Gold-tier capability. 'gold' is a display label only — see CapabilityTier.
    system_only: true,
    dev_only: false,
    enabled: false,
    tier: 'gold',
    // Qualification Promoter writes qualified prospects into the Numa Ops CRM,
    // so Ops must be enabled for the full pipeline (degrades gracefully if off).
    dependencies: ['NUMA_OPS'],
  },
  {
    flag: 'VOICE_ANALYTICS',
    title: 'Voice Analytics',
    description:
      'Contact-center dashboard + call logs for Numa Voice — call volume, dispositions, per-agent efficiency, recording playback, transcripts, and live monitoring.',
    icon: 'bi-graph-up',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['NUMA_VOICE'],
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
    flag: 'SHOW_CREDITS',
    title: 'Credits Admin View',
    description:
      'Shows the in-app credit usage view (Settings -> Credits). Credit metering runs for all clients regardless; this only gates visibility of the admin view. Default off until rollout.',
    icon: 'bi-coin',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'DATA_CONNECTORS_ENABLED',
    title: 'Native Integrations',
    description:
      'Admin-side gate. When on, admins can add native OAuth/token connectors (Google Drive, OneDrive, Synergy etc.) to the unified Integrations list alongside Pipedream. When off, no native rows surface to users.',
    icon: 'bi-cloud-download',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: [],
  },
  {
    flag: 'SYNERGY_FILE_PARITY',
    title: 'Synergy Remote Files Browser',
    description:
      'The Synergy 12d files browser in Files: browse jobs → folders → files with download, plus the rich read-parity experience (revision/version/status columns, lock indicator, in-job file search by name + contents, and per-file actions: details, version history, copy link). When off, no Synergy file-browser routes are deployed and the browser does not surface.',
    icon: 'bi-folder-symlink',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['DATA_CONNECTORS_ENABLED'],
  },
  {
    flag: 'SYNERGY_KB_SEARCH',
    title: 'Synergy Connector',
    description:
      'The Synergy 12d connector: connect to the Synergy API and crawl/download indexable documents (background + on-demand "Sync now") into a knowledge base, respecting each user\'s Synergy permissions per document. Adds the Synergy connector to the integrations catalog, the admin crawl/sync panel, and a selectable "Synergy" entry in the chat knowledge-base picker for cross-job search. When off, no Synergy connector or crawl/sync routes are deployed.',
    icon: 'bi-search',
    system_only: false,
    dev_only: false,
    enabled: false,
    dependencies: ['DATA_CONNECTORS_ENABLED'],
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
    // System-managed, like SSO_ENABLED: MFA on/off is an infra/deploy-time decision
    // driven by clientConfig.mfa (set in the CS portal), not toggleable by a customer
    // admin here. This previously rendered a live toggle — disabling it wrote a
    // capability setting but did NOT reconfigure the Cognito pool or un-enrol users,
    // so Cognito kept issuing MFA challenges. system_only renders a locked "Enabled"
    // badge (the row is only listed for clients where MFA is actually deployed) and
    // removes the toggle.
    system_only: true,
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
