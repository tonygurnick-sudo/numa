// ---------------------------------------------------------------------------
// Connector Registry — single source of truth for all 25+ platforms
// MERGE: kept dev version — adds oauthSetupSteps and enriched apiReference
//   fields vs base wizard commit.
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
  /**
   * When true, the value is normalised to a DNS-safe hostname component
   * (lowercased, `_` replaced with `-`) at URL-placeholder substitution time.
   * Only affects values interpolated into authUrl / tokenUrl — the stored
   * field value keeps the admin's original input. Needed for providers that
   * embed tenant identifiers in the hostname (e.g. NetSuite account IDs).
   */
  hostnameSafe?: boolean;
}

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
  };

  // Non-standard OAuth Authorization header scheme. Defaults to `Bearer`
  // when omitted. Zoho uses `Zoho-oauthtoken`; most providers use `Bearer`.
  // Persisted to the company vault at wizard save time so the backend
  // request path picks it up without a redeploy.
  //
  // SENTINEL: the literal value `access-token` means the OAuth access token is
  // sent in a header NAMED `access-token` (not inside `Authorization` at all) —
  // Total Synergy's custom scheme. The backend request path special-cases this.
  authHeaderScheme?: string;

  // Selects a bespoke OAuth authorize/token-exchange/refresh adapter in the
  // oauth-auth-handler Lambda when the provider's flow is NOT RFC-6749 standard
  // (custom param/body names, non-standard token endpoint host/path, custom
  // token-response field casing). `'totalsynergy'` builds the
  // ApplicationKey/RedirectUri/tenant authorize URL and POSTs to
  // api.totalsynergy.com/api/v2/Oauth2/GetAccessToken|RefreshAccessToken.
  // Persisted to the company vault as `oauth_adapter` at wizard save time so
  // the Lambda picks it up without a code change to the registry import.
  oauthAdapter?: string;

  // Non-OAuth credential fields
  credentialFields?: CredentialFieldDef[];

  // Admin-level config fields captured in the ApiKeyWizard and persisted to the
  // connector-config-{id} company secret — account-level values shared by every
  // user (e.g. ProWorkflow's account API key). Distinct from credentialFields,
  // which are per-user and captured in chat on first use.
  adminFields?: CredentialFieldDef[];

  // Header name that carries the company-level `api_key` admin field on
  // outbound requests (ProWorkflow uses `apikey`). Persisted to the company
  // vault as `api_key_header` at wizard save time so the backend request path
  // picks it up without a redeploy.
  apiKeyHeader?: string;

  // Maps outbound auth header names to per-user credential field keys for
  // APIs that authenticate with custom headers instead of an Authorization
  // header (e.g. Cin7 Core's api-auth-accountid / api-auth-applicationkey).
  // Persisted to the company vault as `credential_header_map` at wizard save
  // time; the backend builds these headers from the user's vault fields.
  credentialHeaderMap?: Record<string, string>;

  // Constant non-secret headers every request to this connector must carry
  // (e.g. GoHighLevel's `Version: 2021-07-28`). Persisted to the company
  // vault as `static_headers` at wizard save time; the backend merges them
  // into every request (caller-supplied headers still win).
  staticHeaders?: Record<string, string>;

  // False = the connector cannot be self-service-added from the Integrations
  // picker (chat-only by design like PMO365, or its auth model isn't
  // supported by the generic request path yet, like the FileMaker/Flowingly/
  // PrintIQ token-exchange flows). Default true. Also excludes the connector
  // from the NATIVE_CONNECTORS catalog-consistency expectation.
  selfService?: boolean;

  // True = the admin MUST enter an Instance URL in the wizard (customer-
  // hosted APIs with no fixed base URL, e.g. Jiwa). The wizard blocks save
  // on a blank value.
  instanceUrlRequired?: boolean;

  // True = connector has a default baseUrl but ALSO supports an optional custom
  // instance URL (e.g. GitLab self-managed). Keeps the wizard's Instance URL
  // field visible even though baseUrl is set.
  instanceUrlOptional?: boolean;

  // Common metadata
  baseUrl?: string;
  rateLimitRpm?: number;
  rateLimitDaily?: number;

  // OAuth-specific setup guidance
  oauthSetupSteps?: string[];

  // True = the admin may legitimately need to edit the authorize/token URLs
  // (e.g. Zoho's per-region data-centre hosts). Keeps "Advanced OAuth Settings"
  // visible for this connector; for all other known connectors it stays hidden.
  editableOAuthUrls?: boolean;

  // OAuth platform family — connectors sharing the same OAuth client ('google' | 'microsoft')
  oauthPlatform?: string;

  // Where the connector surfaces in the UI. A file-browsing connector (e.g. Google Drive,
  // Dropbox, Gmail) shows up in Files > Remote; an API-only connector (e.g. Fergus, simPRO)
  // only exposes itself from chat. Default is ['chat'] — explicitly opt a connector in to
  // files surfacing by including 'files'.
  surfaces?: ('files' | 'chat')[];

  // Hidden-by-default feature flag gating the connector's existence. When set, the
  // connector is only offered in the Add-Integration picker when sessionStorage
  // `DEPLOY_<featureFlag>` === 'true' AND getFlag(featureFlag) is true (matches the
  // SynergyKbSyncPanel hidden-by-default rule — a bare getFlag() defaults true on
  // absent flags, which would wrongly surface the connector on un-flagged clients).
  featureFlag?: string;
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
    description: 'Search and browse your Synergy 12d jobs, folders and files from inside Numa',
    category: 'Project Management',
    // Synergy connector existence is gated on the Synergy Connector flag.
    featureFlag: 'SYNERGY',
    authType: 'token',
    surfaces: ['files', 'chat'],
    instanceUrlRequired: true,
    // Per-user credential: just the PAT. instance_url is admin-level
    // (configured in ApiKeyWizard → connector-config-synergy.fields.instance_url)
    // because Synergy is customer-hosted and the URL is the same for every
    // user in a given workspace — no point asking each user to re-enter it.
    credentialFields: [
      {
        key: 'access_token',
        label: 'dataConnectors.fields.pat',
        type: 'password',
        placeholder: '',
        required: true,
        helpText: 'dataConnectors.fields.synergyPatHint',
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
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Google Cloud Console → APIs & Services → Library and enable the Google Drive API',
      'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID',
      "Choose 'Web application' as the application type",
      "Under 'Authorized redirect URIs', add the redirect URI shown in this wizard (copy it verbatim — it must match exactly)",
      "Copy the Client ID and Client Secret — you'll paste them on the next step (Credentials)",
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
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      extraAuthParams: '{"access_type":"offline","prompt":"consent"}',
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Google Cloud Console → APIs & Services → Library and enable the Gmail API',
      'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID',
      "Choose 'Web application' as the application type",
      "Under 'Authorized redirect URIs', add the redirect URI shown in this wizard (copy it verbatim — it must match exactly)",
      "Copy the Client ID and Client Secret — you'll paste them on the next step (Credentials)",
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
    oauth: {
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: 'https://graph.microsoft.com/Files.Read.All offline_access',
      extraAuthParams: '{"response_mode":"query"}',
      discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    },
    oauthSetupSteps: [
      'Go to Azure Portal → App registrations → New registration',
      'Set a name and choose "Accounts in any organizational directory and personal Microsoft accounts"',
      'Under "Redirect URIs", add the redirect URI shown below as type "Web"',
      'Go to Certificates & secrets → New client secret → copy the Value',
      "Copy the Application (client) ID from the Azure app registration's Overview page (in Azure Portal)",
    ],
  },
  {
    id: 'dropbox',
    displayName: 'Dropbox',
    icon: 'bi-dropbox',
    description: 'Access and browse Dropbox files',
    category: 'Cloud Storage',
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
      // WorkflowMax by BlueRock — the live product since Xero retired the
      // original Xero-hosted WorkflowMax on 26 Jun 2024. OAuth runs on
      // BlueRock's own platform (oauth.workflowmax2.com), NOT Xero identity.
      // offline_access is required to be issued a refresh token.
      authUrl: 'https://oauth.workflowmax2.com/oauth/authorize',
      tokenUrl: 'https://oauth.workflowmax2.com/oauth/token',
      scopes: 'openid profile email workflowmax offline_access',
      extraAuthParams: '{"prompt":"consent"}',
    },
    oauthSetupSteps: [
      'Sign in to the Xero Developer Portal at developer.xero.com and open My Apps (WorkflowMax by BlueRock still registers OAuth apps here; the connection itself runs on workflowmax2.com)',
      'Click "New app" and choose "Web app" as the integration type',
      'Set the Company or application URL to your Numa address (e.g. https://yourco.numa.arcanum.ai)',
      'Add the redirect URI shown below exactly as it appears under "OAuth 2.0 redirect URIs"',
      'Copy the Client ID, then click "Generate a secret" and copy the Client Secret right away (it is shown only once)',
      'Make sure the WorkflowMax user who connects has "Authorise 3rd Party Full Access" on their staff record, or the connection succeeds but every data request is rejected',
    ],
  },
  {
    id: 'podio',
    displayName: 'Podio',
    icon: 'bi-grid-3x3-gap',
    description: 'Flexible work management and collaboration platform',
    category: 'Project Management',
    authType: 'oauth2',
    // Podio uses its own Authorization scheme — NOT Bearer (Bearer -> 401).
    authHeaderScheme: 'OAuth2',
    oauth: {
      authUrl: 'https://podio.com/oauth/authorize',
      // Documented token endpoint is on api.podio.com with a /v2 suffix —
      // different host from the authorize URL. https://developers.podio.com/authentication
      tokenUrl: 'https://api.podio.com/oauth/token/v2',
      scopes: '',
      extraAuthParams: '{}',
    },
    oauthSetupSteps: [
      'Sign in to Podio with an account that can create API keys and open podio.com/settings/api (the "API Keys" page)',
      'Click "Generate API Key" to create a new API client application and name it (e.g. Numa Integration)',
      'In the "Domain" / return-URL field, enter the domain of the redirect URI shown below (e.g. yourco.numa.arcanum.ai) — Podio matches on the domain, not the full URL, so the host must match exactly',
      'Save, then copy the Client ID and copy the Client Secret right away (it is shown only once)',
      'Paste both into this wizard',
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
      // simPRO OAuth runs on each customer's own build subdomain
      // (https://<BUILD>.simprosuite.com), NOT a global host — the old
      // login.simprogroup.com endpoint did not resolve. <BUILD> is interpolated
      // from the build credentialField below (hostnameSafe).
      authUrl: 'https://<BUILD>.simprosuite.com/oauth2/login',
      tokenUrl: 'https://<BUILD>.simprosuite.com/oauth2/token',
      scopes: '',
    },
    credentialFields: [
      {
        key: 'build',
        label: 'simPRO build (subdomain)',
        type: 'text',
        placeholder: 'yourco',
        required: true,
        hostnameSafe: true,
        helpText: 'dataConnectors.fields.simproBuildHint',
      },
    ],
    oauthSetupSteps: [
      'In simPRO go to System > Setup > API > Applications and click Add.',
      'Set Access Type to OAuth 2.0 and Grant Type to Authorization Code.',
      'Paste the redirect URI shown below into the Redirect URI field exactly as it appears, then Save.',
      'simPRO shows the Client ID and Client Secret once — copy both now.',
      'On the Credentials step, enter your build subdomain — the yourco in yourco.simprosuite.com.',
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
      'Sign in to the Jobber Developer Portal at developer.getjobber.com.',
      'Click "Create App" and fill in an app name and description (both appear on the consent screen).',
      'In the "OAuth callback URL" field, paste the redirect URI shown below exactly as it appears.',
      'Copy the Client ID, then copy the Client Secret right away (it is shown only once).',
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
      'Sign in to the Wrike App Console at www.wrike.com/appconsole.htm#/api with a Wrike admin account (or use the profile menu → Apps & Integrations → API).',
      'Click "Create" / "New application" and name it (e.g. Numa Integration).',
      'Add the redirect URI shown below exactly as it appears — Wrike requires a byte-for-byte match.',
      'Copy the Client ID, then copy the Client Secret right away (it is shown only once).',
    ],
  },
  {
    id: 'totalsynergy-oauth',
    displayName: 'Total Synergy (OAuth)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (OAuth)',
    category: 'Project Management',
    authType: 'oauth2',
    surfaces: ['chat'],
    baseUrl: 'https://api.totalsynergy.com/api/v2',
    // Total Synergy's OAuth flow is vendor-custom, NOT RFC-6749: the authorize
    // URL uses ApplicationKey/RedirectUri/tenant (no response_type/scope/PKCE),
    // the token endpoint lives on a different host+path, and the access token
    // rides in a header literally named `access-token` (not Authorization).
    // `oauthAdapter` selects the bespoke flow in oauth-auth-handler; the
    // `access-token` sentinel on authHeaderScheme drives the outbound header.
    oauthAdapter: 'totalsynergy',
    authHeaderScheme: 'access-token',
    oauth: {
      authUrl: 'https://app.totalsynergy.com/OAuth2/Authorize',
      tokenUrl: 'https://api.totalsynergy.com/api/v2/Oauth2/GetAccessToken',
      scopes: '',
    },
    oauthSetupSteps: [
      'Register an application at app.totalsynergy.com/Applications (or contact Total Synergy support if you cannot access it)',
      "Copy the redirect URI shown in this wizard into the application's callback URI (it must match exactly)",
      'Total Synergy gives you an ApplicationKey and an ApplicationSecret — paste the ApplicationKey as the Client ID and the ApplicationSecret as the Client Secret here',
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
      'Sign in to the Xero Developer Portal at developer.xero.com and open My Apps.',
      'Click "New app" and choose "Web app" as the integration type.',
      'Set the Company or application URL to your Numa address (e.g. https://yourco.numa.arcanum.ai).',
      'Under "OAuth 2.0 redirect URIs", add the redirect URI shown below exactly as it appears (including any trailing slash).',
      'Open the app\'s Configuration page, copy the Client ID, then click "Generate a secret" and copy the Client Secret right away (Xero shows it only once).',
    ],
  },
  {
    id: 'myob-account-right',
    displayName: 'MYOB AccountRight',
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
      "Go to developer.myob.com and submit 'Register for API Access' — MYOB emails you my.MYOB portal login details.",
      'Sign in to my.MYOB, open the Developer tab, and click Register App.',
      'Paste the redirect URI shown below into the Redirect URI field exactly as it appears (including any trailing slash).',
      'Save — MYOB shows the API Key (Client ID) and API Secret (Client Secret); the secret is shown once, so copy both now.',
      'Note: only a user with the Administrator role on the company file can complete the connection.',
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
      // Per-instance ERP — every customer is on their own host
      // https://<INSTANCE_HOST>.myobadvanced.com. <INSTANCE_HOST> is
      // interpolated from the instance_host credentialField below. MYOB
      // Acumatica (Acumatica IdentityServer) serves OAuth2 at /identity/connect.
      authUrl: 'https://<INSTANCE_HOST>.myobadvanced.com/identity/connect/authorize',
      tokenUrl: 'https://<INSTANCE_HOST>.myobadvanced.com/identity/connect/token',
      // offline_access is required for Acumatica to issue a refresh token;
      // without it the connection silently expires when the access token does.
      scopes: 'api offline_access',
    },
    credentialFields: [
      {
        key: 'instance_host',
        label: 'MYOB Acumatica instance',
        type: 'text',
        placeholder: 'yourco',
        required: true,
        hostnameSafe: true,
        helpText: 'dataConnectors.fields.myobAcumaticaInstanceHint',
      },
    ],
    oauthSetupSteps: [
      'In your MYOB Acumatica instance open the Connected Applications screen (type SM303010 in the search box).',
      'Click + to add a new application and set Flow Type to Authorization Code.',
      'Paste the redirect URI shown below into the Redirect URI field exactly as it appears.',
      'Save — Acumatica shows the Client ID and Client Secret; the secret is shown once, so copy both now. (The Client ID includes an @Company suffix — copy the whole value.)',
      'On the Credentials step, enter your instance subdomain — the yourco in yourco.myobadvanced.com.',
    ],
  },
  {
    id: 'zoho-crm',
    displayName: 'Zoho CRM',
    icon: 'bi-person-rolodex',
    description: 'Zoho CRM — leads, contacts, accounts, deals, tasks',
    category: 'CRM',
    authType: 'oauth2',
    surfaces: ['chat'],
    // Zoho's authorize/token hosts are per-region data centres (US / EU / IN /
    // JP / CN / CA), so the admin may legitimately need to edit them — keep the
    // wizard's Advanced OAuth Settings section visible for this connector.
    editableOAuthUrls: true,
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
      'Log in to the Zoho API Console for your data centre and click "Add Client" — AU: https://api-console.zoho.com.au/, US: https://api-console.zoho.com/, EU: https://api-console.zoho.eu/, IN: https://api-console.zoho.in/, JP: https://api-console.zoho.jp/, CN: https://api-console.zoho.com.cn/, CA: https://api-console.zohocloud.ca/',
      'Choose "Server-based Applications" as the client type.',
      'Set Client Name to a name your users will recognise, Homepage URL to your Numa address, and paste the redirect URI shown below under "Authorized Redirect URIs" exactly as it appears (one character off gives an "Invalid Redirect URI" error).',
      'Save, then copy the Client ID and copy the Client Secret right away (the secret is shown only once).',
      'Non-AU customers: on the Credentials step, open Advanced OAuth Settings and replace accounts.zoho.com.au in the Authorization and Token URLs with your region host (e.g. accounts.zoho.eu) — Canada is the exception: use accounts.zohocloud.ca, NOT accounts.zoho.ca.',
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
      'Sign in to the Intuit Developer Portal at developer.intuit.com and open your Dashboard.',
      'Click "Create an app" and select "QuickBooks Online and Payments".',
      'Open the app\'s "Keys & credentials" page and use Production keys for a live company (Development keys only hit the QuickBooks sandbox).',
      'Under "Keys & credentials" → "Redirect URIs", add the redirect URI shown below exactly as it appears.',
      'Copy the Client ID, then copy the Client Secret (treat it as secret; you can regenerate it later if needed).',
    ],
  },

  // ─── Tier 2: OAuth2 (Legal) ─────────────────────────────────────────────
  {
    id: 'actionstep',
    displayName: 'Actionstep',
    icon: 'bi-briefcase',
    description: 'Legal practice management — matters, contacts, time recording, billing, and documents',
    category: 'Legal',
    authType: 'oauth2',
    surfaces: ['chat'],
    // Global OAuth endpoints (production). Authorize is on go.actionstep.com;
    // the token exchange POSTs to api.actionstep.com. Scopes are space-separated
    // resource names — the scope picker (oauthScopeDefinitions.ts:actionstep)
    // overrides this default. Staging uses *.actionstepstaging.com.
    //
    // Actionstep returns an `api_endpoint` in the token response — the
    // region-specific REST base URL — because each geographic region has a
    // different host. Until the backend captures that automatically from the
    // token exchange, the admin records the region base URL in the
    // `api_endpoint` field below (workspace-wide, like Synergy's instance URL),
    // so the workspace agent addresses the correct region.
    oauth: {
      authUrl: 'https://go.actionstep.com/api/oauth/authorize',
      tokenUrl: 'https://api.actionstep.com/api/oauth/token',
      scopes: 'actions participants timerecords',
    },
    credentialFields: [
      {
        key: 'api_endpoint',
        label: 'Actionstep API endpoint',
        type: 'url',
        placeholder: 'https://ap-southeast-2.actionstep.com',
        required: true,
        helpText: 'dataConnectors.fields.actionstepApiEndpointHint',
      },
    ],
    oauthSetupSteps: [
      'Email api@actionstep.com (or your Actionstep account manager) and ask for API credentials for your firm.',
      'Give them the redirect URI shown below; they register it and issue your Client ID and Client Secret.',
      'Paste the Client ID and Client Secret into this wizard.',
      'On the Credentials step, enter your regional API endpoint (e.g. https://ap-southeast-2.actionstep.com) — Actionstep provides this with your credentials.',
    ],
  },

  // ─── Tier 2: OAuth2 (Microsoft Dataverse — PPM) ─────────────────────────
  {
    id: 'pmo365',
    displayName: 'PMO365',
    icon: 'bi-diagram-3',
    description:
      'PMO365 project portfolio management — projects, risks, benefits, and financials, served from Microsoft Dataverse',
    category: 'Project Management',
    authType: 'oauth2',
    selfService: false,
    surfaces: ['chat'],
    // PMO365 is a Microsoft Power Platform solution — it has no API of its
    // own; its data lives in the customer's Microsoft Dataverse environment
    // and is reached via the Dataverse Web API (OData v4, JSON) at
    // {environment_url}/api/data/v9.2/. Auth is standard Entra ID OAuth using
    // the `organizations` authority (Dataverse is work/school accounts only —
    // no personal MSA). Bearer scheme (default). offline_access yields a
    // refresh token.
    //
    // The Dataverse scope is environment-specific ({env}/.default), and the
    // wizard only interpolates credential fields into authUrl/tokenUrl, not
    // scopes — so the admin pastes their environment host into
    // `environment_url` below AND edits the scope host in the wizard's
    // Advanced section to match (see oauthSetupSteps). Auto-deriving the scope
    // from environment_url is a worthwhile follow-up — see 03-connector-setup.
    oauth: {
      authUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      scopes: 'https://YOUR-ENV.crm.dynamics.com/.default offline_access',
      extraAuthParams: '{"response_mode":"query"}',
    },
    credentialFields: [
      {
        key: 'environment_url',
        label: 'Dataverse environment URL',
        type: 'url',
        placeholder: 'https://yourorg.crm.dynamics.com',
        required: true,
        helpText: 'dataConnectors.fields.pmo365EnvironmentUrlHint',
      },
    ],
    oauthSetupSteps: [
      "In the Microsoft Entra admin center go to App registrations > New registration and choose 'Accounts in any organizational directory'.",
      "Under Redirect URIs add the redirect URI shown below as type 'Web', exactly as it appears.",
      'Go to API permissions > Add a permission > Dynamics CRM > Delegated > user_impersonation, then click Grant admin consent.',
      'Go to Certificates & secrets > New client secret and copy the Value (shown once); copy the Application (client) ID from the Overview page.',
      'In the Power Platform admin center add this app as an Application User and give it a security role with read/write on the PMO365 tables.',
      'On the Credentials step, paste your Environment URL; then on the Permissions step edit the Scopes field and replace YOUR-ENV.crm.dynamics.com with your environment host (e.g. yourorg.crm.dynamics.com).',
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
        helpText: 'dataConnectors.fields.hirehopApiTokenHint',
      },
      {
        key: 'base_url',
        label: 'dataConnectors.fields.baseUrl',
        type: 'url',
        placeholder: 'https://myhirehop.com',
        required: true,
        helpText: 'dataConnectors.fields.hirehopBaseUrlHint',
      },
    ],
    oauthSetupSteps: [
      'In HireHop, switch to Admin mode → Settings → Users → your API user → open its Menu → API Token, and copy the token.',
      'Your Base URL is the web address you log in to HireHop at (e.g. https://myhirehop.com) — not www.hirehop.com.',
      'Each user enters their own HireHop API token (and base URL) when they first use HireHop in chat.',
    ],
  },
  {
    id: 'connecteam-api',
    displayName: 'Connecteam (API Key)',
    icon: 'bi-people',
    description: 'Employee management — time clock, scheduling, and forms (API key)',
    category: 'HR & Workforce',
    authType: 'api-key',
    baseUrl: 'https://api.connecteam.com',
    // Connecteam authenticates with a static `X-API-KEY` header, NOT
    // `Authorization: Bearer`. The map tells the generic request path
    // (connect_tools.do_request → _headers_from_fields) which user credential
    // field rides in which outbound header; ApiKeyWizard persists it as
    // `credential_header_map` on the company vault — no backend redeploy.
    credentialHeaderMap: { 'X-API-KEY': 'api_token' },
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiToken',
        type: 'password',
        placeholder: '',
        required: true,
        helpText: 'dataConnectors.fields.connecteamApiKeyHint',
      },
    ],
  },
  {
    id: 'motion',
    displayName: 'Motion',
    icon: 'bi-calendar-check',
    description: 'AI calendar, tasks, and project management',
    category: 'Productivity',
    authType: 'api-key',
    baseUrl: 'https://api.usemotion.com/v1',
    // Motion's individual plan caps at 12 requests/min (teams up to 120);
    // surfaced so the request path can pace calls and back off on 429.
    rateLimitRpm: 12,
    // Motion authenticates with a per-user `X-API-Key` header (NOT Bearer).
    // The field key is `api_token` (NOT `api_key`) on purpose — the backend
    // get_oauth_token() probe grabs `api_key` as a bearer token and bypasses
    // credentialHeaderMap; `api_token` (as connecteam-api uses) isn't in that
    // probe, so the header-map branch fires. Each user supplies their own key.
    credentialHeaderMap: { 'X-API-Key': 'api_token' },
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: '',
        required: true,
        helpText: 'dataConnectors.fields.motionApiKeyHint',
      },
    ],
    oauthSetupSteps: [
      'Log in to Motion (app.usemotion.com) and open Settings.',
      'In the API / integrations area, create a new API key.',
      'Copy the key immediately — Motion shows it only once.',
      'Each user connects with their own key, entered in chat on first use.',
    ],
  },
  {
    id: 'totalsynergy-api',
    displayName: 'Total Synergy (API Key)',
    icon: 'bi-building',
    description: 'Architecture and engineering practice management (API key)',
    category: 'Project Management',
    authType: 'api-key',
    baseUrl: 'https://api.totalsynergy.com/api/v2',
    // Total Synergy's API-key auth uses a custom header literally named
    // `access-token` (NOT Authorization: Bearer). The map tells the backend
    // request path which user credential field rides in which outbound header;
    // ApiKeyWizard persists it as `credential_header_map` on the company vault.
    // NOTE: the field key is `api_token` (not `api_key`) on purpose — the backend
    // get_oauth_token() probe list grabs `api_key` and treats it as an OAuth
    // bearer token, bypassing credentialHeaderMap. `api_token` (as connecteam-api
    // uses) isn't in that probe list, so the header-map branch fires correctly.
    credentialHeaderMap: { 'access-token': 'api_token' },
    credentialFields: [
      {
        key: 'api_token',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: '',
        required: true,
        helpText: 'dataConnectors.fields.totalsynergyApiKeyHint',
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
    // REST API base for data requests. <ACCOUNT_ID> is interpolated from the
    // account_id credentialField at save time (sandbox `1234567_SB1` → host
    // `1234567-sb1`). Without this the backend resolver finds no base_url and
    // relative SuiteTalk REST paths can't resolve. (The MCP scope path reads
    // account_id directly and doesn't use base_url.)
    baseUrl: 'https://<ACCOUNT_ID>.suitetalk.api.netsuite.com',
    oauth: {
      authUrl: 'https://<ACCOUNT_ID>.app.netsuite.com/app/login/oauth2/authorize.nl',
      tokenUrl: 'https://<ACCOUNT_ID>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token',
      // Fallback default — the scope picker (oauthScopeDefinitions.ts:netsuite)
      // overrides this. NetSuite's `mcp` scope is mutually exclusive with the
      // REST/RESTlets/SuiteAnalytics group, so never combine them on one
      // integration record. The four scopes are surfaced as separate
      // checkboxes; the admin picks whichever subset matches the Integration
      // Record's Scope field on the NetSuite side.
      //
      // Client secret is required because REST Web Services / RESTlets /
      // SuiteAnalytics scopes use NetSuite's Confidential Client flow.
      // Pure-PKCE Public Client is only valid for the `mcp` scope; since the
      // wizard supports both, we always collect the secret. PKCE params are
      // also still sent on the authorize URL — NetSuite ignores them for
      // confidential clients, so this is safe in either mode.
      scopes: 'rest_webservices',
    },
    credentialFields: [
      {
        key: 'account_id',
        label: 'NetSuite Account ID',
        type: 'text',
        placeholder: '1234567 or 1234567_SB1',
        required: true,
        hostnameSafe: true,
        helpText: 'dataConnectors.fields.netsuiteAccountIdHint',
      },
    ],
    oauthSetupSteps: [
      'In NetSuite go to Setup > Integration > Manage Integrations > New, name it (e.g. Numa Integration), and set State to Enabled.',
      "Check 'OAuth 2.0 Authorization Code Grant', then choose a Scope: REST Web Services for normal data access (or NetSuite AI Connector Service for MCP).",
      'On the Permissions step of this wizard, tick the SAME scope you selected on the NetSuite integration record — REST Web Services for normal data access, or AI Connector (MCP) if you chose NetSuite AI Connector Service. MCP cannot be combined with the others.',
      "Leave 'Public Client' UNCHECKED — this creates a Confidential Client so NetSuite issues a Client Secret (Numa requires it for the REST Web Services / RESTlets / SuiteAnalytics scopes).",
      'Paste the redirect URI shown below into the Redirect URI field exactly as it appears.',
      'Save — NetSuite shows BOTH the Client ID and the Client Secret once on the confirmation screen; copy both now (they are never shown again).',
      'On the Credentials step, enter your Account ID — found in NetSuite at Setup > Company > Company Information > Account ID (a number like 1234567).',
    ],
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
        placeholder: '',
        required: true,
        helpText: 'dataConnectors.fields.workbenchBearerTokenHint',
      },
      {
        key: 'instance_url',
        label: 'dataConnectors.fields.instanceUrl',
        type: 'url',
        placeholder: 'https://yourcompany.workbench.com',
        required: true,
        helpText: 'dataConnectors.fields.workbenchInstanceUrlHint',
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
    baseUrl: 'https://api.fergus.com',
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.pat',
        type: 'password',
        placeholder: 'fergPAT_…',
        required: true,
        helpText: 'dataConnectors.fields.fergusApiKeyHint',
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
    selfService: false,
    credentialFields: [
      {
        key: 'server_url',
        label: 'dataConnectors.fields.serverUrl',
        type: 'url',
        placeholder: 'https://myserver.fmi.filemaker-cloud.com',
        required: true,
        helpText: 'dataConnectors.fields.filemakerServerUrlHint',
      },
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'admin',
        required: true,
        helpText: 'dataConnectors.fields.filemakerUsernameHint',
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
        placeholder: 'Inventory',
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
    selfService: false,
    baseUrl: 'https://publicapi.flowingly.net',
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'admin@company.com',
        required: true,
        helpText: 'dataConnectors.fields.flowinglyUsernameHint',
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
    selfService: false,
    credentialFields: [
      {
        key: 'instance_url',
        label: 'dataConnectors.fields.instanceUrl',
        type: 'url',
        placeholder: 'https://yourco.printiq.com',
        required: true,
        helpText: 'dataConnectors.fields.printiqInstanceUrlHint',
      },
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'apiuser',
        required: true,
        helpText: 'dataConnectors.fields.printiqUsernameHint',
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
        helpText: 'dataConnectors.fields.printiqAppNameHint',
      },
      {
        key: 'app_key',
        label: 'dataConnectors.fields.appKey',
        type: 'password',
        placeholder: 'Paste your app key',
        required: true,
        helpText: 'dataConnectors.fields.printiqAppKeyHint',
      },
    ],
  },
  {
    id: 'proworkflow',
    displayName: 'ProWorkflow',
    icon: 'bi-kanban',
    description: 'Project, task and time management platform',
    category: 'Project Management',
    authType: 'username-password',
    baseUrl: 'https://api.proworkflow.net',
    rateLimitRpm: 1000, // API allows 500 requests per 30s per account API key
    // The API requires TWO auth mechanisms on every request: the account-level
    // API key (apikey header, admin-entered below) AND the user's own
    // ProWorkflow login as Basic auth — PWF enforces that user's permissions.
    apiKeyHeader: 'apikey',
    adminFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXXXXX-XXXXXXXX',
        required: true,
        helpText: 'dataConnectors.fields.proworkflowApiKeyHint',
      },
    ],
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'you@company.com',
        required: true,
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'Enter your ProWorkflow password',
        required: true,
      },
    ],
  },
  {
    id: 'greentree',
    displayName: 'MYOB Greentree',
    icon: 'bi-tree',
    description: 'Enterprise ERP — GL, AR/AP, job costing, inventory, HR, purchasing',
    category: 'ERP',
    authType: 'username-password',
    instanceUrlRequired: true,
    // Customer-hosted: the Greentree API is its own web server on the
    // customer's box (default port 9000), so the admin sets the instance URL
    // and the API must be internet-reachable over HTTPS. Every request needs
    // BOTH the site ApiKey (the Greentree serial number — account-level,
    // admin-entered, sent as the `ApiKey` header) AND the user's own Greentree
    // login as Basic auth (Greentree enforces that user's permissions).
    apiKeyHeader: 'ApiKey',
    adminFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.greentreeApiKey',
        type: 'password',
        placeholder: 'Greentree site serial number',
        required: true,
        helpText: 'dataConnectors.fields.greentreeApiKeyHint',
      },
    ],
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'Your Greentree username',
        required: true,
        helpText: 'dataConnectors.fields.greentreeUserHint',
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'Your Greentree password',
        required: true,
      },
    ],
  },
  {
    id: 'jiwa',
    displayName: 'Jiwa Financials',
    icon: 'bi-box-seam',
    description: 'ERP for inventory, sales and distribution businesses',
    category: 'ERP',
    authType: 'token',
    instanceUrlRequired: true,
    // Customer-hosted (self-hosted Windows service on the customer's own
    // infrastructure) — there is no fixed cloud base URL. The admin MUST set
    // the instance URL in the wizard, and the API must be reachable from the
    // internet over HTTPS. Per-user Staff API key travels as a Bearer token
    // and carries that staff member's Jiwa route permissions.
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'Paste your Jiwa Staff API key',
        required: true,
        helpText: 'dataConnectors.fields.jiwaApiKeyHint',
      },
    ],
  },
  {
    id: 'cin7-omni',
    displayName: 'Cin7 Omni',
    icon: 'bi-boxes',
    description: 'Inventory and order management (Cin7 Omni)',
    category: 'Inventory',
    authType: 'username-password',
    baseUrl: 'https://api.cin7.com/api',
    rateLimitRpm: 60, // 3/sec, 60/min, 5,000/day per API connection
    rateLimitDaily: 5000,
    // Basic auth: API username + API key (created in Cin7 Omni Settings →
    // Integrations & API). Permissions are per-endpoint on the key — a 403
    // means the key lacks that endpoint's permission, not bad credentials.
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'API username',
        required: true,
        helpText: 'dataConnectors.fields.cin7OmniKeyHint',
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.apiKey',
        type: 'password',
        placeholder: 'Paste your Cin7 Omni API key',
        required: true,
      },
    ],
  },
  {
    id: 'cin7-core',
    displayName: 'Cin7 Core',
    icon: 'bi-boxes',
    description: 'Inventory and order management (Cin7 Core, formerly DEAR)',
    category: 'Inventory',
    authType: 'api-key',
    baseUrl: 'https://inventory.dearsystems.com/externalapi/v2',
    rateLimitRpm: 60, // 60/min per application key
    // Cin7 Core authenticates with TWO custom headers, not Authorization —
    // the map below tells the backend which user credential field rides in
    // which header on every request.
    credentialHeaderMap: {
      'api-auth-accountid': 'account_id',
      'api-auth-applicationkey': 'application_key',
    },
    credentialFields: [
      {
        key: 'account_id',
        label: 'dataConnectors.fields.accountId',
        type: 'text',
        placeholder: 'Cin7 Core account ID',
        required: true,
        helpText: 'dataConnectors.fields.cin7CoreKeyHint',
      },
      {
        key: 'application_key',
        label: 'dataConnectors.fields.applicationKey',
        type: 'password',
        placeholder: 'Paste your application key',
        required: true,
      },
    ],
  },
  {
    id: 'betterimpact',
    displayName: 'Better Impact',
    icon: 'bi-people',
    description: 'Volunteer management (Volunteer Impact)',
    category: 'Volunteer Management',
    authType: 'username-password',
    baseUrl: 'https://api.betterimpact.com/v1',
    // An admin-created API key yields a username + password pair sent as
    // HTTP Basic auth. Key scope is module-based — a key without the
    // Volunteer module checked returns no volunteers.
    credentialFields: [
      {
        key: 'username',
        label: 'dataConnectors.fields.username',
        type: 'text',
        placeholder: 'API key username',
        required: true,
        helpText: 'dataConnectors.fields.betterimpactKeyHint',
      },
      {
        key: 'password',
        label: 'dataConnectors.fields.password',
        type: 'password',
        placeholder: 'API key password',
        required: true,
      },
    ],
  },
  {
    id: 'rentman',
    displayName: 'Rentman',
    icon: 'bi-truck',
    description: 'Rental management — projects, equipment, crew planning',
    category: 'Rental Management',
    authType: 'token',
    baseUrl: 'https://api.rentman.net',
    // Workspace API token (Configuration → Account → Integrations → API →
    // Show token), sent as a Bearer token. Note: Rentman also runs a
    // first-party MCP server beta (mcp.rentman.net, OAuth 2.1 + PKCE) —
    // a future second surface once the platform supports generic MCP auth.
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.apiToken',
        type: 'password',
        placeholder: 'Paste your Rentman API token',
        required: true,
        helpText: 'dataConnectors.fields.rentmanTokenHint',
      },
    ],
  },
  {
    id: 'jobadder',
    displayName: 'JobAdder',
    icon: 'bi-person-badge',
    description: 'Recruitment ATS — jobs, candidates, applications, placements',
    category: 'Recruitment',
    authType: 'oauth2',
    baseUrl: 'https://api.jobadder.com/v2',
    oauth: {
      authUrl: 'https://id.jobadder.com/connect/authorize',
      tokenUrl: 'https://id.jobadder.com/connect/token',
      // `read write` cover nearly all GET/POST operations; offline_access
      // is required for refresh tokens (access tokens expire after 60 min).
      scopes: 'read write offline_access',
    },
    oauthSetupSteps: [
      'Sign in to the JobAdder Developer Centre at developers.jobadder.com as an administrator',
      'Register a new application',
      "Copy the redirect URI shown in this wizard into the application's redirect URIs (it must match exactly)",
      'Copy the Client ID and Client Secret from the application page, then paste them on the next step (Credentials).',
    ],
  },
  {
    id: 'gohighlevel',
    displayName: 'GoHighLevel',
    icon: 'bi-megaphone',
    description: 'CRM, marketing automation and sales pipelines (HighLevel)',
    category: 'CRM',
    authType: 'token',
    baseUrl: 'https://services.leadconnectorhq.com',
    // Private Integration Token ("pit-..."), created per sub-account in
    // HighLevel → Settings → Private Integrations. Sent as a Bearer token.
    // Every request additionally needs a constant `Version` header — injected
    // automatically by the backend via staticHeaders (agent can override
    // per-call for endpoint families pinned to a different version).
    staticHeaders: { Version: '2021-07-28' },
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.privateIntegrationToken',
        type: 'password',
        placeholder: 'pit-…',
        required: true,
        helpText: 'dataConnectors.fields.gohighlevelTokenHint',
      },
    ],
  },

  // ─── Tier 2: Token (Developer Tools) ────────────────────────────────────
  {
    id: 'gitlab',
    displayName: 'GitLab',
    icon: 'bi-git',
    description: 'Source code, merge requests, issues, pipelines and releases on GitLab',
    category: 'Developer Tools',
    authType: 'token',
    // SaaS GitLab.com default. Self-managed admins set the Instance URL in the
    // wizard to their own API root (e.g. https://gitlab.example.com/api/v4) —
    // the backend resolver prefers the vault instance_url over this base_url.
    baseUrl: 'https://gitlab.com/api/v4',
    instanceUrlOptional: true,
    surfaces: ['chat'],
    rateLimitRpm: 2000, // GitLab.com authenticated default is ~2,000 req/min/user
    // Per-user Personal Access Token (glpat-…), sent as a Bearer token — GitLab
    // accepts a PAT in the Authorization: Bearer header just like an OAuth
    // token. The token carries that user's own GitLab permissions.
    credentialFields: [
      {
        key: 'api_key',
        label: 'dataConnectors.fields.pat',
        type: 'password',
        placeholder: 'glpat-…',
        required: true,
        helpText: 'dataConnectors.fields.gitlabTokenHint',
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
