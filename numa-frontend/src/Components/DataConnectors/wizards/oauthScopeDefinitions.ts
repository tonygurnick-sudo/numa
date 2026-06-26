export interface ScopeOption {
  id: string;
  label: string;
  scope: string;
  description: string;
  default: boolean;
}

export const PROVIDER_SCOPES: Record<string, ScopeOption[]> = {
  gmail: [
    {
      id: 'readonly',
      label: 'Read emails',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      description: 'View and search emails without making changes',
      default: true,
    },
    {
      id: 'send',
      label: 'Send emails',
      scope: 'https://www.googleapis.com/auth/gmail.send',
      description: 'Send emails on your behalf',
      default: false,
    },
    {
      id: 'modify',
      label: 'Modify emails',
      scope: 'https://www.googleapis.com/auth/gmail.modify',
      description: 'Read, send, delete, and manage labels on emails',
      default: false,
    },
    {
      id: 'labels',
      label: 'Manage labels',
      scope: 'https://www.googleapis.com/auth/gmail.labels',
      description: 'Create, update, and delete labels',
      default: false,
    },
  ],
  googledrive: [
    {
      id: 'read',
      label: 'Read files',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      description: 'View and download all Drive files',
      default: true,
    },
    {
      id: 'write',
      label: 'Full access',
      scope: 'https://www.googleapis.com/auth/drive',
      description: 'View, edit, create and delete Drive files',
      default: false,
    },
    {
      id: 'metadata',
      label: 'Metadata only',
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      description: 'View file names, sizes and dates without downloading',
      default: false,
    },
    {
      id: 'apponly',
      label: 'App-created files only',
      scope: 'https://www.googleapis.com/auth/drive.file',
      description: 'Access only files created by or opened with this app',
      default: false,
    },
  ],
  onedrive: [
    {
      id: 'read',
      label: 'Read user files',
      scope: 'Files.Read',
      description: "Read the user's own files",
      default: true,
    },
    {
      id: 'readall',
      label: 'Read all files',
      scope: 'Files.Read.All',
      description: 'Read all files the user can access',
      default: false,
    },
    {
      id: 'readwrite',
      label: 'Read & write files',
      scope: 'Files.ReadWrite',
      description: "Create, read, update, delete user's files",
      default: false,
    },
    {
      id: 'rwall',
      label: 'Read & write all files',
      scope: 'Files.ReadWrite.All',
      description: 'Full CRUD on all accessible files',
      default: false,
    },
    {
      id: 'sites',
      label: 'SharePoint sites',
      scope: 'Sites.Read.All',
      description: 'Read documents from SharePoint sites',
      default: false,
    },
    {
      id: 'offline',
      label: 'Offline access',
      scope: 'offline_access',
      description: 'Maintain access when user is not active',
      default: true,
    },
  ],
  dropbox: [
    {
      id: 'metaread',
      label: 'Read file info',
      scope: 'files.metadata.read',
      description: 'View names, sizes, dates',
      default: true,
    },
    {
      id: 'metawrite',
      label: 'Manage files',
      scope: 'files.metadata.write',
      description: 'Move, rename, delete files',
      default: false,
    },
    {
      id: 'read',
      label: 'Read file content',
      scope: 'files.content.read',
      description: 'Download and read files',
      default: true,
    },
    {
      id: 'write',
      label: 'Write file content',
      scope: 'files.content.write',
      description: 'Upload and edit files',
      default: false,
    },
    {
      id: 'sharing',
      label: 'View sharing',
      scope: 'sharing.read',
      description: 'View shared folders and links',
      default: false,
    },
    {
      id: 'account',
      label: 'Account info',
      scope: 'account_info.read',
      description: 'View name, email, quota',
      default: true,
    },
  ],
  workflowmax: [
    {
      id: 'openid',
      label: 'OpenID',
      scope: 'openid',
      description: 'Required for authentication',
      default: true,
    },
    {
      id: 'profile',
      label: 'Profile',
      scope: 'profile',
      description: 'Access user profile information',
      default: true,
    },
    {
      id: 'email',
      label: 'Email',
      scope: 'email',
      description: 'Access user email address',
      default: true,
    },
    {
      id: 'workflowmax',
      label: 'WorkflowMax',
      scope: 'workflowmax',
      description: 'Access WorkflowMax data (jobs, clients, timesheets)',
      default: true,
    },
  ],
  podio: [
    {
      id: 'global',
      label: 'Global access',
      scope: 'global:all',
      description: 'Full access to Podio resources',
      default: true,
    },
  ],
  simpro: [
    {
      id: 'default',
      label: 'Default access',
      scope: 'default',
      description: 'Standard API access to simPRO data',
      default: true,
    },
  ],
  getjobber: [
    {
      id: 'clients',
      label: 'Read clients',
      scope: 'read_clients',
      description: 'View client information',
      default: true,
    },
    {
      id: 'jobs',
      label: 'Read jobs',
      scope: 'read_jobs',
      description: 'View job information',
      default: true,
    },
    {
      id: 'invoices',
      label: 'Read invoices',
      scope: 'read_invoices',
      description: 'View invoice information',
      default: true,
    },
    {
      id: 'quotes',
      label: 'Read quotes',
      scope: 'read_quotes',
      description: 'View quote information',
      default: false,
    },
    {
      id: 'write_clients',
      label: 'Write clients',
      scope: 'write_clients',
      description: 'Create and update clients',
      default: false,
    },
    {
      id: 'write_jobs',
      label: 'Write jobs',
      scope: 'write_jobs',
      description: 'Create and update jobs',
      default: false,
    },
  ],
  wrike: [
    {
      id: 'readonly',
      label: 'Read only',
      scope: 'wsReadOnly',
      description: 'View tasks, projects, and folders',
      default: true,
    },
    {
      id: 'readwrite',
      label: 'Read & write',
      scope: 'wsReadWrite',
      description: 'Full CRUD on tasks, projects, and folders',
      default: false,
    },
    {
      id: 'amreadonly',
      label: 'Account management (read)',
      scope: 'amReadOnlyWorkflow',
      description: 'View workflows and account info',
      default: false,
    },
  ],
  'totalsynergy-oauth': [
    {
      id: 'default',
      label: 'Default access',
      scope: 'default',
      description: 'Standard API access to Total Synergy',
      default: true,
    },
  ],
  'zoho-crm': [
    {
      id: 'modules',
      label: 'CRM records',
      scope: 'ZohoCRM.modules.ALL',
      description: 'Read and write all CRM modules — leads, contacts, accounts, deals, tasks',
      default: true,
    },
    {
      id: 'users',
      label: 'Users (read)',
      scope: 'ZohoCRM.users.READ',
      description: 'View user records in the org',
      default: true,
    },
    {
      id: 'org',
      label: 'Org metadata (read)',
      scope: 'ZohoCRM.org.READ',
      description: 'View organisation profile and settings',
      default: true,
    },
    {
      id: 'settings',
      label: 'Settings (read)',
      scope: 'ZohoCRM.settings.READ',
      description: 'View module layouts, fields, pipelines and other configuration',
      default: false,
    },
  ],
  netsuite: [
    {
      id: 'rest_webservices',
      label: 'REST Web Services',
      scope: 'rest_webservices',
      description: 'SuiteTalk REST — record CRUD (customer, salesOrder, invoice, …) and SuiteQL ad-hoc queries',
      default: true,
    },
    {
      id: 'restlets',
      label: 'RESTlets',
      scope: 'restlets',
      description:
        'Custom server-side SuiteScript endpoints. Combinable with REST Web Services and SuiteAnalytics Connect on the same integration record.',
      default: false,
    },
    {
      id: 'suite_analytics',
      label: 'SuiteAnalytics Connect',
      scope: 'suite_analytics',
      description: 'BI / data warehouse loads via the SuiteAnalytics driver',
      default: false,
    },
    {
      id: 'mcp',
      label: 'AI Connector (MCP)',
      scope: 'mcp',
      description:
        'NetSuite AI Connector Service JSON-RPC tools. EXCLUSIVE — cannot be combined with REST Web Services / RESTlets / SuiteAnalytics on the same integration record. Requires its own dedicated NetSuite Integration Record + MCP SuiteApp + custom role.',
      default: false,
    },
  ],
  actionstep: [
    {
      id: 'actions',
      label: 'Matters (Actions)',
      scope: 'actions',
      description: 'Read matters/actions — the core case records',
      default: true,
    },
    {
      id: 'participants',
      label: 'Contacts (Participants)',
      scope: 'participants',
      description: 'Read contacts and participants linked to matters',
      default: true,
    },
    {
      id: 'timerecords',
      label: 'Time records',
      scope: 'timerecords',
      description: 'Read recorded time entries and units',
      default: true,
    },
    {
      id: 'filenotes',
      label: 'File notes',
      scope: 'filenotes',
      description: 'Read file notes attached to matters',
      default: false,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      scope: 'tasks',
      description: 'Read tasks and assignments',
      default: false,
    },
    {
      id: 'bills',
      label: 'Billing',
      scope: 'bills',
      description: 'Read bills and billing data',
      default: false,
    },
    {
      id: 'actiondocuments',
      label: 'Documents',
      scope: 'actiondocuments',
      description: 'Read documents stored against matters',
      default: false,
    },
    {
      id: 'all',
      label: 'Full access (all data)',
      scope: 'all',
      description: 'Access to all data in your Actionstep system — use only if scoped access is insufficient',
      default: false,
    },
  ],
};

// Providers that expect a comma-separated scope string instead of the
// OAuth-2-default space-separated form. Zoho and Xero are the notable cases.
const COMMA_SEPARATED_PROVIDERS: ReadonlySet<string> = new Set(['zoho-crm', 'xero']);

const separatorFor = (providerId: string): ',' | ' ' => (COMMA_SEPARATED_PROVIDERS.has(providerId) ? ',' : ' ');

/** Build the scope string from selected scope IDs, using the provider's
 *  expected separator (space for OAuth default, comma for Zoho/Xero). */
export const buildScopeString = (providerId: string, selectedIds: string[]): string => {
  const sep = separatorFor(providerId);
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return selectedIds.join(sep);
  return defs
    .filter((s) => selectedIds.includes(s.id))
    .map((s) => s.scope)
    .join(sep);
};

/** Parse a scope string back into selected scope IDs for a given provider.
 *  Splits on whitespace OR commas so it tolerates both providers' formats. */
export const parseScopeString = (providerId: string, scopeString: string): string[] => {
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return [];
  const scopes = scopeString.split(/[\s,]+/).filter(Boolean);
  return defs.filter((s) => scopes.includes(s.scope)).map((s) => s.id);
};

/** Get default scope IDs for a provider */
export const getDefaultScopeIds = (providerId: string): string[] => {
  const defs = PROVIDER_SCOPES[providerId];
  if (!defs) return [];
  return defs.filter((s) => s.default).map((s) => s.id);
};
