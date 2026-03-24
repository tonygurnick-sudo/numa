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

export interface ConnectorApiReference {
  docsUrl?: string;
  openApiUrl?: string;
  postmanUrl?: string;
  mcpServerRef?: string;
  sdks?: { language: string; package: string; url?: string }[];
  purpose: string;
  dataTypes: string[];
  capabilities: string[];
  exampleRequests?: {
    description: string;
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }[];
  endpointCategories?: {
    name: string;
    description: string;
    basePath?: string;
  }[];
}

export interface ConnectorEventType {
  id: string;
  label: string;
  description: string;
  defaultTags: string[];
  defaultEnabled: boolean;
}

export interface CachingPolicy {
  ttl: number; // seconds — how long cached data is considered fresh
  staleWhileRevalidate: number; // seconds — serve stale while fetching fresh
  prefetch: boolean; // auto-prefetch subfolders on navigate
  invalidateOn: string[]; // events that bust cache (e.g. 'write', 'delete', 'send')
  maxEntries: number; // max cached folder/listing entries
  backgroundRefresh: number; // seconds — background poll interval (0 = off)
}

// Sensible defaults by data-change frequency
export const CACHING_PRESETS: Record<string, CachingPolicy> = {
  email: {
    ttl: 60,
    staleWhileRevalidate: 120,
    prefetch: false,
    invalidateOn: ['send'],
    maxEntries: 50,
    backgroundRefresh: 0,
  },
  cloudStorage: {
    ttl: 300,
    staleWhileRevalidate: 600,
    prefetch: true,
    invalidateOn: ['write', 'delete'],
    maxEntries: 100,
    backgroundRefresh: 0,
  },
  projectManagement: {
    ttl: 1800,
    staleWhileRevalidate: 3600,
    prefetch: true,
    invalidateOn: ['write'],
    maxEntries: 200,
    backgroundRefresh: 300,
  },
};

export interface ConnectorTemplate {
  id: string;
  displayName: string;
  icon: string;
  description: string;
  category: string;
  authType: ConnectorAuthType;
  tier: 1 | 2 | 3;

  // OAuth-specific
  oauth?: {
    authUrl: string;
    tokenUrl: string;
    scopes: string;
    extraAuthParams?: string;
    discoveryUrl?: string;
  };

  // Non-OAuth credential fields
  credentialFields?: CredentialFieldDef[];

  // Common metadata
  baseUrl?: string;
  helpUrl?: string;
  signupUrl?: string;
  rateLimitRpm?: number;
  rateLimitDaily?: number;
  setupInstructions?: string;

  // OAuth-specific setup guidance
  oauthSetupSteps?: string[];

  // API reference
  apiReference?: ConnectorApiReference;

  // Event types this connector can produce
  eventTypes?: ConnectorEventType[];

  // OAuth platform family — connectors sharing the same OAuth client ('google' | 'microsoft')
  oauthPlatform?: string;

  // Caching policy — sensible defaults per connector, admin can override in wizard
  cachingPolicy?: CachingPolicy;

  // Tier 3 only
  contactInfo?: { email?: string; website?: string; notes?: string };
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
    tier: 1,
    cachingPolicy: CACHING_PRESETS.projectManagement,
    credentialFields: [
      {
        key: 'instance_url',
        label: 'dataConnectors.fields.instanceUrl',
        type: 'url',
        placeholder: 'https://synergy.yourcompany.co.nz',
        required: true,
        helpText: 'dataConnectors.fields.synergyUrlHint',
      },
    ],
    helpUrl: 'https://www.12d.com/products/synergy/',
    apiReference: {
      docsUrl: 'https://www.12d.com/products/synergy/',
      purpose: 'Project management and job tracking for civil engineering and surveying',
      dataTypes: ['jobs', 'folders', 'files', 'documents'],
      capabilities: ['read', 'search'],
    },
  },

  // ─── Tier 1: OAuth2 (existing) ───────────────────────────────────────────
  {
    id: 'googledrive',
    displayName: 'Google Drive',
    icon: 'bi-google',
    description: 'Access and browse Google Drive files',
    category: 'Cloud Storage',
    authType: 'oauth2',
    tier: 1,
    oauthPlatform: 'google',
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    helpUrl: 'https://console.cloud.google.com/apis/credentials',
    oauthSetupSteps: [
      'Go to Google Cloud Console → APIs & Services → Credentials',
      'Click "Create Credentials" → "OAuth Client ID"',
      'Select "Web Application" as the application type',
      'Add the redirect URI below under "Authorized redirect URIs"',
      'Copy the Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developers.google.com/drive/api/reference/rest/v3',
      purpose: 'Cloud file storage and sharing',
      dataTypes: ['files', 'folders', 'permissions', 'comments'],
      capabilities: ['read', 'write', 'search', 'share'],
    },
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    icon: 'bi-envelope',
    description: 'Read, search, and send emails via Gmail',
    category: 'Email & Communication',
    authType: 'oauth2',
    tier: 1,
    oauthPlatform: 'google',
    cachingPolicy: CACHING_PRESETS.email,
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    helpUrl: 'https://console.cloud.google.com/apis/credentials',
    oauthSetupSteps: [
      'Enable the Gmail API in Google Cloud Console → APIs & Services → Library',
      'Go to Credentials → Create Credentials → OAuth Client ID',
      'Select "Web Application" as the application type',
      'Add the redirect URI below under "Authorized redirect URIs"',
      'Copy the Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developers.google.com/gmail/api/reference/rest',
      purpose: 'Email management — read, search, send, and organize messages',
      dataTypes: ['messages', 'threads', 'labels', 'drafts', 'attachments'],
      capabilities: ['read', 'write', 'send', 'search', 'webhooks'],
    },
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
    tier: 1,
    oauthPlatform: 'microsoft',
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    oauth: {
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
      extraAuthParams: '{"response_mode":"query"}',
      discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    },
    helpUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
    oauthSetupSteps: [
      'Go to Azure Portal → App registrations → New registration',
      'Set a name and choose "Accounts in any organizational directory"',
      'Under "Redirect URIs", add the redirect URI shown below as type "Web"',
      'Go to Certificates & secrets → New client secret → copy the Value',
      'Copy the Application (client) ID from the Overview page',
    ],
    apiReference: {
      docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/onedrive',
      purpose: 'Microsoft cloud file storage and collaboration',
      dataTypes: ['files', 'folders', 'permissions', 'sharepoint-items'],
      capabilities: ['read', 'write', 'search', 'share'],
    },
  },
  {
    id: 'dropbox',
    displayName: 'Dropbox',
    icon: 'bi-dropbox',
    description: 'Access and browse Dropbox files',
    category: 'Cloud Storage',
    cachingPolicy: CACHING_PRESETS.cloudStorage,
    authType: 'oauth2',
    tier: 1,
    oauth: {
      authUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: 'files.metadata.read files.content.read',
      extraAuthParams: '{"token_access_type":"offline"}',
      discoveryUrl: 'https://www.dropbox.com/.well-known/openid-configuration',
    },
    helpUrl: 'https://www.dropbox.com/developers/apps',
    oauthSetupSteps: [
      'Go to Dropbox App Console → Create app',
      'Choose "Scoped access" and "Full Dropbox" access type',
      'Under Settings → OAuth 2 → Redirect URIs, add the redirect URI below',
      'Copy the App key (Client ID) and App secret (Client Secret)',
    ],
    apiReference: {
      docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
      purpose: 'Cloud file storage and sharing',
      dataTypes: ['files', 'folders', 'sharing-links'],
      capabilities: ['read', 'write', 'search', 'share'],
    },
  },

  // ─── Tier 2: OAuth2 (new) ──────────────────────────────────────────────
  {
    id: 'workflowmax',
    displayName: 'WorkflowMax',
    icon: 'bi-kanban',
    description: 'Project management and job tracking for professional services',
    category: 'Project Management',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://oauth.workflowmax2.com/oauth/authorize',
      tokenUrl: 'https://oauth.workflowmax2.com/oauth/token',
      scopes: 'openid profile email workflowmax',
      extraAuthParams: '{"prompt":"consent"}',
    },
    helpUrl: 'https://developer.xero.com/',
    oauthSetupSteps: [
      'Log in to the Xero Developer portal (developer.xero.com)',
      'Create a new app and select "Web app" as the integration type',
      'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
      'Copy the Client ID and generate a Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developer.xero.com/documentation/api/workflowmax/overview',
      purpose: 'Project management, time tracking, and invoicing for professional services firms',
      dataTypes: ['jobs', 'clients', 'contacts', 'timesheets', 'invoices', 'quotes', 'tasks', 'staff'],
      capabilities: ['read', 'write', 'search'],
      endpointCategories: [
        { name: 'Jobs', description: 'Manage jobs, tasks, and costs', basePath: '/jobs' },
        { name: 'Clients', description: 'Client and contact management', basePath: '/clients' },
        { name: 'Time', description: 'Timesheet entries and tracking', basePath: '/time' },
        { name: 'Invoices', description: 'Invoice creation and management', basePath: '/invoices' },
      ],
    },
  },
  {
    id: 'podio',
    displayName: 'Podio',
    icon: 'bi-grid-3x3-gap',
    description: 'Flexible work management and collaboration platform',
    category: 'Project Management',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://podio.com/oauth/authorize',
      tokenUrl: 'https://podio.com/oauth/token',
      scopes: '',
      extraAuthParams: '{}',
    },
    helpUrl: 'https://developers.podio.com/',
    oauthSetupSteps: [
      'Go to Podio Developer Portal → API Keys',
      'Create a new API client application',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developers.podio.com/doc',
      purpose: 'Customizable work management platform with flexible workspaces, apps, and workflows',
      dataTypes: ['items', 'apps', 'workspaces', 'tasks', 'files', 'contacts', 'comments'],
      capabilities: ['read', 'write', 'search', 'webhooks'],
      endpointCategories: [
        { name: 'Items', description: 'Create, read, update items in Podio apps', basePath: '/item' },
        { name: 'Apps', description: 'Manage Podio apps and app fields', basePath: '/app' },
        { name: 'Tasks', description: 'Task management', basePath: '/task' },
      ],
    },
  },
  {
    id: 'simpro',
    displayName: 'simPRO',
    icon: 'bi-tools',
    description: 'Field service management for trade and services businesses',
    category: 'Field Service',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://login.simprogroup.com/oauth2/authorize',
      tokenUrl: 'https://login.simprogroup.com/oauth2/token',
      scopes: '',
    },
    helpUrl: 'https://developer.simprogroup.com/',
    oauthSetupSteps: [
      'Log in to the simPRO Developer Portal',
      'Register a new application under your company',
      'Add the redirect URI below to the application settings',
      'Copy the Client ID and Client Secret from the app details',
    ],
    apiReference: {
      docsUrl: 'https://developer.simprogroup.com/apidoc/',
      purpose: 'End-to-end field service management for trades and service businesses',
      dataTypes: ['jobs', 'quotes', 'invoices', 'schedules', 'customers', 'sites', 'assets', 'purchase-orders'],
      capabilities: ['read', 'write', 'search'],
      endpointCategories: [
        {
          name: 'Jobs',
          description: 'Job and work order management',
          basePath: '/api/v1.0/companies/{companyId}/jobs',
        },
        {
          name: 'Quotes',
          description: 'Quote creation and management',
          basePath: '/api/v1.0/companies/{companyId}/quotes',
        },
        {
          name: 'Customers',
          description: 'Customer management',
          basePath: '/api/v1.0/companies/{companyId}/customers',
        },
        {
          name: 'Schedules',
          description: 'Scheduling and dispatch',
          basePath: '/api/v1.0/companies/{companyId}/schedules',
        },
      ],
    },
  },
  {
    id: 'getjobber',
    displayName: 'Jobber',
    icon: 'bi-clipboard-check',
    description: 'Home service management — scheduling, invoicing, and CRM',
    category: 'Field Service',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://api.getjobber.com/api/oauth/authorize',
      tokenUrl: 'https://api.getjobber.com/api/oauth/token',
      scopes: 'read_clients read_jobs read_invoices',
    },
    helpUrl: 'https://developer.getjobber.com/',
    oauthSetupSteps: [
      'Go to Jobber Developer Portal → Create App',
      'Fill in the app details and add the redirect URI below',
      'Copy the Client ID and Client Secret from the app page',
    ],
    apiReference: {
      docsUrl: 'https://developer.getjobber.com/docs',
      purpose: 'Home service management with scheduling, invoicing, quoting, and client CRM',
      dataTypes: ['clients', 'jobs', 'invoices', 'quotes', 'requests', 'visits', 'expenses'],
      capabilities: ['read', 'write', 'search'],
      endpointCategories: [
        { name: 'Clients', description: 'Client management (GraphQL)', basePath: '/api/graphql' },
        { name: 'Jobs', description: 'Job tracking and scheduling', basePath: '/api/graphql' },
        { name: 'Invoices', description: 'Invoice and payment management', basePath: '/api/graphql' },
      ],
    },
  },
  {
    id: 'wrike',
    displayName: 'Wrike',
    icon: 'bi-diagram-3',
    description: 'Enterprise work management and project collaboration',
    category: 'Project Management',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://login.wrike.com/oauth2/authorize/v4',
      tokenUrl: 'https://login.wrike.com/oauth2/token',
      scopes: 'wsReadOnly',
    },
    helpUrl: 'https://developers.wrike.com/',
    oauthSetupSteps: [
      'Go to Wrike Developer Portal → Create App',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developers.wrike.com/overview/',
      purpose: 'Enterprise collaborative work management for projects, tasks, and workflows',
      dataTypes: ['tasks', 'projects', 'folders', 'timesheets', 'contacts', 'comments', 'attachments'],
      capabilities: ['read', 'write', 'search', 'webhooks'],
      endpointCategories: [
        { name: 'Tasks', description: 'Task CRUD and management', basePath: '/api/v4/tasks' },
        { name: 'Folders/Projects', description: 'Folder and project hierarchy', basePath: '/api/v4/folders' },
        { name: 'Timesheets', description: 'Time tracking', basePath: '/api/v4/timelogs' },
      ],
    },
  },
  {
    id: 'connecteam-oauth',
    displayName: 'Connecteam (OAuth)',
    icon: 'bi-people',
    description: 'Employee management — time clock, scheduling, and forms (OAuth)',
    category: 'HR & Workforce',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://app.connecteam.com/oauth/authorize',
      tokenUrl: 'https://app.connecteam.com/oauth/token',
      scopes: 'forms.read attachments.write',
    },
    helpUrl: 'https://developer.connecteam.com/',
    oauthSetupSteps: [
      'Go to Connecteam Developer Portal → Create an integration',
      'Set the redirect URI to the value shown below',
      'Copy the Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developer.connecteam.com/',
      purpose: 'All-in-one employee management — time tracking, scheduling, forms, training, and communication',
      dataTypes: ['users', 'shifts', 'timesheets', 'forms', 'assets', 'courses'],
      capabilities: ['read', 'write'],
    },
  },
  {
    id: 'totalsynergy-oauth',
    displayName: 'Total Synergy (OAuth)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (OAuth)',
    category: 'Project Management',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://app.totalsynergy.com/oauth2/authorize',
      tokenUrl: 'https://app.totalsynergy.com/oauth2/token',
      scopes: '',
    },
    helpUrl: 'https://developer.totalsynergy.com/',
    oauthSetupSteps: [
      'Contact Total Synergy support to register an OAuth application',
      'Provide them with the redirect URI shown below',
      'They will supply you with a Client ID and Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developer.totalsynergy.com/api/',
      purpose: 'Practice management for architecture, engineering, and construction firms',
      dataTypes: ['projects', 'contacts', 'timesheets', 'invoices', 'documents', 'staff'],
      capabilities: ['read', 'write', 'search'],
    },
  },

  // ─── Tier 2: OAuth2 (Accounting) ────────────────────────────────────────
  {
    id: 'xero',
    displayName: 'Xero',
    icon: 'bi-calculator',
    description: 'Cloud accounting for small businesses',
    category: 'Accounting',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      scopes: 'openid profile email accounting.transactions.read accounting.contacts.read offline_access',
    },
    helpUrl: 'https://developer.xero.com/',
    oauthSetupSteps: [
      'Go to Xero Developer Portal (developer.xero.com) → My Apps',
      'Click "New app" and select "Web app" as the integration type',
      'Add the redirect URI below under "OAuth 2.0 redirect URIs"',
      'Copy the Client ID and generate a Client Secret',
    ],
    apiReference: {
      docsUrl: 'https://developer.xero.com/documentation/api/accounting/overview',
      purpose: 'Cloud accounting — invoicing, bank reconciliation, expenses, payroll, and reporting',
      dataTypes: ['invoices', 'contacts', 'accounts', 'bank-transactions', 'payments', 'reports'],
      capabilities: ['read', 'write', 'search', 'webhooks'],
    },
  },
  {
    id: 'myob',
    displayName: 'MYOB',
    icon: 'bi-journal-text',
    description: 'Business management and accounting for AU/NZ',
    category: 'Accounting',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://secure.myob.com/oauth2/account/authorize',
      tokenUrl: 'https://secure.myob.com/oauth2/v1/authorize',
      scopes: 'la',
    },
    helpUrl: 'https://developer.myob.com/',
    oauthSetupSteps: [
      'Go to my.myob.com and register for API keys',
      'Create a new app under your MYOB developer account',
      'Add the redirect URI below to the app settings',
      'Copy the API Key (Client ID) and API Secret (Client Secret)',
    ],
    apiReference: {
      docsUrl: 'https://developer.myob.com/api/myob-business-api/',
      purpose: 'Business management and accounting — invoicing, payroll, inventory, and banking',
      dataTypes: ['invoices', 'contacts', 'accounts', 'journal-entries', 'employees', 'inventory'],
      capabilities: ['read', 'write', 'search'],
    },
  },
  {
    id: 'quickbooks',
    displayName: 'QuickBooks Online',
    icon: 'bi-receipt',
    description: 'Cloud accounting and bookkeeping',
    category: 'Accounting',
    authType: 'oauth2',
    tier: 2,
    oauth: {
      authUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      scopes: 'com.intuit.quickbooks.accounting',
    },
    helpUrl: 'https://developer.intuit.com/',
    oauthSetupSteps: [
      'Go to Intuit Developer Portal (developer.intuit.com) → Dashboard',
      'Click "Create an app" and select "QuickBooks Online and Payments"',
      'Under Keys & credentials → Redirect URIs, add the URI below',
      'Copy the Client ID and Client Secret from the app dashboard',
    ],
    apiReference: {
      docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account',
      purpose: 'Cloud accounting — invoicing, expenses, payroll, tax, and financial reporting',
      dataTypes: ['invoices', 'customers', 'accounts', 'payments', 'estimates', 'reports'],
      capabilities: ['read', 'write', 'search', 'webhooks'],
    },
  },

  // ─── Tier 2: API Key ──────────────────────────────────────────────────
  {
    id: 'hirehop',
    displayName: 'HireHop',
    icon: 'bi-truck',
    description: 'Equipment rental and event hire management',
    category: 'Equipment & Rental',
    authType: 'api-key',
    tier: 2,
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
    helpUrl: 'https://www.hirehop.com/',
    apiReference: {
      docsUrl: 'https://www.hirehop.com/',
      purpose: 'Equipment rental and event hire management with job tracking, invoicing, and resource scheduling',
      dataTypes: ['jobs', 'contacts', 'items', 'invoices', 'depots', 'categories'],
      capabilities: ['read', 'write', 'sql-query'],
      exampleRequests: [
        {
          description: 'Search jobs',
          method: 'GET',
          path: '/php_functions/job_search.php?token=X&search=keyword',
        },
        {
          description: 'Get job details',
          method: 'GET',
          path: '/php_functions/job_refresh.php?token=X&job=123',
        },
      ],
      endpointCategories: [
        { name: 'Jobs', description: 'Job creation, search, and management', basePath: '/php_functions/job_*.php' },
        { name: 'Stock', description: 'Equipment and stock management', basePath: '/php_functions/stock_*.php' },
        { name: 'Contacts', description: 'Contact and company management', basePath: '/php_functions/contact_*.php' },
      ],
    },
  },
  {
    id: 'connecteam-api',
    displayName: 'Connecteam (API Key)',
    icon: 'bi-people',
    description: 'Employee management — time clock, scheduling, and forms (API key)',
    category: 'HR & Workforce',
    authType: 'api-key',
    tier: 2,
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiToken',
        type: 'password',
        placeholder: 'Paste your Connecteam API key',
        required: true,
      },
    ],
    helpUrl: 'https://developer.connecteam.com/',
    apiReference: {
      docsUrl: 'https://developer.connecteam.com/',
      purpose: 'All-in-one employee management — time tracking, scheduling, forms, training, and communication',
      dataTypes: ['users', 'shifts', 'timesheets', 'forms', 'assets', 'courses'],
      capabilities: ['read', 'write'],
    },
  },
  {
    id: 'totalsynergy-api',
    displayName: 'Total Synergy (API Key)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (API key)',
    category: 'Project Management',
    authType: 'api-key',
    tier: 2,
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
    helpUrl: 'https://developer.totalsynergy.com/',
    apiReference: {
      docsUrl: 'https://developer.totalsynergy.com/api/',
      purpose: 'Practice management for architecture, engineering, and construction firms',
      dataTypes: ['projects', 'contacts', 'timesheets', 'invoices', 'documents', 'staff'],
      capabilities: ['read', 'write', 'search'],
    },
  },

  // ─── Tier 2: Token ─────────────────────────────────────────────────────
  {
    id: 'workbench',
    displayName: 'Workbench International',
    icon: 'bi-pc-display',
    description: 'ERP for trade and distribution businesses',
    category: 'ERP',
    authType: 'token',
    tier: 2,
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
    apiReference: {
      purpose: 'ERP system for trade and distribution businesses with inventory, orders, and financials',
      dataTypes: ['products', 'orders', 'customers', 'invoices', 'inventory'],
      capabilities: ['read', 'write'],
    },
  },
  {
    id: 'fergus',
    displayName: 'Fergus',
    icon: 'bi-wrench-adjustable',
    description: 'Job management for trade businesses',
    category: 'Field Service',
    authType: 'token',
    tier: 2,
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'Paste your Fergus API key',
        required: true,
      },
    ],
    helpUrl: 'https://info.fergus.com/developers',
    apiReference: {
      purpose: 'Job management for plumbers, electricians, builders, and other trade businesses',
      dataTypes: ['jobs', 'contacts', 'quotes', 'invoices', 'timesheets', 'schedules'],
      capabilities: ['read', 'write', 'search'],
    },
  },

  // ─── Tier 2: Username/Password ─────────────────────────────────────────
  {
    id: 'filemaker',
    displayName: 'Claris FileMaker',
    icon: 'bi-database',
    description: 'Custom database application platform',
    category: 'Database',
    authType: 'username-password',
    tier: 2,
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
    helpUrl: 'https://help.claris.com/en/data-api-guide/',
    apiReference: {
      docsUrl: 'https://help.claris.com/en/data-api-guide/',
      purpose: 'Custom low-code database application platform with RESTful Data API',
      dataTypes: ['records', 'layouts', 'scripts', 'containers'],
      capabilities: ['read', 'write', 'search', 'run-scripts'],
      exampleRequests: [
        {
          description: 'Get records from a layout',
          method: 'GET',
          path: '/fmi/data/v1/databases/{database}/layouts/{layout}/records',
        },
        {
          description: 'Find records',
          method: 'POST',
          path: '/fmi/data/v1/databases/{database}/layouts/{layout}/_find',
          body: '{"query":[{"fieldName":"=value"}]}',
        },
      ],
      endpointCategories: [
        {
          name: 'Records',
          description: 'CRUD operations on records',
          basePath: '/fmi/data/v1/databases/{db}/layouts/{layout}/records',
        },
        {
          name: 'Find',
          description: 'Search records with queries',
          basePath: '/fmi/data/v1/databases/{db}/layouts/{layout}/_find',
        },
        {
          name: 'Scripts',
          description: 'Execute FileMaker scripts',
          basePath: '/fmi/data/v1/databases/{db}/layouts/{layout}/script/{script}',
        },
      ],
    },
  },
  {
    id: 'flowingly',
    displayName: 'Flowingly',
    icon: 'bi-arrow-repeat',
    description: 'Business process management and workflow automation',
    category: 'Workflow',
    authType: 'username-password',
    tier: 2,
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
    helpUrl: 'https://www.flowingly.io/',
    apiReference: {
      purpose: 'Business process automation and workflow management platform',
      dataTypes: ['flows', 'instances', 'tasks', 'users', 'forms'],
      capabilities: ['read', 'write', 'search'],
    },
  },
  {
    id: 'printiq',
    displayName: 'PrintIQ',
    icon: 'bi-printer',
    description: 'Print MIS and workflow management',
    category: 'Manufacturing',
    authType: 'username-password',
    tier: 2,
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
    helpUrl: 'https://www.printiq.com/',
    apiReference: {
      purpose: 'Print management information system (MIS) with estimating, scheduling, and invoicing',
      dataTypes: ['jobs', 'quotes', 'products', 'customers', 'invoices', 'purchase-orders'],
      capabilities: ['read', 'write', 'search'],
    },
  },

  // ─── Tier 3: Contact Required ──────────────────────────────────────────
  {
    id: 'buildertrend',
    displayName: 'BuilderTrend',
    icon: 'bi-house-gear',
    description: 'Construction project management for builders and remodelers',
    category: 'Construction',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.buildertrend.com/',
      notes: 'API access requires a BuilderTrend enterprise plan. Contact their team for integration partnership.',
    },
    apiReference: {
      purpose: 'Construction project management — scheduling, budgeting, customer management, and daily logs',
      dataTypes: ['projects', 'schedules', 'budgets', 'daily-logs', 'change-orders'],
      capabilities: ['read'],
    },
  },
  {
    id: 'abel-software',
    displayName: 'Abel Software',
    icon: 'bi-box-seam',
    description: 'ERP for manufacturing and distribution businesses',
    category: 'ERP',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.intsolnz.com/',
      email: 'info@intsolnz.com',
      notes: 'Contact Integrated Solutions NZ for API access and integration partnership.',
    },
    apiReference: {
      purpose: 'ERP for manufacturing, distribution, and job costing businesses in NZ/AU',
      dataTypes: ['orders', 'inventory', 'customers', 'suppliers', 'invoices'],
      capabilities: ['read'],
    },
  },
  {
    id: 'sistemi',
    displayName: 'Sistemi',
    icon: 'bi-briefcase',
    description: 'Accounting and business management for NZ businesses',
    category: 'Accounting',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.sistemi.co.nz/',
      notes: 'Contact Sistemi for API access details and integration partnership.',
    },
    apiReference: {
      purpose: 'Business management and accounting system designed for NZ small businesses',
      dataTypes: ['invoices', 'customers', 'suppliers', 'general-ledger'],
      capabilities: ['read'],
    },
  },
  {
    id: 'geroc',
    displayName: 'Geroc',
    icon: 'bi-geo-alt',
    description: 'Geographic and asset management',
    category: 'Asset Management',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.geroc.co.nz/',
      notes: 'Contact Geroc for API access and integration possibilities.',
    },
    apiReference: {
      purpose: 'Geographic and asset management for infrastructure and utilities',
      dataTypes: ['assets', 'locations', 'inspections', 'work-orders'],
      capabilities: ['read'],
    },
  },
  {
    id: 'tablogs',
    displayName: 'TabLogs',
    icon: 'bi-card-checklist',
    description: 'Digital forms and inspection management',
    category: 'Field Service',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.tablogs.com/',
      notes: 'Contact TabLogs for API access and data export options.',
    },
    apiReference: {
      purpose: 'Digital forms, checklists, and inspection management for field teams',
      dataTypes: ['forms', 'inspections', 'reports', 'templates'],
      capabilities: ['read'],
    },
  },
  {
    id: 'ravebuild',
    displayName: 'Rave Build',
    icon: 'bi-bricks',
    description: 'Construction management for residential builders',
    category: 'Construction',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.ravebuild.com/',
      notes: 'Contact Rave Build for API integration and data access.',
    },
    apiReference: {
      purpose: 'Residential construction management — estimates, schedules, variations, and client portal',
      dataTypes: ['projects', 'schedules', 'estimates', 'variations'],
      capabilities: ['read'],
    },
  },
  {
    id: 'myhub-intranet',
    displayName: 'MyHub Intranet',
    icon: 'bi-globe2',
    description: 'Cloud intranet for internal communications',
    category: 'Collaboration',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.myhubintranet.com/',
      notes: 'Contact MyHub for API access and integration partnership.',
    },
    apiReference: {
      purpose: 'Cloud-based intranet for internal communications, knowledge sharing, and document management',
      dataTypes: ['pages', 'documents', 'news', 'staff-directory'],
      capabilities: ['read'],
    },
  },
  {
    id: 'siteapp-pro',
    displayName: 'SiteApp Pro',
    icon: 'bi-cone-striped',
    description: 'Construction site safety and compliance management',
    category: 'Construction',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.siteapppro.com/',
      notes: 'Contact SiteApp Pro for API access and integration options.',
    },
    apiReference: {
      purpose: 'Construction site safety management — hazard identification, incident reporting, and compliance',
      dataTypes: ['sites', 'hazards', 'incidents', 'inspections', 'workers'],
      capabilities: ['read'],
    },
  },
  {
    id: 'rosterelf',
    displayName: 'RosterElf / WFS',
    icon: 'bi-calendar-check',
    description: 'Staff rostering and workforce scheduling',
    category: 'HR & Workforce',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.rosterelf.com/',
      notes: 'Contact RosterElf for API access and integration options.',
    },
    apiReference: {
      purpose: 'Staff rostering, time and attendance, and workforce scheduling',
      dataTypes: ['rosters', 'shifts', 'timesheets', 'staff', 'leave'],
      capabilities: ['read'],
    },
  },
  {
    id: 'eci-m1',
    displayName: 'ECI M1',
    icon: 'bi-gear-wide-connected',
    description: 'ERP for make-to-order manufacturers',
    category: 'ERP',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.ecisolutions.com/erp/m1-erp/',
      notes: 'Contact ECI Solutions for M1 API access and integration partnership.',
    },
    apiReference: {
      purpose: 'ERP system designed for small to mid-sized make-to-order manufacturers',
      dataTypes: ['orders', 'inventory', 'bom', 'routing', 'purchasing'],
      capabilities: ['read'],
    },
  },
  {
    id: 'klevr',
    displayName: 'Klevr',
    icon: 'bi-lightning',
    description: 'Workflow automation and field service management',
    category: 'Field Service',
    authType: 'contact-required',
    tier: 3,
    contactInfo: {
      website: 'https://www.klevr.co.nz/',
      notes: 'Contact Klevr for API access and integration options.',
    },
    apiReference: {
      purpose: 'Workflow automation and field service management for NZ service companies',
      dataTypes: ['jobs', 'workflows', 'forms', 'assets', 'schedules'],
      capabilities: ['read'],
    },
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
    helpUrl: ct.helpUrl || '',
    discoveryUrl: ct.oauth.discoveryUrl,
  };
};

/** Get all OAuth ConnectorTemplates as ProviderTemplate[] */
export const getOAuthProviderTemplates = (): ProviderTemplate[] =>
  getOAuthConnectors()
    .map(toProviderTemplate)
    .filter((t): t is ProviderTemplate => t !== null);
