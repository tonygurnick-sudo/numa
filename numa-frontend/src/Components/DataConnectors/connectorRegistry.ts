// ---------------------------------------------------------------------------
// Connector Registry — single source of truth for all 25+ platforms
// MERGE: kept dev version — adds ConnectorEventType, eventTypes on Gmail,
//   oauthSetupSteps, and enriched apiReference fields vs base wizard commit.
// ---------------------------------------------------------------------------

import type { ProviderTemplate } from './wizards/OAuthWizard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectorAuthType = 'oauth2' | 'api-key' | 'token' | 'username-password' | 'contact-required';

export interface CredentialFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required: boolean;
  helpText?: string;
}

export interface ConnectorEventType {
  id: string;
  label: string;
  description: string;
  defaultTags: string[];
  defaultEnabled: boolean;
}

// Per-connector cache TTL — controls how long `useRemoteBrowse` keeps a folder
// listing in the in-memory + sessionStorage cache before refetching. Picked per
// connector by data-change frequency.
export interface CachingPolicy {
  ttl: number; // seconds
}

export const CACHING_PRESETS: Record<string, CachingPolicy> = {
  email: { ttl: 60 },
  cloudStorage: { ttl: 300 },
  projectManagement: { ttl: 1800 },
};

export interface ConnectorTemplate {
  id: string;
  displayName: string;
  icon: string;
  description: string;
  category: string;
  authType: ConnectorAuthType;

  // OAuth-specific
  oauth?: {
    authUrl: string;
    tokenUrl: string;
    scopes: string;
    extraAuthParams?: string;
    discoveryUrl?: string;
    hideClientSecret?: boolean;
  };

  // Non-standard OAuth Authorization header scheme. Defaults to `Bearer`
  // when omitted. Zoho uses `Zoho-oauthtoken`; most providers use `Bearer`.
  // Persisted to the company vault at wizard save time so the backend
  // request path picks it up without a redeploy.
  authHeaderScheme?: string;

  // Non-OAuth credential fields
  credentialFields?: CredentialFieldDef[];

  // Common metadata
  baseUrl?: string;
  rateLimitRpm?: number;
  rateLimitDaily?: number;

  // OAuth-specific setup guidance
  oauthSetupSteps?: string[];

  // Event types this connector can produce
  eventTypes?: ConnectorEventType[];

  // OAuth platform family — connectors sharing the same OAuth client ('google' | 'microsoft')
  oauthPlatform?: string;

  // Caching policy — sensible defaults per connector, admin can override in wizard
  cachingPolicy?: CachingPolicy;

  // Where the connector surfaces in the UI. A file-browsing connector (e.g. Google Drive,
  // Dropbox, Gmail) shows up in Files > Remote; an API-only connector (e.g. Fergus, simPRO)
  // only exposes itself from chat. Default is ['chat'] — explicitly opt a connector in to
  // files surfacing by including 'files'.
  surfaces?: ('files' | 'chat')[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CONNECTOR_REGISTRY: ConnectorTemplate[] = [
  // ─── Tier 1: Token-based ────────────────────────────────────────────────
  {
    id: 'synergy',
    displayName: 'Synergy 12d',
    icon: 'bi-building',
    description: 'Data connector for Synergy 12d job data',
    category: 'Project Management',
    authType: 'token',
    surfaces: ['files', 'chat'],
    cachingPolicy: CACHING_PRESETS.projectManagement,
    // Per-user credential: just the PAT. instance_url is admin-level
    // (configured in ApiKeyWizard → connector-config-synergy.fields.instance_url)
    // because Synergy is customer-hosted and the URL is the same for every
    // user in a given workspace — no point asking each user to re-enter it.
    credentialFields: [
      {
        key: 'access_token',
        label: 'dataConnectors.fields.pat',
        type: 'password',
        placeholder: 'Paste your Synergy personal access token',
        required: true,
      },
    ],
  },

  // ─── Tier 1: OAuth2 (existing) ───────────────────────────────────────────
  {
    id: 'googledrive',
    displayName: 'Google Drive',
    icon: 'bi-google',
    description: 'Access and browse Google Drive files',
    category: 'Cloud Storage',
    authType: 'oauth2',
    oauthPlatform: 'google',
    surfaces: ['files', 'chat'],
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Google Cloud Console → APIs & Services → Credentials',
      'Click "Create Credentials" → "OAuth Client ID"',
      'Select "Web Application" as the application type',
      'Add the redirect URI below under "Authorized redirect URIs"',
      'Copy the Client ID and Client Secret',
    ],
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    icon: 'bi-envelope',
    description: 'Read, search, and send emails via Gmail',
    category: 'Email & Communication',
    authType: 'oauth2',
    oauthPlatform: 'google',
    surfaces: ['files', 'chat'],
    cachingPolicy: CACHING_PRESETS.email,
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Enable the Gmail API in Google Cloud Console → APIs & Services → Library',
      'Go to Credentials → Create Credentials → OAuth Client ID',
      'Select "Web Application" as the application type',
      'Add the redirect URI below under "Authorized redirect URIs"',
      'Copy the Client ID and Client Secret',
    ],
    eventTypes: [
      {
        id: 'new_email',
        label: 'dataConnectors.events.newEmail',
        description: 'dataConnectors.events.newEmailDesc',
        defaultTags: ['email', 'incoming'],
        defaultEnabled: true,
      },
      {
        id: 'email_read',
        label: 'dataConnectors.events.emailRead',
        description: 'dataConnectors.events.emailReadDesc',
        defaultTags: ['email', 'status'],
        defaultEnabled: false,
      },
      {
        id: 'label_changed',
        label: 'dataConnectors.events.labelChanged',
        description: 'dataConnectors.events.labelChangedDesc',
        defaultTags: ['email', 'organization'],
        defaultEnabled: false,
      },
      {
        id: 'email_sent',
        label: 'dataConnectors.events.emailSent',
        description: 'dataConnectors.events.emailSentDesc',
        defaultTags: ['email', 'outgoing'],
        defaultEnabled: true,
      },
    ],
  },
  {
    id: 'onedrive',
    displayName: 'OneDrive',
    icon: 'bi-microsoft',
    description: 'Access and browse Microsoft OneDrive files',
    category: 'Cloud Storage',
    authType: 'oauth2',
    oauthPlatform: 'microsoft',
    surfaces: ['files', 'chat'],
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    oauth: {
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
      extraAuthParams: '{"response_mode":"query"}',
      discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Azure Portal → App registrations → New registration',
      'Set a name and choose "Accounts in any organizational directory"',
      'Under "Redirect URIs", add the redirect URI shown below as type "Web"',
      'Go to Certificates & secrets → New client secret → copy the Value',
      'Copy the Application (client) ID from the Overview page',
    ],
  },
  {
    id: 'dropbox',
    displayName: 'Dropbox',
    icon: 'bi-dropbox',
    description: 'Access and browse Dropbox files',
    category: 'Cloud Storage',
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    authType: 'oauth2',
    surfaces: ['files', 'chat'],
    oauth: {
      authUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: 'files.metadata.read files.content.read',
      extraAuthParams: '{"token_access_type":"offline"}',
      discoveryUrl: 'https://www.dropbox.com/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Dropbox App Console → Create app',
      'Choose "Scoped access" and "Full Dropbox" access type',
      'Under Settings → OAuth 2 → Redirect URIs, add the redirect URI below',
      'Copy the App key (Client ID) and App secret (Client Secret)',
    ],
  },

  // ─── Tier 2: OAuth2 (new) ──────────────────────────────────────────────
  {
    id: 'workflowmax',
    displayName: 'WorkflowMax',
    icon: 'bi-kanban',
    description: 'Project management and job tracking for professional services',
    category: 'Project Management',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://oauth.workflowmax2.com/oauth/authorize',
      tokenUrl: 'https://oauth.workflowmax2.com/oauth/token',
      scopes: 'openid profile email workflowmax',
      extraAuthParams: '{"prompt":"consent"}',
    },
    oauthSetupSteps: [
      'Log in to the Xero Developer portal (developer.xero.com)',
      'Create a new app and select "Web app" as the integration type',
      'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
      'Copy the Client ID and generate a Client Secret',
    ],
  },
  {
    id: 'podio',
    displayName: 'Podio',
    icon: 'bi-grid-3x3-gap',
    description: 'Flexible work management and collaboration platform',
    category: 'Project Management',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://podio.com/oauth/authorize',
      tokenUrl: 'https://podio.com/oauth/token',
      scopes: '',
      extraAuthParams: '{}',
    },
    oauthSetupSteps: [
      'Go to Podio Developer Portal → API Keys',
      'Create a new API client application',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
  },
  {
    id: 'simpro',
    displayName: 'simPRO',
    icon: 'bi-tools',
    description: 'Field service management for trade and services businesses',
    category: 'Field Service',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://login.simprogroup.com/oauth2/authorize',
      tokenUrl: 'https://login.simprogroup.com/oauth2/token',
      scopes: '',
    },
    oauthSetupSteps: [
      'Log in to the simPRO Developer Portal',
      'Register a new application under your company',
      'Add the redirect URI below to the application settings',
      'Copy the Client ID and Client Secret from the app details',
    ],
  },
  {
    id: 'getjobber',
    displayName: 'Jobber',
    icon: 'bi-clipboard-check',
    description: 'Home service management — scheduling, invoicing, and CRM',
    category: 'Field Service',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://api.getjobber.com/api/oauth/authorize',
      tokenUrl: 'https://api.getjobber.com/api/oauth/token',
      scopes: 'read_clients read_jobs read_invoices',
    },
    oauthSetupSteps: [
      'Go to Jobber Developer Portal → Create App',
      'Fill in the app details and add the redirect URI below',
      'Copy the Client ID and Client Secret from the app page',
    ],
  },
  {
    id: 'wrike',
    displayName: 'Wrike',
    icon: 'bi-diagram-3',
    description: 'Enterprise work management and project collaboration',
    category: 'Project Management',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://login.wrike.com/oauth2/authorize/v4',
      tokenUrl: 'https://login.wrike.com/oauth2/token',
      scopes: 'wsReadOnly',
    },
    oauthSetupSteps: [
      'Go to Wrike Developer Portal → Create App',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
  },
  {
    id: 'connecteam-oauth',
    displayName: 'Connecteam (OAuth)',
    icon: 'bi-people',
    description: 'Employee management — time clock, scheduling, and forms (OAuth)',
    category: 'HR & Workforce',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://app.connecteam.com/oauth/authorize',
      tokenUrl: 'https://app.connecteam.com/oauth/token',
      scopes: 'forms.read attachments.write',
    },
    oauthSetupSteps: [
      'Go to Connecteam Developer Portal → Create an integration',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
  },
  {
    id: 'totalsynergy-oauth',
    displayName: 'Total Synergy (OAuth)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (OAuth)',
    category: 'Project Management',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://app.totalsynergy.com/oauth2/authorize',
      tokenUrl: 'https://app.totalsynergy.com/oauth2/token',
      scopes: '',
    },
    oauthSetupSteps: [
      'Contact Total Synergy support to register an OAuth application',
      'Provide them with the redirect URI shown below',
      'They will supply you with a Client ID and Client Secret',
    ],
  },

  // ─── Tier 2: OAuth2 (Accounting) ────────────────────────────────────────
  {
    id: 'xero',
    displayName: 'Xero',
    icon: 'bi-calculator',
    description: 'Cloud accounting for small businesses',
    category: 'Accounting',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      scopes: 'openid profile email accounting.transactions.read accounting.contacts.read offline_access',
    },
    oauthSetupSteps: [
      'Go to Xero Developer Portal (developer.xero.com) → My Apps',
      'Click "New app" and select "Web app" as the integration type',
      'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
      'Copy the Client ID and generate a Client Secret',
    ],
  },
  {
    id: 'myob',
    displayName: 'MYOB',
    icon: 'bi-journal-text',
    description: 'Business management and accounting for AU/NZ',
    category: 'Accounting',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://secure.myob.com/oauth2/account/authorize',
      tokenUrl: 'https://secure.myob.com/oauth2/v1/authorize',
      scopes: 'la',
    },
    oauthSetupSteps: [
      'Go to my.myob.com and register for API keys',
      'Create a new app under your MYOB developer account',
      'Add the redirect URI below to the app settings',
      'Copy the API Key (Client ID) and API Secret (Client Secret)',
    ],
  },
  {
    id: 'myob-acumatica',
    displayName: 'MYOB Acumatica',
    icon: 'bi-building',
    description: 'Enterprise ERP for mid-market — financials, projects, manufacturing',
    category: 'ERP',
    authType: 'oauth2',
    oauth: {
      // Per-instance — admins configure their own endpoint via the wizard.
      // These defaults are placeholders; auth/token URLs are instance-scoped.
      authUrl: '',
      tokenUrl: '',
      scopes: 'api',
    },
  },
  {
    id: 'netsuite',
    displayName: 'NetSuite',
    icon: 'bi-graph-up',
    description: 'Oracle NetSuite cloud ERP — financials, CRM, e-commerce',
    category: 'ERP',
    authType: 'oauth2',
    oauth: {
      // NetSuite uses per-account endpoints where the account id is embedded
      // in the hostname (e.g. `{account-id}.suitetalk.api.netsuite.com`).
      // Admins supply the account id at registration time; auth/token URLs
      // are derived at runtime. See ext-api-doc/netsuite/03-connector-setup.md.
      authUrl: '',
      tokenUrl: '',
      scopes: 'rest_webservices',
      extraAuthParams: '{"prompt":"consent"}',
    },
  },
  {
    id: 'zoho-crm',
    displayName: 'Zoho CRM',
    icon: 'bi-person-rolodex',
    description: 'Zoho CRM — leads, contacts, accounts, deals, tasks',
    category: 'CRM',
    authType: 'oauth2',
    surfaces: ['chat'],
    cachingPolicy: CACHING_PRESETS.projectManagement,
    // Zoho uses its own Authorization scheme — NOT Bearer.
    authHeaderScheme: 'Zoho-oauthtoken',
    oauth: {
      // Defaults to AU region. Admins serving customers in other Zoho data
      // centres (US / EU / IN / JP / CN) edit the authUrl and tokenUrl in the
      // wizard's Advanced section — see the setup steps below for the mapping.
      authUrl: 'https://accounts.zoho.com.au/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com.au/oauth/v2/token',
      scopes: 'ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.org.READ',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
    },
    oauthSetupSteps: [
      'Log in to the Zoho API Console for your data centre — AU: https://api-console.zoho.com.au/, US: https://api-console.zoho.com/, EU: https://api-console.zoho.eu/, IN: https://api-console.zoho.in/, JP: https://api-console.zoho.jp/, CN: https://api-console.zoho.com.cn/',
      'Choose "Server-based Applications" as the client type and click Create Now',
      'Enter a Client Name, set Homepage URL to your Numa URL, and paste the redirect URI shown below under "Authorized Redirect URIs"',
      'Zoho returns a Client ID and Client Secret — copy both into this wizard',
      'Non-AU customers: open Advanced below and replace `accounts.zoho.com.au` with your region host (e.g. `accounts.zoho.eu`). The API host changes in the same way — `www.zohoapis.{region}`.',
    ],
  },
  {
    id: 'quickbooks',
    displayName: 'QuickBooks Online',
    icon: 'bi-receipt',
    description: 'Cloud accounting and bookkeeping',
    category: 'Accounting',
    authType: 'oauth2',
    oauth: {
      authUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      scopes: 'com.intuit.quickbooks.accounting',
    },
    oauthSetupSteps: [
      'Go to Intuit Developer Portal (developer.intuit.com) → Dashboard',
      'Click "Create an app" and select "QuickBooks Online and Payments"',
      'Under Keys & credentials → Redirect URIs, add the URI below',
      'Copy the Client ID and Client Secret from the app dashboard',
    ],
  },

  // ─── Tier 2: API Key ──────────────────────────────────────────────────
  {
    id: 'hirehop',
    displayName: 'HireHop',
    icon: 'bi-truck',
    description: 'Equipment rental and event hire management',
    category: 'Equipment & Rental',
    authType: 'api-key',
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiToken',
        type: 'password',
        placeholder: 'Paste your HireHop API token',
        required: true,
        helpText: 'dataConnectors.fields.apiTokenHint',
      },
      {
        key: 'base_url',
        label: 'dataConnectors.fields.baseUrl',
        type: 'url',
        placeholder: 'https://myhirehop.com',
        required: true,
        helpText: 'dataConnectors.fields.baseUrlHint',
      },
    ],
  },
  {
    id: 'connecteam-api',
    displayName: 'Connecteam (API Key)',
    icon: 'bi-people',
    description: 'Employee management — time clock, scheduling, and forms (API key)',
    category: 'HR & Workforce',
    authType: 'api-key',
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiToken',
        type: 'password',
        placeholder: 'Paste your Connecteam API key',
        required: true,
      },
    ],
  },
  {
    id: 'totalsynergy-api',
    displayName: 'Total Synergy (API Key)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (API key)',
    category: 'Project Management',
    authType: 'api-key',
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'Paste your Total Synergy API key',
        required: true,
      },
      {
        key: 'instance_url',
        label: 'dataConnectors.fields.instanceUrl',
        type: 'url',
        placeholder: 'https://yourcompany.totalsynergy.com',
        required: true,
      },
    ],
  },

  // ─── Tier 2: Token ─────────────────────────────────────────────────────
  {
    id: 'netsuite',
    displayName: 'NetSuite',
    icon: 'bi-box',
    description: 'Connect to Oracle NetSuite ERP for customers, orders, invoices, inventory, and financial reports',
    category: 'ERP',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://<ACCOUNT_ID>.app.netsuite.com/app/login/oauth2/authorize.nl',
      tokenUrl: 'https://<ACCOUNT_ID>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token',
      scopes: 'mcp restlets',
      hideClientSecret: true,
    },
    credentialFields: [
      {
        key: 'account_id',
        label: 'NetSuite Account ID',
        type: 'text',
        placeholder: 'e.g. 1234567 or 1234567_SB1',
        required: true,
        helpText: 'Your NetSuite Account ID. This is required for OAuth routing.',
      },
    ],
    helpUrl: 'https://docs.oracle.com/en/cloud/saas/netsuite/ns-go-live/chapter_1556006456.html',
    oauthSetupSteps: [
      'Create an Integration Record in NetSuite (Setup > Integration > Manage Integrations > New).',
      'Enable "OAuth 2.0" and "Public Client" (PKCE).',
      'Add the Numa Redirect URI shown below to your integration.',
      'Copy your NetSuite Client ID from the integration record.',
    ],
    cachingPolicy: {
      ttl: 3600,
      staleWhileRevalidate: 7200,
      prefetch: false,
      invalidateOn: ['write'],
      maxEntries: 100,
      backgroundRefresh: 0,
    },
    apiReference: {
      purpose: 'Oracle NetSuite ERP',
      dataTypes: ['customers', 'orders', 'invoices'],
      capabilities: ['query', 'read', 'create', 'update', 'search', 'report'],
    },
  },
  {
    id: 'workbench',
    displayName: 'Workbench International',
    icon: 'bi-pc-display',
    description: 'ERP for trade and distribution businesses',
    category: 'ERP',
    authType: 'token',
    credentialFields: [
      {
        key: 'bearer_token',
        label: 'dataConnectors.fields.bearerToken',
        type: 'password',
        placeholder: 'Paste your Workbench bearer token',
        required: true,
      },
      {
        key: 'instance_url',
        label: 'dataConnectors.fields.instanceUrl',
        type: 'url',
        placeholder: 'https://yourcompany.workbench.com',
        required: true,
      },
    ],
  },
  {
    id: 'fergus',
    displayName: 'Fergus',
    icon: 'bi-wrench-adjustable',
    description: 'Job management for trade businesses',
    category: 'Field Service',
    authType: 'token',
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'Paste your Fergus API key',
        required: true,
      },
    ],
  },

  // ─── Tier 2: Username/Password ─────────────────────────────────────────
  {
    id: 'filemaker',
    displayName: 'Claris FileMaker',
    icon: 'bi-database',
    description: 'Custom database application platform',
    category: 'Database',
    authType: 'username-password',
    credentialFields: [
      {
        key: 'server_url',
        label: 'dataConnectors.fields.serverUrl',
        type: 'url',
        placeholder: 'https://myserver.fmi.filemaker-cloud.com',
        required: true,
      },
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'admin',
        required: true,
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'Enter your password',
        required: true,
      },
      {
        key: 'database',
        label: 'dataConnectors.fields.database',
        type: 'text',
        placeholder: 'MyDatabase',
        required: true,
        helpText: 'dataConnectors.fields.databaseHint',
      },
    ],
  },
  {
    id: 'flowingly',
    displayName: 'Flowingly',
    icon: 'bi-arrow-repeat',
    description: 'Business process management and workflow automation',
    category: 'Workflow',
    authType: 'username-password',
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'user@company.com',
        required: true,
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'Enter your password',
        required: true,
      },
    ],
  },
  {
    id: 'printiq',
    displayName: 'PrintIQ',
    icon: 'bi-printer',
    description: 'Print MIS and workflow management',
    category: 'Manufacturing',
    authType: 'username-password',
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'apiuser',
        required: true,
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'Enter your password',
        required: true,
      },
      {
        key: 'app_name',
        label: 'dataConnectors.fields.appName',
        type: 'text',
        placeholder: 'MyApp',
        required: true,
      },
      {
        key: 'app_key',
        label: 'dataConnectors.fields.appKey',
        type: 'password',
        placeholder: 'Paste your app key',
        required: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export const getConnectorById = (id: string): ConnectorTemplate | undefined =>
  CONNECTOR_REGISTRY.find((c) => c.id === id);

export const getOAuthConnectors = (): ConnectorTemplate[] => CONNECTOR_REGISTRY.filter((c) => c.authType === 'oauth2');

export const getNonOAuthConnectors = (): ConnectorTemplate[] =>
  CONNECTOR_REGISTRY.filter((c) => c.authType !== 'oauth2' && c.authType !== 'contact-required');

export const getContactRequired = (): ConnectorTemplate[] =>
  CONNECTOR_REGISTRY.filter((c) => c.authType === 'contact-required');

export const getConnectorCategories = (): string[] => {
  const cats = new Set(CONNECTOR_REGISTRY.map((c) => c.category));
  return Array.from(cats).sort();
};

/** Returns the vault secret key for a connector — platform name for siblings, connector ID otherwise */
export const getOAuthSecretId = (connectorId: string): string => {
  const connector = getConnectorById(connectorId);
  return connector?.oauthPlatform ?? connectorId;
};

/** Get all connectors that share the same OAuth platform (e.g. 'google' → googledrive, gmail) */
export const getConnectorsByPlatform = (platform: string): ConnectorTemplate[] =>
  CONNECTOR_REGISTRY.filter((c) => c.oauthPlatform === platform);

/**
 * True when a connector should surface in Files > Remote. Only file-browsing
 * providers belong there; API-only connectors (Fergus, simPRO, …) are chat-only.
 * Unknown ids default to false so we never accidentally leak a non-file connector
 * into the file picker if its registry entry disappears.
 */
export const surfacesInFiles = (connectorId: string): boolean => {
  const connector = getConnectorById(connectorId);
  if (!connector) return false;
  return (connector.surfaces ?? ['chat']).includes('files');
};

/** True when a connector is usable from chat. Defaults to true for any known connector. */
export const surfacesInChat = (connectorId: string): boolean => {
  const connector = getConnectorById(connectorId);
  if (!connector) return true;
  return (connector.surfaces ?? ['chat']).includes('chat');
};

/** Convert an oauth2 ConnectorTemplate to ProviderTemplate for backward compat with OAuthWizard */
export const toProviderTemplate = (ct: ConnectorTemplate): ProviderTemplate | null => {
  if (ct.authType !== 'oauth2' || !ct.oauth) return null;
  return {
    id: ct.id,
    displayName: ct.displayName,
    icon: ct.icon,
    description: ct.description,
    authUrl: ct.oauth.authUrl,
    tokenUrl: ct.oauth.tokenUrl,
    scopes: ct.oauth.scopes,
    extraAuthParams: ct.oauth.extraAuthParams || '',
    discoveryUrl: ct.oauth.discoveryUrl,
  };
};

/** Get all OAuth ConnectorTemplates as ProviderTemplate[] */
export const getOAuthProviderTemplates = (): ProviderTemplate[] =>
  getOAuthConnectors()
    .map(toProviderTemplate)
    .filter((t): t is ProviderTemplate => t !== null);
